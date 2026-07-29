import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const LOCAL_PEER = process.argv.includes('--local-peer');
if (!LOCAL_PEER) {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));
  const envResult = dotenv.config({ path: envPath });
  if (envResult.error) {
    throw new Error(`Could not load server/.env: ${envResult.error.message}`);
  }
}

const branches = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
if (branches.length === 0) {
  branches.push('ayluxmau', 'ayluxgkmu');
}

const databaseConfig = LOCAL_PEER
  ? {
    host: '/var/run/postgresql',
    port: 5432,
    database: 'aylux_aufmass_db',
    user: 'postgres',
  }
  : {
    host: (
      process.env.PG_HOST
      || process.env.DB_HOST
      || process.env.DB_SERVER
      || 'localhost'
    ),
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
    `Missing database settings in server/.env: ${missingDatabaseSettings.join(', ')}`,
  );
}

const pool = new pg.Pool({
  ...databaseConfig,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

const warnings = [];
const serverDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

async function rowsOrEmpty(sql, params, label) {
  try {
    return (await pool.query(sql, params)).rows;
  } catch (error) {
    warnings.push(`${label}: ${error.message.split('\n')[0]}`);
    return [];
  }
}

async function scalar(sql, params, label) {
  const rows = await rowsOrEmpty(sql, params, label);
  return rows[0]?.value ?? null;
}

function existingFileCount(paths) {
  return paths.filter((filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  }).length;
}

const pdfDirectories = Array.from(new Set([
  ...(process.env.PDF_DIR
    ? [path.resolve(serverDirectory, process.env.PDF_DIR)]
    : []),
  '/var/www/aufmass-pdfs',
  path.resolve(serverDirectory, 'aufmass-pdfs'),
]));

const database = await rowsOrEmpty(
  `SELECT current_database() AS database,
          current_schema() AS schema,
          NOW() AS audited_at`,
  [],
  'database identity',
);

const report = {
  mode: 'read-only',
  connectionMode: LOCAL_PEER ? 'local-peer' : 'environment',
  database: database[0] || null,
  pdfDirectories,
  branches: [],
};

for (const branch of branches) {
  const branchRecord = await rowsOrEmpty(
    `SELECT id, slug, name, is_active
     FROM aufmass_branches
     WHERE slug = $1`,
    [branch],
    `${branch} branch record`,
  );

  const counts = {
    users: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_users
       WHERE branch_id = $1`,
      [branch],
      `${branch} users`,
    ),
    activeUsers: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_users
       WHERE branch_id = $1 AND is_active = true`,
      [branch],
      `${branch} active users`,
    ),
    aufmass: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_forms
       WHERE branch_id = $1`,
      [branch],
      `${branch} aufmass`,
    ),
    leads: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_leads
       WHERE branch_id = $1`,
      [branch],
      `${branch} leads`,
    ),
    formAngebote: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_angebot a
       JOIN aufmass_forms f ON f.id = a.form_id
       WHERE f.branch_id = $1`,
      [branch],
      `${branch} form angebote`,
    ),
    formAngebotItems: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_angebot_items i
       JOIN aufmass_forms f ON f.id = i.form_id
       WHERE f.branch_id = $1`,
      [branch],
      `${branch} form angebot items`,
    ),
    leadAngebote: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_lead_angebote a
       JOIN aufmass_leads l ON l.id = a.lead_id
       WHERE l.branch_id = $1`,
      [branch],
      `${branch} lead angebote`,
    ),
    generatedAufmassPdfsInDb: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_forms
       WHERE branch_id = $1 AND generated_pdf IS NOT NULL`,
      [branch],
      `${branch} generated aufmass pdfs`,
    ),
    uploadedFiles: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_bilder b
       JOIN aufmass_forms f ON f.id = b.form_id
       WHERE f.branch_id = $1`,
      [branch],
      `${branch} uploaded files`,
    ),
    uploadedPdfs: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_bilder b
       JOIN aufmass_forms f ON f.id = b.form_id
       WHERE f.branch_id = $1
         AND (
           b.file_type = 'application/pdf'
           OR LOWER(b.file_name) LIKE '%.pdf'
         )`,
      [branch],
      `${branch} uploaded pdfs`,
    ),
    pdfSnapshots: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_form_pdf_snapshots s
       JOIN aufmass_forms f ON f.id = s.form_id
       WHERE f.branch_id = $1`,
      [branch],
      `${branch} pdf snapshots`,
    ),
    rechnungen: await scalar(
      `SELECT COUNT(DISTINCT r.id)::int AS value
       FROM aufmass_rechnungen r
       LEFT JOIN aufmass_forms f ON f.id = r.form_id
       WHERE r.branch_id = $1 OR f.branch_id = $1`,
      [branch],
      `${branch} rechnungen`,
    ),
    anzahlungen: await scalar(
      `SELECT COUNT(DISTINCT a.id)::int AS value
       FROM aufmass_anzahlungen a
       LEFT JOIN aufmass_forms f ON f.id = a.form_id
       WHERE a.branch_id = $1 OR f.branch_id = $1`,
      [branch],
      `${branch} anzahlungen`,
    ),
    abnahmen: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_abnahme a
       JOIN aufmass_forms f ON f.id = a.form_id
       WHERE f.branch_id = $1`,
      [branch],
      `${branch} abnahmen`,
    ),
    esignatureRequests: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_esignature_requests e
       JOIN aufmass_forms f ON f.id = e.form_id
       WHERE f.branch_id = $1`,
      [branch],
      `${branch} esignature requests`,
    ),
    productsTotal: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_lead_products
       WHERE branch_id = $1`,
      [branch],
      `${branch} products total`,
    ),
    productsActive: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_lead_products
       WHERE branch_id = $1 AND COALESCE(is_active, true) = true`,
      [branch],
      `${branch} products active`,
    ),
    productsPriced: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_lead_products
       WHERE branch_id = $1
         AND price IS NOT NULL
         AND price <> 0`,
      [branch],
      `${branch} products priced`,
    ),
    productImages: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_product_images
       WHERE branch_slug = $1`,
      [branch],
      `${branch} product images`,
    ),
    productCoverPdfs: await scalar(
      `SELECT COUNT(*)::int AS value
       FROM aufmass_product_cover_pdfs
       WHERE branch_slug = $1`,
      [branch],
      `${branch} product cover pdfs`,
    ),
  };

  const users = await rowsOrEmpty(
    `SELECT id, email, name, role, is_active, last_login
     FROM aufmass_users
     WHERE branch_id = $1
     ORDER BY email`,
    [branch],
    `${branch} user roster`,
  );

  const creators = await rowsOrEmpty(
    `SELECT COALESCE(u.email, '(bilinmiyor)') AS creator,
            COUNT(*)::int AS aufmass
     FROM aufmass_forms f
     LEFT JOIN aufmass_users u ON u.id = f.created_by
     WHERE f.branch_id = $1
     GROUP BY u.email
     ORDER BY COUNT(*) DESC, creator`,
    [branch],
    `${branch} creator distribution`,
  );

  const statuses = await rowsOrEmpty(
    `SELECT COALESCE(status, '(bos)') AS status,
            COUNT(*)::int AS count
     FROM aufmass_forms
     WHERE branch_id = $1
     GROUP BY status
     ORDER BY COUNT(*) DESC, status`,
    [branch],
    `${branch} status distribution`,
  );

  const snapshotTypes = await rowsOrEmpty(
    `SELECT s.document_type,
            COUNT(*)::int AS count
     FROM aufmass_form_pdf_snapshots s
     JOIN aufmass_forms f ON f.id = s.form_id
     WHERE f.branch_id = $1
     GROUP BY s.document_type
     ORDER BY s.document_type`,
    [branch],
    `${branch} snapshot types`,
  );

  const productSummary = await rowsOrEmpty(
    `SELECT COUNT(DISTINCT product_name)::int AS distinct_products,
            COUNT(DISTINCT category)::int AS distinct_categories,
            MIN(created_at) AS first_product_row,
            MAX(created_at) AS last_product_row,
            MD5(
              COALESCE(
                STRING_AGG(
                  MD5(CONCAT_WS(
                    '|',
                    COALESCE(category, ''),
                    COALESCE(product_type, ''),
                    COALESCE(product_name, ''),
                    COALESCE(breite::text, ''),
                    COALESCE(tiefe::text, ''),
                    COALESCE(price::text, ''),
                    COALESCE(pricing_type, ''),
                    COALESCE(unit_label, ''),
                    COALESCE(description, ''),
                    COALESCE(custom_fields, ''),
                    COALESCE(size_values::text, ''),
                    COALESCE(size_profile, ''),
                    COALESCE(price_variant::text, ''),
                    COALESCE(source_document, ''),
                    COALESCE(source_page::text, ''),
                    COALESCE(source_year::text, ''),
                    COALESCE(valid_from::text, ''),
                    COALESCE(currency, ''),
                    COALESCE(vat_included::text, ''),
                    COALESCE(is_active::text, '')
                  )),
                  ''
                  ORDER BY id
                ),
                ''
              )
            ) AS content_checksum
     FROM aufmass_lead_products
     WHERE branch_id = $1`,
    [branch],
    `${branch} product summary`,
  );

  const formIds = await rowsOrEmpty(
    `SELECT id
     FROM aufmass_forms
     WHERE branch_id = $1`,
    [branch],
    `${branch} form ids`,
  );
  const physicalAufmassPdfs = formIds.filter(({ id }) => (
    pdfDirectories.some((directory) => (
      fs.existsSync(path.join(directory, `${id}.pdf`))
    ))
  )).length;

  const imageRows = await rowsOrEmpty(
    `SELECT image_path
     FROM aufmass_product_images
     WHERE branch_slug = $1`,
    [branch],
    `${branch} product image paths`,
  );
  const physicalProductImages = existingFileCount(
    imageRows.map(({ image_path: imagePath }) => (
      path.resolve(serverDirectory, 'product-images', imagePath)
    )),
  );

  const coverRows = await rowsOrEmpty(
    `SELECT file_path
     FROM aufmass_product_cover_pdfs
     WHERE branch_slug = $1`,
    [branch],
    `${branch} cover pdf paths`,
  );
  const physicalCoverPdfs = existingFileCount(
    coverRows.map(({ file_path: filePath }) => (
      path.resolve(
        serverDirectory,
        'aufmass-pdfs',
        'branch-uploads',
        branch,
        filePath,
      )
    )),
  );

  const branchTerms = await rowsOrEmpty(
    `SELECT branch_slug,
            content IS NOT NULL AND LENGTH(content) > 0 AS has_content,
            show_on_aufmass,
            show_on_angebot,
            show_on_abnahme,
            show_on_rechnung,
            agb_pdf_path,
            agb_pdf_pages,
            attach_separately
     FROM aufmass_branch_terms
     WHERE branch_slug = $1`,
    [branch],
    `${branch} branch terms`,
  );

  const physicalAgbPdf = branchTerms[0]?.agb_pdf_path
    ? fs.existsSync(
      path.resolve(
        serverDirectory,
        'aufmass-pdfs',
        'branch-uploads',
        branch,
        branchTerms[0].agb_pdf_path,
      ),
    )
    : false;

  report.branches.push({
    slug: branch,
    branch: branchRecord[0] || null,
    counts,
    users,
    creators,
    statuses,
    snapshotTypes,
    productSummary: productSummary[0] || null,
    files: {
      physicalAufmassPdfs,
      physicalProductImages,
      physicalCoverPdfs,
      physicalAgbPdf,
    },
    branchTerms: branchTerms[0] || null,
  });
}

report.warnings = warnings;
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await pool.end();
