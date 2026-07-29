import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const LOCAL_PEER = process.argv.includes('--local-peer');
const serverDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

if (!LOCAL_PEER) {
  const envPath = path.join(serverDirectory, '.env');
  const envResult = dotenv.config({ path: envPath });
  if (envResult.error) {
    throw new Error(`Could not load server/.env: ${envResult.error.message}`);
  }
}

const databaseConfig = LOCAL_PEER
  ? {
    host: '/var/run/postgresql',
    port: 5432,
    database: 'aylux_aufmass_db',
    user: 'postgres',
  }
  : {
    host: process.env.PG_HOST || process.env.DB_HOST || process.env.DB_SERVER,
    port: Number(process.env.PG_PORT || process.env.DB_PORT || 5432),
    database: process.env.PG_DATABASE || process.env.DB_DATABASE,
    user: process.env.PG_USER || process.env.DB_USER,
    password: (
      process.env.PG_PASSWORD
      || process.env.DB_PASSWORD
      || process.env.POSTGRES_PASSWORD
    ),
  };

const missingDatabaseSettings = Object.entries(databaseConfig)
  .filter(([, value]) => value === undefined || value === null || value === '')
  .map(([key]) => key);
if (missingDatabaseSettings.length > 0) {
  throw new Error(
    `Missing database settings: ${missingDatabaseSettings.join(', ')}`,
  );
}

