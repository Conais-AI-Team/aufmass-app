import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: new URL('../.env', import.meta.url) });

const APPLY = process.argv.includes('--apply');
const SOURCE_CATALOG_BRANCH = 'aylux';
const SIEGEN_BRANCH = 'ayluxsi';
const SIEGEN_EMAIL = 'siegen@aylux.de';
const DUESSELDORF_BRANCH = 'ayluxd';
const DUESSELDORF_EMAIL = 'admin@ayluxd.cnsform.com';
const DISABLED_BRANCHES = [
  { slug: 'ayluxl', reason: 'Leipzig şubesi bulunmuyor' },
  { slug: 'ayluxdo', reason: 'Dortmund şubesi bulunmuyor' },
  { slug: 'ayluxau', reason: 'Augsburg şubesi bulunmuyor' },
];

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function createTemporaryPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%';
  const all = upper + lower + digits + symbols;
  const chars = [
    upper[crypto.randomInt(upper.length)],
    lower[crypto.randomInt(lower.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];
  while (chars.length < 14) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function getBranchUsage(client, slug) {
  const columns = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name IN ('branch_id', 'branch_slug')
    ORDER BY table_name, column_name
  `);

  const usage = [];
  for (const row of columns.rows) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM ${quoteIdentifier(row.table_name)}
       WHERE ${quoteIdentifier(row.column_name)} = $1`,
      [slug],
    );
    const count = Number(result.rows[0]?.count || 0);
    if (count > 0) {
      usage.push({
        table: row.table_name,
        column: row.column_name,
        count,
      });
    }
  }
  return usage;
}

function assertBranchCanBeDeactivated(slug, usage) {
  const allowedTables = new Set([
    'aufmass_lead_products',
    'aufmass_lead_products_backup_20260715',
    'aufmass_lead_products_backup_lewens_20260710',
    'aufmass_lead_products_bak_aylux_20260703',
    'aufmass_users',
  ]);
  const businessRows = usage.filter((row) => !allowedTables.has(row.table));
  if (businessRows.length > 0) {
    throw new Error(
      `${slug} has business data and cannot be deactivated automatically: ${JSON.stringify(businessRows)}`,
    );
  }
}

async function ensureBranch(client, slug, name) {
  await client.query(
    `INSERT INTO aufmass_branches (slug, name, is_active)
     VALUES ($1, $2, true)
     ON CONFLICT (slug)
     DO UPDATE SET name = EXCLUDED.name, is_active = true`,
    [slug, name],
  );
}

async function ensureAdminUser(client, {
  email,
  passwordHash,
  name,
  branchId,
}) {
  const existing = await client.query(
    `SELECT id, branch_id
     FROM aufmass_users
     WHERE email = $1
     FOR UPDATE`,
    [email],
  );

  if (existing.rows.length > 0) {
    const userId = existing.rows[0].id;
    await client.query(
      `UPDATE aufmass_users
       SET password_hash = $2,
           name = $3,
           role = 'admin',
           branch_id = $4,
           is_active = true,
           updated_at = NOW()
       WHERE id = $1`,
      [userId, passwordHash, name, branchId],
    );
    return {
      id: userId,
      previousBranchId: existing.rows[0].branch_id,
      created: false,
    };
  }

  const inserted = await client.query(
    `INSERT INTO aufmass_users
       (email, password_hash, name, role, branch_id, is_active)
     VALUES ($1, $2, $3, 'admin', $4, true)
     RETURNING id`,
    [email, passwordHash, name, branchId],
  );
  return {
    id: inserted.rows[0].id,
    previousBranchId: null,
    created: true,
  };
}

async function getTablesWithOwnerAndBranch(client, ownerColumn) {
  const result = await client.query(`
    SELECT owner_col.table_name,
           branch_col.column_name AS branch_column
    FROM information_schema.columns owner_col
    JOIN information_schema.columns branch_col
      ON branch_col.table_schema = owner_col.table_schema
     AND branch_col.table_name = owner_col.table_name
     AND branch_col.column_name IN ('branch_id', 'branch_slug')
    WHERE owner_col.table_schema = current_schema()
      AND owner_col.column_name = $1
    ORDER BY owner_col.table_name
  `, [ownerColumn]);
  return result.rows;
}

