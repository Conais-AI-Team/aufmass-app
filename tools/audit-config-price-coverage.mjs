// Config -> DB price coverage audit.
// Every model listed in productConfig.json is selectable in the form, but its price is
// looked up from aufmass_lead_products by exact product_name. If a model has no priced row
// the form silently shows "price_missing"/"no_match". This audit lists such models so the
// config<->DB coupling can be kept clean (goal: zero no-price selectable models).
//
// Usage: node tools/audit-config-price-coverage.mjs [--branch=koblenz] [--json]
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const dotenv = require('../server/node_modules/dotenv');
const pg = require('../server/node_modules/pg');
dotenv.config({ path: 'server/.env' });

const branch = (process.argv.find(a => a.startsWith('--branch=')) || '--branch=koblenz').split('=')[1];
const asJson = process.argv.includes('--json');

const config = JSON.parse(fs.readFileSync('src/config/productConfig.json', 'utf8'));
const models = [];
for (const [category, types] of Object.entries(config)) {
  for (const [ptype, data] of Object.entries(types)) {
    for (const m of (data.models || [])) models.push({ category, ptype, model: m });
  }
}

const pool = new pg.Pool({ host: process.env.PG_HOST, port: Number(process.env.PG_PORT || 5432), database: process.env.PG_DATABASE, user: process.env.PG_USER, password: process.env.PG_PASSWORD, connectionTimeoutMillis: 15000 });
try {
  const r = await pool.query(`
    SELECT product_name,
      count(*) FILTER (WHERE price IS NOT NULL AND price <> 0)::int AS priced,
      count(*)::int AS rows
    FROM aufmass_lead_products
    WHERE branch_id = $1 AND COALESCE(is_active, true) = true
    GROUP BY product_name`, [branch]);
  const byName = new Map(r.rows.map(x => [x.product_name, x]));

  const noPrice = [], partial = [], ok = [];
  for (const m of models) {
    const d = byName.get(m.model);
    if (!d || d.priced === 0) noPrice.push(m);
    else if (d.priced < d.rows) partial.push({ ...m, priced: d.priced, rows: d.rows });
    else ok.push(m);
  }

  if (asJson) {
    console.log(JSON.stringify({ branch, total: models.length, ok: ok.length, partial: partial.length, no_price: noPrice.length, noPriceModels: noPrice }, null, 2));
  } else {
    console.log(`Config->DB price coverage (branch ${branch}): ${models.length} models | ${ok.length} fully priced | ${partial.length} partial | ${noPrice.length} NO PRICE`);
    if (noPrice.length) {
      console.log('\nNO-PRICE models (selectable in form, no priced DB row -> silent price_missing):');
      for (const m of noPrice) console.log(`  [${m.category}/${m.ptype}] ${m.model}`);
    }
  }
  process.exitCode = noPrice.length ? 1 : 0;
} finally { await pool.end(); }