const pool = new pg.Pool({
  ...databaseConfig,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

const FULL_MOVES = [
  {
    source: 'ayluxmau',
    target: 'ayluxmu',
    targetName: 'AYLUX München GmbH',
    oldAdminEmail: 'admin@ayluxmau.cnsform.com',
    newAdminEmail: 'admin@ayluxmu.cnsform.com',
    adminName: 'Admin München',
  },
  {
    source: 'ayluxgkmu',
    target: 'ayluxgk',
    targetName: 'AYLUX Gelsenkirchen GmbH',
    oldAdminEmail: 'admin@ayluxgkmu.cnsform.com',
    newAdminEmail: 'admin@ayluxgk.cnsform.com',
    adminName: 'Admin Gelsenkirchen',
  },
];

const CATALOG_CLONES = [
  {
    source: 'ayluxgkmu',
    target: 'ayluxms',
    targetName: 'AYLUX Münster GmbH',
    cloneSettings: true,
  },
  {
    source: 'aylux',
    target: 'ayluxsi',
    targetName: 'AYLUX Siegen GmbH',
    cloneSettings: false,
  },
];

const DISABLED_BRANCHES = [
  { slug: 'ayluxl', reason: 'Leipzig şubesi bulunmuyor' },
  { slug: 'ayluxdo', reason: 'Dortmund şubesi bulunmuyor' },
  { slug: 'ayluxau', reason: 'Augsburg şubesi bulunmuyor' },
];

const BUSINESS_TABLES = new Set([
  'aufmass_forms',
  'aufmass_leads',
  'aufmass_rechnungen',
  'aufmass_anzahlungen',
  'aufmass_email_log',
  'aufmass_support_tickets',
]);

const SIEGEN_EMAIL = 'siegen@aylux.de';
const DUESSELDORF_EMAIL = 'admin@ayluxd.cnsform.com';
const ADVISORY_LOCK = 2026073001;
const productImagesDirectory = path.join(serverDirectory, 'product-images');
const branchUploadsDirectory = path.join(
  serverDirectory,
  'aufmass-pdfs',
  'branch-uploads',
);
const createdFiles = [];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tempTableName(target) {
  return `tmp_product_map_${target.replaceAll(/[^a-z0-9_]/gi, '_')}`;
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
  while (chars.length < 14) {
    chars.push(all[crypto.randomInt(all.length)]);
  }
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [chars[index], chars[swapIndex]] = [chars[swapIndex], chars[index]];
  }
  return chars.join('');
}

async function getBranchScopedColumns(client) {
  const result = await client.query(`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
     AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = current_schema()
      AND c.column_name IN ('branch_id', 'branch_slug')
    ORDER BY c.table_name, c.column_name
  `);
  return result.rows;
}

async function getBranchUsage(client, slug, scopedColumns = null) {
  const columns = scopedColumns || await getBranchScopedColumns(client);
  const usage = [];
  for (const row of columns) {
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

function summarizeUsage(usage) {
  return Object.fromEntries(
    usage.map((row) => [`${row.table}.${row.column}`, row.count]),
  );
}

function assertVacantTarget(slug, usage) {
  if (usage.length > 0) {
    throw new Error(
      `Target branch ${slug} is not empty: ${JSON.stringify(usage)}`,
    );
  }
}

function assertUnusedBranchHasNoBusinessData(slug, usage) {
  const businessRows = usage.filter((row) => BUSINESS_TABLES.has(row.table));
  if (businessRows.length > 0) {
    throw new Error(
      `Unused branch ${slug} has business data: ${JSON.stringify(businessRows)}`,
    );
  }
}

async function readBranchRecord(client, slug) {
  const result = await client.query(
    `SELECT id, slug, name, is_active
     FROM aufmass_branches
     WHERE slug = $1`,
    [slug],
  );
  return result.rows[0] || null;
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

async function catalogSummary(client, slug) {
  const result = await client.query(
    `WITH normalized AS (
       SELECT MD5(
         (TO_JSONB(p) - 'id' - 'branch_id')::text
       ) AS row_hash
       FROM aufmass_lead_products p
       WHERE p.branch_id = $1
     )
     SELECT
       (SELECT COUNT(*)::int
        FROM aufmass_lead_products
        WHERE branch_id = $1) AS total,
       (SELECT COUNT(*)::int
        FROM aufmass_lead_products
        WHERE branch_id = $1
          AND COALESCE(is_active, true) = true) AS active,
       (SELECT COUNT(*)::int
        FROM aufmass_lead_products
        WHERE branch_id = $1
          AND price IS NOT NULL
          AND price <> 0) AS priced,
       MD5(COALESCE(
         STRING_AGG(row_hash, '' ORDER BY row_hash),
         ''
       )) AS checksum
     FROM normalized`,
    [slug],
  );
  return result.rows[0];
}

async function branchBusinessSummary(client, slug) {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::int
        FROM aufmass_users
        WHERE branch_id = $1) AS users,
       (SELECT COUNT(*)::int
        FROM aufmass_users
        WHERE branch_id = $1 AND is_active = true) AS active_users,
       (SELECT COUNT(*)::int
        FROM aufmass_forms
        WHERE branch_id = $1) AS aufmass,
       (SELECT COUNT(*)::int
        FROM aufmass_leads
        WHERE branch_id = $1) AS leads,
       (SELECT COUNT(*)::int
        FROM aufmass_angebot a
        JOIN aufmass_forms f ON f.id = a.form_id
        WHERE f.branch_id = $1) AS form_angebote,
       (SELECT COUNT(*)::int
        FROM aufmass_angebot_items i
        JOIN aufmass_forms f ON f.id = i.form_id
        WHERE f.branch_id = $1) AS form_angebot_items,
       (SELECT COUNT(*)::int
        FROM aufmass_forms
        WHERE branch_id = $1 AND generated_pdf IS NOT NULL)
        AS generated_aufmass_pdfs,
       (SELECT COUNT(*)::int
        FROM aufmass_bilder b
        JOIN aufmass_forms f ON f.id = b.form_id
        WHERE f.branch_id = $1) AS uploaded_files,
       (SELECT COUNT(*)::int
        FROM aufmass_form_pdf_snapshots s
        JOIN aufmass_forms f ON f.id = s.form_id
        WHERE f.branch_id = $1) AS pdf_snapshots,
       (SELECT COUNT(DISTINCT r.id)::int
        FROM aufmass_rechnungen r
        LEFT JOIN aufmass_forms f ON f.id = r.form_id
        WHERE r.branch_id = $1 OR f.branch_id = $1) AS rechnungen,
       (SELECT COUNT(DISTINCT a.id)::int
        FROM aufmass_anzahlungen a
        LEFT JOIN aufmass_forms f ON f.id = a.form_id
        WHERE a.branch_id = $1 OR f.branch_id = $1) AS anzahlungen,
       (SELECT COUNT(*)::int
        FROM aufmass_abnahme a
        JOIN aufmass_forms f ON f.id = a.form_id
        WHERE f.branch_id = $1) AS abnahmen`,
    [slug],
  );
  return result.rows[0];
}

async function branchAssetSummary(client, slug) {
  const images = await client.query(
    `SELECT image.id,
            image.product_id,
            image.image_path,
            product.id IS NULL AS orphaned
     FROM aufmass_product_images image
     LEFT JOIN aufmass_lead_products product
       ON product.id = image.product_id
      AND product.branch_id = image.branch_slug
     WHERE image.branch_slug = $1
     ORDER BY image.id`,
    [slug],
  );
  const covers = await client.query(
    `SELECT cover.id,
            cover.product_id,
            cover.file_path,
            product.id IS NULL AS orphaned
     FROM aufmass_product_cover_pdfs cover
     LEFT JOIN aufmass_lead_products product
       ON product.id = cover.product_id
      AND product.branch_id = cover.branch_slug
     WHERE cover.branch_slug = $1
     ORDER BY cover.id`,
    [slug],
  );
  const terms = await client.query(
    `SELECT branch_slug, agb_pdf_path
     FROM aufmass_branch_terms
     WHERE branch_slug = $1`,
    [slug],
  );

  const missingImages = images.rows.filter((row) => (
    !fs.existsSync(path.join(productImagesDirectory, row.image_path))
  ));
  const missingCovers = covers.rows.filter((row) => (
    !fs.existsSync(
      path.join(branchUploadsDirectory, slug, row.file_path),
    )
  ));
  const agbPath = terms.rows[0]?.agb_pdf_path || null;
  const agbExists = !agbPath || fs.existsSync(
    path.join(branchUploadsDirectory, slug, agbPath),
  );

  return {
    productImages: images.rows.length,
    productCoverPdfs: covers.rows.length,
    hasBranchTerms: terms.rows.length > 0,
    agbPdfPath: agbPath,
    branchUploadDirectoryExists: fs.existsSync(
      path.join(branchUploadsDirectory, slug),
    ),
    missingProductImageFiles: missingImages.map((row) => row.image_path),
    missingCoverPdfFiles: missingCovers.map((row) => row.file_path),
    orphanedProductImages: images.rows
      .filter((row) => row.orphaned)
      .map((row) => row.id),
    orphanedProductCoverPdfs: covers.rows
      .filter((row) => row.orphaned)
      .map((row) => row.id),
    agbPdfExists: agbExists,
  };
}

async function cloneTableRows(
  client,
  tableName,
  branchColumn,
  source,
  target,
  overrides = {},
) {
  const targetCount = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM ${quoteIdentifier(tableName)}
     WHERE ${quoteIdentifier(branchColumn)} = $1`,
    [target],
  );
  if (Number(targetCount.rows[0].count) > 0) {
    throw new Error(`${tableName} already has rows for ${target}`);
  }

  const columnResult = await client.query(
    `SELECT column_name, column_default, is_identity, is_generated
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName],
  );
  const columns = columnResult.rows.filter((column) => (
    column.is_identity !== 'YES'
    && column.is_generated === 'NEVER'
    && !(
      column.column_name === 'id'
      && column.column_default?.includes('nextval(')
    )
  ));
  const insertColumns = columns
    .map((column) => quoteIdentifier(column.column_name))
    .join(', ');
  const values = [];
  const selectColumns = columns.map((column) => {
    if (column.column_name === branchColumn) {
      values.push(target);
      return `$${values.length}`;
    }
    if (Object.hasOwn(overrides, column.column_name)) {
      values.push(overrides[column.column_name]);
      return `$${values.length}`;
    }
    return `source.${quoteIdentifier(column.column_name)}`;
  }).join(', ');
  values.push(source);

  const inserted = await client.query(
    `INSERT INTO ${quoteIdentifier(tableName)} (${insertColumns})
     SELECT ${selectColumns}
     FROM ${quoteIdentifier(tableName)} source
     WHERE source.${quoteIdentifier(branchColumn)} = $${values.length}`,
    values,
  );
  return inserted.rowCount;
}

async function cloneCatalog(client, source, target) {
  const sourceSummary = await catalogSummary(client, source);
  const targetBefore = await catalogSummary(client, target);
  if (Number(sourceSummary.total) === 0) {
    throw new Error(`Source catalog ${source} is empty`);
  }
  if (Number(targetBefore.total) !== 0) {
    throw new Error(`Target catalog ${target} is not empty`);
  }

  const sequenceResult = await client.query(
    `SELECT pg_get_serial_sequence(
       'aufmass_lead_products',
       'id'
     ) AS sequence_name`,
  );
  const sequenceName = sequenceResult.rows[0]?.sequence_name;
  if (!sequenceName) {
    throw new Error('aufmass_lead_products id sequence not found');
  }

  const mappingTable = tempTableName(target);
  await client.query(
    `CREATE TEMP TABLE ${quoteIdentifier(mappingTable)} (
       source_id INT PRIMARY KEY,
       target_id INT UNIQUE NOT NULL
     ) ON COMMIT DROP`,
  );
  await client.query(
    `INSERT INTO ${quoteIdentifier(mappingTable)} (source_id, target_id)
     SELECT id, NEXTVAL($1::regclass)
     FROM aufmass_lead_products
     WHERE branch_id = $2
     ORDER BY id`,
    [sequenceName, source],
  );

  const columnResult = await client.query(`
    SELECT column_name, is_identity, is_generated
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'aufmass_lead_products'
    ORDER BY ordinal_position
  `);
  const columns = columnResult.rows.filter((column) => (
    column.is_identity !== 'YES' && column.is_generated === 'NEVER'
  ));
  const insertColumns = columns
    .map((column) => quoteIdentifier(column.column_name))
    .join(', ');
  const selectColumns = columns.map((column) => {
    if (column.column_name === 'id') return 'mapping.target_id';
    if (column.column_name === 'branch_id') return '$1::varchar';
    return `source.${quoteIdentifier(column.column_name)}`;
  }).join(', ');

  const inserted = await client.query(
    `INSERT INTO aufmass_lead_products (${insertColumns})
     SELECT ${selectColumns}
     FROM aufmass_lead_products source
     JOIN ${quoteIdentifier(mappingTable)} mapping
       ON mapping.source_id = source.id
     WHERE source.branch_id = $2
     ORDER BY source.id`,
    [target, source],
  );
  if (inserted.rowCount !== Number(sourceSummary.total)) {
    throw new Error(
      `Catalog clone mismatch for ${target}: `
      + `${inserted.rowCount}/${sourceSummary.total}`,
    );
  }

  const targetAfter = await catalogSummary(client, target);
  if (
    Number(targetAfter.total) !== Number(sourceSummary.total)
    || targetAfter.checksum !== sourceSummary.checksum
  ) {
    throw new Error(
      `Catalog verification failed for ${source} -> ${target}`,
    );
  }

  return {
    source,
    target,
    sourceSummary,
    targetSummary: targetAfter,
    mappingTable,
  };
}

function ensureDirectory(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function copyTrackedFile(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Required file is missing: ${sourcePath}`);
  }
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
  createdFiles.push(targetPath);
}

async function cloneProductAssets(
  client,
  source,
  target,
  mappingTable,
) {
  const images = await client.query(
    `SELECT image.*,
            mapping.target_id
     FROM aufmass_product_images image
     JOIN ${quoteIdentifier(mappingTable)} mapping
       ON mapping.source_id = image.product_id
     WHERE image.branch_slug = $1
     ORDER BY image.id`,
    [source],
  );
  const sourceImageCount = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM aufmass_product_images
     WHERE branch_slug = $1`,
    [source],
  );
  if (images.rows.length !== Number(sourceImageCount.rows[0].count)) {
    throw new Error(
      `Some ${source} product images do not map to catalog rows`,
    );
  }
  for (const image of images.rows) {
    const extension = path.extname(image.image_path);
    const newFilename = (
      `${target}-${crypto.randomUUID()}${extension}`
    );
    copyTrackedFile(
      path.join(productImagesDirectory, image.image_path),
      path.join(productImagesDirectory, newFilename),
    );
    await client.query(
      `INSERT INTO aufmass_product_images
         (branch_slug, product_id, image_path, image_order,
          show_on_cover, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        target,
        image.target_id,
        newFilename,
        image.image_order,
        image.show_on_cover,
        image.uploaded_at,
      ],
    );
  }

  const covers = await client.query(
    `SELECT cover.*,
            mapping.target_id
     FROM aufmass_product_cover_pdfs cover
     JOIN ${quoteIdentifier(mappingTable)} mapping
       ON mapping.source_id = cover.product_id
     WHERE cover.branch_slug = $1
     ORDER BY cover.id`,
    [source],
  );
  const sourceCoverCount = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM aufmass_product_cover_pdfs
     WHERE branch_slug = $1`,
    [source],
  );
  if (covers.rows.length !== Number(sourceCoverCount.rows[0].count)) {
    throw new Error(
      `Some ${source} cover PDFs do not map to catalog rows`,
    );
  }
  for (const cover of covers.rows) {
    const newFilename = (
      `${target}-${crypto.randomUUID()}${path.extname(cover.file_path)}`
    );
    copyTrackedFile(
      path.join(branchUploadsDirectory, source, cover.file_path),
      path.join(branchUploadsDirectory, target, newFilename),
    );
    await client.query(
      `INSERT INTO aufmass_product_cover_pdfs
         (branch_slug, product_id, file_path, selected_pages,
          page_count, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        target,
        cover.target_id,
        newFilename,
        cover.selected_pages == null
          ? null
          : JSON.stringify(cover.selected_pages),
        cover.page_count,
        cover.uploaded_at,
      ],
    );
  }
  return {
    productImages: images.rows.length,
    productCoverPdfs: covers.rows.length,
  };
}