async function moveRelatedRows(client, ownerColumn, ownerIds, targetBranch) {
  if (ownerIds.length === 0) return [];

  const tables = await getTablesWithOwnerAndBranch(client, ownerColumn);
  const changes = [];
  for (const row of tables) {
    const updated = await client.query(
      `UPDATE ${quoteIdentifier(row.table_name)}
       SET ${quoteIdentifier(row.branch_column)} = $1
       WHERE ${quoteIdentifier(ownerColumn)} = ANY($2::int[])
         AND ${quoteIdentifier(row.branch_column)} IS DISTINCT FROM $1`,
      [targetBranch, ownerIds],
    );
    if (updated.rowCount > 0) {
      changes.push({
        table: row.table_name,
        column: row.branch_column,
        count: updated.rowCount,
      });
    }
  }
  return changes;
}

async function cloneCatalogIfNeeded(client, sourceBranch, targetBranch) {
  const counts = await client.query(
    `SELECT branch_id, COUNT(*)::int AS count
     FROM aufmass_lead_products
     WHERE branch_id IN ($1, $2)
     GROUP BY branch_id`,
    [sourceBranch, targetBranch],
  );
  const countByBranch = Object.fromEntries(
    counts.rows.map((row) => [row.branch_id, Number(row.count)]),
  );
  const sourceCount = countByBranch[sourceBranch] || 0;
  const targetCount = countByBranch[targetBranch] || 0;

  if (sourceCount === 0) {
    throw new Error(`Source catalog ${sourceBranch} is empty`);
  }
  if (targetCount === sourceCount) {
    return { sourceCount, targetCount, inserted: 0, skipped: true };
  }
  if (targetCount > 0) {
    throw new Error(
      `Target catalog ${targetBranch} already has ${targetCount} rows; expected 0 or ${sourceCount}`,
    );
  }

  const columnResult = await client.query(`
    SELECT column_name, is_identity, is_generated
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'aufmass_lead_products'
    ORDER BY ordinal_position
  `);
  const columns = columnResult.rows
    .filter((row) => (
      row.column_name !== 'id'
      && row.is_identity !== 'YES'
      && row.is_generated === 'NEVER'
    ))
    .map((row) => row.column_name);
  if (!columns.includes('branch_id')) {
    throw new Error('aufmass_lead_products.branch_id column not found');
  }

  const insertColumns = columns.map(quoteIdentifier).join(', ');
  const selectColumns = columns.map((column) => (
    column === 'branch_id'
      ? '$1::varchar'
      : quoteIdentifier(column)
  )).join(', ');

  const inserted = await client.query(
    `INSERT INTO aufmass_lead_products (${insertColumns})
     SELECT ${selectColumns}
     FROM aufmass_lead_products
     WHERE branch_id = $2`,
    [targetBranch, sourceBranch],
  );
  if (inserted.rowCount !== sourceCount) {
    throw new Error(
      `Catalog clone count mismatch: inserted ${inserted.rowCount}, expected ${sourceCount}`,
    );
  }
  return {
    sourceCount,
    targetCount: inserted.rowCount,
    inserted: inserted.rowCount,
    skipped: false,
  };
}

async function readPdfRoster(client) {
  const branches = await client.query(`
    SELECT slug, name, is_active
    FROM aufmass_branches
    ORDER BY is_active DESC, name, slug
  `);
  const users = await client.query(`
    SELECT branch_id, email, name, role, is_active
    FROM aufmass_users
    WHERE branch_id IS NOT NULL
    ORDER BY branch_id, role, email
  `);
  const usersByBranch = {};
  for (const user of users.rows) {
    if (!usersByBranch[user.branch_id]) usersByBranch[user.branch_id] = [];
    usersByBranch[user.branch_id].push({
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.is_active,
    });
  }
  return branches.rows.map((branch) => ({
    slug: branch.slug,
    name: branch.name,
    isActive: branch.is_active,
    url: `https://${branch.slug}.cnsform.com`,
    users: usersByBranch[branch.slug] || [],
  }));
}