async function cloneSettingsAndTerms(client, source, target) {
  const settings = await cloneTableRows(
    client,
    'aufmass_branch_settings',
    'branch_slug',
    source,
    target,
  );

  const sourceTerms = await client.query(
    `SELECT agb_pdf_path
     FROM aufmass_branch_terms
     WHERE branch_slug = $1`,
    [source],
  );
  let terms = 0;
  if (sourceTerms.rows.length > 0) {
    const sourceAgbPath = sourceTerms.rows[0].agb_pdf_path;
    let targetAgbPath = sourceAgbPath;
    if (sourceAgbPath) {
      targetAgbPath = (
        `${target}-${crypto.randomUUID()}${path.extname(sourceAgbPath)}`
      );
      copyTrackedFile(
        path.join(branchUploadsDirectory, source, sourceAgbPath),
        path.join(branchUploadsDirectory, target, targetAgbPath),
      );
    }
    terms = await cloneTableRows(
      client,
      'aufmass_branch_terms',
      'branch_slug',
      source,
      target,
      { agb_pdf_path: targetAgbPath },
    );
  }
  return { settings, terms };
}

async function copyBranchUploadDirectory(source, target) {
  const sourceDirectory = path.join(branchUploadsDirectory, source);
  const targetDirectory = path.join(branchUploadsDirectory, target);
  if (!fs.existsSync(sourceDirectory)) {
    return { copied: false, files: 0 };
  }
  if (fs.existsSync(targetDirectory)) {
    const entries = fs.readdirSync(targetDirectory);
    if (entries.length > 0) {
      throw new Error(
        `Target branch upload directory is not empty: ${targetDirectory}`,
      );
    }
  }
  ensureDirectory(targetDirectory);
  let fileCount = 0;
  for (const entry of fs.readdirSync(sourceDirectory, {
    withFileTypes: true,
    recursive: true,
  })) {
    if (!entry.isFile()) continue;
    const sourcePath = path.join(entry.parentPath, entry.name);
    const relativePath = path.relative(sourceDirectory, sourcePath);
    const targetPath = path.join(targetDirectory, relativePath);
    copyTrackedFile(sourcePath, targetPath);
    fileCount += 1;
  }
  return { copied: true, files: fileCount };
}