async function audit(client) {
  const branchRows = await client.query(
    `SELECT b.id, b.slug, b.name, b.is_active,
            (SELECT COUNT(*)::int FROM aufmass_forms f WHERE f.branch_id = b.slug) AS form_count,
            (SELECT COUNT(*)::int FROM aufmass_leads l WHERE l.branch_id = b.slug) AS lead_count,
            (SELECT COUNT(*)::int FROM aufmass_users u WHERE u.branch_id = b.slug) AS user_count
     FROM aufmass_branches b
     WHERE b.slug IN (
       'ayluxau',
       'ayluxb',
       'ayluxd',
       'ayluxdo',
       'ayluxgkmu',
       'ayluxl',
       'ayluxmau',
       'ayluxsi'
     )
     ORDER BY b.slug`,
  );
  const siegenUser = await client.query(
    `SELECT id, email, name, role, branch_id, is_active
     FROM aufmass_users
     WHERE email IN ($1, $2)
     ORDER BY email`,
    [SIEGEN_EMAIL, DUESSELDORF_EMAIL],
  );
  const siegenOwned = siegenUser.rows.find((user) => user.email === SIEGEN_EMAIL);
  let ownedForms = [];
  let ownedLeads = [];
  if (siegenOwned) {
    const forms = await client.query(
      `SELECT id, branch_id, status, lead_id
       FROM aufmass_forms
       WHERE created_by = $1
       ORDER BY id`,
      [siegenOwned.id],
    );
    ownedForms = forms.rows;
    const leads = await client.query(
      `SELECT id, branch_id, status
       FROM aufmass_leads
       WHERE created_by = $1
       ORDER BY id`,
      [siegenOwned.id],
    );
    ownedLeads = leads.rows;
  }
  const disabledBranchUsage = {};
  for (const branch of DISABLED_BRANCHES) {
    disabledBranchUsage[branch.slug] = await getBranchUsage(client, branch.slug);
  }
  return {
    mode: APPLY ? 'apply' : 'dry-run',
    branches: branchRows.rows,
    relevantUsers: siegenUser.rows,
    siegenOwnedForms: ownedForms,
    siegenOwnedLeads: ownedLeads,
    disabledBranchUsage,
  };
}