async function moveEntireBranch(
  client,
  source,
  target,
  scopedColumns,
) {
  const changes = [];
  for (const row of scopedColumns) {
    const result = await client.query(
      `UPDATE ${quoteIdentifier(row.table_name)}
       SET ${quoteIdentifier(row.column_name)} = $1
       WHERE ${quoteIdentifier(row.column_name)} = $2`,
      [target, source],
    );
    if (result.rowCount > 0) {
      changes.push({
        table: row.table_name,
        column: row.column_name,
        count: result.rowCount,
      });
    }
  }
  await client.query(
    `UPDATE aufmass_branches
     SET is_active = false
     WHERE slug = $1`,
    [source],
  );
  return changes;
}

async function getOwnerBranchTables(client, ownerColumn) {
  const result = await client.query(
    `SELECT owner.table_name,
            branch.column_name AS branch_column
     FROM information_schema.columns owner
     JOIN information_schema.columns branch
       ON branch.table_schema = owner.table_schema
      AND branch.table_name = owner.table_name
      AND branch.column_name IN ('branch_id', 'branch_slug')
     JOIN information_schema.tables table_info
       ON table_info.table_schema = owner.table_schema
      AND table_info.table_name = owner.table_name
      AND table_info.table_type = 'BASE TABLE'
     WHERE owner.table_schema = current_schema()
       AND owner.column_name = $1
     ORDER BY owner.table_name`,
    [ownerColumn],
  );
  return result.rows;
}

async function moveRelatedRows(
  client,
  ownerColumn,
  ownerIds,
  targetBranch,
) {
  if (ownerIds.length === 0) return [];
  const tables = await getOwnerBranchTables(client, ownerColumn);
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

async function moveSiegenData(client) {
  const userResult = await client.query(
    `SELECT id, branch_id
     FROM aufmass_users
     WHERE LOWER(email) = LOWER($1)
     FOR UPDATE`,
    [SIEGEN_EMAIL],
  );
  if (userResult.rows.length !== 1) {
    throw new Error(
      `Expected exactly one Siegen user, found ${userResult.rows.length}`,
    );
  }
  const userId = userResult.rows[0].id;
  const unexpectedForms = await client.query(
    `SELECT id, branch_id
     FROM aufmass_forms
     WHERE created_by = $1
       AND branch_id NOT IN ('aylux', 'ayluxsi')`,
    [userId],
  );
  if (unexpectedForms.rows.length > 0) {
    throw new Error(
      `Siegen user owns forms in unexpected branches: `
      + JSON.stringify(unexpectedForms.rows),
    );
  }
  const unexpectedLeads = await client.query(
    `SELECT id, branch_id
     FROM aufmass_leads
     WHERE created_by = $1
       AND branch_id NOT IN ('aylux', 'ayluxsi')`,
    [userId],
  );
  if (unexpectedLeads.rows.length > 0) {
    throw new Error(
      `Siegen user owns leads in unexpected branches: `
      + JSON.stringify(unexpectedLeads.rows),
    );
  }

  const movedForms = await client.query(
    `UPDATE aufmass_forms
     SET branch_id = 'ayluxsi', updated_at = NOW()
     WHERE created_by = $1 AND branch_id = 'aylux'
     RETURNING id`,
    [userId],
  );
  const movedLeads = await client.query(
    `UPDATE aufmass_leads
     SET branch_id = 'ayluxsi', updated_at = NOW()
     WHERE created_by = $1 AND branch_id = 'aylux'
     RETURNING id`,
    [userId],
  );
  const formIds = movedForms.rows.map((row) => row.id);
  const leadIds = movedLeads.rows.map((row) => row.id);

  const relatedForms = await moveRelatedRows(
    client,
    'form_id',
    formIds,
    'ayluxsi',
  );
  const relatedLeads = await moveRelatedRows(
    client,
    'lead_id',
    leadIds,
    'ayluxsi',
  );
  await client.query(
    `UPDATE aufmass_support_tickets
     SET branch_slug = 'ayluxsi'
     WHERE user_id = $1 AND branch_slug = 'aylux'`,
    [userId],
  );
  await client.query(
    `UPDATE aufmass_invitations
     SET branch_id = 'ayluxsi'
     WHERE LOWER(email) = LOWER($1)`,
    [SIEGEN_EMAIL],
  );
  await client.query(
    `UPDATE aufmass_users
     SET branch_id = 'ayluxsi',
         is_active = true,
         updated_at = NOW()
     WHERE id = $1`,
    [userId],
  );

  return {
    userId,
    previousBranchId: userResult.rows[0].branch_id,
    formIds,
    leadIds,
    relatedForms,
    relatedLeads,
  };
}

async function ensureAdminUser(client, {
  currentEmail = null,
  email,
  name,
  branchId,
  passwordHash,
}) {
  const emails = [email];
  if (currentEmail && currentEmail !== email) emails.push(currentEmail);
  const normalizedEmails = emails.map((value) => value.toLowerCase());
  const existing = await client.query(
    `SELECT id, email, branch_id
     FROM aufmass_users
     WHERE LOWER(email) = ANY($1::text[])
     ORDER BY CASE WHEN LOWER(email) = LOWER($2) THEN 0 ELSE 1 END
     FOR UPDATE`,
    [normalizedEmails, currentEmail || email],
  );
  if (existing.rows.length > 1) {
    throw new Error(
      `Multiple users conflict with admin email ${email}`,
    );
  }
  if (existing.rows.length === 1) {
    const user = existing.rows[0];
    if (user.branch_id && user.branch_id !== branchId) {
      throw new Error(
        `Admin ${user.email} belongs to unexpected branch ${user.branch_id}`,
      );
    }
    await client.query(
      `UPDATE aufmass_users
       SET email = $2,
           password_hash = $3,
           name = $4,
           role = 'admin',
           branch_id = $5,
           is_active = true,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id, email, passwordHash, name, branchId],
    );
    return { id: user.id, created: false, oldEmail: user.email };
  }

  const inserted = await client.query(
    `INSERT INTO aufmass_users
       (email, password_hash, name, role, branch_id, is_active)
     VALUES ($1, $2, $3, 'admin', $4, true)
     RETURNING id`,
    [email, passwordHash, name, branchId],
  );
  return { id: inserted.rows[0].id, created: true, oldEmail: null };
}

async function readRoster(client) {
  const result = await client.query(`
    SELECT b.slug, b.name, b.is_active,
           COALESCE(
             JSON_AGG(
               JSON_BUILD_OBJECT(
                 'email', u.email,
                 'name', u.name,
                 'role', u.role,
                 'isActive', u.is_active
               )
               ORDER BY u.role, u.email
             ) FILTER (WHERE u.id IS NOT NULL),
             '[]'::json
           ) AS users
    FROM aufmass_branches b
    LEFT JOIN aufmass_users u ON u.branch_id = b.slug
    GROUP BY b.slug, b.name, b.is_active
    ORDER BY b.is_active DESC, b.name, b.slug
  `);
  return result.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    isActive: row.is_active,
    url: `https://${row.slug}.cnsform.com`,
    users: row.users,
  }));
}