const client = await pool.connect();
try {
  const before = await audit(client);
  for (const branch of DISABLED_BRANCHES) {
    assertBranchCanBeDeactivated(
      branch.slug,
      before.disabledBranchUsage[branch.slug],
    );
  }

  if (!APPLY) {
    process.stdout.write(`${JSON.stringify(before)}\n`);
    process.exitCode = 0;
  } else {
    const duesseldorfPassword = createTemporaryPassword();
    const siegenPassword = createTemporaryPassword();
    const [duesseldorfHash, siegenHash] = await Promise.all([
      bcrypt.hash(duesseldorfPassword, 12),
      bcrypt.hash(siegenPassword, 12),
    ]);

    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL statement_timeout = '15min'`);
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      await client.query('SELECT pg_advisory_xact_lock($1)', [20260729]);

      await client.query(
        `UPDATE aufmass_branches
         SET name = CASE slug
           WHEN 'ayluxb' THEN 'AYLUX Berlin GmbH'
           WHEN 'ayluxd' THEN 'AYLUX Düsseldorf GmbH'
           WHEN 'ayluxgkmu' THEN 'AYLUX Gelsenkirchen & Münster GmbH'
           WHEN 'ayluxmau' THEN 'AYLUX München GmbH'
           ELSE name
         END
         WHERE slug IN ('ayluxb', 'ayluxd', 'ayluxgkmu', 'ayluxmau')`,
      );

      await ensureBranch(client, SIEGEN_BRANCH, 'AYLUX Siegen GmbH');

      const disabledBranches = [];
      for (const branch of DISABLED_BRANCHES) {
        const branchUpdate = await client.query(
          `UPDATE aufmass_branches
           SET is_active = false
           WHERE slug = $1
           RETURNING slug`,
          [branch.slug],
        );
        const userUpdate = await client.query(
          `UPDATE aufmass_users
           SET is_active = false, updated_at = NOW()
           WHERE branch_id = $1
             AND is_active IS DISTINCT FROM false`,
          [branch.slug],
        );
        disabledBranches.push({
          slug: branch.slug,
          reason: branch.reason,
          branchFound: branchUpdate.rowCount > 0,
          usersDeactivated: userUpdate.rowCount,
        });
      }

      const duesseldorfUser = await ensureAdminUser(client, {
        email: DUESSELDORF_EMAIL,
        passwordHash: duesseldorfHash,
        name: 'Admin Düsseldorf',
        branchId: DUESSELDORF_BRANCH,
      });
      const siegenUser = await ensureAdminUser(client, {
        email: SIEGEN_EMAIL,
        passwordHash: siegenHash,
        name: 'Ömer Ayhan',
        branchId: SIEGEN_BRANCH,
      });

      const unexpectedSiegenForms = await client.query(
        `SELECT id, branch_id
         FROM aufmass_forms
         WHERE created_by = $1
           AND branch_id NOT IN ('aylux', $2)`,
        [siegenUser.id, SIEGEN_BRANCH],
      );
      if (unexpectedSiegenForms.rows.length > 0) {
        throw new Error(
          `Siegen user owns forms in unexpected branches: ${JSON.stringify(unexpectedSiegenForms.rows)}`,
        );
      }
      const unexpectedSiegenLeads = await client.query(
        `SELECT id, branch_id
         FROM aufmass_leads
         WHERE created_by = $1
           AND branch_id NOT IN ('aylux', $2)`,
        [siegenUser.id, SIEGEN_BRANCH],
      );
      if (unexpectedSiegenLeads.rows.length > 0) {
        throw new Error(
          `Siegen user owns leads in unexpected branches: ${JSON.stringify(unexpectedSiegenLeads.rows)}`,
        );
      }

      const movedForms = await client.query(
        `UPDATE aufmass_forms
         SET branch_id = $1, updated_at = NOW()
         WHERE created_by = $2
           AND branch_id = 'aylux'
         RETURNING id`,
        [SIEGEN_BRANCH, siegenUser.id],
      );
      const movedFormIds = movedForms.rows.map((row) => row.id);
      const movedLeads = await client.query(
        `UPDATE aufmass_leads
         SET branch_id = $1, updated_at = NOW()
         WHERE created_by = $2
           AND branch_id = 'aylux'
         RETURNING id`,
        [SIEGEN_BRANCH, siegenUser.id],
      );
      const movedLeadIds = movedLeads.rows.map((row) => row.id);

      const relatedFormChanges = await moveRelatedRows(
        client,
        'form_id',
        movedFormIds,
        SIEGEN_BRANCH,
      );
      const relatedLeadChanges = await moveRelatedRows(
        client,
        'lead_id',
        movedLeadIds,
        SIEGEN_BRANCH,
      );
      const relatedUserChanges = await moveRelatedRows(
        client,
        'user_id',
        [siegenUser.id],
        SIEGEN_BRANCH,
      );
      await client.query(
        `UPDATE aufmass_invitations
         SET branch_id = $1
         WHERE LOWER(email) = LOWER($2)
           AND branch_id IS DISTINCT FROM $1`,
        [SIEGEN_BRANCH, SIEGEN_EMAIL],
      );

      const catalog = await cloneCatalogIfNeeded(
        client,
        SOURCE_CATALOG_BRANCH,
        SIEGEN_BRANCH,
      );
      await client.query(
        `INSERT INTO aufmass_branch_settings (branch_slug)
         SELECT $1
         WHERE NOT EXISTS (
           SELECT 1
           FROM aufmass_branch_settings
           WHERE branch_slug = $1
         )`,
        [SIEGEN_BRANCH],
      );

      const after = await audit(client);
      const roster = await readPdfRoster(client);
      const result = {
        mode: 'apply',
        appliedAt: new Date().toISOString(),
        credentials: [
          {
            branchSlug: DUESSELDORF_BRANCH,
            branchName: 'AYLUX Düsseldorf GmbH',
            url: `https://${DUESSELDORF_BRANCH}.cnsform.com`,
            email: DUESSELDORF_EMAIL,
            temporaryPassword: duesseldorfPassword,
          },
          {
            branchSlug: SIEGEN_BRANCH,
            branchName: 'AYLUX Siegen GmbH',
            url: `https://${SIEGEN_BRANCH}.cnsform.com`,
            email: SIEGEN_EMAIL,
            temporaryPassword: siegenPassword,
          },
        ],
        duesseldorfUser,
        siegenUser,
        movedFormIds,
        movedLeadIds,
        relatedFormChanges,
        relatedLeadChanges,
        relatedUserChanges,
        disabledBranches,
        catalog,
        before,
        after,
        roster,
      };
      await client.query('COMMIT');
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  }
} catch (error) {
  console.error(`Branch provisioning failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