async function preflight(client) {
  const scopedColumns = await getBranchScopedColumns(client);
  const slugs = new Set([
    ...FULL_MOVES.flatMap((move) => [move.source, move.target]),
    ...CATALOG_CLONES.flatMap((clone) => [clone.source, clone.target]),
    ...DISABLED_BRANCHES.map((branch) => branch.slug),
    'ayluxd',
  ]);
  const branches = {};
  for (const slug of slugs) {
    const usage = await getBranchUsage(client, slug, scopedColumns);
    branches[slug] = {
      branch: await readBranchRecord(client, slug),
      usage: summarizeUsage(usage),
      business: await branchBusinessSummary(client, slug),
      catalog: await catalogSummary(client, slug),
      assets: await branchAssetSummary(client, slug),
    };
  }

  for (const move of FULL_MOVES) {
    if (!branches[move.source].branch?.is_active) {
      throw new Error(`Source branch ${move.source} is not active`);
    }
    assertVacantTarget(
      move.target,
      await getBranchUsage(client, move.target, scopedColumns),
    );
  }
  for (const clone of CATALOG_CLONES) {
    assertVacantTarget(
      clone.target,
      await getBranchUsage(client, clone.target, scopedColumns),
    );
    if (Number(branches[clone.source].catalog.total) === 0) {
      throw new Error(`Source catalog ${clone.source} is empty`);
    }
  }
  for (const branch of DISABLED_BRANCHES) {
    assertUnusedBranchHasNoBusinessData(
      branch.slug,
      await getBranchUsage(client, branch.slug, scopedColumns),
    );
  }

  const siegenUser = await client.query(
    `SELECT id, email, name, role, branch_id, is_active
     FROM aufmass_users
     WHERE LOWER(email) = LOWER($1)`,
    [SIEGEN_EMAIL],
  );
  const siegenOwned = siegenUser.rows[0];
  const siegenForms = siegenOwned
    ? await client.query(
      `SELECT id, branch_id, status, lead_id
       FROM aufmass_forms
       WHERE created_by = $1
       ORDER BY id`,
      [siegenOwned.id],
    )
    : { rows: [] };
  const siegenLeads = siegenOwned
    ? await client.query(
      `SELECT id, branch_id, status
       FROM aufmass_leads
       WHERE created_by = $1
       ORDER BY id`,
      [siegenOwned.id],
    )
    : { rows: [] };

  return {
    mode: APPLY ? 'apply-preflight' : 'dry-run',
    connectionMode: LOCAL_PEER ? 'local-peer' : 'environment',
    plannedFullMoves: FULL_MOVES.map((move) => ({
      source: move.source,
      target: move.target,
      targetName: move.targetName,
    })),
    plannedCatalogClones: CATALOG_CLONES,
    plannedDisabledBranches: DISABLED_BRANCHES,
    branches,
    siegen: {
      user: siegenOwned || null,
      forms: siegenForms.rows,
      leads: siegenLeads.rows,
    },
    scopedColumns,
  };
}

async function cleanupCreatedFiles() {
  for (const filePath of [...createdFiles].reverse()) {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Keep the original migration error; report leftovers to stderr below.
      process.stderr.write(`Could not clean staged file: ${filePath}\n`);
    }
  }
}

const client = await pool.connect();
try {
  const before = await preflight(client);
  if (!APPLY) {
    process.stdout.write(`${JSON.stringify(before, null, 2)}\n`);
  } else {
    const credentialSpecs = [
      {
        branchSlug: 'ayluxd',
        branchName: 'AYLUX Düsseldorf GmbH',
        email: DUESSELDORF_EMAIL,
        name: 'Admin Düsseldorf',
      },
      {
        branchSlug: 'ayluxsi',
        branchName: 'AYLUX Siegen GmbH',
        email: SIEGEN_EMAIL,
        name: 'Ömer Ayhan',
      },
      {
        branchSlug: 'ayluxmu',
        branchName: 'AYLUX München GmbH',
        email: 'admin@ayluxmu.cnsform.com',
        currentEmail: 'admin@ayluxmau.cnsform.com',
        name: 'Admin München',
      },
      {
        branchSlug: 'ayluxgk',
        branchName: 'AYLUX Gelsenkirchen GmbH',
        email: 'admin@ayluxgk.cnsform.com',
        currentEmail: 'admin@ayluxgkmu.cnsform.com',
        name: 'Admin Gelsenkirchen',
      },
      {
        branchSlug: 'ayluxms',
        branchName: 'AYLUX Münster GmbH',
        email: 'admin@ayluxms.cnsform.com',
        name: 'Admin Münster',
      },
    ];
    const credentials = [];
    for (const spec of credentialSpecs) {
      const temporaryPassword = createTemporaryPassword();
      credentials.push({
        ...spec,
        temporaryPassword,
        passwordHash: await bcrypt.hash(temporaryPassword, 12),
        url: `https://${spec.branchSlug}.cnsform.com`,
      });
    }

    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL statement_timeout = '30min'`);
      await client.query(`SET LOCAL lock_timeout = '10s'`);
      await client.query(
        'SELECT pg_advisory_xact_lock($1)',
        [ADVISORY_LOCK],
      );

      for (const move of FULL_MOVES) {
        await ensureBranch(client, move.target, move.targetName);
      }
      for (const clone of CATALOG_CLONES) {
        await ensureBranch(client, clone.target, clone.targetName);
      }
      await client.query(
        `UPDATE aufmass_branches
         SET name = CASE slug
           WHEN 'ayluxb' THEN 'AYLUX Berlin GmbH'
           WHEN 'ayluxd' THEN 'AYLUX Düsseldorf GmbH'
           ELSE name
         END
         WHERE slug IN ('ayluxb', 'ayluxd')`,
      );

      const catalogClones = [];
      for (const clone of CATALOG_CLONES) {
        const catalog = await cloneCatalog(
          client,
          clone.source,
          clone.target,
        );
        const assets = await cloneProductAssets(
          client,
          clone.source,
          clone.target,
          catalog.mappingTable,
        );
        const settings = clone.cloneSettings
          ? await cloneSettingsAndTerms(
            client,
            clone.source,
            clone.target,
          )
          : { settings: 0, terms: 0 };
        if (!clone.cloneSettings || settings.settings === 0) {
          await client.query(
            `INSERT INTO aufmass_branch_settings (branch_slug)
             SELECT $1::varchar
             WHERE NOT EXISTS (
               SELECT 1
               FROM aufmass_branch_settings
               WHERE branch_slug = $1::varchar
             )`,
            [clone.target],
          );
        }
        catalogClones.push({ ...catalog, assets, settings });
      }

      const scopedColumns = await getBranchScopedColumns(client);
      const fullMoves = [];
      for (const move of FULL_MOVES) {
        const fileCopy = await copyBranchUploadDirectory(
          move.source,
          move.target,
        );
        const changes = await moveEntireBranch(
          client,
          move.source,
          move.target,
          scopedColumns,
        );
        fullMoves.push({ ...move, fileCopy, changes });
      }

      const siegen = await moveSiegenData(client);
      const adminChanges = [];
      for (const credential of credentials) {
        adminChanges.push({
          branchSlug: credential.branchSlug,
          ...await ensureAdminUser(client, {
            currentEmail: credential.currentEmail || null,
            email: credential.email,
            name: credential.name,
            branchId: credential.branchSlug,
            passwordHash: credential.passwordHash,
          }),
        });
      }

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
          ...branch,
          branchFound: branchUpdate.rowCount > 0,
          usersDeactivated: userUpdate.rowCount,
        });
      }

      const after = {};
      for (const slug of [
        'ayluxmau',
        'ayluxmu',
        'ayluxgkmu',
        'ayluxgk',
        'ayluxms',
        'ayluxsi',
      ]) {
        after[slug] = {
          branch: await readBranchRecord(client, slug),
          usage: summarizeUsage(
            await getBranchUsage(client, slug),
          ),
          business: await branchBusinessSummary(client, slug),
          catalog: await catalogSummary(client, slug),
          assets: await branchAssetSummary(client, slug),
        };
      }

      for (const move of FULL_MOVES) {
        const sourceBusiness = before.branches[move.source].business;
        const targetBusiness = after[move.target].business;
        for (const key of Object.keys(sourceBusiness)) {
          if (Number(targetBusiness[key]) !== Number(sourceBusiness[key])) {
            throw new Error(
              `${move.source} -> ${move.target} verification failed `
              + `for ${key}: ${targetBusiness[key]}/${sourceBusiness[key]}`,
            );
          }
        }
        if (
          after[move.target].catalog.checksum
          !== before.branches[move.source].catalog.checksum
        ) {
          throw new Error(
            `${move.source} -> ${move.target} catalog checksum mismatch`,
          );
        }
        const sourceUsage = before.branches[move.source].usage;
        const targetUsage = after[move.target].usage;
        for (const [key, count] of Object.entries(sourceUsage)) {
          if (Number(targetUsage[key] || 0) !== Number(count)) {
            throw new Error(
              `${move.source} -> ${move.target} scoped-data mismatch `
              + `for ${key}: ${targetUsage[key] || 0}/${count}`,
            );
          }
        }
        if (Object.keys(after[move.source].usage).length > 0) {
          throw new Error(
            `Source ${move.source} still has branch-scoped rows after move`,
          );
        }
        const sourceAssets = before.branches[move.source].assets;
        const targetAssets = after[move.target].assets;
        for (const key of [
          'productImages',
          'productCoverPdfs',
          'hasBranchTerms',
        ]) {
          if (targetAssets[key] !== sourceAssets[key]) {
            throw new Error(
              `${move.source} -> ${move.target} asset mismatch for ${key}`,
            );
          }
        }
        if (
          targetAssets.missingProductImageFiles.length > 0
          || targetAssets.missingCoverPdfFiles.length > 0
          || !targetAssets.agbPdfExists
        ) {
          throw new Error(
            `${move.target} contains missing product/branch files`,
          );
        }
      }

      const roster = await readRoster(client);
      const result = {
        mode: 'apply',
        appliedAt: new Date().toISOString(),
        credentials: credentials.map((credential) => ({
          branchSlug: credential.branchSlug,
          branchName: credential.branchName,
          url: credential.url,
          email: credential.email,
          temporaryPassword: credential.temporaryPassword,
        })),
        fullMoves,
        catalogClones: catalogClones.map((clone) => ({
          source: clone.source,
          target: clone.target,
          sourceSummary: clone.sourceSummary,
          targetSummary: clone.targetSummary,
          assets: clone.assets,
          settings: clone.settings,
        })),
        siegen,
        adminChanges,
        disabledBranches,
        before,
        after,
        roster,
      };
      await client.query('COMMIT');
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      await cleanupCreatedFiles();
      throw error;
    }
  }
} catch (error) {
  process.stderr.write(`Branch migration failed: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
