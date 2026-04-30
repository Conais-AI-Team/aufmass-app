import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'https://aufmass-app.vercel.app',
      'https://aufmass-api.conais.com',
      'http://localhost:5173',
      'http://localhost:5174'
    ];

    // Allow *.cnsform.com domains (branch subdomains)
    if (origin.match(/^https?:\/\/[a-z0-9-]+\.cnsform\.com$/i)) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB per file (PDF can be large)
    files: 10
  }
});

// PostgreSQL connection pool
const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: parseInt(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'aylux_aufmass_db',
  user: process.env.PG_USER || 'aylux_admin',
  password: process.env.PG_PASSWORD || 'Aylux2026DB',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

async function connectDB() {
  try {
    // Test the connection
    const client = await pool.connect();
    client.release();
    console.log('Connected to PostgreSQL Database');
    await initializeTables();
  } catch (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }
}

// Initialize tables - tables already exist in PG, just run migrations
async function initializeTables() {
  try {
    // Add columns if not exists (PG syntax)
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS kunde_email VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS kunde_telefon VARCHAR(50)`);
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS montage_datum DATE`);
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS status_date DATE`);
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS papierkorb_date DATE`);

    // Set papierkorb_date for existing papierkorb items that don't have it
    await pool.query(`
      UPDATE aufmass_forms
      SET papierkorb_date = CURRENT_DATE
      WHERE status = 'papierkorb' AND papierkorb_date IS NULL
    `);

    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS generated_pdf BYTEA`);
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMP`);
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS lead_id INT`);
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS created_by INT`);
    await pool.query(`ALTER TABLE aufmass_forms ADD COLUMN IF NOT EXISTS branch_id VARCHAR(50)`);

    // Abnahme columns
    await pool.query(`ALTER TABLE aufmass_abnahme ADD COLUMN IF NOT EXISTS maengel_liste TEXT`);
    await pool.query(`ALTER TABLE aufmass_abnahme ADD COLUMN IF NOT EXISTS baustelle_sauber VARCHAR(10)`);
    await pool.query(`ALTER TABLE aufmass_abnahme ADD COLUMN IF NOT EXISTS monteur_note INT`);
    await pool.query(`ALTER TABLE aufmass_abnahme ADD COLUMN IF NOT EXISTS signature_data TEXT`);

    // Public abnahme sign link requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_abnahme_sign_requests (
        id SERIAL PRIMARY KEY,
        form_id INT NOT NULL,
        branch_id VARCHAR(50),
        token_hash VARCHAR(128) NOT NULL UNIQUE,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        snapshot_json TEXT NOT NULL,
        signer_name VARCHAR(255),
        signature_data TEXT,
        signed_at TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        created_by INT,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_abnahme_sign_requests_form_id ON aufmass_abnahme_sign_requests(form_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_abnahme_sign_requests_status ON aufmass_abnahme_sign_requests(status)`);

    // User columns
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS branch_id VARCHAR(50)`);

    // Montageteams columns
    await pool.query(`ALTER TABLE aufmass_montageteams ADD COLUMN IF NOT EXISTS branch_id VARCHAR(50)`);

    // Invitations columns
    await pool.query(`ALTER TABLE aufmass_invitations ADD COLUMN IF NOT EXISTS branch_id VARCHAR(50)`);

    // Status history columns
    await pool.query(`ALTER TABLE aufmass_status_history ADD COLUMN IF NOT EXISTS status_date DATE`);

    // Create indexes if not exists
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_aufmass_forms_branch_id ON aufmass_forms(branch_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_aufmass_users_branch_id ON aufmass_users(branch_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_aufmass_montageteams_branch_id ON aufmass_montageteams(branch_id)`);

    // Insert default branch (koblenz) if not exists
    await pool.query(`
      INSERT INTO aufmass_branches (slug, name)
      SELECT 'koblenz', 'Aylux Koblenz'
      WHERE NOT EXISTS (SELECT 1 FROM aufmass_branches WHERE slug = 'koblenz')
    `);

    // Migrate existing montageteams with NULL branch_id to 'koblenz'
    await pool.query(`UPDATE aufmass_montageteams SET branch_id = 'koblenz' WHERE branch_id IS NULL`);

    // Migrate old status values
    await pool.query(`UPDATE aufmass_forms SET status = 'neu' WHERE status IN ('draft', 'completed')`);

    // E-signature columns
    await pool.query(`ALTER TABLE aufmass_esignature_requests ADD COLUMN IF NOT EXISTS provider VARCHAR(20) DEFAULT 'openapi'`);
    await pool.query(`ALTER TABLE aufmass_esignature_requests ADD COLUMN IF NOT EXISTS boldsign_document_id VARCHAR(100)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS esignature_provider VARCHAR(20) DEFAULT 'openapi'`);
    await pool.query(`ALTER TABLE aufmass_esignature_requests ADD COLUMN IF NOT EXISTS document_type VARCHAR(20) DEFAULT 'aufmass'`);
    await pool.query(`ALTER TABLE aufmass_esignature_requests ADD COLUMN IF NOT EXISTS branch_id VARCHAR(50)`);

    // E-signature indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_aufmass_esignature_requests_form_id ON aufmass_esignature_requests(form_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_aufmass_esignature_requests_openapi_id ON aufmass_esignature_requests(openapi_signature_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_aufmass_esignature_requests_boldsign_id ON aufmass_esignature_requests(boldsign_document_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_aufmass_esignature_requests_branch_id ON aufmass_esignature_requests(branch_id)`);

    // Lead products columns
    await pool.query(`ALTER TABLE aufmass_lead_products ADD COLUMN IF NOT EXISTS category VARCHAR(100)`);
    await pool.query(`ALTER TABLE aufmass_lead_products ADD COLUMN IF NOT EXISTS product_type VARCHAR(100)`);
    await pool.query(`ALTER TABLE aufmass_lead_products ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(20) DEFAULT 'dimension'`);
    await pool.query(`ALTER TABLE aufmass_lead_products ADD COLUMN IF NOT EXISTS unit_label VARCHAR(100)`);
    await pool.query(`ALTER TABLE aufmass_lead_products ADD COLUMN IF NOT EXISTS description TEXT`);
    console.log('aufmass_lead_products.description column ready');
    await pool.query(`ALTER TABLE aufmass_lead_products ADD COLUMN IF NOT EXISTS custom_fields TEXT`);
    console.log('aufmass_lead_products.custom_fields column ready');

    // Lead items columns
    await pool.query(`ALTER TABLE aufmass_lead_items ADD COLUMN IF NOT EXISTS discount DECIMAL(10,2) DEFAULT 0`);
    console.log('aufmass_lead_items.discount column ready');
    await pool.query(`ALTER TABLE aufmass_leads ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0`);
    console.log('aufmass_leads.subtotal column ready');
    await pool.query(`ALTER TABLE aufmass_leads ADD COLUMN IF NOT EXISTS total_discount DECIMAL(10,2) DEFAULT 0`);
    console.log('aufmass_leads.total_discount column ready');

    // Lead items extra spec columns
    const specColumns = ['pi_ober_kante', 'pi_unter_kante', 'pi_gestell_farbe', 'pi_sicherheitglas', 'pi_pfostenanzahl'];
    for (const col of specColumns) {
      await pool.query(`ALTER TABLE aufmass_lead_items ADD COLUMN IF NOT EXISTS ${col} VARCHAR(100)`);
    }
    console.log('aufmass_lead_items extra spec columns ready');

    // Lead items pricing columns
    await pool.query(`ALTER TABLE aufmass_lead_items ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(20) DEFAULT 'dimension'`);
    await pool.query(`ALTER TABLE aufmass_lead_items ADD COLUMN IF NOT EXISTS unit_label VARCHAR(100)`);
    console.log('aufmass_lead_items pricing columns ready');

    await pool.query(`ALTER TABLE aufmass_lead_items ADD COLUMN IF NOT EXISTS custom_field_values TEXT`);
    console.log('aufmass_lead_items.custom_field_values column ready');

    // Angebot nummer column
    await pool.query(`ALTER TABLE aufmass_leads ADD COLUMN IF NOT EXISTS angebot_nummer VARCHAR(20)`);

    // ============ MULTI-ANGEBOT SUPPORT ============
    // Create angebote table for multiple quotes per lead
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_lead_angebote (
        id SERIAL PRIMARY KEY,
        lead_id INT NOT NULL REFERENCES aufmass_leads(id) ON DELETE CASCADE,
        angebot_nummer VARCHAR(20),
        subtotal DECIMAL(10,2) DEFAULT 0,
        total_discount DECIMAL(10,2) DEFAULT 0,
        total_price DECIMAL(10,2) DEFAULT 0,
        notes TEXT,
        status VARCHAR(20) DEFAULT 'offen',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_lead_angebote_lead_id ON aufmass_lead_angebote(lead_id)`);

    // Add angebot_id column to lead_items and lead_extras
    await pool.query(`ALTER TABLE aufmass_lead_items ADD COLUMN IF NOT EXISTS angebot_id INT REFERENCES aufmass_lead_angebote(id) ON DELETE CASCADE`);
    await pool.query(`ALTER TABLE aufmass_lead_extras ADD COLUMN IF NOT EXISTS angebot_id INT REFERENCES aufmass_lead_angebote(id) ON DELETE CASCADE`);

    // Migrate existing leads: create angebot record for leads that have items but no angebote
    const leadsWithoutAngebote = await pool.query(`
      SELECT l.id, l.angebot_nummer, l.subtotal, l.total_discount, l.total_price, l.notes, l.status
      FROM aufmass_leads l
      WHERE NOT EXISTS (SELECT 1 FROM aufmass_lead_angebote a WHERE a.lead_id = l.id)
      AND EXISTS (SELECT 1 FROM aufmass_lead_items i WHERE i.lead_id = l.id)
    `);
    for (const lead of leadsWithoutAngebote.rows) {
      const angebotResult = await pool.query(
        `INSERT INTO aufmass_lead_angebote (lead_id, angebot_nummer, subtotal, total_discount, total_price, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [lead.id, lead.angebot_nummer, lead.subtotal || 0, lead.total_discount || 0, lead.total_price || 0, lead.notes, lead.status || 'offen']
      );
      const angebotId = angebotResult.rows[0].id;
      await pool.query(`UPDATE aufmass_lead_items SET angebot_id = $1 WHERE lead_id = $2 AND angebot_id IS NULL`, [angebotId, lead.id]);
      await pool.query(`UPDATE aufmass_lead_extras SET angebot_id = $1 WHERE lead_id = $2 AND angebot_id IS NULL`, [angebotId, lead.id]);
    }
    console.log(`Multi-angebot migration: ${leadsWithoutAngebote.rows.length} leads migrated`);

    // ============ PRODUCT RENAME: Premiumline → Arona ============
    const renameResult1 = await pool.query(`UPDATE aufmass_forms SET model = 'Arona' WHERE model = 'Premiumline'`);
    const renameResult2 = await pool.query(`UPDATE aufmass_lead_products SET product_name = REPLACE(product_name, 'Premiumline', 'Arona') WHERE product_name LIKE '%Premiumline%'`);
    const renameResult3 = await pool.query(`UPDATE aufmass_lead_items SET product_name = REPLACE(product_name, 'Premiumline', 'Arona') WHERE product_name LIKE '%Premiumline%'`);
    if (renameResult1.rowCount > 0 || renameResult2.rowCount > 0 || renameResult3.rowCount > 0) {
      console.log(`Premiumline → Arona rename: forms=${renameResult1.rowCount}, products=${renameResult2.rowCount}, items=${renameResult3.rowCount}`);
    }

    // ============ ANGEBOT/KUNDEN NUMBER COUNTERS (race-safe, monotonic) ============
    // Replaces the old COUNT(*)-based numbering which produced duplicates after deletes
    // and across the leads/lead_angebote tables (different sources of truth).
    // The counter table is the single source of truth for next number per branch+year.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_angebot_counters (
        branch_key VARCHAR(20) NOT NULL,
        year INTEGER NOT NULL,
        last_num INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (branch_key, year)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_kunden_counters (
        branch_key VARCHAR(20) NOT NULL,
        year INTEGER NOT NULL,
        last_num INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (branch_key, year)
      )
    `);
    console.log('aufmass_angebot_counters / aufmass_kunden_counters tables ready');

    // Seed counters from existing max values so new numbers continue past current ones.
    // We take the MAX over BOTH leads.angebot_nummer AND lead_angebote.angebot_nummer to be safe.
    // Existing 3-digit numbers are left untouched; new numbers will be 5+ digits, so they
    // never collide with legacy ones lexicographically.
    const angebotSeed = await pool.query(`
      WITH all_nrs AS (
        SELECT angebot_nummer FROM aufmass_leads         WHERE angebot_nummer IS NOT NULL
        UNION ALL
        SELECT angebot_nummer FROM aufmass_lead_angebote WHERE angebot_nummer IS NOT NULL
      ),
      parsed AS (
        SELECT
          SPLIT_PART(angebot_nummer, '-', 1) AS branch_key,
          NULLIF(SPLIT_PART(angebot_nummer, '-', 2), '')::int AS year,
          NULLIF(SPLIT_PART(angebot_nummer, '-', 3), '')::int AS num
        FROM all_nrs
        WHERE angebot_nummer ~ '^[A-Z]+-[0-9]{4}-[0-9]+$'
      )
      INSERT INTO aufmass_angebot_counters (branch_key, year, last_num)
      SELECT branch_key, year, MAX(num)
      FROM parsed
      GROUP BY branch_key, year
      ON CONFLICT (branch_key, year)
      DO UPDATE SET last_num = GREATEST(aufmass_angebot_counters.last_num, EXCLUDED.last_num)
    `);
    console.log(`aufmass_angebot_counters seeded (${angebotSeed.rowCount} rows)`);

    // Partial UNIQUE index for new format only (5+ digits) — guarantees no future collision
    // without touching existing 3-digit duplicates.
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_aufmass_lead_angebote_nummer_new
        ON aufmass_lead_angebote (angebot_nummer)
        WHERE angebot_nummer ~ '^[A-Z]+-[0-9]{4}-[0-9]{5,}$'
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_aufmass_leads_angebot_nummer_new
        ON aufmass_leads (angebot_nummer)
        WHERE angebot_nummer ~ '^[A-Z]+-[0-9]{4}-[0-9]{5,}$'
    `);
    console.log('Partial UNIQUE indexes (new 5+ digit format) ready');

    // ============ KUNDENNUMMER COLUMN ============
    await pool.query(`ALTER TABLE aufmass_leads ADD COLUMN IF NOT EXISTS kunden_nummer VARCHAR(20)`);
    console.log('aufmass_leads.kunden_nummer column ready');

    // Seed kunden counters from existing kunden_nummer values
    const kundenSeed = await pool.query(`
      WITH parsed AS (
        SELECT
          SPLIT_PART(kunden_nummer, '-', 1) AS branch_key,
          NULLIF(SPLIT_PART(kunden_nummer, '-', 3), '')::int AS year,
          NULLIF(SPLIT_PART(kunden_nummer, '-', 4), '')::int AS num
        FROM aufmass_leads
        WHERE kunden_nummer ~ '^[A-Z]+-K-[0-9]{4}-[0-9]+$'
      )
      INSERT INTO aufmass_kunden_counters (branch_key, year, last_num)
      SELECT branch_key, year, MAX(num)
      FROM parsed
      GROUP BY branch_key, year
      ON CONFLICT (branch_key, year)
      DO UPDATE SET last_num = GREATEST(aufmass_kunden_counters.last_num, EXCLUDED.last_num)
    `);
    console.log(`aufmass_kunden_counters seeded (${kundenSeed.rowCount} rows)`);

    // Backfill kunden_nummer for existing leads that don't have one
    const leadsWithoutKN = await pool.query(`SELECT id, branch_id, created_at FROM aufmass_leads WHERE kunden_nummer IS NULL ORDER BY created_at ASC`);
    if (leadsWithoutKN.rows.length > 0) {
      const branchPrefixMap = { 'koblenz': 'KOB', 'ayluxtr': 'AYT', 'aylux': 'AYL', 'ayluxus': 'AYU', 'ayluxgkmu': 'GKM', 'ayluxmau': 'MAU', 'ayluxa': 'AYA' };
      // Count per branch+year for numbering
      const counters = {};
      for (const lead of leadsWithoutKN.rows) {
        const yr = new Date(lead.created_at).getFullYear();
        const bp = lead.branch_id ? (branchPrefixMap[lead.branch_id] || lead.branch_id.substring(0, 3).toUpperCase()) : 'ANG';
        const key = `${bp}-${yr}`;
        counters[key] = (counters[key] || 0) + 1;
        const kn = `${bp}-K-${yr}-${String(counters[key]).padStart(3, '0')}`;
        await pool.query(`UPDATE aufmass_leads SET kunden_nummer = $1 WHERE id = $2`, [kn, lead.id]);
      }
      console.log(`Backfilled kunden_nummer for ${leadsWithoutKN.rows.length} leads`);
    }

    // Check if admin exists, create default admin if not
    const adminCheck = await pool.query(
      "SELECT COUNT(*) as count FROM aufmass_users WHERE role = 'admin'"
    );

    if (parseInt(adminCheck.rows[0].count) === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 12);
      await pool.query(
        `INSERT INTO aufmass_users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)`,
        ['admin@aylux.de', hashedPassword, 'Administrator', 'admin']
      );
      console.log('Default admin created: admin@aylux.de / admin123');
    }

    // ============ EMAIL SMTP SETTINGS ============
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS smtp_port INT DEFAULT 587`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS smtp_user VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS smtp_pass_enc TEXT`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS smtp_from_name VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS smtp_from_email VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS smtp_enabled BOOLEAN DEFAULT false`);
    console.log('SMTP branch settings columns ready');

    // ============ BRANCH COMPANY INFO (Firmenangaben) ============
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_name VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_strasse VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_plz VARCHAR(20)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_ort VARCHAR(100)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_telefon VARCHAR(50)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_email VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_ust_id VARCHAR(50)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_web VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_steuernr VARCHAR(50)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_iban VARCHAR(50)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_bic VARCHAR(20)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_bank_name VARCHAR(100)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_geschaeftsfuehrer VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_branch_settings ADD COLUMN IF NOT EXISTS company_handelsregister VARCHAR(100)`);
    console.log('Branch company info columns ready');

    // User-level SMTP (hybrid: user override > branch default)
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS smtp_host VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS smtp_port INT DEFAULT 587`);
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS smtp_user VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS smtp_pass_enc TEXT`);
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS smtp_from_name VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS smtp_from_email VARCHAR(255)`);
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS smtp_secure BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE aufmass_users ADD COLUMN IF NOT EXISTS smtp_configured BOOLEAN DEFAULT false`);
    console.log('SMTP user settings columns ready');

    // Email log table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_email_log (
        id SERIAL PRIMARY KEY,
        form_id INT,
        lead_id INT,
        branch_id VARCHAR(50),
        email_type VARCHAR(50) NOT NULL,
        recipient_email VARCHAR(255) NOT NULL,
        subject VARCHAR(500),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        error_message TEXT,
        sent_by INT,
        sent_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_email_log_branch ON aufmass_email_log(branch_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ix_email_log_form ON aufmass_email_log(form_id)`);
    console.log('Email log table ready');

    // === MODÜL F: PDF Şablon Sistemi ===
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_product_images (
        id SERIAL PRIMARY KEY,
        branch_slug VARCHAR(50) NOT NULL,
        product_id INT NOT NULL,
        image_path VARCHAR(500) NOT NULL,
        image_order INT DEFAULT 1,
        show_on_cover BOOLEAN DEFAULT false,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_images_lookup ON aufmass_product_images(branch_slug, product_id)`);
    console.log('Product images table ready');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_branch_terms (
        branch_slug VARCHAR(50) PRIMARY KEY,
        content TEXT,
        show_on_aufmass BOOLEAN DEFAULT false,
        show_on_angebot BOOLEAN DEFAULT true,
        show_on_abnahme BOOLEAN DEFAULT false,
        show_on_rechnung BOOLEAN DEFAULT false,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`ALTER TABLE aufmass_branch_terms ADD COLUMN IF NOT EXISTS agb_pdf_path VARCHAR(500)`);
    await pool.query(`ALTER TABLE aufmass_branch_terms ADD COLUMN IF NOT EXISTS agb_pdf_pages JSONB`);
    await pool.query(`ALTER TABLE aufmass_branch_terms ADD COLUMN IF NOT EXISTS attach_separately BOOLEAN DEFAULT false`);
    console.log('Branch terms (AGB) table ready');

    // === MODÜL F2: PDF Cover/AGB Override System ===
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_product_cover_pdfs (
        id SERIAL PRIMARY KEY,
        branch_slug VARCHAR(50) NOT NULL,
        product_id INT NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        selected_pages JSONB,
        page_count INT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(branch_slug, product_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_product_cover_pdfs_lookup ON aufmass_product_cover_pdfs(branch_slug, product_id)`);
    console.log('Product cover PDFs table ready');

    // PDF cache table — for legal stability: once a PDF is generated for a lead, it's frozen
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_lead_pdf_cache (
        id SERIAL PRIMARY KEY,
        lead_id INT NOT NULL,
        angebot_id INT,
        document_type VARCHAR(20) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(lead_id, angebot_id, document_type)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_lead_pdf_cache_lookup ON aufmass_lead_pdf_cache(lead_id, angebot_id, document_type)`);
    console.log('Lead PDF cache table ready');

    // Form-level PDF snapshots — frozen per (form_id, document_type) for legal traceability
    // Status transitions auto-create snapshots so users can re-download a historic PDF after status changes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_form_pdf_snapshots (
        id SERIAL PRIMARY KEY,
        form_id INT NOT NULL,
        document_type VARCHAR(20) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(form_id, document_type)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_form_pdf_snapshots_lookup ON aufmass_form_pdf_snapshots(form_id, document_type)`);
    console.log('Form PDF snapshots table ready');

    console.log('Database tables initialized');
  } catch (err) {
    console.error('Table initialization failed:', err.message);
  }
}

// ============ AUTH MIDDLEWARE ============
const authenticateToken = (req, res, next) => {
  // Check Authorization header first, then query param (for direct PDF links)
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireAdminOrOffice = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'office') {
    return res.status(403).json({ error: 'Admin or Office access required' });
  }
  next();
};

// ============ BRANCH DETECTION MIDDLEWARE ============
// Detects branch from subdomain (e.g., koblenz.cnsform.com -> branchId = 'koblenz')
// Dev domains (aufmass-api.conais.com, localhost) -> branchId = null (sees all data)
const detectBranch = (req, res, next) => {
  const host = req.headers.host || '';
  const origin = req.headers.origin || '';

  // Check both host and origin for branch detection
  let hostToCheck;
  try {
    hostToCheck = origin ? new URL(origin).hostname : host.split(':')[0];
  } catch (e) {
    // If origin is malformed, fall back to host
    hostToCheck = host.split(':')[0];
  }

  // Dev/admin domains - no branch filter (sees all data, full admin access)
  const adminDomains = ['localhost', '127.0.0.1', 'aufmass-api.conais.com', 'aufmass-app.vercel.app'];
  if (adminDomains.some(d => hostToCheck === d || hostToCheck.includes(d))) {
    req.branchId = null;
    return next();
  }

  // Branch domains: {branch}.cnsform.com
  const cnsformMatch = hostToCheck.match(/^([a-z0-9-]+)\.cnsform\.com$/i);
  if (cnsformMatch) {
    req.branchId = cnsformMatch[1].toLowerCase();
    return next();
  }

  // Default: no branch filter
  req.branchId = null;
  next();
};

// Apply branch detection to all API routes
app.use('/api', detectBranch);

// Helper: verify a form belongs to the requesting branch (returns form or null)
async function verifyFormBranch(formId, branchId) {
  if (!branchId) return true; // admin/dev sees all
  const result = await pool.query(
    'SELECT id FROM aufmass_forms WHERE id = $1 AND (branch_id = $2 OR branch_id IS NULL)',
    [formId, branchId]
  );
  return result.rows.length > 0;
}

function hashPublicToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function buildAbnahmeSignSnapshot(formId) {
  const formResult = await pool.query(
    `SELECT id, datum, aufmasser, kunde_vorname, kunde_nachname, kunde_email, kunde_telefon,
            kundenlokation, category, product_type, model, bemerkungen
     FROM aufmass_forms
     WHERE id = $1`,
    [formId]
  );

  if (formResult.rows.length === 0) {
    return null;
  }

  const abnahmeResult = await pool.query('SELECT * FROM aufmass_abnahme WHERE form_id = $1', [formId]);
  if (abnahmeResult.rows.length === 0) {
    return null;
  }

  const form = formResult.rows[0];
  const abnahme = abnahmeResult.rows[0];

  // Fetch abnahme photos as base64
  const photosResult = await pool.query(
    'SELECT id, file_name, file_type, file_data FROM aufmass_abnahme_bilder WHERE form_id = $1 ORDER BY created_at',
    [formId]
  );
  const photos = photosResult.rows.map(p => ({
    id: p.id,
    fileName: p.file_name,
    fileType: p.file_type,
    base64: `data:${p.file_type};base64,${p.file_data.toString('base64')}`
  }));

  return {
    form: {
      id: form.id,
      datum: form.datum,
      aufmasser: form.aufmasser,
      kundeVorname: form.kunde_vorname,
      kundeNachname: form.kunde_nachname,
      kundeEmail: form.kunde_email,
      kundeTelefon: form.kunde_telefon,
      kundenlokation: form.kundenlokation,
      category: form.category,
      productType: form.product_type,
      model: form.model,
      bemerkungen: form.bemerkungen
    },
    abnahme: {
      istFertig: abnahme.ist_fertig,
      hatProbleme: abnahme.hat_probleme,
      problemBeschreibung: abnahme.problem_beschreibung,
      maengelListe: abnahme.maengel_liste ? JSON.parse(abnahme.maengel_liste) : [],
      baustelleSauber: abnahme.baustelle_sauber,
      monteurNote: abnahme.monteur_note,
      kundeName: abnahme.kunde_name,
      kundeUnterschrift: abnahme.kunde_unterschrift,
      abnahmeDatum: abnahme.abnahme_datum,
      bemerkungen: abnahme.bemerkungen
    },
    photos
  };
}

// ============ AUTH ROUTES ============

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Branch-specific login: allow users from the same branch OR global users (branch_id IS NULL)
    let query, params;
    if (req.branchId) {
      query = `SELECT * FROM aufmass_users WHERE email = $1 AND is_active = true AND (branch_id = $2 OR branch_id IS NULL)`;
      params = [email.toLowerCase(), req.branchId];
    } else {
      query = `SELECT * FROM aufmass_users WHERE email = $1 AND is_active = true`;
      params = [email.toLowerCase()];
    }

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await pool.query('UPDATE aufmass_users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, last_login FROM aufmass_users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Change password
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const result = await pool.query(
      'SELECT password_hash FROM aufmass_users WHERE id = $1',
      [req.user.id]
    );

    const validPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await pool.query(
      'UPDATE aufmass_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, req.user.id]
    );

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ============ USER MANAGEMENT (Admin only) ============

// Get all users (branch filtered)
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    let query, params;
    if (req.branchId) {
      query = `SELECT id, email, name, role, is_active, last_login, created_at, branch_id
               FROM aufmass_users WHERE branch_id = $1 ORDER BY created_at DESC`;
      params = [req.branchId];
    } else {
      query = `SELECT id, email, name, role, is_active, last_login, created_at, branch_id
               FROM aufmass_users ORDER BY created_at DESC`;
      params = [];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create invitation (with branch_id)
app.post('/api/invitations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    // Branch subdomain required for creating invitations
    if (!req.branchId) {
      return res.status(400).json({ error: 'Invitations can only be created from branch subdomains' });
    }

    // Check if user already exists in this branch
    const existingUser = await pool.query(
      'SELECT id FROM aufmass_users WHERE email = $1 AND branch_id = $2',
      [email.toLowerCase(), req.branchId]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists in this branch' });
    }

    // Check for existing valid invitation in this branch
    const existingInvite = await pool.query(
      'SELECT id FROM aufmass_invitations WHERE email = $1 AND branch_id = $2 AND used_at IS NULL AND expires_at > NOW()',
      [email.toLowerCase(), req.branchId]
    );

    if (existingInvite.rows.length > 0) {
      return res.status(400).json({ error: 'Valid invitation already exists for this email' });
    }

    const token = uuidv4();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days validity

    await pool.query(
      `INSERT INTO aufmass_invitations (token, email, role, invited_by, expires_at, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [token, email.toLowerCase(), role || 'user', req.user.id, expiresAt, req.branchId]
    );

    res.json({
      message: 'Invitation created',
      inviteLink: `/register?token=${token}`,
      token,
      expiresAt
    });
  } catch (err) {
    console.error('Create invitation error:', err);
    res.status(500).json({ error: 'Failed to create invitation' });
  }
});

// Get all invitations (branch filtered)
app.get('/api/invitations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    let query, params;
    if (req.branchId) {
      query = `SELECT i.*, u.name as invited_by_name
               FROM aufmass_invitations i
               LEFT JOIN aufmass_users u ON i.invited_by = u.id
               WHERE i.branch_id = $1
               ORDER BY i.created_at DESC`;
      params = [req.branchId];
    } else {
      query = `SELECT i.*, u.name as invited_by_name
               FROM aufmass_invitations i
               LEFT JOIN aufmass_users u ON i.invited_by = u.id
               ORDER BY i.created_at DESC`;
      params = [];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get invitations error:', err);
    res.status(500).json({ error: 'Failed to fetch invitations' });
  }
});

// Delete invitation (branch filtered)
app.delete('/api/invitations/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (req.branchId) {
      await pool.query('DELETE FROM aufmass_invitations WHERE id = $1 AND branch_id = $2', [req.params.id, req.branchId]);
    } else {
      await pool.query('DELETE FROM aufmass_invitations WHERE id = $1', [req.params.id]);
    }
    res.json({ message: 'Invitation deleted' });
  } catch (err) {
    console.error('Delete invitation error:', err);
    res.status(500).json({ error: 'Failed to delete invitation' });
  }
});

// Register with invitation token
app.post('/api/auth/register', async (req, res) => {
  try {
    const { token, name, password } = req.body;

    if (!token || !name || !password) {
      return res.status(400).json({ error: 'Token, name and password required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Find valid invitation
    const invitation = await pool.query(
      `SELECT * FROM aufmass_invitations WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [token]
    );

    if (invitation.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }

    const invite = invitation.rows[0];

    // Create user with branch_id from invitation
    const hashedPassword = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO aufmass_users (email, password_hash, name, role, branch_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [invite.email, hashedPassword, name, invite.role, invite.branch_id || null]
    );

    // Mark invitation as used
    await pool.query('UPDATE aufmass_invitations SET used_at = NOW() WHERE id = $1', [invite.id]);

    const userId = result.rows[0].id;
    const jwtToken = jwt.sign(
      { id: userId, email: invite.email, name, role: invite.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      message: 'Registration successful',
      token: jwtToken,
      user: {
        id: userId,
        email: invite.email,
        name,
        role: invite.role
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Verify invitation token
app.get('/api/auth/verify-invite/:token', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT email, role, expires_at FROM aufmass_invitations
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()`,
      [req.params.token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired invitation' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Verify invite error:', err);
    res.status(500).json({ error: 'Failed to verify invitation' });
  }
});

// Update user (Admin only, branch filtered)
app.put('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, role, is_active } = req.body;
    const userId = parseInt(req.params.id);

    // Prevent admin from deactivating themselves
    if (userId === req.user.id && is_active === false) {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    if (req.branchId) {
      await pool.query(
        `UPDATE aufmass_users SET name = $1, role = $2, is_active = $3, updated_at = NOW()
         WHERE id = $4 AND branch_id = $5`,
        [name, role, is_active, userId, req.branchId]
      );
    } else {
      await pool.query(
        `UPDATE aufmass_users SET name = $1, role = $2, is_active = $3, updated_at = NOW()
         WHERE id = $4`,
        [name, role, is_active, userId]
      );
    }

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (Admin only, branch filtered)
app.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent admin from deleting themselves
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    if (req.branchId) {
      await pool.query('DELETE FROM aufmass_users WHERE id = $1 AND branch_id = $2', [userId, req.branchId]);
    } else {
      await pool.query('DELETE FROM aufmass_users WHERE id = $1', [userId]);
    }

    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ============ API ROUTES (Protected) ============

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Get current branch info (from subdomain)
app.get('/api/branch', async (req, res) => {
  try {
    if (!req.branchId) {
      return res.json({ branch: null, name: 'Development', isDevMode: true });
    }

    const result = await pool.query(
      'SELECT * FROM aufmass_branches WHERE slug = $1 AND is_active = true',
      [req.branchId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Branch not found' });
    }

    res.json({ branch: result.rows[0], isDevMode: false });
  } catch (err) {
    console.error('Error fetching branch:', err);
    res.status(500).json({ error: 'Failed to fetch branch info' });
  }
});

// Get all branches (admin only)
app.get('/api/branches', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM aufmass_branches ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching branches:', err);
    res.status(500).json({ error: 'Failed to fetch branches' });
  }
});

// Get all forms
app.get('/api/forms', authenticateToken, async (req, res) => {
  try {
    console.log('=== GET FORMS ===');
    console.log('User:', req.user.email);
    console.log('BranchId from middleware:', req.branchId);
    console.log('Origin:', req.headers.origin);
    console.log('Host:', req.headers.host);

    // Auto-delete forms in Papierkorb older than 60 days (with logging)
    const deletedRows = await pool.query(`
      DELETE FROM aufmass_forms
      WHERE status = 'papierkorb'
      AND papierkorb_date IS NOT NULL
      AND papierkorb_date < CURRENT_DATE - INTERVAL '60 days'
      RETURNING id, kunde_vorname, kunde_nachname, branch_id, papierkorb_date
    `);
    if (deletedRows.rows.length > 0) {
      console.log(`[PAPIERKORB-CLEANUP] ${deletedRows.rows.length} form(s) permanently deleted:`);
      deletedRows.rows.forEach(r => console.log(`  ID:${r.id} ${r.kunde_vorname} ${r.kunde_nachname} (${r.branch_id}) papierkorb:${r.papierkorb_date}`));
    }

    // Build query with optional branch filter
    let query, params;
    if (req.branchId) {
      query = `
        SELECT
          f.id, f.datum, f.aufmasser, f.kunde_vorname, f.kunde_nachname, f.kunde_email, f.kunde_telefon,
          f.kundenlokation, f.category, f.product_type, f.model, f.specifications,
          f.markise_data, f.bemerkungen, f.status, f.created_by, f.created_at, f.updated_at,
          f.montage_datum, f.status_date, f.pdf_generated_at, f.branch_id, f.papierkorb_date, f.lead_id,
          EXISTS(
            SELECT 1
            FROM aufmass_abnahme_sign_requests sr
            WHERE sr.form_id = f.id
              AND sr.status = 'pending'
              AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
          ) as abnahme_sign_pending,
          (SELECT COUNT(*) FROM aufmass_bilder WHERE form_id = f.id AND file_type LIKE 'image/%') as image_count,
          (SELECT COUNT(*) FROM aufmass_bilder WHERE form_id = f.id AND (file_type = 'application/pdf' OR file_name LIKE '%.pdf')) as pdf_count
        FROM aufmass_forms f
        WHERE f.branch_id = $1
        ORDER BY f.created_at DESC
      `;
      params = [req.branchId];
    } else {
      query = `
        SELECT
          f.id, f.datum, f.aufmasser, f.kunde_vorname, f.kunde_nachname, f.kunde_email, f.kunde_telefon,
          f.kundenlokation, f.category, f.product_type, f.model, f.specifications,
          f.markise_data, f.bemerkungen, f.status, f.created_by, f.created_at, f.updated_at,
          f.montage_datum, f.status_date, f.pdf_generated_at, f.branch_id, f.papierkorb_date, f.lead_id,
          EXISTS(
            SELECT 1
            FROM aufmass_abnahme_sign_requests sr
            WHERE sr.form_id = f.id
              AND sr.status = 'pending'
              AND (sr.expires_at IS NULL OR sr.expires_at > NOW())
          ) as abnahme_sign_pending,
          (SELECT COUNT(*) FROM aufmass_bilder WHERE form_id = f.id AND file_type LIKE 'image/%') as image_count,
          (SELECT COUNT(*) FROM aufmass_bilder WHERE form_id = f.id AND (file_type = 'application/pdf' OR file_name LIKE '%.pdf')) as pdf_count
        FROM aufmass_forms f
        ORDER BY f.created_at DESC
      `;
      params = [];
    }

    const result = await pool.query(query, params);

    // Batch fetch all bilder metadata in ONE query instead of N+1
    const formIds = result.rows.map(f => f.id);
    let bilderMap = {};
    if (formIds.length > 0) {
      let bilderQuery, bilderParams;
      if (req.branchId) {
        bilderQuery = `
          SELECT b.id, b.form_id, b.file_name, b.file_type
          FROM aufmass_bilder b
          INNER JOIN aufmass_forms f ON b.form_id = f.id
          WHERE f.branch_id = $1
        `;
        bilderParams = [req.branchId];
      } else {
        bilderQuery = `
          SELECT b.id, b.form_id, b.file_name, b.file_type
          FROM aufmass_bilder b
          INNER JOIN aufmass_forms f ON b.form_id = f.id
        `;
        bilderParams = [];
      }
      const bilderResult = await pool.query(bilderQuery, bilderParams);

      // Group by form_id
      bilderMap = {};
      for (const bild of bilderResult.rows) {
        if (!bilderMap[bild.form_id]) {
          bilderMap[bild.form_id] = [];
        }
        bilderMap[bild.form_id].push(bild);
      }
    }

    // Map bilder to forms
    const formsWithFiles = result.rows.map(form => {
      const allBilder = bilderMap[form.id] || [];
      return {
        ...form,
        pdf_files: allBilder.filter(b => b.file_type === 'application/pdf' || b.file_name.endsWith('.pdf')),
        media_files: allBilder.filter(b => b.file_type.startsWith('image/') || b.file_type.startsWith('video/'))
      };
    });

    console.log('Forms found:', formsWithFiles.length);
    console.log('Forms branch_ids:', [...new Set(result.rows.map(f => f.branch_id))]);
    res.json(formsWithFiles);
  } catch (err) {
    console.error('Error fetching forms:', err);
    res.status(500).json({ error: 'Failed to fetch forms' });
  }
});

// Get single form by ID (branch filtered)
app.get('/api/forms/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    let query, params;
    if (req.branchId) {
      query = `SELECT id, datum, aufmasser, kunde_vorname, kunde_nachname, kunde_email, kunde_telefon,
               kundenlokation, category, product_type, model, specifications,
               markise_data, bemerkungen, status, created_by, created_at, updated_at,
               montage_datum, status_date, pdf_generated_at, customer_signature, signature_name
               FROM aufmass_forms WHERE id = $1 AND branch_id = $2`;
      params = [id, req.branchId];
    } else {
      query = `SELECT id, datum, aufmasser, kunde_vorname, kunde_nachname, kunde_email, kunde_telefon,
               kundenlokation, category, product_type, model, specifications,
               markise_data, bemerkungen, status, created_by, created_at, updated_at,
               montage_datum, status_date, pdf_generated_at, customer_signature, signature_name
               FROM aufmass_forms WHERE id = $1`;
      params = [id];
    }
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Get images for this form
    const images = await pool.query(
      'SELECT id, file_name, file_type FROM aufmass_bilder WHERE form_id = $1',
      [id]
    );

    // Get additional products for this form
    const produkte = await pool.query(
      'SELECT * FROM aufmass_form_produkte WHERE form_id = $1 ORDER BY sort_order',
      [id]
    );

    // Transform produkte to match frontend format
    const transformedProdukte = produkte.rows.map(p => ({
      id: String(p.id),
      category: p.category,
      productType: p.product_type,
      model: p.model,
      specifications: typeof p.specifications === 'string' ? JSON.parse(p.specifications) : (p.specifications || {})
    }));

    res.json({
      ...result.rows[0],
      bilder: images.rows,
      weitereProdukte: transformedProdukte
    });
  } catch (err) {
    console.error('Error fetching form:', err);
    res.status(500).json({ error: 'Failed to fetch form' });
  }
});

// Create new form
app.post('/api/forms', authenticateToken, async (req, res) => {
  try {
    const {
      datum,
      aufmasser,
      kundeVorname,
      kundeNachname,
      kundeEmail,
      kundeTelefon,
      kundenlokation,
      category,
      productType,
      model,
      specifications,
      markiseData,
      bemerkungen,
      status,
      weitereProdukte,
      leadId,
      customerSignature,
      signatureName
    } = req.body;

    // Auto-set status_date to form datum (Aufmass date) when form is created
    // Set branch_id from subdomain detection
    console.log('=== CREATE FORM ===');
    console.log('User:', req.user.email);
    console.log('BranchId being set:', req.branchId);
    console.log('Origin:', req.headers.origin);

    const result = await pool.query(
      `INSERT INTO aufmass_forms
       (datum, aufmasser, kunde_vorname, kunde_nachname, kunde_email, kunde_telefon, kundenlokation, category, product_type, model, specifications, markise_data, bemerkungen, status, status_date, branch_id, created_by, lead_id, customer_signature, signature_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        datum, aufmasser, kundeVorname, kundeNachname, kundeEmail || null, kundeTelefon || null,
        kundenlokation, category, productType, model,
        JSON.stringify(specifications || {}), JSON.stringify(markiseData || null),
        bemerkungen || '', status || 'neu', datum, req.branchId || null, req.user.id, leadId || null,
        customerSignature || null, signatureName || null
      ]
    );

    const newId = result.rows[0].id;

    // Insert additional products if provided
    if (weitereProdukte && Array.isArray(weitereProdukte) && weitereProdukte.length > 0) {
      for (let i = 0; i < weitereProdukte.length; i++) {
        const produkt = weitereProdukte[i];
        await pool.query(
          `INSERT INTO aufmass_form_produkte (form_id, sort_order, category, product_type, model, specifications)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId, i + 1, produkt.category, produkt.productType, produkt.model, JSON.stringify(produkt.specifications || {})]
        );
      }
    }

    res.status(201).json({ id: newId, message: 'Form created successfully' });
  } catch (err) {
    console.error('Error creating form:', err);
    res.status(500).json({ error: 'Failed to create form' });
  }
});

// Update form (supports partial updates, branch filtered)
app.put('/api/forms/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const fieldMappings = {
      datum: { column: 'datum' },
      aufmasser: { column: 'aufmasser' },
      kundeVorname: { column: 'kunde_vorname' },
      kundeNachname: { column: 'kunde_nachname' },
      kundeEmail: { column: 'kunde_email' },
      kundeTelefon: { column: 'kunde_telefon' },
      kundenlokation: { column: 'kundenlokation' },
      category: { column: 'category' },
      productType: { column: 'product_type' },
      model: { column: 'model' },
      specifications: { column: 'specifications', transform: v => JSON.stringify(v || {}) },
      markiseData: { column: 'markise_data', transform: v => JSON.stringify(v || null) },
      bemerkungen: { column: 'bemerkungen' },
      status: { column: 'status' },
      montageDatum: { column: 'montage_datum' },
      statusDate: { column: 'status_date' },
      papierkorbDate: { column: 'papierkorb_date' },
      customerSignature: { column: 'customer_signature' },
      signatureName: { column: 'signature_name' }
    };

    // Auto-set papierkorb_date when moving to trash, clear when restoring
    if (updates.status === 'papierkorb') {
      updates.papierkorbDate = new Date().toISOString().split('T')[0];
    } else if (updates.status && updates.status !== 'papierkorb') {
      updates.papierkorbDate = null;
    }

    const setClauses = [];
    const values = [];
    let paramIdx = 1;

    // First param is always id
    values.push(id);
    paramIdx++;

    // If branch filter, second param is branch_id
    if (req.branchId) {
      values.push(req.branchId);
      paramIdx++;
    }

    for (const [key, mapping] of Object.entries(fieldMappings)) {
      if (updates[key] !== undefined) {
        const value = mapping.transform ? mapping.transform(updates[key]) : updates[key];
        setClauses.push(`${mapping.column} = $${paramIdx}`);
        values.push(value);
        paramIdx++;
      }
    }

    // Handle weitereProdukte separately
    if (updates.weitereProdukte !== undefined) {
      // Delete existing products and re-insert
      await pool.query('DELETE FROM aufmass_form_produkte WHERE form_id = $1', [id]);

      if (Array.isArray(updates.weitereProdukte) && updates.weitereProdukte.length > 0) {
        for (let i = 0; i < updates.weitereProdukte.length; i++) {
          const produkt = updates.weitereProdukte[i];
          await pool.query(
            `INSERT INTO aufmass_form_produkte (form_id, sort_order, category, product_type, model, specifications)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, i + 1, produkt.category, produkt.productType, produkt.model, JSON.stringify(produkt.specifications || {})]
          );
        }
      }
    }

    if (setClauses.length === 0 && updates.weitereProdukte === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (setClauses.length > 0) {
      setClauses.push('updated_at = NOW()');
      const branchFilter = req.branchId ? `AND branch_id = $2` : '';
      await pool.query(
        `UPDATE aufmass_forms SET ${setClauses.join(', ')} WHERE id = $1 ${branchFilter}`,
        values
      );

      // If status was changed, add to status history
      if (updates.status !== undefined) {
        await pool.query(
          `INSERT INTO aufmass_status_history (form_id, status, changed_by, status_date, notes)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, updates.status, req.user?.id || null, updates.statusDate || null, updates.statusNotes || null]
        );
      }
    }

    // Delete stored PDF so next preview generates fresh one
    const pdfPath = path.join(PDF_DIR, `${id}.pdf`);
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }

    res.json({ message: 'Form updated successfully' });
  } catch (err) {
    console.error('Error updating form:', err);
    res.status(500).json({ error: 'Failed to update form' });
  }
});

// Delete form (branch filtered)
app.delete('/api/forms/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (req.branchId) {
      await pool.query('DELETE FROM aufmass_forms WHERE id = $1 AND branch_id = $2', [id, req.branchId]);
    } else {
      await pool.query('DELETE FROM aufmass_forms WHERE id = $1', [id]);
    }

    res.json({ message: 'Form deleted successfully' });
  } catch (err) {
    console.error('Error deleting form:', err);
    res.status(500).json({ error: 'Failed to delete form' });
  }
});

// ============ PDF STORAGE ENDPOINTS ============

// PDF storage directory
const PDF_DIR = process.env.PDF_DIR || (process.platform === 'win32' ? './aufmass-pdfs' : '/var/www/aufmass-pdfs');

// Ensure PDF directory exists
if (!fs.existsSync(PDF_DIR)) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
}

// Save generated PDF for a form (to filesystem - much faster than database)
app.post('/api/forms/:id/pdf', authenticateToken, (req, res, next) => {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      console.error(`PDF upload error for form ${req.params.id}:`, err.message, err.code, 'field:', err.field);
      return res.status(400).json({ error: `Upload fehlgeschlagen: ${err.message}` });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      console.error('PDF save: No file in request. Content-Type:', req.headers['content-type']);
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    console.log(`PDF save: form ${id}, size=${req.file.size}, mime=${req.file.mimetype}`);

    // Save PDF to filesystem
    if (!fs.existsSync(PDF_DIR)) {
      fs.mkdirSync(PDF_DIR, { recursive: true });
    }
    const pdfPath = path.join(PDF_DIR, `${id}.pdf`);
    fs.writeFileSync(pdfPath, req.file.buffer);

    // Update database - save PDF binary and mark as generated (non-blocking)
    // Filesystem is the primary storage, DB is secondary for e-signature
    pool.query(
      `UPDATE aufmass_forms SET generated_pdf = $1, pdf_generated_at = NOW(), updated_at = NOW() WHERE id = $2`,
      [req.file.buffer, id]
    ).catch(dbErr => console.error('DB PDF save failed (filesystem copy exists):', dbErr.message));

    res.json({ message: 'PDF saved successfully' });
  } catch (err) {
    console.error('Error saving PDF:', err);
    res.status(500).json({ error: 'Failed to save PDF' });
  }
});

// Get generated PDF for a form (filesystem first, fallback to DB)
app.get('/api/forms/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const pdfPath = path.join(PDF_DIR, `${id}.pdf`);

    // Try filesystem first
    if (fs.existsSync(pdfPath)) {
      const stats = fs.statSync(pdfPath);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="aufmass_${id}.pdf"`,
        'Content-Length': stats.size,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      const fileStream = fs.createReadStream(pdfPath);
      return fileStream.pipe(res);
    }

    // Fallback to DB (generated_pdf column)
    const result = await pool.query(
      'SELECT generated_pdf FROM aufmass_forms WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0 || !result.rows[0].generated_pdf) {
      return res.status(404).json({ error: 'No PDF generated for this form', needsGeneration: true });
    }

    const pdfBuffer = result.rows[0].generated_pdf;

    // Cache to filesystem for next time
    try { fs.writeFileSync(pdfPath, pdfBuffer); } catch {}

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="aufmass_${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error getting PDF:', err);
    res.status(500).json({ error: 'Failed to get PDF' });
  }
});

// === FORM PDF SNAPSHOTS — per-document-type frozen copies ===
// Stores aufmass / angebot / abnahme / rechnung PDFs as immutable snapshots.
// Triggered on status transitions so historic PDFs remain accessible.

const SNAPSHOT_TYPES = ['aufmass', 'angebot', 'abnahme', 'rechnung'];

app.post('/api/forms/:id/pdf-snapshot', authenticateToken, (req, res, next) => {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      console.error(`Snapshot upload error for form ${req.params.id}:`, err.message);
      return res.status(400).json({ error: `Upload fehlgeschlagen: ${err.message}` });
    }
    next();
  });
}, async (req, res) => {
  try {
    const formId = parseInt(req.params.id);
    const docType = String(req.body.document_type || '').toLowerCase();

    if (!SNAPSHOT_TYPES.includes(docType)) {
      return res.status(400).json({ error: `Invalid document_type. Must be one of: ${SNAPSHOT_TYPES.join(', ')}` });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    if (!await verifyFormBranch(formId, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const dir = path.join(PDF_DIR, 'snapshots');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const filename = `form${formId}_${docType}_${Date.now()}.pdf`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    // Upsert; remove old file if present
    const old = await pool.query(
      'SELECT file_path FROM aufmass_form_pdf_snapshots WHERE form_id = $1 AND document_type = $2',
      [formId, docType]
    );
    if (old.rows.length > 0) {
      const oldPath = path.join(dir, old.rows[0].file_path);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      await pool.query(
        'UPDATE aufmass_form_pdf_snapshots SET file_path = $1, created_at = NOW() WHERE form_id = $2 AND document_type = $3',
        [filename, formId, docType]
      );
    } else {
      await pool.query(
        'INSERT INTO aufmass_form_pdf_snapshots (form_id, document_type, file_path) VALUES ($1, $2, $3)',
        [formId, docType, filename]
      );
    }

    res.json({ success: true, document_type: docType, created_at: new Date().toISOString() });
  } catch (err) {
    console.error('Error saving form PDF snapshot:', err);
    res.status(500).json({ error: 'Failed to save snapshot' });
  }
});

// List available snapshots for a form
app.get('/api/forms/:id/pdf-snapshots', authenticateToken, async (req, res) => {
  try {
    const formId = parseInt(req.params.id);
    if (!await verifyFormBranch(formId, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }
    const result = await pool.query(
      `SELECT document_type, created_at FROM aufmass_form_pdf_snapshots
       WHERE form_id = $1 ORDER BY created_at ASC`,
      [formId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error listing snapshots:', err);
    res.status(500).json({ error: 'Failed to list snapshots' });
  }
});

// Stream a specific snapshot
app.get('/api/forms/:id/pdf-snapshot/:docType', authenticateToken, async (req, res) => {
  try {
    const formId = parseInt(req.params.id);
    const docType = String(req.params.docType).toLowerCase();
    if (!SNAPSHOT_TYPES.includes(docType)) {
      return res.status(400).json({ error: 'Invalid document_type' });
    }
    if (!await verifyFormBranch(formId, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }
    const result = await pool.query(
      'SELECT file_path FROM aufmass_form_pdf_snapshots WHERE form_id = $1 AND document_type = $2',
      [formId, docType]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }
    const filePath = path.join(PDF_DIR, 'snapshots', result.rows[0].file_path);
    if (!fs.existsSync(filePath)) {
      // Orphan record — clean up
      await pool.query(
        'DELETE FROM aufmass_form_pdf_snapshots WHERE form_id = $1 AND document_type = $2',
        [formId, docType]
      );
      return res.status(404).json({ error: 'Snapshot file missing' });
    }
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="form_${formId}_${docType}.pdf"`,
      'Cache-Control': 'private, max-age=86400'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Error streaming snapshot:', err);
    res.status(500).json({ error: 'Failed to fetch snapshot' });
  }
});

// Check if PDF exists for a form
app.get('/api/forms/:id/pdf/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify form belongs to this branch
    if (!await verifyFormBranch(id, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const pdfPath = path.join(PDF_DIR, `${id}.pdf`);

    // Check filesystem for PDF
    const hasPdf = fs.existsSync(pdfPath);
    let pdfGeneratedAt = null;
    let isOutdated = false;

    if (hasPdf) {
      const stats = fs.statSync(pdfPath);
      pdfGeneratedAt = stats.mtime.toISOString();

      // Check if form was updated after PDF was generated
      const result = await pool.query('SELECT updated_at FROM aufmass_forms WHERE id = $1', [id]);

      if (result.rows.length > 0) {
        const { updated_at } = result.rows[0];
        isOutdated = updated_at && new Date(updated_at) > stats.mtime;
      }
    }

    res.json({
      hasPdf,
      pdfGeneratedAt: pdfGeneratedAt,
      isOutdated,
      needsRegeneration: !hasPdf || isOutdated
    });
  } catch (err) {
    console.error('Error checking PDF status:', err);
    res.status(500).json({ error: 'Failed to check PDF status' });
  }
});

// ============ STATUS HISTORY ENDPOINTS ============

// Get status history for a form
app.get('/api/forms/:id/status-history', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify form belongs to this branch
    if (!await verifyFormBranch(id, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const result = await pool.query(
      `SELECT sh.*, u.name as changed_by_name
       FROM aufmass_status_history sh
       LEFT JOIN aufmass_users u ON sh.changed_by = u.id
       WHERE sh.form_id = $1
       ORDER BY sh.changed_at DESC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error getting status history:', err);
    res.status(500).json({ error: 'Failed to get status history' });
  }
});

// ============ ABNAHME ENDPOINTS ============

// Get abnahme data for a form
app.get('/api/forms/:id/abnahme', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify form belongs to this branch
    if (!await verifyFormBranch(id, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const result = await pool.query('SELECT * FROM aufmass_abnahme WHERE form_id = $1', [id]);

    if (result.rows.length === 0) {
      return res.json(null);
    }

    const abnahme = result.rows[0];
    res.json({
      id: abnahme.id,
      formId: abnahme.form_id,
      istFertig: abnahme.ist_fertig,
      hatProbleme: abnahme.hat_probleme,
      problemBeschreibung: abnahme.problem_beschreibung,
      maengelListe: abnahme.maengel_liste ? JSON.parse(abnahme.maengel_liste) : [],
      baustelleSauber: abnahme.baustelle_sauber,
      monteurNote: abnahme.monteur_note,
      kundeName: abnahme.kunde_name,
      kundeUnterschrift: abnahme.kunde_unterschrift,
      signatureData: abnahme.signature_data,
      abnahmeDatum: abnahme.abnahme_datum,
      bemerkungen: abnahme.bemerkungen,
      createdAt: abnahme.created_at,
      updatedAt: abnahme.updated_at
    });
  } catch (err) {
    console.error('Error getting abnahme:', err);
    res.status(500).json({ error: 'Failed to get abnahme data' });
  }
});

// Create or update abnahme data
app.post('/api/forms/:id/abnahme', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { istFertig, hatProbleme, problemBeschreibung, maengelListe, baustelleSauber, monteurNote, kundeName, kundeUnterschrift, bemerkungen, signatureData } = req.body;

    // Serialize maengelListe to JSON
    const maengelListeJson = maengelListe ? JSON.stringify(maengelListe) : null;

    // Check if abnahme already exists
    const existing = await pool.query('SELECT id FROM aufmass_abnahme WHERE form_id = $1', [id]);

    if (existing.rows.length > 0) {
      // Update existing
      await pool.query(
        `UPDATE aufmass_abnahme SET
          ist_fertig = $1, hat_probleme = $2, problem_beschreibung = $3,
          maengel_liste = $4, baustelle_sauber = $5, monteur_note = $6,
          kunde_name = $7, kunde_unterschrift = $8, abnahme_datum = $9,
          bemerkungen = $10, signature_data = COALESCE($11, signature_data), updated_at = NOW()
         WHERE form_id = $12`,
        [
          istFertig ? true : false, hatProbleme ? true : false, problemBeschreibung || null,
          maengelListeJson, baustelleSauber || null, monteurNote || null,
          kundeName || null, kundeUnterschrift ? true : false, new Date(),
          bemerkungen || null, signatureData || null, id
        ]
      );
    } else {
      // Create new
      await pool.query(
        `INSERT INTO aufmass_abnahme (form_id, ist_fertig, hat_probleme, problem_beschreibung, maengel_liste, baustelle_sauber, monteur_note, kunde_name, kunde_unterschrift, abnahme_datum, bemerkungen, signature_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id, istFertig ? true : false, hatProbleme ? true : false, problemBeschreibung || null,
          maengelListeJson, baustelleSauber || null, monteurNote || null,
          kundeName || null, kundeUnterschrift ? true : false, new Date(),
          bemerkungen || null, signatureData || null
        ]
      );
    }

    // Delete stored PDF so next preview generates fresh one with abnahme data
    const pdfPath = path.join(PDF_DIR, `${id}.pdf`);
    if (fs.existsSync(pdfPath)) {
      fs.unlinkSync(pdfPath);
    }

    res.json({ message: 'Abnahme saved successfully' });
  } catch (err) {
    console.error('Error saving abnahme:', err);
    res.status(500).json({ error: 'Failed to save abnahme data' });
  }
});

// Create public abnahme sign link
app.post('/api/forms/:id/abnahme/sign-request', authenticateToken, requireAdminOrOffice, async (req, res) => {
  try {
    const { id } = req.params;

    if (!await verifyFormBranch(id, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const snapshot = await buildAbnahmeSignSnapshot(id);
    if (!snapshot) {
      return res.status(400).json({ error: 'Abnahme data must be saved before creating a sign link' });
    }

    const rawToken = crypto.randomBytes(24).toString('hex');
    const tokenHash = hashPublicToken(rawToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await pool.query(
      `UPDATE aufmass_abnahme_sign_requests
       SET status = 'replaced', updated_at = NOW()
       WHERE form_id = $1 AND status = 'pending'`,
      [id]
    );

    const insertResult = await pool.query(
      `INSERT INTO aufmass_abnahme_sign_requests
       (form_id, branch_id, token_hash, snapshot_json, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, expires_at`,
      [id, req.branchId || null, tokenHash, JSON.stringify(snapshot), expiresAt, req.user.id]
    );

    const appBaseUrl = req.headers.origin || process.env.PUBLIC_APP_URL || 'http://localhost:5173';
    const signUrl = `${appBaseUrl}/abnahme/sign/${rawToken}`;

    res.json({
      id: insertResult.rows[0].id,
      signUrl,
      expiresAt: insertResult.rows[0].expires_at
    });
  } catch (err) {
    console.error('Error creating abnahme sign request:', err);
    res.status(500).json({ error: 'Failed to create sign link' });
  }
});

// Get public abnahme sign request
app.get('/api/public/abnahme-sign/:token', async (req, res) => {
  try {
    const tokenHash = hashPublicToken(req.params.token);
    const result = await pool.query(
      `SELECT id, form_id, status, snapshot_json, signer_name, signed_at, expires_at
       FROM aufmass_abnahme_sign_requests
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sign request not found' });
    }

    const request = result.rows[0];
    const isExpired = request.expires_at && new Date(request.expires_at) < new Date();

    res.json({
      id: request.id,
      formId: request.form_id,
      status: isExpired && request.status === 'pending' ? 'expired' : request.status,
      signerName: request.signer_name,
      signedAt: request.signed_at,
      expiresAt: request.expires_at,
      snapshot: JSON.parse(request.snapshot_json)
    });
  } catch (err) {
    console.error('Error getting public abnahme sign request:', err);
    res.status(500).json({ error: 'Failed to load sign request' });
  }
});

// Submit public abnahme signature
app.post('/api/public/abnahme-sign/:token', async (req, res) => {
  const client = await pool.connect();
  try {
    const tokenHash = hashPublicToken(req.params.token);
    const { signerName, signatureData } = req.body;

    if (!signerName || !signatureData) {
      return res.status(400).json({ error: 'Signer name and signature are required' });
    }

    const requestResult = await client.query(
      `SELECT id, form_id, status, snapshot_json, expires_at
       FROM aufmass_abnahme_sign_requests
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ error: 'Sign request not found' });
    }

    const signRequest = requestResult.rows[0];
    if (signRequest.status === 'signed') {
      return res.status(409).json({ error: 'This sign request has already been completed' });
    }
    if (signRequest.expires_at && new Date(signRequest.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This sign request has expired' });
    }

    const snapshot = JSON.parse(signRequest.snapshot_json);
    const targetStatus = snapshot?.abnahme?.hatProbleme ? 'reklamation_eingegangen' : 'abnahme';

    await client.query('BEGIN');

    await client.query(
      `UPDATE aufmass_abnahme_sign_requests
       SET status = 'signed', signer_name = $1, signature_data = $2, signed_at = NOW(), used_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [signerName.trim(), signatureData, signRequest.id]
    );

    await client.query(
      `UPDATE aufmass_abnahme
       SET kunde_name = $1, kunde_unterschrift = true, abnahme_datum = NOW(), signature_data = $2, updated_at = NOW()
       WHERE form_id = $3`,
      [signerName.trim(), signatureData, signRequest.form_id]
    );

    await client.query(
      `UPDATE aufmass_forms
       SET status = $1, updated_at = NOW()
       WHERE id = $2`,
      [targetStatus, signRequest.form_id]
    );

    await client.query('COMMIT');

    res.json({ success: true, formId: signRequest.form_id, status: targetStatus });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error submitting public abnahme signature:', err);
    res.status(500).json({ error: 'Failed to submit signature' });
  } finally {
    client.release();
  }
});

// Public PDF download for signed abnahme
app.get('/api/public/abnahme-sign/:token/pdf', async (req, res) => {
  try {
    const tokenHash = hashPublicToken(req.params.token);
    const result = await pool.query(
      `SELECT form_id, status FROM aufmass_abnahme_sign_requests WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Sign request not found' });
    }

    const { form_id, status } = result.rows[0];
    if (status !== 'signed') {
      return res.status(403).json({ error: 'PDF is only available after signing' });
    }

    const pdfPath = path.join(PDF_DIR, `${form_id}.pdf`);
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF not yet generated' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Abnahme-Protokoll.pdf"`);
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error('Error serving public abnahme PDF:', err);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// Upload images for a form
app.post('/api/forms/:id/images', authenticateToken, upload.array('images', 10), async (req, res) => {
  try {
    const { id } = req.params;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    for (const file of files) {
      await pool.query(
        `INSERT INTO aufmass_bilder (form_id, file_name, file_data, file_type)
         VALUES ($1, $2, $3, $4)`,
        [id, file.originalname, file.buffer, file.mimetype]
      );
    }

    res.json({ message: `${files.length} images uploaded successfully` });
  } catch (err) {
    console.error('Error uploading images:', err.message);
    res.status(500).json({ error: 'Failed to upload images' });
  }
});

// Upload Maengel/Abnahme images for a form
app.post('/api/forms/:id/abnahme-images', authenticateToken, upload.array('images', 10), async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify form belongs to this branch
    if (!await verifyFormBranch(id, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images provided' });
    }

    for (const file of files) {
      await pool.query(
        `INSERT INTO aufmass_abnahme_bilder (form_id, file_name, file_data, file_type)
         VALUES ($1, $2, $3, $4)`,
        [id, file.originalname, file.buffer, file.mimetype]
      );
    }

    res.json({ message: `${files.length} Maengel images uploaded successfully` });
  } catch (err) {
    console.error('Error uploading Maengel images:', err);
    res.status(500).json({ error: 'Failed to upload Maengel images' });
  }
});

// Get Maengel/Abnahme images for a form
app.get('/api/forms/:id/abnahme-images', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify form belongs to this branch
    if (!await verifyFormBranch(id, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const result = await pool.query(
      'SELECT id, file_name, file_type, created_at FROM aufmass_abnahme_bilder WHERE form_id = $1 ORDER BY created_at',
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error getting Maengel images:', err);
    res.status(500).json({ error: 'Failed to get Maengel images' });
  }
});

// Get single Maengel image data
app.get('/api/abnahme-images/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    let query, params;
    if (req.branchId) {
      query = `SELECT ab.file_data, ab.file_type, ab.file_name
               FROM aufmass_abnahme_bilder ab
               INNER JOIN aufmass_forms f ON ab.form_id = f.id
               WHERE ab.id = $1 AND (f.branch_id = $2 OR f.branch_id IS NULL)`;
      params = [id, req.branchId];
    } else {
      query = `SELECT ab.file_data, ab.file_type, ab.file_name
               FROM aufmass_abnahme_bilder ab
               INNER JOIN aufmass_forms f ON ab.form_id = f.id
               WHERE ab.id = $1`;
      params = [id];
    }
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const image = result.rows[0];
    res.setHeader('Content-Type', image.file_type);
    res.setHeader('Content-Disposition', `inline; filename="${image.file_name}"`);
    res.send(image.file_data);
  } catch (err) {
    console.error('Error getting Maengel image:', err);
    res.status(500).json({ error: 'Failed to get image' });
  }
});

// Delete Maengel image
app.delete('/api/abnahme-images/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify image belongs to a form in this branch
    let verifyQuery, verifyParams;
    if (req.branchId) {
      verifyQuery = `SELECT ab.id FROM aufmass_abnahme_bilder ab
                     INNER JOIN aufmass_forms f ON ab.form_id = f.id
                     WHERE ab.id = $1 AND (f.branch_id = $2 OR f.branch_id IS NULL)`;
      verifyParams = [id, req.branchId];
    } else {
      verifyQuery = `SELECT ab.id FROM aufmass_abnahme_bilder ab
                     INNER JOIN aufmass_forms f ON ab.form_id = f.id
                     WHERE ab.id = $1`;
      verifyParams = [id];
    }
    const verify = await pool.query(verifyQuery, verifyParams);
    if (verify.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    await pool.query('DELETE FROM aufmass_abnahme_bilder WHERE id = $1', [id]);

    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Error deleting Maengel image:', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// ============ ANGEBOT (QUOTE) ENDPOINTS ============

// Get Angebot data for a form
app.get('/api/forms/:id/angebot', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify form belongs to this branch
    if (!await verifyFormBranch(id, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    // Get angebot summary
    const summaryResult = await pool.query('SELECT * FROM aufmass_angebot WHERE form_id = $1', [id]);

    // Get angebot items
    const itemsResult = await pool.query(
      'SELECT * FROM aufmass_angebot_items WHERE form_id = $1 ORDER BY sort_order, id',
      [id]
    );

    res.json({
      summary: summaryResult.rows[0] || null,
      items: itemsResult.rows
    });
  } catch (err) {
    console.error('Error fetching Angebot:', err);
    res.status(500).json({ error: 'Failed to fetch Angebot data' });
  }
});

// Save/Update Angebot data
app.post('/api/forms/:id/angebot', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify form belongs to this branch
    if (!await verifyFormBranch(id, req.branchId)) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const { items, angebot_datum, bemerkungen, mwst_satz = 19 } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // Validate items
    for (const item of items) {
      if (!item.bezeichnung || item.bezeichnung.trim() === '') {
        return res.status(400).json({ error: 'Bezeichnung is required for all items' });
      }
      if (!item.menge || item.menge <= 0) {
        return res.status(400).json({ error: 'Menge must be greater than 0' });
      }
      if (item.einzelpreis === undefined || item.einzelpreis < 0) {
        return res.status(400).json({ error: 'Einzelpreis is required for all items' });
      }
    }

    // Calculate totals
    const netto_summe = items.reduce((sum, item) => {
      const gesamtpreis = (parseFloat(item.menge) || 0) * (parseFloat(item.einzelpreis) || 0);
      return sum + gesamtpreis;
    }, 0);
    const mwst_betrag = netto_summe * (mwst_satz / 100);
    const brutto_summe = netto_summe + mwst_betrag;

    // Delete existing items
    await pool.query('DELETE FROM aufmass_angebot_items WHERE form_id = $1', [id]);

    // Insert new items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const gesamtpreis = (parseFloat(item.menge) || 0) * (parseFloat(item.einzelpreis) || 0);

      await pool.query(
        `INSERT INTO aufmass_angebot_items (form_id, bezeichnung, menge, einzelpreis, gesamtpreis, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, item.bezeichnung, parseFloat(item.menge) || 1, parseFloat(item.einzelpreis) || 0, gesamtpreis, i]
      );
    }

    // Upsert angebot summary
    const existingResult = await pool.query('SELECT id FROM aufmass_angebot WHERE form_id = $1', [id]);

    if (existingResult.rows.length > 0) {
      await pool.query(
        `UPDATE aufmass_angebot
         SET netto_summe = $1, mwst_satz = $2, mwst_betrag = $3,
             brutto_summe = $4, angebot_datum = $5, bemerkungen = $6,
             updated_at = NOW()
         WHERE form_id = $7`,
        [netto_summe, mwst_satz, mwst_betrag, brutto_summe,
         angebot_datum ? new Date(angebot_datum) : new Date(), bemerkungen || null, id]
      );
    } else {
      await pool.query(
        `INSERT INTO aufmass_angebot (form_id, netto_summe, mwst_satz, mwst_betrag, brutto_summe, angebot_datum, bemerkungen)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, netto_summe, mwst_satz, mwst_betrag, brutto_summe,
         angebot_datum ? new Date(angebot_datum) : new Date(), bemerkungen || null]
      );
    }

    res.json({
      message: 'Angebot saved successfully',
      summary: {
        netto_summe,
        mwst_satz,
        mwst_betrag,
        brutto_summe
      }
    });
  } catch (err) {
    console.error('Error saving Angebot:', err);
    res.status(500).json({ error: 'Failed to save Angebot data' });
  }
});

// Upload temporary file (for PDF links in exported PDF)
app.post('/api/upload-temp', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Create temp_files table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS aufmass_temp_files (
        id SERIAL PRIMARY KEY,
        file_name VARCHAR(255) NOT NULL,
        file_data BYTEA NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert file and get ID
    const result = await pool.query(
      `INSERT INTO aufmass_temp_files (file_name, file_data, file_type)
       VALUES ($1, $2, $3) RETURNING id`,
      [file.originalname, file.buffer, file.mimetype]
    );

    const fileId = result.rows[0].id;
    const fileUrl = `${req.protocol}://${req.get('host')}/api/files/${fileId}`;

    res.json({ id: fileId, url: fileUrl, fileName: file.originalname });
  } catch (err) {
    console.error('Error uploading temp file:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Get temp file by ID (public)
app.get('/api/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT file_data, file_type, file_name FROM aufmass_temp_files WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'File not found' });
    }

    const file = result.rows[0];
    res.set('Content-Type', file.file_type);
    res.set('Content-Disposition', `inline; filename="${file.file_name}"`);
    res.send(file.file_data);
  } catch (err) {
    console.error('Error fetching file:', err);
    res.status(500).json({ error: 'Failed to fetch file' });
  }
});

// Get image by ID (with branch isolation)
app.get('/api/images/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    let query, params;
    if (req.branchId) {
      query = `SELECT b.file_data, b.file_type, b.file_name
               FROM aufmass_bilder b
               INNER JOIN aufmass_forms f ON b.form_id = f.id
               WHERE b.id = $1 AND (f.branch_id = $2 OR f.branch_id IS NULL)`;
      params = [id, req.branchId];
    } else {
      query = `SELECT b.file_data, b.file_type, b.file_name
               FROM aufmass_bilder b
               INNER JOIN aufmass_forms f ON b.form_id = f.id
               WHERE b.id = $1`;
      params = [id];
    }
    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    const image = result.rows[0];
    res.set('Content-Type', image.file_type);
    res.set('Content-Disposition', `inline; filename="${image.file_name}"`);
    res.send(image.file_data);
  } catch (err) {
    console.error('Error fetching image:', err);
    res.status(500).json({ error: 'Failed to fetch image' });
  }
});

// Delete image
app.delete('/api/images/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Branch isolation: verify image belongs to a form in this branch
    let verifyQuery, verifyParams;
    if (req.branchId) {
      verifyQuery = `SELECT b.id FROM aufmass_bilder b
                     INNER JOIN aufmass_forms f ON b.form_id = f.id
                     WHERE b.id = $1 AND (f.branch_id = $2 OR f.branch_id IS NULL)`;
      verifyParams = [id, req.branchId];
    } else {
      verifyQuery = `SELECT b.id FROM aufmass_bilder b
                     INNER JOIN aufmass_forms f ON b.form_id = f.id
                     WHERE b.id = $1`;
      verifyParams = [id];
    }
    const verify = await pool.query(verifyQuery, verifyParams);
    if (verify.rows.length === 0) {
      return res.status(404).json({ error: 'Image not found' });
    }

    await pool.query('DELETE FROM aufmass_bilder WHERE id = $1', [id]);

    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Error deleting image:', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

// Get dashboard stats
app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    let total, completed, draft;
    if (req.branchId) {
      total = await pool.query('SELECT COUNT(*) as count FROM aufmass_forms WHERE branch_id = $1', [req.branchId]);
      completed = await pool.query("SELECT COUNT(*) as count FROM aufmass_forms WHERE status = 'abnahme' AND branch_id = $1", [req.branchId]);
      draft = await pool.query("SELECT COUNT(*) as count FROM aufmass_forms WHERE status IN ('neu', 'angebot_versendet') AND branch_id = $1", [req.branchId]);
    } else {
      total = await pool.query('SELECT COUNT(*) as count FROM aufmass_forms');
      completed = await pool.query("SELECT COUNT(*) as count FROM aufmass_forms WHERE status = 'abnahme'");
      draft = await pool.query("SELECT COUNT(*) as count FROM aufmass_forms WHERE status IN ('neu', 'angebot_versendet')");
    }

    res.json({
      total: parseInt(total.rows[0].count),
      completed: parseInt(completed.rows[0].count),
      draft: parseInt(draft.rows[0].count)
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get Montageteam stats (with project counts from forms)
app.get('/api/stats/montageteam', authenticateToken, async (req, res) => {
  try {
    let query, params;
    if (req.branchId) {
      query = `
        SELECT
          m.id,
          m.name as montageteam,
          m.is_active,
          m.created_at,
          COALESCE(f.count, 0) as count,
          COALESCE(f.neu, 0) as neu,
          COALESCE(f.abgeschlossen, 0) as abgeschlossen
        FROM aufmass_montageteams m
        LEFT JOIN (
          SELECT
            specifications::jsonb->>'montageteam' as team_name,
            COUNT(*) as count,
            SUM(CASE WHEN status IN ('neu', 'draft', 'completed') THEN 1 ELSE 0 END) as neu,
            SUM(CASE WHEN status = 'abgeschlossen' THEN 1 ELSE 0 END) as abgeschlossen
          FROM aufmass_forms
          WHERE specifications::jsonb->>'montageteam' IS NOT NULL
            AND specifications::jsonb->>'montageteam' != ''
            AND branch_id = $1
          GROUP BY specifications::jsonb->>'montageteam'
        ) f ON m.name = f.team_name
        WHERE m.is_active = true AND m.branch_id = $1
        ORDER BY m.name ASC
      `;
      params = [req.branchId];
    } else {
      query = `
        SELECT
          m.id,
          m.name as montageteam,
          m.is_active,
          m.created_at,
          COALESCE(f.count, 0) as count,
          COALESCE(f.neu, 0) as neu,
          COALESCE(f.abgeschlossen, 0) as abgeschlossen
        FROM aufmass_montageteams m
        LEFT JOIN (
          SELECT
            specifications::jsonb->>'montageteam' as team_name,
            COUNT(*) as count,
            SUM(CASE WHEN status IN ('neu', 'draft', 'completed') THEN 1 ELSE 0 END) as neu,
            SUM(CASE WHEN status = 'abgeschlossen' THEN 1 ELSE 0 END) as abgeschlossen
          FROM aufmass_forms
          WHERE specifications::jsonb->>'montageteam' IS NOT NULL
            AND specifications::jsonb->>'montageteam' != ''
          GROUP BY specifications::jsonb->>'montageteam'
        ) f ON m.name = f.team_name
        WHERE m.is_active = true
        ORDER BY m.name ASC
      `;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching montageteam stats:', err);
    res.status(500).json({ error: 'Failed to fetch montageteam stats' });
  }
});

// ============ MONTAGETEAMS CRUD ============

// Get all montageteams
app.get('/api/montageteams', authenticateToken, async (req, res) => {
  try {
    let query, params;
    if (req.branchId) {
      query = 'SELECT * FROM aufmass_montageteams WHERE branch_id = $1 ORDER BY name ASC';
      params = [req.branchId];
    } else {
      query = 'SELECT * FROM aufmass_montageteams ORDER BY name ASC';
      params = [];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching montageteams:', err);
    res.status(500).json({ error: 'Failed to fetch montageteams' });
  }
});

// Create montageteam
app.post('/api/montageteams', authenticateToken, requireAdminOrOffice, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await pool.query(
      `INSERT INTO aufmass_montageteams (name, branch_id)
       VALUES ($1, $2) RETURNING *`,
      [name.trim(), req.branchId || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('duplicate') || err.code === '23505') {
      return res.status(400).json({ error: 'Montageteam name already exists' });
    }
    console.error('Error creating montageteam:', err);
    res.status(500).json({ error: 'Failed to create montageteam' });
  }
});

// Update montageteam (branch filtered)
app.put('/api/montageteams/:id', authenticateToken, requireAdminOrOffice, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_active } = req.body;

    if (req.branchId) {
      await pool.query(
        `UPDATE aufmass_montageteams SET name = $1, is_active = $2
         WHERE id = $3 AND branch_id = $4`,
        [name, is_active !== undefined ? is_active : true, id, req.branchId]
      );
    } else {
      await pool.query(
        `UPDATE aufmass_montageteams SET name = $1, is_active = $2 WHERE id = $3`,
        [name, is_active !== undefined ? is_active : true, id]
      );
    }

    res.json({ message: 'Montageteam updated' });
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('duplicate') || err.code === '23505') {
      return res.status(400).json({ error: 'Montageteam name already exists' });
    }
    console.error('Error updating montageteam:', err);
    res.status(500).json({ error: 'Failed to update montageteam' });
  }
});

// Delete montageteam (branch filtered)
app.delete('/api/montageteams/:id', authenticateToken, requireAdminOrOffice, async (req, res) => {
  try {
    const { id } = req.params;
    if (req.branchId) {
      await pool.query('DELETE FROM aufmass_montageteams WHERE id = $1 AND branch_id = $2', [id, req.branchId]);
    } else {
      await pool.query('DELETE FROM aufmass_montageteams WHERE id = $1', [id]);
    }

    res.json({ message: 'Montageteam deleted' });
  } catch (err) {
    console.error('Error deleting montageteam:', err);
    res.status(500).json({ error: 'Failed to delete montageteam' });
  }
});

// ============ E-SIGNATURE API HELPER ============

const ESIGN_API_URL = 'https://test.esignature.openapi.com';
const ESIGN_API_TOKEN = '6970ac597587b2a42b091184';  // Sandbox token - HARDCODED to avoid env override
const ESIGN_API_KEY = 'wwy8ndulhusbijf68wxgtv2zkx6mrevb';
const ESIGN_API_EMAIL = 'fkeles@conais.com';
const ESIGN_OAUTH_URL = process.env.ESIGN_OAUTH_URL || 'https://test.oauth.openapi.it';
const ESIGN_CERT_USERNAME = process.env.ESIGN_CERT_USERNAME || 'openapiSandboxUsername';
const ESIGN_CERT_PASSWORD = process.env.ESIGN_CERT_PASSWORD || 'openapiSandboxPassword';

// Verify token is valid before using
async function verifyOrRefreshToken() {
  try {
    // Basic Auth format: email:apikey
    const basicAuth = Buffer.from(`${ESIGN_API_EMAIL}:${ESIGN_API_KEY}`).toString('base64');
    console.log('OAuth Basic Auth (email:apikey):', ESIGN_API_EMAIL ? 'configured' : 'MISSING EMAIL!');

    // Check current token status via OAuth API
    const response = await fetch(`${ESIGN_OAUTH_URL}/token/${ESIGN_API_TOKEN}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    console.log('Token verification:', JSON.stringify(data, null, 2));

    if (data.success && data.token) {
      console.log('Token is valid. Scopes:', data.scopes);
      console.log('Token expires:', new Date(data.expire * 1000).toISOString());
      return ESIGN_API_TOKEN;
    } else {
      console.log('Token invalid or expired, creating new one...');
      return await createNewToken();
    }
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return ESIGN_API_TOKEN; // Fall back to existing token
  }
}

// Create new token with all eSignature scopes
async function createNewToken() {
  try {
    const basicAuth = Buffer.from(`${ESIGN_API_EMAIL}:${ESIGN_API_KEY}`).toString('base64');
    const response = await fetch(`${ESIGN_OAUTH_URL}/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        scopes: ['*:esignature.openapi.com/*', '*:test.esignature.openapi.com/*'],
        ttl: 31536000 // 1 year
      })
    });

    const data = await response.json();
    console.log('New token created:', JSON.stringify(data, null, 2));

    if (data.success && data.token) {
      return data.token;
    }
    throw new Error('Failed to create token');
  } catch (error) {
    console.error('Token creation failed:', error.message);
    throw error;
  }
}

// Helper: Call OpenAPI eSignature API
async function callEsignatureAPI(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${ESIGN_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  console.log(`Calling eSignature API: ${method} ${ESIGN_API_URL}${endpoint}`);
  console.log(`Full token: ${ESIGN_API_TOKEN}`);
  console.log(`Full URL: ${ESIGN_API_URL}`);
  const response = await fetch(`${ESIGN_API_URL}${endpoint}`, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`eSignature API error: ${response.status} - ${errorText}`);
  }

  // Check if response is JSON
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const jsonResponse = await response.json();
    console.log('eSignature API Response:', JSON.stringify(jsonResponse, null, 2));
    return jsonResponse;
  }

  return response;
}

// Helper: Check if branch has e-signature enabled
async function isBranchEsignatureEnabled(branchSlug) {
  if (!branchSlug) return false; // Admin branch doesn't need check

  const result = await pool.query(
    'SELECT esignature_enabled FROM aufmass_branch_settings WHERE branch_slug = $1',
    [branchSlug]
  );

  return result.rows.length > 0 && result.rows[0].esignature_enabled;
}

// ============ BOLDSIGN API CONFIGURATION ============

const BOLDSIGN_API_URL = process.env.BOLDSIGN_API_URL || 'https://api-eu.boldsign.com/v1';
const BOLDSIGN_API_KEY = process.env.BOLDSIGN_API_KEY || ''; // Must be set in .env
const BOLDSIGN_WEBHOOK_SECRET = process.env.BOLDSIGN_WEBHOOK_SECRET || '';

// Helper: Call BoldSign API
async function callBoldSignAPI(endpoint, method = 'GET', body = null, isFormData = false) {
  const headers = {
    'X-API-KEY': BOLDSIGN_API_KEY,
    'Accept': 'application/json'
  };

  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const options = { method, headers };

  if (body) {
    options.body = isFormData ? body : JSON.stringify(body);
  }

  console.log(`Calling BoldSign API: ${method} ${BOLDSIGN_API_URL}${endpoint}`);
  const response = await fetch(`${BOLDSIGN_API_URL}${endpoint}`, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BoldSign API error: ${response.status} - ${errorText}`);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const jsonResponse = await response.json();
    console.log('BoldSign API Response:', JSON.stringify(jsonResponse, null, 2));
    return jsonResponse;
  }

  return response;
}

// Helper: Verify BoldSign webhook signature
function verifyBoldSignWebhook(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature || ''),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// ============ E-SIGNATURE BRANCH SETTINGS ENDPOINTS ============

// Get all branch settings (admin only)
app.get('/api/esignature/branch-settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Only allow from admin branch
    if (req.branchId !== null) {
      return res.status(403).json({ error: 'Admin branch access required' });
    }

    // Get all branches with their e-signature settings
    const result = await pool.query(`
      SELECT
        b.slug,
        b.name,
        b.is_active,
        COALESCE(bs.esignature_enabled, false) as esignature_enabled,
        COALESCE(bs.esignature_sandbox, true) as esignature_sandbox,
        COALESCE(bs.esignature_provider, 'openapi') as esignature_provider
      FROM aufmass_branches b
      LEFT JOIN aufmass_branch_settings bs ON b.slug = bs.branch_slug
      ORDER BY b.name
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching branch settings:', err);
    res.status(500).json({ error: 'Failed to fetch branch settings' });
  }
});

// Update branch e-signature settings (admin only)
app.put('/api/esignature/branch-settings/:slug', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Only allow from admin branch
    if (req.branchId !== null) {
      return res.status(403).json({ error: 'Admin branch access required' });
    }

    const { slug } = req.params;
    const { esignature_enabled, esignature_sandbox, esignature_provider } = req.body;

    // Upsert branch settings using INSERT ... ON CONFLICT
    await pool.query(
      `INSERT INTO aufmass_branch_settings (branch_slug, esignature_enabled, esignature_sandbox, esignature_provider)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (branch_slug) DO UPDATE SET
         esignature_enabled = $2,
         esignature_sandbox = $3,
         esignature_provider = $4,
         updated_at = NOW()`,
      [slug, esignature_enabled ? true : false, esignature_sandbox ? true : false, esignature_provider || 'openapi']
    );

    res.json({ message: 'Branch settings updated', slug, esignature_enabled, esignature_sandbox, esignature_provider });
  } catch (err) {
    console.error('Error updating branch settings:', err);
    res.status(500).json({ error: 'Failed to update branch settings' });
  }
});

// Get current branch features (for frontend to check)
// NOTE: E-Signature feature is temporarily deactivated for all branches.
// All esignature code is preserved but disabled via this endpoint.
app.get('/api/branch/features', authenticateToken, async (req, res) => {
  try {
    const branchSlug = req.branchId;

    // E-Signature is deactivated for now - always return false
    const ESIGNATURE_ACTIVE = false;

    // Admin branch (null) sees management UI
    if (branchSlug === null) {
      return res.json({
        isAdminBranch: true,
        esignature_enabled: ESIGNATURE_ACTIVE,
        esignature_management: ESIGNATURE_ACTIVE
      });
    }

    res.json({
      isAdminBranch: false,
      branchSlug,
      esignature_enabled: ESIGNATURE_ACTIVE,
      esignature_sandbox: false,
      esignature_management: false
    });
  } catch (err) {
    console.error('Error fetching branch features:', err);
    res.status(500).json({ error: 'Failed to fetch branch features' });
  }
});

// ============ E-SIGNATURE REQUEST ENDPOINTS ============

// Public endpoint to serve PDF for OpenAPI to fetch (much faster than base64 upload)
app.get('/api/esignature/pdf/:form_id/:token', async (req, res) => {
  try {
    const { form_id, token } = req.params;

    // Simple token validation - token is first 8 chars of form creation timestamp hash
    const formResult = await pool.query(
      'SELECT generated_pdf, created_at FROM aufmass_forms WHERE id = $1',
      [form_id]
    );

    if (formResult.rows.length === 0 || !formResult.rows[0].generated_pdf) {
      return res.status(404).json({ error: 'PDF not found' });
    }

    const form = formResult.rows[0];
    // Generate expected token from created_at timestamp
    const expectedToken = crypto.createHash('md5')
      .update(form.created_at.toISOString() + form_id)
      .digest('hex')
      .substring(0, 8);

    if (token !== expectedToken) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    // Serve PDF directly
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="aufmass_${form_id}.pdf"`);
    res.send(form.generated_pdf);
  } catch (err) {
    console.error('Error serving PDF:', err);
    res.status(500).json({ error: 'Failed to serve PDF' });
  }
});

// Create QES signature request via OpenAPI (Aufmass - customer receives signing link via email)
// EU-QES_mail_otp: Qualified Electronic Signature with email OTP - customer signs themselves
app.post('/api/esignature/send-ses', authenticateToken, async (req, res) => {
  try {
    const { form_id } = req.body;

    if (!form_id) {
      return res.status(400).json({ error: 'form_id is required' });
    }

    // Get form data from database
    const formResult = await pool.query('SELECT * FROM aufmass_forms WHERE id = $1', [form_id]);

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const form = formResult.rows[0];
    const signer_firstname = form.kunde_vorname || 'Kunde';
    const signer_lastname = form.kunde_nachname || '';
    const signer_name = `${signer_firstname} ${signer_lastname}`.trim();
    const signer_email = form.kunde_email;
    const signer_phone = form.kunde_telefon || '';

    // Email is required for EU-SES
    if (!signer_email) {
      return res.status(400).json({ error: 'Kunden-E-Mail ist erforderlich fuer die Signatur.' });
    }

    // Check if PDF exists
    if (!form.generated_pdf) {
      return res.status(400).json({ error: 'PDF nicht gefunden. Bitte zuerst PDF erstellen (PDF Vorschau Button).' });
    }

    // Use base64 format
    const pdf_base64 = form.generated_pdf.toString('base64');
    console.log('OpenAPI QES Aufmass: Base64 format, PDF size:', Math.round(pdf_base64.length / 1024), 'KB');
    console.log('OpenAPI QES Aufmass: Signer:', signer_name, signer_email);

    // Call OpenAPI EU-QES_mail_otp endpoint - QES level signature
    const signatureResponse = await callEsignatureAPI('/EU-QES_mail_otp', 'POST', {
      title: `Aufmass Bestaetigung - ${form_id}`,
      description: `Aufmass Dokument fuer ${signer_name}`,
      certificateUsername: ESIGN_CERT_USERNAME,
      certificatePassword: ESIGN_CERT_PASSWORD,
      inputDocuments: [{
        sourceType: 'base64',
        payload: pdf_base64
      }],
      signers: [{
        name: signer_firstname,
        surname: signer_lastname || signer_firstname,
        email: signer_email,
        mobile: signer_phone || undefined,
        authentication: ['email'],
        signatures: [{
          page: 1,
          x: '350',
          y: '750'
        }]
      }],
      callback: {
        url: `${process.env.CALLBACK_BASE_URL || 'https://aufmass-api.conais.com'}/api/webhooks/esignature`
      }
    });

    // Extract data from API response
    const responseData = signatureResponse.data || signatureResponse;
    const openapi_id = responseData.id;
    const status = responseData.state || 'WAIT_VALIDATION';
    const signing_url = responseData.signers?.[0]?.url || responseData.signingUrl || null;

    console.log('OpenAPI QES Response:', JSON.stringify(responseData, null, 2));

    // Save signature request to database
    const insertResult = await pool.query(
      `INSERT INTO aufmass_esignature_requests
       (form_id, signature_type, openapi_signature_id, status, signer_email, signer_name, signing_url, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [form_id, 'QES_AUFMASS', openapi_id, status, signer_email, signer_name, signing_url, 'openapi']
    );

    res.json({
      success: true,
      request_id: insertResult.rows[0].id,
      openapi_id: openapi_id,
      signing_url: signing_url,
      status: status,
      provider: 'openapi',
      message: signing_url
        ? `Imza linki olusturuldu. Musteri (${signer_email}) email ile bilgilendirildi.`
        : `Imza talebi olusturuldu. Musteri (${signer_email}) email ile bilgilendirilecek.`
    });
  } catch (err) {
    console.error('Error creating OpenAPI QES signature:', err);
    res.status(500).json({ error: 'Failed to create signature request', details: err.message });
  }
});

// Create QES signature request (Aufmass, Angebot or Abnahme) - customer receives signing link via email
app.post('/api/esignature/send-qes', authenticateToken, async (req, res) => {
  try {
    const { form_id, signature_type } = req.body;

    if (!form_id || !signature_type) {
      return res.status(400).json({ error: 'form_id and signature_type are required' });
    }

    // Validate signature_type
    if (!['aufmass', 'angebot', 'abnahme'].includes(signature_type)) {
      return res.status(400).json({ error: 'signature_type must be aufmass, angebot or abnahme' });
    }

    // Get form data from database
    const formResult = await pool.query('SELECT * FROM aufmass_forms WHERE id = $1', [form_id]);

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const form = formResult.rows[0];
    const signer_firstname = form.kunde_vorname || 'Kunde';
    const signer_lastname = form.kunde_nachname || '';
    const signer_name = `${signer_firstname} ${signer_lastname}`.trim();
    const signer_email = form.kunde_email;
    const signer_phone = form.kunde_telefon || '';

    if (!signer_email) {
      return res.status(400).json({ error: 'Kunden-E-Mail ist erforderlich. Bitte E-Mail zum Formular hinzufuegen.' });
    }

    // Get stored PDF from database
    let pdf_base64;
    if (form.generated_pdf) {
      pdf_base64 = form.generated_pdf.toString('base64');
    } else {
      return res.status(400).json({ error: 'PDF nicht gefunden. Bitte zuerst PDF erstellen (PDF Vorschau Button).' });
    }

    const purposeMap = {
      'aufmass': 'QES_AUFMASS',
      'angebot': 'QES_ANGEBOT',
      'abnahme': 'QES_ABNAHME'
    };
    const signature_purpose = purposeMap[signature_type];
    const titleMap = {
      'QES_AUFMASS': `Aufmass Bestaetigung - ${form_id}`,
      'QES_ANGEBOT': `Angebot Bestaetigung - ${form_id}`,
      'QES_ABNAHME': `Abnahmeprotokoll - ${form_id}`
    };
    const descriptionMap = {
      'QES_AUFMASS': `Aufmass Dokument fuer ${signer_name} - Bitte unterschreiben Sie zur Bestaetigung`,
      'QES_ANGEBOT': `Angebot Dokument fuer ${signer_name} - Bitte unterschreiben Sie zur Auftragserteilung`,
      'QES_ABNAHME': `Abnahmeprotokoll fuer ${signer_name} - Bitte unterschreiben Sie zur Bestaetigung`
    };

    console.log(`OpenAPI QES ${signature_type}: Signer:`, signer_name, signer_email);

    // Call OpenAPI EU-QES_mail_otp endpoint - QES level signature
    const signatureResponse = await callEsignatureAPI('/EU-QES_mail_otp', 'POST', {
      title: titleMap[signature_purpose],
      description: descriptionMap[signature_purpose],
      certificateUsername: ESIGN_CERT_USERNAME,
      certificatePassword: ESIGN_CERT_PASSWORD,
      inputDocuments: [{
        sourceType: 'base64',
        payload: pdf_base64
      }],
      signers: [{
        name: signer_firstname,
        surname: signer_lastname || signer_firstname,
        email: signer_email,
        mobile: signer_phone || undefined,
        authentication: ['email'],
        signatures: [{
          page: 1,
          x: '350',
          y: '750'
        }]
      }],
      callback: {
        url: `${process.env.CALLBACK_BASE_URL || 'https://aufmass-api.conais.com'}/api/webhooks/esignature`
      }
    });

    // Extract data from API response
    const responseData = signatureResponse.data || signatureResponse;
    const openapi_id = responseData.id;
    const status = responseData.state || 'WAIT_VALIDATION';
    const signing_url = responseData.signers?.[0]?.url || responseData.signingUrl || null;

    console.log(`OpenAPI QES ${signature_type} Response:`, JSON.stringify(responseData, null, 2));

    // Save signature request to database
    const insertResult = await pool.query(
      `INSERT INTO aufmass_esignature_requests
       (form_id, signature_type, openapi_signature_id, status, signer_email, signer_name, signing_url, provider)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [form_id, signature_purpose, openapi_id, status, signer_email, signer_name, signing_url, 'openapi']
    );

    res.json({
      success: true,
      request_id: insertResult.rows[0].id,
      openapi_id: openapi_id,
      signing_url: signing_url,
      status: status,
      provider: 'openapi',
      message: signing_url
        ? `Imza linki olusturuldu. Musteri (${signer_email}) email ile bilgilendirildi.`
        : `Imza talebi olusturuldu. Musteri (${signer_email}) email ile bilgilendirilecek.`
    });
  } catch (err) {
    console.error('Error creating QES signature:', err);
    res.status(500).json({ error: 'Failed to create signature request', details: err.message });
  }
});

// Get signature status for a form (with branch isolation)
app.get('/api/esignature/status/:formId', authenticateToken, async (req, res) => {
  try {
    const { formId } = req.params;

    let query, params;
    if (req.branchId) {
      query = `SELECT
                 e.id, e.signature_type, e.openapi_signature_id, e.boldsign_document_id, e.status,
                 e.signer_email, e.signer_name, e.signing_url, e.document_type, e.provider,
                 e.signed_at, e.created_at, e.updated_at, e.error_message
               FROM aufmass_esignature_requests e
               WHERE e.form_id = $1 AND (e.branch_id = $2 OR e.branch_id IS NULL)
               ORDER BY e.created_at DESC`;
      params = [formId, req.branchId];
    } else {
      query = `SELECT
                 e.id, e.signature_type, e.openapi_signature_id, e.boldsign_document_id, e.status,
                 e.signer_email, e.signer_name, e.signing_url, e.document_type, e.provider,
                 e.signed_at, e.created_at, e.updated_at, e.error_message
               FROM aufmass_esignature_requests e
               WHERE e.form_id = $1
               ORDER BY e.created_at DESC`;
      params = [formId];
    }

    const result = await pool.query(query, params);

    res.json({
      form_id: formId,
      signatures: result.rows
    });
  } catch (err) {
    console.error('Error fetching signature status:', err);
    res.status(500).json({ error: 'Failed to fetch signature status' });
  }
});

// Poll for new signature notifications (signed documents since last check)
app.get('/api/esignature/notifications', authenticateToken, async (req, res) => {
  try {
    const { since } = req.query; // ISO timestamp of last check
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 60000); // Default: last 60 seconds

    let query, params;
    if (req.branchId) {
      query = `SELECT
                 e.id, e.form_id, e.signature_type, e.document_type, e.status,
                 e.signer_name, e.signed_at, e.updated_at,
                 f.kunde_vorname, f.kunde_nachname
               FROM aufmass_esignature_requests e
               JOIN aufmass_forms f ON e.form_id = f.id
               WHERE e.status = 'signed'
                 AND e.signed_at > $1
                 AND e.branch_id = $2
               ORDER BY e.signed_at DESC`;
      params = [sinceDate, req.branchId];
    } else {
      query = `SELECT
                 e.id, e.form_id, e.signature_type, e.document_type, e.status,
                 e.signer_name, e.signed_at, e.updated_at,
                 f.kunde_vorname, f.kunde_nachname
               FROM aufmass_esignature_requests e
               JOIN aufmass_forms f ON e.form_id = f.id
               WHERE e.status = 'signed'
                 AND e.signed_at > $1
                 AND e.branch_id IS NULL
               ORDER BY e.signed_at DESC`;
      params = [sinceDate];
    }

    const result = await pool.query(query, params);

    res.json({
      notifications: result.rows,
      checked_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error fetching signature notifications:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Download signed document
app.get('/api/esignature/download/:requestId', authenticateToken, async (req, res) => {
  try {
    const { requestId } = req.params;

    let query, params;
    if (req.branchId) {
      query = `SELECT e.signed_document, e.signature_type, e.form_id
               FROM aufmass_esignature_requests e
               INNER JOIN aufmass_forms f ON e.form_id = f.id
               WHERE e.id = $1 AND (f.branch_id = $2 OR f.branch_id IS NULL)`;
      params = [requestId, req.branchId];
    } else {
      query = `SELECT e.signed_document, e.signature_type, e.form_id
               FROM aufmass_esignature_requests e
               INNER JOIN aufmass_forms f ON e.form_id = f.id
               WHERE e.id = $1`;
      params = [requestId];
    }
    const result = await pool.query(query, params);

    if (result.rows.length === 0 || !result.rows[0].signed_document) {
      return res.status(404).json({ error: 'Signed document not found' });
    }

    const { signed_document, signature_type, form_id } = result.rows[0];

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Aufmass_${form_id}_${signature_type}_signed.pdf"`);
    res.send(signed_document);
  } catch (err) {
    console.error('Error downloading signed document:', err);
    res.status(500).json({ error: 'Failed to download signed document' });
  }
});

// ============ E-SIGNATURE WEBHOOK ENDPOINT ============

// Webhook callback from OpenAPI
app.post('/api/webhooks/esignature', async (req, res) => {
  try {
    console.log('E-Signature webhook received:', JSON.stringify(req.body, null, 2));

    const { id, status, signedDocument } = req.body;

    if (!id) {
      return res.status(400).json({ error: 'Missing signature id' });
    }

    // Find the signature request by openapi_signature_id
    const findResult = await pool.query(
      'SELECT id, form_id, signature_type FROM aufmass_esignature_requests WHERE openapi_signature_id = $1',
      [id]
    );

    if (findResult.rows.length === 0) {
      console.warn('Webhook received for unknown signature:', id);
      return res.status(200).json({ message: 'Signature not found, ignoring' });
    }

    const signatureRequest = findResult.rows[0];

    // If signed, try to fetch and store the signed document
    if (status === 'signed' && signedDocument) {
      // signedDocument might be base64 encoded
      const signedBuffer = Buffer.from(signedDocument, 'base64');

      await pool.query(
        `UPDATE aufmass_esignature_requests
         SET status = $1, signed_document = $2, signed_at = $3,
             callback_received_at = $4, updated_at = NOW()
         WHERE id = $5`,
        [status === 'signed' ? 'signed' : status, signedBuffer, new Date(), new Date(), signatureRequest.id]
      );

      // Auto-update form status based on signature type
      const { form_id, signature_type } = signatureRequest;

      if (signature_type === 'QES_ANGEBOT') {
        // Angebot signed -> Auftrag Erteilt
        await pool.query(
          `UPDATE aufmass_forms
           SET status = $1, status_date = $2, updated_at = NOW()
           WHERE id = $3`,
          ['auftrag_erteilt', new Date(), form_id]
        );

        console.log(`Form ${form_id} status updated to auftrag_erteilt (QES_ANGEBOT signed)`);
      }
    } else {
      await pool.query(
        `UPDATE aufmass_esignature_requests
         SET status = $1, callback_received_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [status === 'signed' ? 'signed' : status, new Date(), signatureRequest.id]
      );
    }

    console.log(`Signature ${id} updated to status: ${status}`);
    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (err) {
    console.error('Error processing webhook:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Generate mailto link with pre-filled content
app.post('/api/esignature/generate-mailto', authenticateToken, async (req, res) => {
  try {
    const { signature_type, signer_email, signer_name, signing_url, form_id } = req.body;

    if (!signature_type || !signer_email || !signing_url) {
      return res.status(400).json({ error: 'signature_type, signer_email, and signing_url are required' });
    }

    // Email templates in German
    const templates = {
      'SES': {
        subject: `Aufmass-Bestaetigung - Bitte unterschreiben`,
        body: `Sehr geehrte/r ${signer_name || 'Kunde'},

hiermit bestaetigen wir die Aufnahme Ihrer Masse.

Bitte bestaetigen Sie die Massaufnahme ueber folgenden Link:
${signing_url}

Mit freundlichen Gruessen
AYLUX Team`
      },
      'QES_ANGEBOT': {
        subject: `Ihr Angebot von AYLUX - Elektronische Signatur erforderlich`,
        body: `Sehr geehrte/r ${signer_name || 'Kunde'},

anbei erhalten Sie unser Angebot fuer Ihr Projekt.

Bitte unterzeichnen Sie das Angebot elektronisch ueber folgenden Link:
${signing_url}

Nach Ihrer Unterschrift wird der Auftrag automatisch erteilt.

Mit freundlichen Gruessen
AYLUX Team`
      },
      'QES_ABNAHME': {
        subject: `Abnahmeprotokoll - Elektronische Signatur`,
        body: `Sehr geehrte/r ${signer_name || 'Kunde'},

die Montagearbeiten wurden abgeschlossen.

Bitte bestaetigen Sie die Abnahme ueber folgenden Link:
${signing_url}

Mit freundlichen Gruessen
AYLUX Team`
      }
    };

    const template = templates[signature_type] || templates['SES'];

    const mailtoLink = `mailto:${encodeURIComponent(signer_email)}?subject=${encodeURIComponent(template.subject)}&body=${encodeURIComponent(template.body)}`;

    res.json({
      mailto_link: mailtoLink,
      subject: template.subject,
      body: template.body
    });
  } catch (err) {
    console.error('Error generating mailto link:', err);
    res.status(500).json({ error: 'Failed to generate mailto link' });
  }
});

// ============ OPENAPI ESIGNATURE CALLBACK ENDPOINTS ============

// In-memory storage for callback logs (for testing purposes)
const esignatureCallbackLogs = [];
const MAX_CALLBACK_LOGS = 100;

// Callback endpoint for OpenAPI eSignature service
app.post('/api/openapi/esignature/callback', (req, res) => {
  try {
    const payload = req.body;
    const receivedAt = new Date().toISOString();

    // Extract signature ID from payload (structure may vary based on OpenAPI docs)
    const signatureId = payload.signatureId || payload.id || payload.signature_id || 'unknown';
    const state = payload.state || payload.status || 'unknown';

    const logEntry = {
      receivedAt,
      signatureId,
      state,
      payload
    };

    // Add to in-memory log (keep last N entries)
    esignatureCallbackLogs.unshift(logEntry);
    if (esignatureCallbackLogs.length > MAX_CALLBACK_LOGS) {
      esignatureCallbackLogs.pop();
    }

    // Also write to file for persistence
    const logsDir = path.join(process.cwd(), 'openapi-callback-logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    const logFileName = `callback-${signatureId}-${receivedAt.replace(/[:.]/g, '-')}.json`;
    const logFilePath = path.join(logsDir, logFileName);
    fs.writeFileSync(logFilePath, JSON.stringify(logEntry, null, 2));

    console.log(`[OpenAPI Callback] Received callback for signature ${signatureId}, state: ${state}`);
    console.log(`[OpenAPI Callback] Payload logged to: ${logFilePath}`);

    // Return success to OpenAPI
    res.status(200).json({ success: true, receivedAt });
  } catch (err) {
    console.error('[OpenAPI Callback] Error processing callback:', err);
    res.status(500).json({ error: 'Failed to process callback' });
  }
});

// Get callback logs for test harness
app.get('/api/openapi/esignature/callback-log', (req, res) => {
  try {
    const { signatureId, limit = 50 } = req.query;

    let logs = [...esignatureCallbackLogs];

    // Filter by signatureId if provided
    if (signatureId) {
      logs = logs.filter(log => log.signatureId === signatureId);
    }

    // Limit results
    logs = logs.slice(0, parseInt(limit));

    res.json({
      count: logs.length,
      logs
    });
  } catch (err) {
    console.error('[OpenAPI Callback] Error retrieving logs:', err);
    res.status(500).json({ error: 'Failed to retrieve callback logs' });
  }
});

// ============ BOLDSIGN E-SIGNATURE ENDPOINTS ============

// In-memory storage for BoldSign callback logs
const boldSignCallbackLogs = [];
const MAX_BOLDSIGN_CALLBACK_LOGS = 100;

// Send document for signature via BoldSign (AES - Advanced Electronic Signature with Email OTP)
app.post('/api/boldsign/send-aes', authenticateToken, async (req, res) => {
  try {
    const { form_id } = req.body;

    if (!form_id) {
      return res.status(400).json({ error: 'form_id is required' });
    }

    if (!BOLDSIGN_API_KEY) {
      return res.status(500).json({ error: 'BoldSign API key not configured' });
    }

    // Get form with PDF
    const formResult = await pool.query('SELECT * FROM aufmass_forms WHERE id = $1', [form_id]);

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const form = formResult.rows[0];

    if (!form.generated_pdf) {
      return res.status(400).json({ error: 'Form has no generated PDF. Bitte zuerst PDF erstellen.' });
    }

    const signer_email = form.kunde_email;
    const signer_name = `${form.kunde_vorname || ''} ${form.kunde_nachname || ''}`.trim() || 'Kunde';
    const signer_phone = form.kunde_telefon;

    if (!signer_email) {
      return res.status(400).json({ error: 'Form has no customer email for signing' });
    }

    if (!signer_phone) {
      return res.status(400).json({ error: 'Form has no customer phone number for SMS verification' });
    }

    // Parse phone number - extract country code and number
    let countryCode = '+49'; // Default Germany
    let phoneNumber = signer_phone.replace(/\s+/g, ''); // Remove spaces

    if (phoneNumber.startsWith('+')) {
      const match = phoneNumber.match(/^(\+\d{1,3})(.+)$/);
      if (match) {
        countryCode = match[1];
        phoneNumber = match[2];
      }
    } else if (phoneNumber.startsWith('00')) {
      phoneNumber = '+' + phoneNumber.substring(2);
      const match = phoneNumber.match(/^(\+\d{1,3})(.+)$/);
      if (match) {
        countryCode = match[1];
        phoneNumber = match[2];
      }
    } else if (phoneNumber.startsWith('0')) {
      phoneNumber = phoneNumber.substring(1);
    }

    // Create FormData for BoldSign API (multipart/form-data)
    const FormData = (await import('form-data')).default;
    const axios = (await import('axios')).default;
    const formData = new FormData();

    // Add PDF file as buffer
    formData.append('Files', form.generated_pdf, {
      filename: `aufmass-${form_id}.pdf`,
      contentType: 'application/pdf'
    });

    // Add document metadata
    formData.append('Title', `Aufmass Bestaetigung - ${form_id}`);
    formData.append('Message', 'Bitte unterschreiben Sie das angehaegte Aufmass-Dokument.');
    formData.append('EnableSigningOrder', 'false');
    formData.append('ExpiryDays', '30');

    // Add signer with signature field
    formData.append('Signers[0][Name]', signer_name);
    formData.append('Signers[0][EmailAddress]', signer_email);
    formData.append('Signers[0][SignerType]', 'Signer');
    formData.append('Signers[0][AuthenticationType]', 'SMSOTP');
    formData.append('Signers[0][PhoneNumber][CountryCode]', countryCode);
    formData.append('Signers[0][PhoneNumber][Number]', phoneNumber);
    formData.append('Signers[0][FormFields][0][FieldType]', 'Signature');
    formData.append('Signers[0][FormFields][0][PageNumber]', '1');
    formData.append('Signers[0][FormFields][0][Bounds][X]', '350');
    formData.append('Signers[0][FormFields][0][Bounds][Y]', '750');
    formData.append('Signers[0][FormFields][0][Bounds][Width]', '150');
    formData.append('Signers[0][FormFields][0][Bounds][Height]', '50');
    formData.append('Signers[0][FormFields][0][IsRequired]', 'true');

    console.log('BoldSign AES Request - Title:', `Aufmass Bestaetigung - ${form_id}`);
    console.log('BoldSign AES Request - Signer:', signer_name, signer_email, `Phone: ${countryCode}${phoneNumber}`, '(SMS OTP)');

    // Call BoldSign API with axios
    const response = await axios.post(`${BOLDSIGN_API_URL}/document/send`, formData, {
      headers: {
        'X-API-KEY': BOLDSIGN_API_KEY,
        ...formData.getHeaders()
      }
    });

    const responseData = response.data;
    console.log('BoldSign AES Response:', JSON.stringify(responseData, null, 2));

    const documentId = responseData.documentId;

    // Save to database with document_type and branch_id
    const insertResult = await pool.query(
      `INSERT INTO aufmass_esignature_requests
       (form_id, signature_type, provider, boldsign_document_id, status, signer_email, signer_name, document_type, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [form_id, 'AES', 'boldsign', documentId, 'pending', signer_email, signer_name, 'aufmass', req.branchId || null]
    );

    const requestId = insertResult.rows[0].id;

    res.json({
      success: true,
      request_id: requestId,
      openapi_id: documentId,
      signing_url: null,  // BoldSign sends email directly
      status: 'SENT',
      provider: 'boldsign',
      message: 'Dokument wurde zur Signatur an ' + signer_email + ' gesendet'
    });

  } catch (err) {
    console.error('BoldSign SES error:', err.response?.data || err.message);
    const errorDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.status(500).json({ error: 'Failed to send document for signature via BoldSign', details: errorDetails });
  }
});

// Send Abnahme (acceptance) document for AES signature via BoldSign
app.post('/api/boldsign/send-abnahme-aes', authenticateToken, async (req, res) => {
  try {
    const { form_id } = req.body;

    if (!form_id) {
      return res.status(400).json({ error: 'form_id is required' });
    }

    if (!BOLDSIGN_API_KEY) {
      return res.status(500).json({ error: 'BoldSign API key not configured' });
    }

    // Get form with PDF and abnahme data
    const formResult = await pool.query('SELECT * FROM aufmass_forms WHERE id = $1', [form_id]);

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const form = formResult.rows[0];

    // Check if abnahme data exists
    const abnahmeResult = await pool.query('SELECT * FROM aufmass_abnahme WHERE form_id = $1', [form_id]);

    if (abnahmeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Abnahme data not found. Please complete Abnahme form first.' });
    }

    if (!form.generated_pdf) {
      return res.status(400).json({ error: 'Form has no generated PDF. Bitte zuerst PDF erstellen.' });
    }

    const signer_email = form.kunde_email;
    const signer_name = `${form.kunde_vorname || ''} ${form.kunde_nachname || ''}`.trim() || 'Kunde';
    const signer_phone = form.kunde_telefon;

    if (!signer_email) {
      return res.status(400).json({ error: 'Form has no customer email for signing' });
    }

    if (!signer_phone) {
      return res.status(400).json({ error: 'Form has no customer phone number for SMS verification' });
    }

    // Parse phone number
    let countryCode = '+49';
    let phoneNumber = signer_phone.replace(/\s+/g, '');

    if (phoneNumber.startsWith('+')) {
      const match = phoneNumber.match(/^(\+\d{1,3})(.+)$/);
      if (match) {
        countryCode = match[1];
        phoneNumber = match[2];
      }
    } else if (phoneNumber.startsWith('00')) {
      phoneNumber = '+' + phoneNumber.substring(2);
      const match = phoneNumber.match(/^(\+\d{1,3})(.+)$/);
      if (match) {
        countryCode = match[1];
        phoneNumber = match[2];
      }
    } else if (phoneNumber.startsWith('0')) {
      phoneNumber = phoneNumber.substring(1);
    }

    // Create FormData for BoldSign API
    const FormData = (await import('form-data')).default;
    const axios = (await import('axios')).default;
    const formData = new FormData();

    // Add PDF file
    formData.append('Files', form.generated_pdf, {
      filename: `abnahme-${form_id}.pdf`,
      contentType: 'application/pdf'
    });

    // Add document metadata for Abnahme
    formData.append('Title', `Abnahme Protokoll - ${form_id}`);
    formData.append('Message', 'Bitte unterschreiben Sie das Abnahme-Protokoll zur Bestaetigung der abgeschlossenen Montage.');
    formData.append('EnableSigningOrder', 'false');
    formData.append('ExpiryDays', '30');

    // Add signer with SMS OTP authentication
    formData.append('Signers[0][Name]', signer_name);
    formData.append('Signers[0][EmailAddress]', signer_email);
    formData.append('Signers[0][SignerType]', 'Signer');
    formData.append('Signers[0][AuthenticationType]', 'SMSOTP');
    formData.append('Signers[0][PhoneNumber][CountryCode]', countryCode);
    formData.append('Signers[0][PhoneNumber][Number]', phoneNumber);
    formData.append('Signers[0][FormFields][0][FieldType]', 'Signature');
    formData.append('Signers[0][FormFields][0][PageNumber]', '1');
    formData.append('Signers[0][FormFields][0][Bounds][X]', '350');
    formData.append('Signers[0][FormFields][0][Bounds][Y]', '750');
    formData.append('Signers[0][FormFields][0][Bounds][Width]', '150');
    formData.append('Signers[0][FormFields][0][Bounds][Height]', '50');
    formData.append('Signers[0][FormFields][0][IsRequired]', 'true');

    console.log('BoldSign Abnahme AES Request - Title:', `Abnahme Protokoll - ${form_id}`);
    console.log('BoldSign Abnahme AES Request - Signer:', signer_name, signer_email, `Phone: ${countryCode}${phoneNumber}`);

    // Call BoldSign API
    const response = await axios.post(`${BOLDSIGN_API_URL}/document/send`, formData, {
      headers: {
        'X-API-KEY': BOLDSIGN_API_KEY,
        ...formData.getHeaders()
      }
    });

    const responseData = response.data;
    console.log('BoldSign Abnahme AES Response:', JSON.stringify(responseData, null, 2));

    const documentId = responseData.documentId;

    // Save to database with document_type='abnahme' and branch_id
    const insertResult = await pool.query(
      `INSERT INTO aufmass_esignature_requests
       (form_id, signature_type, provider, boldsign_document_id, status, signer_email, signer_name, document_type, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [form_id, 'AES', 'boldsign', documentId, 'pending', signer_email, signer_name, 'abnahme', req.branchId || null]
    );

    const requestId = insertResult.rows[0].id;

    res.json({
      success: true,
      request_id: requestId,
      openapi_id: documentId,
      signing_url: null,
      status: 'SENT',
      provider: 'boldsign',
      document_type: 'abnahme',
      message: 'Abnahme-Protokoll wurde zur Signatur an ' + signer_email + ' gesendet'
    });

  } catch (err) {
    console.error('BoldSign Abnahme AES error:', err.response?.data || err.message);
    const errorDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.status(500).json({ error: 'Failed to send Abnahme document for signature via BoldSign', details: errorDetails });
  }
});

// Send Angebot (quote) document for AES signature via BoldSign
app.post('/api/boldsign/send-angebot-aes', authenticateToken, async (req, res) => {
  try {
    const { form_id } = req.body;

    if (!form_id) {
      return res.status(400).json({ error: 'form_id is required' });
    }

    if (!BOLDSIGN_API_KEY) {
      return res.status(500).json({ error: 'BoldSign API key not configured' });
    }

    // Get form with PDF
    const formResult = await pool.query('SELECT * FROM aufmass_forms WHERE id = $1', [form_id]);

    if (formResult.rows.length === 0) {
      return res.status(404).json({ error: 'Form not found' });
    }

    const form = formResult.rows[0];

    // Check if angebot data exists
    const angebotResult = await pool.query('SELECT * FROM aufmass_angebot WHERE form_id = $1', [form_id]);

    if (angebotResult.rows.length === 0) {
      return res.status(400).json({ error: 'Angebot data not found. Please complete Angebot form first.' });
    }

    if (!form.generated_pdf) {
      return res.status(400).json({ error: 'Form has no generated PDF. Bitte zuerst PDF erstellen.' });
    }

    const signer_email = form.kunde_email;
    const signer_name = `${form.kunde_vorname || ''} ${form.kunde_nachname || ''}`.trim() || 'Kunde';
    const signer_phone = form.kunde_telefon;

    if (!signer_email) {
      return res.status(400).json({ error: 'Form has no customer email for signing' });
    }

    if (!signer_phone) {
      return res.status(400).json({ error: 'Form has no customer phone number for SMS verification' });
    }

    // Parse phone number
    let countryCode = '+49';
    let phoneNumber = signer_phone.replace(/\s+/g, '');

    if (phoneNumber.startsWith('+')) {
      const match = phoneNumber.match(/^(\+\d{1,3})(.+)$/);
      if (match) {
        countryCode = match[1];
        phoneNumber = match[2];
      }
    } else if (phoneNumber.startsWith('00')) {
      phoneNumber = '+' + phoneNumber.substring(2);
      const match = phoneNumber.match(/^(\+\d{1,3})(.+)$/);
      if (match) {
        countryCode = match[1];
        phoneNumber = match[2];
      }
    } else if (phoneNumber.startsWith('0')) {
      phoneNumber = phoneNumber.substring(1);
    }

    // Create FormData for BoldSign API
    const FormData = (await import('form-data')).default;
    const axios = (await import('axios')).default;
    const formData = new FormData();

    // Add PDF file
    formData.append('Files', form.generated_pdf, {
      filename: `angebot-${form_id}.pdf`,
      contentType: 'application/pdf'
    });

    // Add document metadata for Angebot
    formData.append('Title', `Angebot - ${form_id}`);
    formData.append('Message', 'Bitte unterschreiben Sie das Angebot zur Auftragserteilung.');
    formData.append('EnableSigningOrder', 'false');
    formData.append('ExpiryDays', '30');

    // Add signer with SMS OTP authentication
    formData.append('Signers[0][Name]', signer_name);
    formData.append('Signers[0][EmailAddress]', signer_email);
    formData.append('Signers[0][SignerType]', 'Signer');
    formData.append('Signers[0][AuthenticationType]', 'SMSOTP');
    formData.append('Signers[0][PhoneNumber][CountryCode]', countryCode);
    formData.append('Signers[0][PhoneNumber][Number]', phoneNumber);
    formData.append('Signers[0][FormFields][0][FieldType]', 'Signature');
    formData.append('Signers[0][FormFields][0][PageNumber]', '1');
    formData.append('Signers[0][FormFields][0][Bounds][X]', '350');
    formData.append('Signers[0][FormFields][0][Bounds][Y]', '750');
    formData.append('Signers[0][FormFields][0][Bounds][Width]', '150');
    formData.append('Signers[0][FormFields][0][Bounds][Height]', '50');
    formData.append('Signers[0][FormFields][0][IsRequired]', 'true');

    console.log('BoldSign Angebot AES Request - Title:', `Angebot - ${form_id}`);
    console.log('BoldSign Angebot AES Request - Signer:', signer_name, signer_email, `Phone: ${countryCode}${phoneNumber}`);

    // Call BoldSign API
    const response = await axios.post(`${BOLDSIGN_API_URL}/document/send`, formData, {
      headers: {
        'X-API-KEY': BOLDSIGN_API_KEY,
        ...formData.getHeaders()
      }
    });

    const responseData = response.data;
    console.log('BoldSign Angebot AES Response:', JSON.stringify(responseData, null, 2));

    const documentId = responseData.documentId;

    // Save to database with document_type='angebot' and branch_id
    const insertResult = await pool.query(
      `INSERT INTO aufmass_esignature_requests
       (form_id, signature_type, provider, boldsign_document_id, status, signer_email, signer_name, document_type, branch_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [form_id, 'AES', 'boldsign', documentId, 'pending', signer_email, signer_name, 'angebot', req.branchId || null]
    );

    const requestId = insertResult.rows[0].id;

    res.json({
      success: true,
      request_id: requestId,
      openapi_id: documentId,
      signing_url: null,
      status: 'SENT',
      provider: 'boldsign',
      document_type: 'angebot',
      message: 'Angebot wurde zur Signatur an ' + signer_email + ' gesendet'
    });

  } catch (err) {
    console.error('BoldSign Angebot AES error:', err.response?.data || err.message);
    const errorDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    res.status(500).json({ error: 'Failed to send Angebot document for signature via BoldSign', details: errorDetails });
  }
});

// Get BoldSign document status
app.get('/api/esignature/boldsign/status/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;

    if (!BOLDSIGN_API_KEY) {
      return res.status(500).json({ error: 'BoldSign API key not configured' });
    }

    const response = await callBoldSignAPI(`/document/properties?documentId=${documentId}`);
    res.json(response);
  } catch (err) {
    console.error('BoldSign status error:', err);
    res.status(500).json({ error: 'Failed to get document status', details: err.message });
  }
});

// Download signed document from BoldSign
app.get('/api/esignature/boldsign/download/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;

    if (!BOLDSIGN_API_KEY) {
      return res.status(500).json({ error: 'BoldSign API key not configured' });
    }

    const response = await fetch(`${BOLDSIGN_API_URL}/document/download?documentId=${documentId}`, {
      headers: {
        'X-API-KEY': BOLDSIGN_API_KEY
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BoldSign download error: ${response.status} - ${errorText}`);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="signed-${documentId}.pdf"`);

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('BoldSign download error:', err);
    res.status(500).json({ error: 'Failed to download signed document', details: err.message });
  }
});

// Get embedded signing link from BoldSign
app.get('/api/esignature/boldsign/signing-link/:documentId', authenticateToken, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { signerEmail } = req.query;

    if (!documentId || !signerEmail) {
      return res.status(400).json({ error: 'documentId and signerEmail are required' });
    }

    if (!BOLDSIGN_API_KEY) {
      return res.status(500).json({ error: 'BoldSign API key not configured' });
    }

    const response = await callBoldSignAPI(`/document/getEmbeddedSignLink?documentId=${documentId}&signerEmail=${encodeURIComponent(signerEmail)}`);
    res.json(response);
  } catch (err) {
    console.error('BoldSign signing link error:', err);
    res.status(500).json({ error: 'Failed to get signing link', details: err.message });
  }
});

// Check BoldSign document status directly from API (for polling/refresh)
app.post('/api/esignature/boldsign/refresh-status', authenticateToken, async (req, res) => {
  try {
    const { request_id } = req.body;

    if (!request_id) {
      return res.status(400).json({ error: 'request_id is required' });
    }

    if (!BOLDSIGN_API_KEY) {
      return res.status(500).json({ error: 'BoldSign API key not configured' });
    }

    // Get the signature request from database
    const dbResult = await pool.query(
      'SELECT id, boldsign_document_id, status, form_id FROM aufmass_esignature_requests WHERE id = $1',
      [request_id]
    );

    if (dbResult.rows.length === 0) {
      return res.status(404).json({ error: 'Signature request not found' });
    }

    const sigRequest = dbResult.rows[0];

    if (!sigRequest.boldsign_document_id) {
      return res.status(400).json({ error: 'No BoldSign document ID associated with this request' });
    }

    // Call BoldSign API to get current document status
    const response = await fetch(`${BOLDSIGN_API_URL}/document/properties?documentId=${sigRequest.boldsign_document_id}`, {
      headers: {
        'X-API-KEY': BOLDSIGN_API_KEY
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('BoldSign status check error:', errorText);
      return res.status(500).json({ error: 'Failed to check BoldSign status', details: errorText });
    }

    const boldSignData = await response.json();
    console.log('BoldSign document status:', boldSignData.status);

    // Map BoldSign status to our status
    let newStatus = sigRequest.status;
    if (boldSignData.status === 'Completed') {
      newStatus = 'signed';
    } else if (boldSignData.status === 'Declined') {
      newStatus = 'declined';
    } else if (boldSignData.status === 'Expired') {
      newStatus = 'expired';
    } else if (boldSignData.status === 'Revoked') {
      newStatus = 'cancelled';
    } else if (boldSignData.status === 'InProgress') {
      const signer = boldSignData.signerDetails?.[0];
      if (signer?.status === 'Viewed') {
        newStatus = 'viewed';
      } else if (signer?.status === 'Signed') {
        newStatus = 'signing';
      } else {
        newStatus = 'pending';
      }
    } else if (boldSignData.status === 'WaitingForOthers' || boldSignData.status === 'Sent') {
      newStatus = 'pending';
    }

    // Update database if status changed
    if (newStatus !== sigRequest.status) {
      // If completed, also download the signed document
      if (newStatus === 'signed') {
        try {
          const downloadResponse = await fetch(`${BOLDSIGN_API_URL}/document/download?documentId=${sigRequest.boldsign_document_id}`, {
            headers: { 'X-API-KEY': BOLDSIGN_API_KEY }
          });

          if (downloadResponse.ok) {
            const pdfBuffer = await downloadResponse.arrayBuffer();
            await pool.query(
              `UPDATE aufmass_esignature_requests
               SET status = $1, signed_document = $2, signed_at = $3, updated_at = NOW()
               WHERE id = $4`,
              [newStatus, Buffer.from(pdfBuffer), new Date(), request_id]
            );
          } else {
            await pool.query(
              'UPDATE aufmass_esignature_requests SET status = $1, updated_at = NOW() WHERE id = $2',
              [newStatus, request_id]
            );
          }
        } catch (downloadErr) {
          console.error('Error downloading signed document:', downloadErr);
          await pool.query(
            'UPDATE aufmass_esignature_requests SET status = $1, updated_at = NOW() WHERE id = $2',
            [newStatus, request_id]
          );
        }
      } else {
        await pool.query(
          'UPDATE aufmass_esignature_requests SET status = $1, updated_at = NOW() WHERE id = $2',
          [newStatus, request_id]
        );
      }

      console.log(`Signature status updated: ${sigRequest.status} -> ${newStatus}`);
    }

    res.json({
      request_id,
      previous_status: sigRequest.status,
      current_status: newStatus,
      boldsign_status: boldSignData.status,
      updated: newStatus !== sigRequest.status
    });
  } catch (err) {
    console.error('BoldSign refresh status error:', err);
    res.status(500).json({ error: 'Failed to refresh signature status', details: err.message });
  }
});

// BoldSign webhook callback
app.post('/api/webhooks/boldsign', async (req, res) => {
  try {
    console.log('BoldSign webhook received:', JSON.stringify(req.body, null, 2));

    const signature = req.headers['x-boldsign-signature'];
    const payload = req.body;

    // Verify signature if secret is configured
    if (BOLDSIGN_WEBHOOK_SECRET && signature) {
      if (!verifyBoldSignWebhook(payload, signature, BOLDSIGN_WEBHOOK_SECRET)) {
        console.warn('BoldSign webhook signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { event, document } = payload;
    const eventType = event?.eventType;
    const documentId = document?.documentId;
    const documentStatus = document?.status;

    // Log callback
    const logEntry = {
      receivedAt: new Date().toISOString(),
      eventType,
      documentId,
      status: documentStatus,
      payload
    };
    boldSignCallbackLogs.unshift(logEntry);
    if (boldSignCallbackLogs.length > MAX_BOLDSIGN_CALLBACK_LOGS) {
      boldSignCallbackLogs.pop();
    }

    if (!documentId) {
      console.warn('BoldSign webhook missing documentId');
      return res.status(200).json({ message: 'Missing documentId, ignoring' });
    }

    // Find request in database
    const findResult = await pool.query(
      'SELECT id, form_id, signature_type FROM aufmass_esignature_requests WHERE boldsign_document_id = $1',
      [documentId]
    );

    if (findResult.rows.length === 0) {
      console.warn('BoldSign webhook received for unknown document:', documentId);
      return res.status(200).json({ message: 'Document not found, ignoring' });
    }

    const request = findResult.rows[0];

    // Map BoldSign status to our status
    let dbStatus = 'pending';
    if (eventType === 'Completed') {
      dbStatus = 'signed';
    } else if (eventType === 'Declined') {
      dbStatus = 'declined';
    } else if (eventType === 'Expired') {
      dbStatus = 'expired';
    } else if (eventType === 'Revoked') {
      dbStatus = 'cancelled';
    } else if (eventType === 'Sent') {
      dbStatus = 'pending';
    } else if (eventType === 'Viewed') {
      dbStatus = 'viewed';
    } else if (eventType === 'Signed') {
      dbStatus = 'signing';
    }

    // If completed, download and store signed document
    if (eventType === 'Completed') {
      try {
        const downloadResponse = await fetch(`${BOLDSIGN_API_URL}/document/download?documentId=${documentId}`, {
          headers: { 'X-API-KEY': BOLDSIGN_API_KEY }
        });

        if (downloadResponse.ok) {
          const arrayBuffer = await downloadResponse.arrayBuffer();
          const signedDocument = Buffer.from(arrayBuffer);

          await pool.query(
            `UPDATE aufmass_esignature_requests
             SET status = $1, signed_document = $2, signed_at = $3,
                 callback_received_at = $4, updated_at = NOW()
             WHERE id = $5`,
            [dbStatus, signedDocument, new Date(), new Date(), request.id]
          );
        } else {
          await pool.query(
            `UPDATE aufmass_esignature_requests
             SET status = $1, callback_received_at = $2, updated_at = NOW()
             WHERE id = $3`,
            [dbStatus, new Date(), request.id]
          );
        }
      } catch (downloadErr) {
        console.error('Failed to download signed document:', downloadErr);
        await pool.query(
          `UPDATE aufmass_esignature_requests
           SET status = $1, callback_received_at = $2, updated_at = NOW()
           WHERE id = $3`,
          [dbStatus, new Date(), request.id]
        );
      }
    } else {
      await pool.query(
        `UPDATE aufmass_esignature_requests
         SET status = $1, callback_received_at = $2, updated_at = NOW()
         WHERE id = $3`,
        [dbStatus, new Date(), request.id]
      );
    }

    console.log(`BoldSign webhook processed: ${eventType} for document ${documentId}`);
    res.status(200).json({ message: 'Webhook processed successfully' });
  } catch (err) {
    console.error('BoldSign webhook error:', err);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Get BoldSign callback logs (for testing)
app.get('/api/boldsign/callback-log', (req, res) => {
  try {
    const { documentId, limit = 50 } = req.query;

    let logs = [...boldSignCallbackLogs];

    if (documentId) {
      logs = logs.filter(log => log.documentId === documentId);
    }

    logs = logs.slice(0, parseInt(limit));

    res.json({
      count: logs.length,
      logs
    });
  } catch (err) {
    console.error('[BoldSign Callback] Error retrieving logs:', err);
    res.status(500).json({ error: 'Failed to retrieve callback logs' });
  }
});

// ==================== LEAD / ANGEBOT API ====================

// Get all lead products (price matrix)
app.get('/api/lead-products', authenticateToken, async (req, res) => {
  try {
    let query, params;
    if (req.branchId) {
      query = `SELECT * FROM aufmass_lead_products
               WHERE branch_id = $1
               ORDER BY product_name, breite, tiefe`;
      params = [req.branchId];
    } else {
      query = `SELECT * FROM aufmass_lead_products ORDER BY product_name, breite, tiefe`;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get lead products error:', err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// Create a new product price entry (admin/office only)
app.post('/api/lead-products', authenticateToken, async (req, res) => {
  console.log('=== CREATE LEAD PRODUCT ===');
  console.log('Body:', req.body);
  console.log('User:', req.user?.email);
  console.log('BranchId:', req.branchId);

  try {
    if (req.user.role !== 'admin' && req.user.role !== 'office') {
      console.log('Access denied - role:', req.user.role);
      return res.status(403).json({ error: 'Admin or office access required' });
    }

    const { product_name, breite, tiefe, price, category, product_type, pricing_type, unit_label } = req.body;

    if (!product_name || price === undefined) {
      console.log('Missing fields:', { product_name, price });
      return res.status(400).json({ error: 'Product name and price are required' });
    }

    // For dimension-based products, breite and tiefe are required
    const isUnit = pricing_type === 'unit';
    if (!isUnit && (!breite || !tiefe)) {
      return res.status(400).json({ error: 'Breite and tiefe are required for dimension products' });
    }

    const effectiveBreite = isUnit ? 0 : breite;
    const effectiveTiefe = isUnit ? 0 : tiefe;

    // Check if already exists for this branch
    const existing = await pool.query(
      `SELECT id FROM aufmass_lead_products
       WHERE product_name = $1 AND breite = $2 AND tiefe = $3
       AND (branch_id = $4 OR (branch_id IS NULL AND $4 IS NULL))`,
      [product_name, effectiveBreite, effectiveTiefe, req.branchId || null]
    );

    if (existing.rows.length > 0) {
      console.log('Product already exists');
      return res.status(409).json({ error: isUnit ? 'Unit product already exists' : 'Product with these dimensions already exists' });
    }

    // Build dynamic INSERT
    const columns = ['product_name', 'breite', 'tiefe', 'price', 'branch_id'];
    const values = [product_name, effectiveBreite, effectiveTiefe, price, req.branchId || null];
    let paramIdx = 6;

    if (category) {
      columns.push('category');
      values.push(category);
      paramIdx++;
    }
    if (product_type) {
      columns.push('product_type');
      values.push(product_type);
      paramIdx++;
    }
    if (pricing_type) {
      columns.push('pricing_type');
      values.push(pricing_type);
      paramIdx++;
    }
    if (unit_label) {
      columns.push('unit_label');
      values.push(unit_label);
      paramIdx++;
    }
    if (req.body.description) {
      columns.push('description');
      values.push(req.body.description);
      paramIdx++;
    }
    if (req.body.custom_fields) {
      const cfJson = typeof req.body.custom_fields === 'string' ? req.body.custom_fields : JSON.stringify(req.body.custom_fields);
      columns.push('custom_fields');
      values.push(cfJson);
      paramIdx++;
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
      `INSERT INTO aufmass_lead_products (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    console.log('Product created:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create lead product error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to create product', details: err.message });
  }
});

// Update a product price entry (admin/office only)
app.put('/api/lead-products/:id', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'office') {
      return res.status(403).json({ error: 'Admin or office access required' });
    }

    const { id } = req.params;
    const { product_name, breite, tiefe, price, pricing_type, unit_label } = req.body;

    // Verify product belongs to this branch
    let checkQuery, checkParams;
    if (req.branchId) {
      checkQuery = 'SELECT * FROM aufmass_lead_products WHERE id = $1 AND branch_id = $2';
      checkParams = [id, req.branchId];
    } else {
      checkQuery = 'SELECT * FROM aufmass_lead_products WHERE id = $1';
      checkParams = [id];
    }

    const existing = await pool.query(checkQuery, checkParams);

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updates = [];
    const values = [];
    let paramIdx = 1;

    if (product_name !== undefined) {
      updates.push(`product_name = $${paramIdx++}`);
      values.push(product_name);
    }
    if (breite !== undefined) {
      updates.push(`breite = $${paramIdx++}`);
      values.push(breite);
    }
    if (tiefe !== undefined) {
      updates.push(`tiefe = $${paramIdx++}`);
      values.push(tiefe);
    }
    if (price !== undefined) {
      updates.push(`price = $${paramIdx++}`);
      values.push(price);
    }
    if (pricing_type !== undefined) {
      updates.push(`pricing_type = $${paramIdx++}`);
      values.push(pricing_type);
    }
    if (unit_label !== undefined) {
      updates.push(`unit_label = $${paramIdx++}`);
      values.push(unit_label);
    }
    if (req.body.description !== undefined) {
      updates.push(`description = $${paramIdx++}`);
      values.push(req.body.description);
    }
    if (req.body.custom_fields !== undefined) {
      const cfJson = typeof req.body.custom_fields === 'string' ? req.body.custom_fields : JSON.stringify(req.body.custom_fields);
      updates.push(`custom_fields = $${paramIdx++}`);
      values.push(cfJson);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE aufmass_lead_products SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update lead product error:', err);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// Delete a product price entry (admin/office only)
app.delete('/api/lead-products/:id', authenticateToken, async (req, res) => {
  console.log('=== DELETE LEAD PRODUCT START ===');
  console.log('Params:', req.params);
  console.log('User:', req.user);
  console.log('BranchId:', req.branchId);

  try {
    if (!req.user) {
      console.log('No user in request');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'office') {
      console.log('Access denied - role:', req.user.role);
      return res.status(403).json({ error: 'Admin or office access required' });
    }

    const id = parseInt(req.params.id, 10);
    console.log('Parsed ID:', id);

    if (isNaN(id)) {
      console.log('Invalid ID');
      return res.status(400).json({ error: 'Invalid product ID' });
    }

    // Delete with branch isolation
    console.log('Executing delete query for ID:', id);
    let deleteResult;
    if (req.branchId) {
      deleteResult = await pool.query('DELETE FROM aufmass_lead_products WHERE id = $1 AND branch_id = $2', [id, req.branchId]);
    } else {
      deleteResult = await pool.query('DELETE FROM aufmass_lead_products WHERE id = $1', [id]);
    }

    console.log('Delete result:', deleteResult.rowCount);

    if (deleteResult.rowCount === 0) {
      console.log('No rows deleted - product not found');
      return res.status(404).json({ error: 'Product not found' });
    }

    console.log('Product deleted successfully:', id);
    res.json({ success: true, deleted: deleteResult.rowCount });
  } catch (err) {
    console.error('=== DELETE ERROR ===');
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    res.status(500).json({ error: 'Failed to delete product', details: err.message });
  }
});

// Get unique product names
app.get('/api/lead-products/names', authenticateToken, async (req, res) => {
  try {
    let query, params;
    if (req.branchId) {
      query = `SELECT DISTINCT product_name FROM aufmass_lead_products
               WHERE branch_id = $1
               ORDER BY product_name`;
      params = [req.branchId];
    } else {
      query = `SELECT DISTINCT product_name FROM aufmass_lead_products ORDER BY product_name`;
      params = [];
    }

    const result = await pool.query(query, params);
    res.json(result.rows.map(r => r.product_name));
  } catch (err) {
    console.error('Get product names error:', err);
    res.status(500).json({ error: 'Failed to fetch product names' });
  }
});

// Get available dimensions for a product
app.get('/api/lead-products/:productName/dimensions', authenticateToken, async (req, res) => {
  try {
    const { productName } = req.params;

    let query, params;
    if (req.branchId) {
      query = `SELECT breite, tiefe, price, pricing_type, unit_label, description, custom_fields
               FROM aufmass_lead_products
               WHERE product_name = $1
               AND (branch_id = $2 OR (branch_id IS NULL AND product_name LIKE '%PREMIUMLINE%'))
               ORDER BY breite, tiefe`;
      params = [productName, req.branchId];
    } else {
      query = `SELECT breite, tiefe, price, pricing_type, unit_label, description, custom_fields
               FROM aufmass_lead_products
               WHERE product_name = $1
               ORDER BY breite, tiefe`;
      params = [productName];
    }

    const result = await pool.query(query, params);

    const rows = result.rows;
    // Find custom_fields from any row (not just first)
    const cfRow = rows.find(r => r.custom_fields);
    const custom_fields = cfRow ? JSON.parse(cfRow.custom_fields) : null;

    // Check if this is a unit-based product
    if (rows.length > 0 && rows[0].pricing_type === 'unit') {
      res.json({
        pricing_type: 'unit',
        unit_label: rows[0].unit_label || '',
        unit_price: rows[0].price,
        description: rows[0].description || null,
        custom_fields
      });
    } else {
      // Dimension-based: group by breite, return available tiefe values
      const dimensions = {};
      rows.forEach(row => {
        if (!dimensions[row.breite]) {
          dimensions[row.breite] = [];
        }
        dimensions[row.breite].push({ tiefe: row.tiefe, price: row.price });
      });

      const description = rows.length > 0 ? (rows[0].description || null) : null;
      res.json({ pricing_type: 'dimension', dimensions, description, custom_fields });
    }
  } catch (err) {
    console.error('Get dimensions error:', err);
    res.status(500).json({ error: 'Failed to fetch dimensions' });
  }
});

// Create a new lead
app.post('/api/leads', authenticateToken, async (req, res) => {
  console.log('=== CREATE LEAD START ===');
  console.log('Body:', JSON.stringify(req.body, null, 2));
  try {
    const { customer_firstname, customer_lastname, customer_email, customer_phone, customer_address, notes, items, extras, subtotal, total_discount, total_price } = req.body;

    // Use provided total_price or calculate fallback
    let finalTotal = total_price;
    if (finalTotal === undefined) {
      finalTotal = 0;
      if (items) items.forEach(item => finalTotal += (item.unit_price * (item.quantity || 1)) - (item.discount || 0));
      if (extras) extras.forEach(extra => finalTotal += extra.price);
      finalTotal -= (total_discount || 0);
    }

    // Generate angebot_nummer + kunden_nummer using race-safe counter tables
    // (replaces the legacy COUNT(*)+1 logic which produced duplicates after deletes
    //  and across the leads/lead_angebote tables). Format is now BRANCH-YYYY-NNNNN
    // (5-digit minimum, auto-grows to 6+ digits if a branch exceeds 99999 in one year).
    const angebotNummer = await generateNextAngebotNummer(req.branchId);
    const kundenNummer  = await generateNextKundenNummer(req.branchId);

    // Insert lead with discount fields, angebot_nummer and kunden_nummer
    const leadResult = await pool.query(
      `INSERT INTO aufmass_leads (customer_firstname, customer_lastname, customer_email, customer_phone, customer_address, notes, subtotal, total_discount, total_price, status, branch_id, created_by, angebot_nummer, kunden_nummer)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'unbearbeitet', $10, $11, $12, $13) RETURNING id, angebot_nummer, kunden_nummer`,
      [customer_firstname, customer_lastname, customer_email || null, customer_phone || null,
       customer_address || null, notes || null, subtotal || 0, total_discount || 0, finalTotal,
       req.branchId || null, req.user.id, angebotNummer, kundenNummer]
    );

    const leadId = leadResult.rows[0].id;

    // Create first angebot record
    const angebotResult = await pool.query(
      `INSERT INTO aufmass_lead_angebote (lead_id, angebot_nummer, subtotal, total_discount, total_price, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'unbearbeitet') RETURNING id`,
      [leadId, angebotNummer, subtotal || 0, total_discount || 0, finalTotal, notes || null]
    );
    const angebotId = angebotResult.rows[0].id;

    // Insert items with discount (linked to angebot)
    if (items && items.length > 0) {
      for (const item of items) {
        const itemDiscount = item.discount || 0;
        const itemTotal = (item.unit_price * (item.quantity || 1)) - itemDiscount;
        await pool.query(
          `INSERT INTO aufmass_lead_items (lead_id, angebot_id, product_id, product_name, breite, tiefe, quantity, unit_price, discount, total_price, pricing_type, unit_label, custom_field_values)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [leadId, angebotId, item.product_id || null, item.product_name, item.breite || null, item.tiefe || null,
           item.quantity || 1, item.unit_price, itemDiscount, itemTotal,
           item.pricing_type || 'dimension', item.unit_label || null,
           item.custom_field_values ? (typeof item.custom_field_values === 'string' ? item.custom_field_values : JSON.stringify(item.custom_field_values)) : null]
        );
      }
    }

    // Insert extras (linked to angebot)
    if (extras && extras.length > 0) {
      for (const extra of extras) {
        await pool.query(
          `INSERT INTO aufmass_lead_extras (lead_id, angebot_id, description, price) VALUES ($1, $2, $3, $4)`,
          [leadId, angebotId, extra.description, extra.price]
        );
      }
    }

    res.status(201).json({ id: leadId, angebot_nummer: angebotNummer, kunden_nummer: kundenNummer, message: 'Lead created successfully' });
  } catch (err) {
    console.error('=== CREATE LEAD ERROR ===');
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    console.error('Request body:', JSON.stringify(req.body, null, 2));
    res.status(500).json({ error: 'Failed to create lead', details: err.message });
  }
});

// Get all leads
app.get('/api/leads', authenticateToken, async (req, res) => {
  try {
    let query, params;
    if (req.branchId) {
      query = `SELECT l.*, u.name as created_by_name,
               (SELECT COUNT(*) FROM aufmass_lead_angebote WHERE lead_id = l.id) as angebot_count
               FROM aufmass_leads l
               LEFT JOIN aufmass_users u ON l.created_by = u.id
               WHERE l.branch_id = $1
               ORDER BY l.created_at DESC`;
      params = [req.branchId];
    } else {
      query = `SELECT l.*, u.name as created_by_name,
               (SELECT COUNT(*) FROM aufmass_lead_angebote WHERE lead_id = l.id) as angebot_count
               FROM aufmass_leads l
               LEFT JOIN aufmass_users u ON l.created_by = u.id
               ORDER BY l.created_at DESC`;
      params = [];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// ============ ANGEBOT / KUNDEN NUMBER GENERATION ============
// Single source of truth for branch prefix mapping (used by both number generators)
const BRANCH_PREFIX_MAP = {
  'koblenz': 'KOB', 'ayluxtr': 'AYT', 'aylux': 'AYL', 'ayluxus': 'AYU',
  'ayluxgkmu': 'GKM', 'ayluxmau': 'MAU', 'ayluxa': 'AYA'
};
function branchPrefixFor(branchId) {
  if (!branchId) return 'ANG';
  return BRANCH_PREFIX_MAP[branchId] || branchId.substring(0, 3).toUpperCase();
}
// Format with auto-grow: minimum 5 digits, but if the counter exceeds 99999
// padStart becomes a no-op so the number naturally grows to 6+ digits.
function padNumber(n) {
  return String(n).padStart(5, '0');
}
// Atomic, race-safe next number for angebot. Uses UPSERT on the counter table:
// concurrent inserts are serialized by Postgres at row level, eliminating the
// COUNT(*)+1 race that produced duplicates in the legacy code.
async function generateNextAngebotNummer(branchId) {
  const year = new Date().getFullYear();
  const branchKey = branchPrefixFor(branchId);
  const result = await pool.query(
    `INSERT INTO aufmass_angebot_counters (branch_key, year, last_num)
     VALUES ($1, $2, 1)
     ON CONFLICT (branch_key, year)
     DO UPDATE SET last_num = aufmass_angebot_counters.last_num + 1
     RETURNING last_num`,
    [branchKey, year]
  );
  return `${branchKey}-${year}-${padNumber(result.rows[0].last_num)}`;
}
async function generateNextKundenNummer(branchId) {
  const year = new Date().getFullYear();
  const branchKey = branchPrefixFor(branchId);
  const result = await pool.query(
    `INSERT INTO aufmass_kunden_counters (branch_key, year, last_num)
     VALUES ($1, $2, 1)
     ON CONFLICT (branch_key, year)
     DO UPDATE SET last_num = aufmass_kunden_counters.last_num + 1
     RETURNING last_num`,
    [branchKey, year]
  );
  return `${branchKey}-K-${year}-${padNumber(result.rows[0].last_num)}`;
}

// Helper: enrich lead items with description + custom_fields schema from product master,
// and parse custom_field_values JSON. Used so the frontend can render PRODUKTDETAILS labels.
//
// IMPORTANT: aufmass_lead_products has many duplicate rows per product_name (some with
// custom_fields populated, some null, some with dummy/test labels). We pick one canonical
// row per product_name using DISTINCT ON, preferring rows that:
//   1. have non-null custom_fields,
//   2. have non-null description,
//   3. have the smallest id (typically the first/original insert is the real one).
async function enrichItemsWithProductMeta(items, branchId) {
  if (!items || items.length === 0) return items;
  const names = [...new Set(items.map(i => i.product_name).filter(Boolean))];
  if (names.length === 0) return items.map(parseItemCustomFieldValues);

  const productQuery = branchId
    ? `SELECT DISTINCT ON (product_name)
              product_name, description, custom_fields
       FROM aufmass_lead_products
       WHERE product_name = ANY($1::text[]) AND branch_id = $2
       ORDER BY product_name,
                (custom_fields IS NOT NULL)::int DESC,
                (description IS NOT NULL)::int DESC,
                id ASC`
    : `SELECT DISTINCT ON (product_name)
              product_name, description, custom_fields
       FROM aufmass_lead_products
       WHERE product_name = ANY($1::text[])
       ORDER BY product_name,
                (custom_fields IS NOT NULL)::int DESC,
                (description IS NOT NULL)::int DESC,
                id ASC`;
  const productParams = branchId ? [names, branchId] : [names];
  const productResult = await pool.query(productQuery, productParams);

  // Modül F: canonical product_id for image lookups.
  // Must match ProductPricing's grouping (ORDER BY product_name, breite, tiefe)
  // so the id used for image upload equals the id used for image lookup in PDF.
  const canonicalIdQuery = branchId
    ? `SELECT DISTINCT ON (product_name) product_name, id
       FROM aufmass_lead_products
       WHERE product_name = ANY($1::text[]) AND branch_id = $2
       ORDER BY product_name, breite ASC, tiefe ASC, id ASC`
    : `SELECT DISTINCT ON (product_name) product_name, id
       FROM aufmass_lead_products
       WHERE product_name = ANY($1::text[])
       ORDER BY product_name, breite ASC, tiefe ASC, id ASC`;
  const canonicalResult = await pool.query(canonicalIdQuery, productParams);
  const canonicalIdByName = {};
  for (const row of canonicalResult.rows) {
    canonicalIdByName[row.product_name] = row.id;
  }

  const metaByName = {};
  for (const row of productResult.rows) {
    let customFields = null;
    if (row.custom_fields) {
      try {
        customFields = typeof row.custom_fields === 'string'
          ? JSON.parse(row.custom_fields)
          : row.custom_fields;
      } catch (e) {
        customFields = null;
      }
    }
    metaByName[row.product_name] = { description: row.description || null, custom_fields: customFields };
  }

  return items.map(item => {
    const meta = metaByName[item.product_name];
    return {
      ...parseItemCustomFieldValues(item),
      product_id: canonicalIdByName[item.product_name] ?? item.product_id ?? null,
      description: meta?.description ?? null,
      custom_fields: meta?.custom_fields ?? null
    };
  });
}

function parseItemCustomFieldValues(item) {
  if (!item.custom_field_values) return item;
  if (typeof item.custom_field_values !== 'string') return item;
  try {
    return { ...item, custom_field_values: JSON.parse(item.custom_field_values) };
  } catch (e) {
    return item;
  }
}

// Get single lead with items and extras
app.get('/api/leads/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    let query, params;
    if (req.branchId) {
      query = 'SELECT * FROM aufmass_leads WHERE id = $1 AND branch_id = $2';
      params = [id, req.branchId];
    } else {
      query = 'SELECT * FROM aufmass_leads WHERE id = $1';
      params = [id];
    }
    const leadResult = await pool.query(query, params);

    if (leadResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = leadResult.rows[0];
    const itemsResult = await pool.query('SELECT * FROM aufmass_lead_items WHERE lead_id = $1', [id]);
    const extrasResult = await pool.query('SELECT * FROM aufmass_lead_extras WHERE lead_id = $1', [id]);

    const enrichedLeadItems = await enrichItemsWithProductMeta(itemsResult.rows, lead.branch_id);

    // Fetch angebote with their items and extras
    const angeboteResult = await pool.query('SELECT * FROM aufmass_lead_angebote WHERE lead_id = $1 ORDER BY created_at ASC', [id]);
    const angebote = [];
    for (const ang of angeboteResult.rows) {
      const angItems = await pool.query('SELECT * FROM aufmass_lead_items WHERE angebot_id = $1', [ang.id]);
      const angExtras = await pool.query('SELECT * FROM aufmass_lead_extras WHERE angebot_id = $1', [ang.id]);
      const enrichedAngItems = await enrichItemsWithProductMeta(angItems.rows, lead.branch_id);
      angebote.push({ ...ang, items: enrichedAngItems, extras: angExtras.rows });
    }

    res.json({
      ...lead,
      items: enrichedLeadItems,
      extras: extrasResult.rows,
      angebote
    });
  } catch (err) {
    console.error('Get lead error:', err);
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

// Update lead (full edit - updates customer info + first angebot items/extras)
app.put('/api/leads/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_firstname, customer_lastname, customer_email, customer_phone, customer_address, notes, items, extras, subtotal, total_discount, total_price, angebot_id } = req.body;

    // Update customer info on lead (including notes/Beschreibung — was previously omitted)
    let result;
    if (req.branchId) {
      result = await pool.query(
        `UPDATE aufmass_leads
         SET customer_firstname = $1, customer_lastname = $2,
             customer_email = $3, customer_phone = $4,
             customer_address = $5, notes = $6,
             subtotal = $7, total_discount = $8, total_price = $9,
             updated_at = NOW()
         WHERE id = $10 AND branch_id = $11`,
        [customer_firstname, customer_lastname, customer_email || null, customer_phone || null,
         customer_address || null, notes || null,
         subtotal || 0, total_discount || 0, total_price,
         id, req.branchId]
      );
    } else {
      result = await pool.query(
        `UPDATE aufmass_leads
         SET customer_firstname = $1, customer_lastname = $2,
             customer_email = $3, customer_phone = $4,
             customer_address = $5, notes = $6,
             subtotal = $7, total_discount = $8, total_price = $9,
             updated_at = NOW()
         WHERE id = $10`,
        [customer_firstname, customer_lastname, customer_email || null, customer_phone || null,
         customer_address || null, notes || null,
         subtotal || 0, total_discount || 0, total_price,
         id]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Determine which angebot to update (explicit angebot_id or first angebot)
    let targetAngebotId = angebot_id;
    if (!targetAngebotId) {
      const firstAng = await pool.query('SELECT id FROM aufmass_lead_angebote WHERE lead_id = $1 ORDER BY created_at ASC LIMIT 1', [id]);
      targetAngebotId = firstAng.rows.length > 0 ? firstAng.rows[0].id : null;
    }

    if (targetAngebotId) {
      // Update angebot totals
      await pool.query(
        `UPDATE aufmass_lead_angebote SET subtotal = $1, total_discount = $2, total_price = $3, notes = $4, updated_at = NOW() WHERE id = $5`,
        [subtotal || 0, total_discount || 0, total_price, notes || null, targetAngebotId]
      );

      // Delete old items and extras for this angebot, then re-insert
      await pool.query('DELETE FROM aufmass_lead_items WHERE angebot_id = $1', [targetAngebotId]);
      await pool.query('DELETE FROM aufmass_lead_extras WHERE angebot_id = $1', [targetAngebotId]);

      // Insert updated items
      if (items && items.length > 0) {
        for (const item of items) {
          const itemDiscount = item.discount || 0;
          const itemTotal = (item.unit_price * (item.quantity || 1)) - itemDiscount;
          await pool.query(
            `INSERT INTO aufmass_lead_items (lead_id, angebot_id, product_id, product_name, breite, tiefe, quantity, unit_price, discount, total_price, pricing_type, unit_label, custom_field_values)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [id, targetAngebotId, item.product_id || null, item.product_name, item.breite || null, item.tiefe || null,
             item.quantity || 1, item.unit_price, itemDiscount, itemTotal,
             item.pricing_type || 'dimension', item.unit_label || null,
             item.custom_field_values ? (typeof item.custom_field_values === 'string' ? item.custom_field_values : JSON.stringify(item.custom_field_values)) : null]
          );
        }
      }

      // Insert updated extras
      if (extras && extras.length > 0) {
        for (const extra of extras) {
          await pool.query(
            `INSERT INTO aufmass_lead_extras (lead_id, angebot_id, description, price) VALUES ($1, $2, $3, $4)`,
            [id, targetAngebotId, extra.description, extra.price]
          );
        }
      }

      // Recalculate lead total_price as sum of all angebote
      await pool.query(
        `UPDATE aufmass_leads SET total_price = (SELECT COALESCE(SUM(total_price), 0) FROM aufmass_lead_angebote WHERE lead_id = $1), updated_at = NOW() WHERE id = $1`,
        [id]
      );
    } else {
      // Legacy: no angebote exist, work with lead-level items (backward compat)
      await pool.query('DELETE FROM aufmass_lead_items WHERE lead_id = $1 AND angebot_id IS NULL', [id]);
      await pool.query('DELETE FROM aufmass_lead_extras WHERE lead_id = $1 AND angebot_id IS NULL', [id]);

      if (items && items.length > 0) {
        for (const item of items) {
          const itemDiscount = item.discount || 0;
          const itemTotal = (item.unit_price * (item.quantity || 1)) - itemDiscount;
          await pool.query(
            `INSERT INTO aufmass_lead_items (lead_id, product_id, product_name, breite, tiefe, quantity, unit_price, discount, total_price, pricing_type, unit_label, custom_field_values)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [id, item.product_id || null, item.product_name, item.breite || null, item.tiefe || null,
             item.quantity || 1, item.unit_price, itemDiscount, itemTotal,
             item.pricing_type || 'dimension', item.unit_label || null,
             item.custom_field_values ? (typeof item.custom_field_values === 'string' ? item.custom_field_values : JSON.stringify(item.custom_field_values)) : null]
          );
        }
      }

      if (extras && extras.length > 0) {
        for (const extra of extras) {
          await pool.query(
            `INSERT INTO aufmass_lead_extras (lead_id, description, price) VALUES ($1, $2, $3)`,
            [id, extra.description, extra.price]
          );
        }
      }
    }

    res.json({ id: parseInt(id), message: 'Lead updated successfully' });
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ error: 'Failed to update lead', details: err.message });
  }
});

// Update lead status
app.put('/api/leads/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, previousStatus } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    // Role check: only admin/office can move status backward
    if (previousStatus && req.user.role !== 'admin' && req.user.role !== 'office') {
      const statusOrder = ['unbearbeitet','wiedervorlage','aufmass_termin','aufmass_erstellt','showroom_termin','tag1_nicht_erreicht','tag2_nicht_erreicht','tag3_nicht_erreicht','tag4_email','auftrag_erteilt','abgelehnt','komplett_raus','offen'];
      const prevIdx = statusOrder.indexOf(previousStatus);
      const newIdx = statusOrder.indexOf(status);
      if (prevIdx >= 0 && newIdx >= 0 && newIdx < prevIdx) {
        return res.status(403).json({ error: 'Only admin or office can revert status' });
      }
    }

    let result;
    if (req.branchId) {
      result = await pool.query(
        'UPDATE aufmass_leads SET status = $1, updated_at = NOW() WHERE id = $2 AND branch_id = $3',
        [status, id, req.branchId]
      );
    } else {
      result = await pool.query(
        'UPDATE aufmass_leads SET status = $1, updated_at = NOW() WHERE id = $2',
        [status, id]
      );
    }

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({ message: 'Lead status updated' });
  } catch (err) {
    console.error('Update lead status error:', err);
    res.status(500).json({ error: 'Failed to update lead status' });
  }
});

// Delete lead
app.delete('/api/leads/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (req.branchId) {
      await pool.query('DELETE FROM aufmass_leads WHERE id = $1 AND branch_id = $2', [id, req.branchId]);
    } else {
      await pool.query('DELETE FROM aufmass_leads WHERE id = $1', [id]);
    }
    res.json({ message: 'Lead deleted successfully' });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

// ============ MULTI-ANGEBOT ENDPOINTS ============

// Add new angebot to existing lead
app.post('/api/leads/:id/angebote', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { items, extras, notes, subtotal, total_discount, total_price } = req.body;

    // Verify lead exists
    const leadCheck = req.branchId
      ? await pool.query('SELECT id, branch_id FROM aufmass_leads WHERE id = $1 AND branch_id = $2', [id, req.branchId])
      : await pool.query('SELECT id, branch_id FROM aufmass_leads WHERE id = $1', [id]);

    if (leadCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Generate angebot_nummer using race-safe counter (same logic as POST /api/leads).
    // We resolve the branch from the lead itself to avoid losing branch context if the
    // caller is an admin without a branch header — the legacy code occasionally produced
    // ANG-prefixed numbers for branch-owned leads because of this exact issue.
    const branchForNumber = leadCheck.rows[0].branch_id || req.branchId || null;
    const angebotNummer = await generateNextAngebotNummer(branchForNumber);

    // Insert angebot
    const angebotResult = await pool.query(
      `INSERT INTO aufmass_lead_angebote (lead_id, angebot_nummer, subtotal, total_discount, total_price, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'unbearbeitet') RETURNING id, angebot_nummer`,
      [id, angebotNummer, subtotal || 0, total_discount || 0, total_price || 0, notes || null]
    );
    const angebotId = angebotResult.rows[0].id;

    // Insert items
    if (items && items.length > 0) {
      for (const item of items) {
        const itemDiscount = item.discount || 0;
        const itemTotal = (item.unit_price * (item.quantity || 1)) - itemDiscount;
        await pool.query(
          `INSERT INTO aufmass_lead_items (lead_id, angebot_id, product_id, product_name, breite, tiefe, quantity, unit_price, discount, total_price, pricing_type, unit_label, custom_field_values)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [id, angebotId, item.product_id || null, item.product_name, item.breite || null, item.tiefe || null,
           item.quantity || 1, item.unit_price, itemDiscount, itemTotal,
           item.pricing_type || 'dimension', item.unit_label || null,
           item.custom_field_values ? (typeof item.custom_field_values === 'string' ? item.custom_field_values : JSON.stringify(item.custom_field_values)) : null]
        );
      }
    }

    // Insert extras
    if (extras && extras.length > 0) {
      for (const extra of extras) {
        await pool.query(
          `INSERT INTO aufmass_lead_extras (lead_id, angebot_id, description, price) VALUES ($1, $2, $3, $4)`,
          [id, angebotId, extra.description, extra.price]
        );
      }
    }

    // Update lead total_price as sum of all angebote
    await pool.query(
      `UPDATE aufmass_leads SET total_price = (SELECT COALESCE(SUM(total_price), 0) FROM aufmass_lead_angebote WHERE lead_id = $1), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    res.status(201).json({ id: angebotId, angebot_nummer: angebotNummer, message: 'Angebot added successfully' });
  } catch (err) {
    console.error('Create angebot error:', err);
    res.status(500).json({ error: 'Failed to create angebot', details: err.message });
  }
});

// Update a specific angebot
app.put('/api/leads/:id/angebote/:angebotId', authenticateToken, async (req, res) => {
  try {
    const { id, angebotId } = req.params;
    const { items, extras, notes, subtotal, total_discount, total_price } = req.body;

    // Update angebot totals
    const result = await pool.query(
      `UPDATE aufmass_lead_angebote SET subtotal = $1, total_discount = $2, total_price = $3, notes = $4, updated_at = NOW()
       WHERE id = $5 AND lead_id = $6`,
      [subtotal || 0, total_discount || 0, total_price || 0, notes || null, angebotId, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Angebot not found' });
    }

    // Replace items and extras
    await pool.query('DELETE FROM aufmass_lead_items WHERE angebot_id = $1', [angebotId]);
    await pool.query('DELETE FROM aufmass_lead_extras WHERE angebot_id = $1', [angebotId]);

    if (items && items.length > 0) {
      for (const item of items) {
        const itemDiscount = item.discount || 0;
        const itemTotal = (item.unit_price * (item.quantity || 1)) - itemDiscount;
        await pool.query(
          `INSERT INTO aufmass_lead_items (lead_id, angebot_id, product_id, product_name, breite, tiefe, quantity, unit_price, discount, total_price, pricing_type, unit_label, custom_field_values)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [id, angebotId, item.product_id || null, item.product_name, item.breite || null, item.tiefe || null,
           item.quantity || 1, item.unit_price, itemDiscount, itemTotal,
           item.pricing_type || 'dimension', item.unit_label || null,
           item.custom_field_values ? (typeof item.custom_field_values === 'string' ? item.custom_field_values : JSON.stringify(item.custom_field_values)) : null]
        );
      }
    }

    if (extras && extras.length > 0) {
      for (const extra of extras) {
        await pool.query(
          `INSERT INTO aufmass_lead_extras (lead_id, angebot_id, description, price) VALUES ($1, $2, $3, $4)`,
          [id, angebotId, extra.description, extra.price]
        );
      }
    }

    // Recalculate lead total
    await pool.query(
      `UPDATE aufmass_leads SET total_price = (SELECT COALESCE(SUM(total_price), 0) FROM aufmass_lead_angebote WHERE lead_id = $1), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    res.json({ id: parseInt(angebotId), message: 'Angebot updated successfully' });
  } catch (err) {
    console.error('Update angebot error:', err);
    res.status(500).json({ error: 'Failed to update angebot', details: err.message });
  }
});

// Delete a specific angebot
app.delete('/api/leads/:id/angebote/:angebotId', authenticateToken, async (req, res) => {
  try {
    const { id, angebotId } = req.params;

    const result = await pool.query(
      'DELETE FROM aufmass_lead_angebote WHERE id = $1 AND lead_id = $2',
      [angebotId, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Angebot not found' });
    }

    // Recalculate lead total
    await pool.query(
      `UPDATE aufmass_leads SET total_price = (SELECT COALESCE(SUM(total_price), 0) FROM aufmass_lead_angebote WHERE lead_id = $1), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    // Delete angebot PDF if exists
    const angebotPdfPath = path.join(PDF_DIR, 'leads', `${id}_${angebotId}.pdf`);
    if (fs.existsSync(angebotPdfPath)) {
      fs.unlinkSync(angebotPdfPath);
    }

    res.json({ message: 'Angebot deleted successfully' });
  } catch (err) {
    console.error('Delete angebot error:', err);
    res.status(500).json({ error: 'Failed to delete angebot' });
  }
});

// Save PDF for a specific angebot
app.post('/api/leads/:id/angebote/:angebotId/pdf', authenticateToken, upload.single('pdf'), async (req, res) => {
  try {
    const { id, angebotId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No PDF file provided' });

    // Verify angebot exists
    const check = await pool.query('SELECT id FROM aufmass_lead_angebote WHERE id = $1 AND lead_id = $2', [angebotId, id]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Angebot not found' });

    const pdfPath = path.join(LEAD_PDF_DIR, `${id}_${angebotId}.pdf`);
    fs.writeFileSync(pdfPath, req.file.buffer);
    res.json({ message: 'Angebot PDF saved successfully' });
  } catch (err) {
    console.error('Error saving angebot PDF:', err);
    res.status(500).json({ error: 'Failed to save angebot PDF' });
  }
});

// Get PDF for a specific angebot
app.get('/api/leads/:id/angebote/:angebotId/pdf', authenticateToken, async (req, res) => {
  try {
    const { id, angebotId } = req.params;

    // Try angebot-specific PDF first, fall back to lead-level PDF
    const angebotPdfPath = path.join(LEAD_PDF_DIR, `${id}_${angebotId}.pdf`);
    const leadPdfPath = path.join(LEAD_PDF_DIR, `${id}.pdf`);

    const pdfPath = fs.existsSync(angebotPdfPath) ? angebotPdfPath : (fs.existsSync(leadPdfPath) ? leadPdfPath : null);
    if (!pdfPath) return res.status(404).json({ error: 'No PDF generated for this angebot' });

    const stats = fs.statSync(pdfPath);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="angebot_${id}_${angebotId}.pdf"`,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error('Error getting angebot PDF:', err);
    res.status(500).json({ error: 'Failed to get angebot PDF' });
  }
});

// ============ LEAD PDF STORAGE ============

// Lead PDF storage directory
const LEAD_PDF_DIR = path.join(PDF_DIR, 'leads');
if (!fs.existsSync(LEAD_PDF_DIR)) {
  fs.mkdirSync(LEAD_PDF_DIR, { recursive: true });
}

// Save generated PDF for a lead
app.post('/api/leads/:id/pdf', authenticateToken, upload.single('pdf'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    // Verify lead belongs to this branch
    let verifyQuery, verifyParams;
    if (req.branchId) {
      verifyQuery = 'SELECT id FROM aufmass_leads WHERE id = $1 AND branch_id = $2';
      verifyParams = [id, req.branchId];
    } else {
      verifyQuery = 'SELECT id FROM aufmass_leads WHERE id = $1';
      verifyParams = [id];
    }
    const verifyResult = await pool.query(verifyQuery, verifyParams);
    if (verifyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const pdfPath = path.join(LEAD_PDF_DIR, `${id}.pdf`);
    fs.writeFileSync(pdfPath, req.file.buffer);

    res.json({ message: 'Lead PDF saved successfully' });
  } catch (err) {
    console.error('Error saving lead PDF:', err);
    res.status(500).json({ error: 'Failed to save lead PDF' });
  }
});

// Get generated PDF for a lead
app.get('/api/leads/:id/pdf', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify lead belongs to this branch
    let verifyQuery, verifyParams;
    if (req.branchId) {
      verifyQuery = 'SELECT id FROM aufmass_leads WHERE id = $1 AND branch_id = $2';
      verifyParams = [id, req.branchId];
    } else {
      verifyQuery = 'SELECT id FROM aufmass_leads WHERE id = $1';
      verifyParams = [id];
    }
    const verifyResult = await pool.query(verifyQuery, verifyParams);
    if (verifyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    let pdfPath = path.join(LEAD_PDF_DIR, `${id}.pdf`);
    let fileName = `angebot_${id}.pdf`;

    if (!fs.existsSync(pdfPath)) {
      const angeboteResult = await pool.query(
        'SELECT id FROM aufmass_lead_angebote WHERE lead_id = $1 ORDER BY created_at DESC, id DESC',
        [id]
      );

      const fallbackPdf = angeboteResult.rows
        .map((angebot) => ({
          pdfPath: path.join(LEAD_PDF_DIR, `${id}_${angebot.id}.pdf`),
          fileName: `angebot_${id}_${angebot.id}.pdf`
        }))
        .find((candidate) => fs.existsSync(candidate.pdfPath));

      if (!fallbackPdf) {
        return res.status(404).json({ error: 'No PDF generated for this lead' });
      }

      pdfPath = fallbackPdf.pdfPath;
      fileName = fallbackPdf.fileName;
    }

    const stats = fs.statSync(pdfPath);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': stats.size,
      'Cache-Control': 'no-cache'
    });

    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
  } catch (err) {
    console.error('Error getting lead PDF:', err);
    res.status(500).json({ error: 'Failed to get lead PDF' });
  }
});

// Import products from price matrix (admin only)
app.post('/api/lead-products/import', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { products } = req.body; // Array of { product_name, breite, tiefe, price }

    let imported = 0;
    for (const product of products) {
      await pool.query(
        `INSERT INTO aufmass_lead_products (product_name, breite, tiefe, price, branch_id)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM aufmass_lead_products
           WHERE product_name = $1 AND breite = $2 AND tiefe = $3
           AND (branch_id = $5 OR (branch_id IS NULL AND $5 IS NULL))
         )`,
        [product.product_name, product.breite, product.tiefe, product.price, req.branchId || null]
      );
      imported++;
    }

    res.json({ message: `Imported ${imported} products` });
  } catch (err) {
    console.error('Import products error:', err);
    res.status(500).json({ error: 'Failed to import products' });
  }
});

// ============ EMAIL / SMTP ============

// Simple AES-256 encryption for SMTP passwords
const EMAIL_ENCRYPTION_KEY = process.env.EMAIL_ENCRYPTION_KEY || 'aylux-smtp-encryption-key-2026!!'; // 32 chars
function encryptSmtpPass(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(EMAIL_ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}
function decryptSmtpPass(encryptedText) {
  const [ivHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const key = crypto.scryptSync(EMAIL_ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Get SMTP config for a user (user-level first, then branch fallback)
async function getUserSmtpConfig(userId) {
  const result = await pool.query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_pass_enc, smtp_from_name, smtp_from_email, smtp_secure, smtp_configured
     FROM aufmass_users WHERE id = $1`,
    [userId]
  );
  if (result.rows.length === 0 || !result.rows[0].smtp_configured) return null;
  const row = result.rows[0];
  if (!row.smtp_host || !row.smtp_user || !row.smtp_pass_enc) return null;
  return {
    host: row.smtp_host,
    port: row.smtp_port || 587,
    secure: row.smtp_secure || false,
    auth: { user: row.smtp_user, pass: decryptSmtpPass(row.smtp_pass_enc) },
    fromName: row.smtp_from_name || 'AYLUX',
    fromEmail: row.smtp_from_email || row.smtp_user,
    source: 'user'
  };
}

// Get SMTP settings for a branch
async function getBranchSmtpConfig(branchSlug) {
  const result = await pool.query(
    `SELECT smtp_host, smtp_port, smtp_user, smtp_pass_enc, smtp_from_name, smtp_from_email, smtp_secure, smtp_enabled
     FROM aufmass_branch_settings WHERE branch_slug = $1`,
    [branchSlug]
  );
  if (result.rows.length === 0 || !result.rows[0].smtp_enabled) return null;
  const row = result.rows[0];
  if (!row.smtp_host || !row.smtp_user || !row.smtp_pass_enc) return null;
  return {
    host: row.smtp_host,
    port: row.smtp_port || 587,
    secure: row.smtp_secure || false,
    auth: { user: row.smtp_user, pass: decryptSmtpPass(row.smtp_pass_enc) },
    fromName: row.smtp_from_name || 'AYLUX',
    fromEmail: row.smtp_from_email || row.smtp_user,
    source: 'branch'
  };
}

// Hybrid: user SMTP > branch SMTP
async function getSmtpConfig(userId, branchSlug) {
  const userConfig = await getUserSmtpConfig(userId);
  if (userConfig) return userConfig;
  return getBranchSmtpConfig(branchSlug);
}

// Create nodemailer transporter from branch config
function createTransporter(smtpConfig) {
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.auth,
    tls: { rejectUnauthorized: false }
  });
}

// GET /api/email/my-settings - Get user's own SMTP settings
app.get('/api/email/my-settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_from_name, smtp_from_email, smtp_secure, smtp_configured
       FROM aufmass_users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.json({ smtp_host: '', smtp_port: 587, smtp_user: '', smtp_from_name: '', smtp_from_email: '', smtp_secure: false, smtp_configured: false });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user email settings:', err);
    res.status(500).json({ error: 'Failed to fetch email settings' });
  }
});

// PUT /api/email/my-settings - Save user's own SMTP settings
app.put('/api/email/my-settings', authenticateToken, async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, smtp_from_email, smtp_secure, smtp_configured } = req.body;

    if (smtp_pass) {
      const encrypted = encryptSmtpPass(smtp_pass);
      await pool.query(
        `UPDATE aufmass_users
         SET smtp_host = $2, smtp_port = $3, smtp_user = $4, smtp_pass_enc = $5,
             smtp_from_name = $6, smtp_from_email = $7, smtp_secure = $8, smtp_configured = $9
         WHERE id = $1`,
        [req.user.id, smtp_host, smtp_port || 587, smtp_user, encrypted, smtp_from_name, smtp_from_email, smtp_secure || false, smtp_configured || false]
      );
    } else {
      await pool.query(
        `UPDATE aufmass_users
         SET smtp_host = $2, smtp_port = $3, smtp_user = $4,
             smtp_from_name = $5, smtp_from_email = $6, smtp_secure = $7, smtp_configured = $8
         WHERE id = $1`,
        [req.user.id, smtp_host, smtp_port || 587, smtp_user, smtp_from_name, smtp_from_email, smtp_secure || false, smtp_configured || false]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving user email settings:', err);
    res.status(500).json({ error: 'Failed to save email settings' });
  }
});

// GET /api/email/status - Check which SMTP is active for current user (any user)
app.get('/api/email/status', authenticateToken, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const config = await getSmtpConfig(req.user.id, branchSlug);
    if (!config) {
      return res.json({ configured: false, source: null, from_email: null });
    }
    res.json({ configured: true, source: config.source, from_email: config.fromEmail, from_name: config.fromName });
  } catch (err) {
    console.error('Error checking email status:', err);
    res.status(500).json({ error: 'Failed to check email status' });
  }
});

// GET /api/email/settings - Get SMTP settings for current branch (admin only)
app.get('/api/email/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const result = await pool.query(
      `SELECT smtp_host, smtp_port, smtp_user, smtp_from_name, smtp_from_email, smtp_secure, smtp_enabled
       FROM aufmass_branch_settings WHERE branch_slug = $1`,
      [branchSlug]
    );
    if (result.rows.length === 0) {
      return res.json({ smtp_host: '', smtp_port: 587, smtp_user: '', smtp_from_name: '', smtp_from_email: '', smtp_secure: false, smtp_enabled: false });
    }
    // Never return the password
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching email settings:', err);
    res.status(500).json({ error: 'Failed to fetch email settings' });
  }
});

// PUT /api/email/settings - Save SMTP settings for current branch (admin only)
app.put('/api/email/settings', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name, smtp_from_email, smtp_secure, smtp_enabled } = req.body;

    // Ensure branch_settings row exists
    await pool.query(
      `INSERT INTO aufmass_branch_settings (branch_slug) VALUES ($1) ON CONFLICT (branch_slug) DO NOTHING`,
      [branchSlug]
    );

    // Build update - only update password if provided
    if (smtp_pass) {
      const encrypted = encryptSmtpPass(smtp_pass);
      await pool.query(
        `UPDATE aufmass_branch_settings
         SET smtp_host = $2, smtp_port = $3, smtp_user = $4, smtp_pass_enc = $5,
             smtp_from_name = $6, smtp_from_email = $7, smtp_secure = $8, smtp_enabled = $9
         WHERE branch_slug = $1`,
        [branchSlug, smtp_host, smtp_port || 587, smtp_user, encrypted, smtp_from_name, smtp_from_email, smtp_secure || false, smtp_enabled || false]
      );
    } else {
      await pool.query(
        `UPDATE aufmass_branch_settings
         SET smtp_host = $2, smtp_port = $3, smtp_user = $4,
             smtp_from_name = $5, smtp_from_email = $6, smtp_secure = $7, smtp_enabled = $8
         WHERE branch_slug = $1`,
        [branchSlug, smtp_host, smtp_port || 587, smtp_user, smtp_from_name, smtp_from_email, smtp_secure || false, smtp_enabled || false]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving email settings:', err);
    res.status(500).json({ error: 'Failed to save email settings' });
  }
});

// POST /api/email/test - Test SMTP connection (admin only)
app.post('/api/email/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_email, smtp_secure } = req.body;

    if (!smtp_host || !smtp_user || !smtp_pass) {
      return res.status(400).json({ error: 'SMTP Host, Benutzer und Passwort sind erforderlich' });
    }

    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port: smtp_port || 587,
      secure: smtp_secure || false,
      auth: { user: smtp_user, pass: smtp_pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      socketTimeout: 10000
    });

    // Verify connection
    await transporter.verify();

    // Send test email to the SMTP user themselves
    const testTo = smtp_from_email || smtp_user;
    await transporter.sendMail({
      from: `"AYLUX Test" <${testTo}>`,
      to: testTo,
      subject: 'AYLUX E-Mail Test - Verbindung erfolgreich ✓',
      text: 'Die SMTP-Verbindung wurde erfolgreich hergestellt. E-Mails können jetzt über die AYLUX Aufmaß App versendet werden.',
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <h2 style="color:#7fa93d">✓ SMTP-Verbindung erfolgreich</h2>
        <p>Die SMTP-Verbindung wurde erfolgreich hergestellt.</p>
        <p>E-Mails können jetzt über die <strong>AYLUX Aufmaß App</strong> versendet werden.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0">
        <small style="color:#999">Dies ist eine automatische Test-E-Mail.</small>
      </div>`
    });

    res.json({ success: true, message: 'Verbindung erfolgreich! Test-E-Mail wurde gesendet.' });
  } catch (err) {
    console.error('SMTP test failed:', err);
    let errorMessage = 'Verbindung fehlgeschlagen';
    if (err.code === 'ECONNREFUSED') errorMessage = 'Verbindung abgelehnt - Host oder Port falsch';
    else if (err.code === 'EAUTH' || err.responseCode === 535) errorMessage = 'Authentifizierung fehlgeschlagen - Benutzername oder Passwort falsch';
    else if (err.code === 'ESOCKET') errorMessage = 'Verbindungsfehler - Prüfen Sie Host und Port';
    else if (err.code === 'ETIMEDOUT') errorMessage = 'Zeitüberschreitung - Server nicht erreichbar';
    else if (err.message) errorMessage = err.message;
    res.status(400).json({ error: errorMessage });
  }
});

// POST /api/email/send - Send email with optional PDF attachment
app.post('/api/email/send', authenticateToken, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const { to, subject, body, body_html, form_id, lead_id, angebot_ids, email_type, attachment_name, attach_agb, extra_pdfs, suppress_main_pdf } = req.body;

    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Empfänger, Betreff und Nachricht sind erforderlich' });
    }

    const smtpConfig = await getSmtpConfig(req.user.id, branchSlug);
    if (!smtpConfig) {
      return res.status(400).json({ error: 'E-Mail ist nicht konfiguriert. Richten Sie Ihre persönlichen SMTP-Einstellungen ein oder bitten Sie den Admin, die Filial-E-Mail zu konfigurieren.' });
    }

    const transporter = createTransporter(smtpConfig);

    // Build email
    const mailOptions = {
      from: `"${smtpConfig.fromName}" <${smtpConfig.fromEmail}>`,
      to,
      subject,
      text: body,
      html: body_html || body.replace(/\n/g, '<br>'),
      attachments: []
    };

    // Attach PDF if form_id or lead_id provided
    // suppress_main_pdf is set when the client uploads per-product split PDFs via extra_pdfs;
    // we must skip the consolidated PDF in that case to avoid duplicates.
    if (form_id && !suppress_main_pdf) {
      // Try filesystem first, then DB
      const pdfPath = path.join(PDF_DIR, `${form_id}.pdf`);
      if (fs.existsSync(pdfPath)) {
        mailOptions.attachments.push({
          filename: attachment_name || `Aufmass_${form_id}.pdf`,
          path: pdfPath,
          contentType: 'application/pdf'
        });
      } else {
        const pdfResult = await pool.query('SELECT generated_pdf FROM aufmass_forms WHERE id = $1', [form_id]);
        if (pdfResult.rows.length > 0 && pdfResult.rows[0].generated_pdf) {
          mailOptions.attachments.push({
            filename: attachment_name || `Aufmass_${form_id}.pdf`,
            content: pdfResult.rows[0].generated_pdf,
            contentType: 'application/pdf'
          });
        }
      }
    }

    if (lead_id && !suppress_main_pdf) {
      const leadPdfDir = path.join(PDF_DIR, 'leads');

      if (angebot_ids && Array.isArray(angebot_ids) && angebot_ids.length > 0) {
        // Specific angebote requested - attach each one
        for (const angId of angebot_ids) {
          const angPdfPath = path.join(leadPdfDir, `${lead_id}_${angId}.pdf`);
          if (fs.existsSync(angPdfPath)) {
            // Look up angebot_nummer for filename
            const angResult = await pool.query('SELECT angebot_nummer FROM aufmass_lead_angebote WHERE id = $1', [angId]);
            const angNr = angResult.rows[0]?.angebot_nummer || angId;
            mailOptions.attachments.push({
              filename: `Angebot_${angNr}.pdf`,
              path: angPdfPath,
              contentType: 'application/pdf'
            });
          } else {
            // Fallback: lead-level PDF
            const leadPdfPath = path.join(leadPdfDir, `${lead_id}.pdf`);
            if (fs.existsSync(leadPdfPath)) {
              mailOptions.attachments.push({
                filename: `Angebot_${angId}.pdf`,
                path: leadPdfPath,
                contentType: 'application/pdf'
              });
            }
          }
        }
      } else {
        // No specific angebote - attach latest
        let pdfAttached = false;
        if (fs.existsSync(leadPdfDir)) {
          const files = fs.readdirSync(leadPdfDir).filter(f => f.startsWith(`${lead_id}_`) && f.endsWith('.pdf'));
          if (files.length > 0) {
            files.sort().reverse();
            mailOptions.attachments.push({
              filename: attachment_name || `Angebot_${lead_id}.pdf`,
              path: path.join(leadPdfDir, files[0]),
              contentType: 'application/pdf'
            });
            pdfAttached = true;
          }
        }
        if (!pdfAttached) {
          const leadPdfPath = path.join(leadPdfDir, `${lead_id}.pdf`);
          if (fs.existsSync(leadPdfPath)) {
            mailOptions.attachments.push({
              filename: attachment_name || `Angebot_${lead_id}.pdf`,
              path: leadPdfPath,
              contentType: 'application/pdf'
            });
          }
        }
      }
    }

    // Client-supplied extra PDFs (e.g. one PDF per product when split-per-item is selected).
    // Format: [{ filename: "Angebot_Markise.pdf", base64: "<base64-encoded pdf bytes>" }]
    if (Array.isArray(extra_pdfs) && extra_pdfs.length > 0) {
      const TOTAL_LIMIT = 25 * 1024 * 1024; // 25 MB combined budget for client uploads
      let totalBytes = 0;
      for (const pdf of extra_pdfs) {
        if (!pdf?.base64 || typeof pdf.base64 !== 'string') continue;
        const safeName = String(pdf.filename || 'Anhang.pdf').replace(/[^\w\-. ()äöüÄÖÜß]/g, '_').slice(0, 120);
        let buf;
        try {
          buf = Buffer.from(pdf.base64, 'base64');
        } catch (e) {
          console.warn('Skipping malformed extra_pdf:', safeName, e.message);
          continue;
        }
        // Sanity-check it's actually a PDF
        if (buf.length < 5 || buf.subarray(0, 5).toString('ascii') !== '%PDF-') {
          console.warn('Skipping non-PDF extra attachment:', safeName);
          continue;
        }
        totalBytes += buf.length;
        if (totalBytes > TOTAL_LIMIT) {
          return res.status(400).json({ error: 'Gesamtgröße der angehängten PDFs überschreitet 25 MB.' });
        }
        mailOptions.attachments.push({ filename: safeName, content: buf, contentType: 'application/pdf' });
      }
    }

    // Optional: attach branch's AGB as a separate file (only when uploaded as a PDF).
    // Selected pages are honored — we splice them out using pdf-lib so the attachment
    // matches what the user picked in the AGB settings page.
    if (attach_agb) {
      try {
        const termsResult = await pool.query(
          'SELECT agb_pdf_path, agb_pdf_pages FROM aufmass_branch_terms WHERE branch_slug = $1',
          [branchSlug]
        );
        const terms = termsResult.rows[0];
        if (terms?.agb_pdf_path) {
          const fullPath = path.join(process.cwd(), 'aufmass-pdfs', 'branch-uploads', branchSlug, terms.agb_pdf_path);
          if (fs.existsSync(fullPath)) {
            let pdfBuffer = fs.readFileSync(fullPath);
            const selectedPages = Array.isArray(terms.agb_pdf_pages) ? terms.agb_pdf_pages : null;
            if (selectedPages && selectedPages.length > 0) {
              try {
                const { PDFDocument } = await import('pdf-lib');
                const src = await PDFDocument.load(pdfBuffer);
                const pageCount = src.getPageCount();
                const validIdx0 = selectedPages
                  .filter((p) => Number.isInteger(p) && p >= 1 && p <= pageCount)
                  .map((p) => p - 1);
                if (validIdx0.length > 0 && validIdx0.length < pageCount) {
                  const out = await PDFDocument.create();
                  const copied = await out.copyPages(src, validIdx0);
                  copied.forEach((p) => out.addPage(p));
                  const sliced = await out.save();
                  pdfBuffer = Buffer.from(sliced);
                }
              } catch (sliceErr) {
                console.warn('AGB page-slice failed, sending full PDF:', sliceErr.message);
              }
            }
            mailOptions.attachments.push({
              filename: 'AGB.pdf',
              content: pdfBuffer,
              contentType: 'application/pdf'
            });
          }
        }
      } catch (agbErr) {
        console.warn('AGB attachment skipped:', agbErr.message);
      }
    }

    // Send
    await transporter.sendMail(mailOptions);

    // Log
    await pool.query(
      `INSERT INTO aufmass_email_log (form_id, lead_id, branch_id, email_type, recipient_email, subject, status, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', $7)`,
      [form_id || null, lead_id || null, branchSlug, email_type || 'manual', to, subject, req.user.id]
    );

    res.json({ success: true, message: 'E-Mail erfolgreich gesendet' });
  } catch (err) {
    console.error('Email send error:', err);

    // Log failure
    const branchSlug = req.branchId || 'koblenz';
    const { to, subject, form_id, lead_id, email_type } = req.body;
    await pool.query(
      `INSERT INTO aufmass_email_log (form_id, lead_id, branch_id, email_type, recipient_email, subject, status, error_message, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'failed', $7, $8)`,
      [form_id || null, lead_id || null, branchSlug, email_type || 'manual', to || '', subject || '', err.message, req.user.id]
    ).catch(() => {});

    res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden: ' + err.message });
  }
});

// GET /api/email/log - Get email log for branch (admin only)
app.get('/api/email/log', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const result = await pool.query(
      `SELECT el.*, u.name as sent_by_name
       FROM aufmass_email_log el
       LEFT JOIN aufmass_users u ON el.sent_by = u.id
       WHERE el.branch_id = $1
       ORDER BY el.sent_at DESC LIMIT 100`,
      [branchSlug]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching email log:', err);
    res.status(500).json({ error: 'Failed to fetch email log' });
  }
});

// ============ BRANCH COMPANY INFO (Firmenangaben) ============

// GET /api/branch/company-info — get company info for current branch (admin only)
app.get('/api/branch/company-info', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const result = await pool.query(
      `SELECT company_name, company_strasse, company_plz, company_ort, company_telefon,
              company_email, company_ust_id, company_web, company_steuernr, company_iban,
              company_bic, company_bank_name, company_geschaeftsfuehrer, company_handelsregister
       FROM aufmass_branch_settings WHERE branch_slug = $1`,
      [branchSlug]
    );
    if (result.rows.length === 0) {
      return res.json({
        company_name: '', company_strasse: '', company_plz: '', company_ort: '',
        company_telefon: '', company_email: '', company_ust_id: '', company_web: '',
        company_steuernr: '', company_iban: '', company_bic: '', company_bank_name: '',
        company_geschaeftsfuehrer: '', company_handelsregister: ''
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching company info:', err);
    res.status(500).json({ error: 'Failed to fetch company info' });
  }
});

// PUT /api/branch/company-info — save company info for current branch (admin only)
app.put('/api/branch/company-info', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const {
      company_name, company_strasse, company_plz, company_ort, company_telefon,
      company_email, company_ust_id, company_web, company_steuernr, company_iban,
      company_bic, company_bank_name, company_geschaeftsfuehrer, company_handelsregister
    } = req.body;

    // Required field validation
    if (!company_name || !company_strasse || !company_plz || !company_ort ||
        !company_telefon || !company_email || !company_ust_id) {
      return res.status(400).json({ error: 'Pflichtfelder fehlen (Firmenname, Adresse, Telefon, E-Mail, USt-IdNr)' });
    }

    // Manual upsert (branch_slug may not have a UNIQUE constraint)
    const existing = await pool.query(
      'SELECT branch_slug FROM aufmass_branch_settings WHERE branch_slug = $1',
      [branchSlug]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO aufmass_branch_settings (
          branch_slug, company_name, company_strasse, company_plz, company_ort,
          company_telefon, company_email, company_ust_id, company_web,
          company_steuernr, company_iban, company_bic, company_bank_name,
          company_geschaeftsfuehrer, company_handelsregister
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [branchSlug, company_name, company_strasse, company_plz, company_ort,
         company_telefon, company_email, company_ust_id, company_web || '',
         company_steuernr || '', company_iban || '', company_bic || '', company_bank_name || '',
         company_geschaeftsfuehrer || '', company_handelsregister || '']
      );
    } else {
      await pool.query(
        `UPDATE aufmass_branch_settings SET
          company_name = $2, company_strasse = $3, company_plz = $4, company_ort = $5,
          company_telefon = $6, company_email = $7, company_ust_id = $8, company_web = $9,
          company_steuernr = $10, company_iban = $11, company_bic = $12, company_bank_name = $13,
          company_geschaeftsfuehrer = $14, company_handelsregister = $15
         WHERE branch_slug = $1`,
        [branchSlug, company_name, company_strasse, company_plz, company_ort,
         company_telefon, company_email, company_ust_id, company_web || '',
         company_steuernr || '', company_iban || '', company_bic || '', company_bank_name || '',
         company_geschaeftsfuehrer || '', company_handelsregister || '']
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving company info:', err);
    res.status(500).json({ error: 'Failed to save company info' });
  }
});

// GET /api/branch/company-info-public — public read for PDF generation (any authenticated user)
app.get('/api/branch/company-info-public', authenticateToken, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const result = await pool.query(
      `SELECT company_name, company_strasse, company_plz, company_ort, company_telefon,
              company_email, company_ust_id, company_web, company_steuernr, company_iban,
              company_bic, company_bank_name, company_geschaeftsfuehrer, company_handelsregister
       FROM aufmass_branch_settings WHERE branch_slug = $1`,
      [branchSlug]
    );
    if (result.rows.length === 0) {
      return res.json({
        company_name: '', company_strasse: '', company_plz: '', company_ort: '',
        company_telefon: '', company_email: '', company_ust_id: '', company_web: '',
        company_steuernr: '', company_iban: '', company_bic: '', company_bank_name: '',
        company_geschaeftsfuehrer: '', company_handelsregister: ''
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching public company info:', err);
    res.status(500).json({ error: 'Failed to fetch company info' });
  }
});

// ============ MODÜL F: PRODUCT IMAGES ============

const productImageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(process.cwd(), 'product-images');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `prod_${Date.now()}_${Math.random().toString(36).substring(7)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// GET — list product images
app.get('/api/products/:productId/images', authenticateToken, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const productId = parseInt(req.params.productId);
    const result = await pool.query(
      `SELECT id, image_path, image_order, show_on_cover, uploaded_at
       FROM aufmass_product_images
       WHERE branch_slug = $1 AND product_id = $2
       ORDER BY image_order ASC`,
      [branchSlug, productId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching product images:', err);
    res.status(500).json({ error: 'Failed to fetch product images' });
  }
});

// POST — upload product image (max 3 per product)
app.post('/api/products/:productId/images', authenticateToken, requireAdmin, (req, res) => {
  productImageUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const branchSlug = req.branchId || 'koblenz';
      const productId = parseInt(req.params.productId);

      const countResult = await pool.query(
        'SELECT COUNT(*) FROM aufmass_product_images WHERE branch_slug = $1 AND product_id = $2',
        [branchSlug, productId]
      );
      if (parseInt(countResult.rows[0].count) >= 3) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Maximum 3 Bilder pro Produkt' });
      }

      const orderResult = await pool.query(
        'SELECT COALESCE(MAX(image_order), 0) + 1 AS next_order FROM aufmass_product_images WHERE branch_slug = $1 AND product_id = $2',
        [branchSlug, productId]
      );
      const nextOrder = orderResult.rows[0].next_order;

      const insertResult = await pool.query(
        `INSERT INTO aufmass_product_images (branch_slug, product_id, image_path, image_order, show_on_cover)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id, image_path, image_order, show_on_cover, uploaded_at`,
        [branchSlug, productId, req.file.filename, nextOrder]
      );

      res.json(insertResult.rows[0]);
    } catch (err) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      console.error('Error uploading product image:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

// DELETE — remove a product image
app.delete('/api/products/:productId/images/:imageId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const imageId = parseInt(req.params.imageId);

    const result = await pool.query(
      'SELECT image_path FROM aufmass_product_images WHERE id = $1 AND branch_slug = $2',
      [imageId, branchSlug]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Bild nicht gefunden' });

    const imagePath = path.join(process.cwd(), 'product-images', result.rows[0].image_path);
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

    await pool.query('DELETE FROM aufmass_product_images WHERE id = $1 AND branch_slug = $2', [imageId, branchSlug]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting product image:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// PUT — toggle cover flag (max 2 cover images per product)
app.put('/api/products/:productId/images/:imageId/cover-flag', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const imageId = parseInt(req.params.imageId);
    const productId = parseInt(req.params.productId);
    const { show_on_cover } = req.body;

    if (show_on_cover === true) {
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM aufmass_product_images
         WHERE branch_slug = $1 AND product_id = $2 AND show_on_cover = true AND id != $3`,
        [branchSlug, productId, imageId]
      );
      if (parseInt(countResult.rows[0].count) >= 2) {
        return res.status(400).json({ error: 'Maximal 2 Bilder können auf dem Cover angezeigt werden' });
      }
    }

    await pool.query(
      'UPDATE aufmass_product_images SET show_on_cover = $1 WHERE id = $2 AND branch_slug = $3',
      [!!show_on_cover, imageId, branchSlug]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating cover flag:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// GET — serve product image file (public; filenames are unguessable random strings)
app.get('/api/product-image/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^[\w\-.]+\.(jpg|jpeg|png|webp)$/i.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(process.cwd(), 'product-images', filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// ============ MODÜL F: BRANCH TERMS (AGB) ============

app.get('/api/branch/terms', authenticateToken, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const result = await pool.query(
      `SELECT content, show_on_aufmass, show_on_angebot, show_on_abnahme, show_on_rechnung,
              agb_pdf_path, agb_pdf_pages, attach_separately
       FROM aufmass_branch_terms WHERE branch_slug = $1`,
      [branchSlug]
    );
    if (result.rows.length === 0) {
      return res.json({
        content: '',
        show_on_aufmass: false,
        show_on_angebot: true,
        show_on_abnahme: false,
        show_on_rechnung: false,
        agb_pdf_path: null,
        agb_pdf_pages: null,
        attach_separately: false
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching branch terms:', err);
    res.status(500).json({ error: 'Failed to fetch terms' });
  }
});

app.put('/api/branch/terms', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const { content, show_on_aufmass, show_on_angebot, show_on_abnahme, show_on_rechnung, attach_separately } = req.body;

    const existing = await pool.query(
      'SELECT branch_slug FROM aufmass_branch_terms WHERE branch_slug = $1',
      [branchSlug]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO aufmass_branch_terms
         (branch_slug, content, show_on_aufmass, show_on_angebot, show_on_abnahme, show_on_rechnung, attach_separately, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [branchSlug, content || '', !!show_on_aufmass, !!show_on_angebot, !!show_on_abnahme, !!show_on_rechnung, !!attach_separately]
      );
    } else {
      await pool.query(
        `UPDATE aufmass_branch_terms SET
           content = $2, show_on_aufmass = $3, show_on_angebot = $4,
           show_on_abnahme = $5, show_on_rechnung = $6, attach_separately = $7, updated_at = NOW()
         WHERE branch_slug = $1`,
        [branchSlug, content || '', !!show_on_aufmass, !!show_on_angebot, !!show_on_abnahme, !!show_on_rechnung, !!attach_separately]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving branch terms:', err);
    res.status(500).json({ error: 'Save failed' });
  }
});

// ============ MODÜL F2: PDF Cover/AGB Override System ============

const branchPdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const branchSlug = req.branchId || 'koblenz';
      const dir = path.join(process.cwd(), 'aufmass-pdfs', 'branch-uploads', branchSlug);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}_${Math.random().toString(36).substring(2, 10)}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Nur PDF-Dateien erlaubt'));
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// Helper: validate PDF magic bytes (defense-in-depth beyond MIME)
function isPdfMagic(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(5);
    fs.readSync(fd, buf, 0, 5, 0);
    fs.closeSync(fd);
    return buf.toString('ascii') === '%PDF-';
  } catch {
    return false;
  }
}

// Helper: count pages in a PDF using pdf-lib (server-side)
async function getPdfPageCount(filePath) {
  const { PDFDocument } = await import('pdf-lib');
  const bytes = fs.readFileSync(filePath);
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: false });
  return pdfDoc.getPageCount();
}

// === COVER PDF (per-product) ===

app.get('/api/products/:productId/cover-pdf', authenticateToken, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const productId = parseInt(req.params.productId);
    const result = await pool.query(
      `SELECT id, file_path, selected_pages, page_count, uploaded_at
       FROM aufmass_product_cover_pdfs
       WHERE branch_slug = $1 AND product_id = $2`,
      [branchSlug, productId]
    );
    if (result.rows.length === 0) return res.json(null);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching cover PDF:', err);
    res.status(500).json({ error: 'Failed to fetch cover PDF' });
  }
});

app.post('/api/products/:productId/cover-pdf', authenticateToken, requireAdmin, (req, res) => {
  branchPdfUpload.single('pdf')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

    if (!isPdfMagic(req.file.path)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Ungültige PDF-Datei' });
    }

    let pageCount;
    try {
      pageCount = await getPdfPageCount(req.file.path);
    } catch (e) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'PDF konnte nicht gelesen werden (möglicherweise verschlüsselt)' });
    }
    if (pageCount > 30) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Maximal 30 Seiten erlaubt' });
    }

    try {
      const branchSlug = req.branchId || 'koblenz';
      const productId = parseInt(req.params.productId);

      // Delete old PDF if exists
      const old = await pool.query(
        'SELECT file_path FROM aufmass_product_cover_pdfs WHERE branch_slug = $1 AND product_id = $2',
        [branchSlug, productId]
      );
      if (old.rows.length > 0) {
        const oldPath = path.join(process.cwd(), 'aufmass-pdfs', 'branch-uploads', branchSlug, old.rows[0].file_path);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      // Default: first page selected
      const defaultPages = [1];

      const upsertResult = await pool.query(
        `INSERT INTO aufmass_product_cover_pdfs (branch_slug, product_id, file_path, selected_pages, page_count, uploaded_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
         ON CONFLICT (branch_slug, product_id)
         DO UPDATE SET file_path = EXCLUDED.file_path, selected_pages = EXCLUDED.selected_pages,
                       page_count = EXCLUDED.page_count, uploaded_at = NOW()
         RETURNING id, file_path, selected_pages, page_count, uploaded_at`,
        [branchSlug, productId, req.file.filename, JSON.stringify(defaultPages), pageCount]
      );
      res.json(upsertResult.rows[0]);
    } catch (err) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      console.error('Error saving cover PDF:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

app.put('/api/products/:productId/cover-pdf/pages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const productId = parseInt(req.params.productId);
    const { selected_pages } = req.body;

    if (!Array.isArray(selected_pages) || selected_pages.some(p => typeof p !== 'number' || p < 1)) {
      return res.status(400).json({ error: 'Ungültige Seitenauswahl' });
    }

    await pool.query(
      `UPDATE aufmass_product_cover_pdfs SET selected_pages = $1::jsonb
       WHERE branch_slug = $2 AND product_id = $3`,
      [JSON.stringify(selected_pages), branchSlug, productId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating cover PDF pages:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/products/:productId/cover-pdf', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const productId = parseInt(req.params.productId);

    const existing = await pool.query(
      'SELECT file_path FROM aufmass_product_cover_pdfs WHERE branch_slug = $1 AND product_id = $2',
      [branchSlug, productId]
    );
    if (existing.rows.length > 0) {
      const filePath = path.join(process.cwd(), 'aufmass-pdfs', 'branch-uploads', branchSlug, existing.rows[0].file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await pool.query(
      'DELETE FROM aufmass_product_cover_pdfs WHERE branch_slug = $1 AND product_id = $2',
      [branchSlug, productId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting cover PDF:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// === AGB PDF (branch-level) ===

app.post('/api/branch/agb-pdf', authenticateToken, requireAdmin, (req, res) => {
  branchPdfUpload.single('pdf')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });

    if (!isPdfMagic(req.file.path)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Ungültige PDF-Datei' });
    }

    let pageCount;
    try {
      pageCount = await getPdfPageCount(req.file.path);
    } catch (e) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'PDF konnte nicht gelesen werden' });
    }
    if (pageCount > 30) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Maximal 30 Seiten erlaubt' });
    }

    try {
      const branchSlug = req.branchId || 'koblenz';

      // Delete old AGB PDF if exists
      const old = await pool.query(
        'SELECT agb_pdf_path FROM aufmass_branch_terms WHERE branch_slug = $1',
        [branchSlug]
      );
      if (old.rows.length > 0 && old.rows[0].agb_pdf_path) {
        const oldPath = path.join(process.cwd(), 'aufmass-pdfs', 'branch-uploads', branchSlug, old.rows[0].agb_pdf_path);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      // Default: NO pages selected — client-side auto-detect or manual picker decides.
      // Selecting all pages by default silently includes covers/marketing — worse than empty.
      const defaultPages = [];

      // Upsert (branch_terms row may not exist yet)
      const exists = await pool.query('SELECT branch_slug FROM aufmass_branch_terms WHERE branch_slug = $1', [branchSlug]);
      if (exists.rows.length === 0) {
        await pool.query(
          `INSERT INTO aufmass_branch_terms (branch_slug, content, agb_pdf_path, agb_pdf_pages, updated_at)
           VALUES ($1, '', $2, $3::jsonb, NOW())`,
          [branchSlug, req.file.filename, JSON.stringify(defaultPages)]
        );
      } else {
        await pool.query(
          `UPDATE aufmass_branch_terms SET agb_pdf_path = $1, agb_pdf_pages = $2::jsonb, updated_at = NOW()
           WHERE branch_slug = $3`,
          [req.file.filename, JSON.stringify(defaultPages), branchSlug]
        );
      }

      res.json({ file_path: req.file.filename, page_count: pageCount, selected_pages: defaultPages });
    } catch (err) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      console.error('Error saving AGB PDF:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

app.put('/api/branch/agb-pdf/pages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const { selected_pages } = req.body;
    if (!Array.isArray(selected_pages) || selected_pages.some(p => typeof p !== 'number' || p < 1)) {
      return res.status(400).json({ error: 'Ungültige Seitenauswahl' });
    }
    await pool.query(
      `UPDATE aufmass_branch_terms SET agb_pdf_pages = $1::jsonb, updated_at = NOW()
       WHERE branch_slug = $2`,
      [JSON.stringify(selected_pages), branchSlug]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating AGB PDF pages:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.delete('/api/branch/agb-pdf', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const branchSlug = req.branchId || 'koblenz';
    const existing = await pool.query(
      'SELECT agb_pdf_path FROM aufmass_branch_terms WHERE branch_slug = $1',
      [branchSlug]
    );
    if (existing.rows.length > 0 && existing.rows[0].agb_pdf_path) {
      const filePath = path.join(process.cwd(), 'aufmass-pdfs', 'branch-uploads', branchSlug, existing.rows[0].agb_pdf_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await pool.query(
      `UPDATE aufmass_branch_terms SET agb_pdf_path = NULL, agb_pdf_pages = NULL, updated_at = NOW()
       WHERE branch_slug = $1`,
      [branchSlug]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting AGB PDF:', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// GET — serve branch-uploaded PDF (auth required, branch-isolated)
app.get('/api/branch-pdf/:filename', authenticateToken, (req, res) => {
  const filename = req.params.filename;
  if (!/^[\w\-.]+\.pdf$/i.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const branchSlug = req.branchId || 'koblenz';
  const filePath = path.join(process.cwd(), 'aufmass-pdfs', 'branch-uploads', branchSlug, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(filePath);
});

// === LEAD PDF CACHE (frozen-on-first-render for legal stability) ===

const cachedPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.get('/api/lead-pdf-cache/:leadId', authenticateToken, async (req, res) => {
  try {
    const leadId = parseInt(req.params.leadId);
    const angebotId = req.query.angebot_id ? parseInt(req.query.angebot_id) : null;
    const documentType = req.query.document_type || 'angebot';

    // Branch isolation: only return if lead belongs to this branch
    const branchCheck = req.branchId
      ? await pool.query('SELECT id FROM aufmass_leads WHERE id = $1 AND branch_id = $2', [leadId, req.branchId])
      : await pool.query('SELECT id FROM aufmass_leads WHERE id = $1', [leadId]);
    if (branchCheck.rows.length === 0) return res.status(404).json({ error: 'Lead not found' });

    const result = await pool.query(
      `SELECT file_path, created_at FROM aufmass_lead_pdf_cache
       WHERE lead_id = $1 AND (angebot_id = $2 OR ($2 IS NULL AND angebot_id IS NULL))
         AND document_type = $3`,
      [leadId, angebotId, documentType]
    );
    if (result.rows.length === 0) return res.json(null);

    const filePath = path.join(process.cwd(), 'aufmass-pdfs', 'cached', result.rows[0].file_path);
    if (!fs.existsSync(filePath)) {
      // Cache record exists but file missing — clean up the orphan
      await pool.query(
        `DELETE FROM aufmass_lead_pdf_cache WHERE lead_id = $1
         AND (angebot_id = $2 OR ($2 IS NULL AND angebot_id IS NULL)) AND document_type = $3`,
        [leadId, angebotId, documentType]
      );
      return res.json(null);
    }
    res.sendFile(filePath);
  } catch (err) {
    console.error('Error fetching cached PDF:', err);
    res.status(500).json({ error: 'Failed to fetch cached PDF' });
  }
});

app.post('/api/lead-pdf-cache/:leadId', authenticateToken, (req, res) => {
  cachedPdfUpload.single('pdf')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const leadId = parseInt(req.params.leadId);
      const angebotId = req.body.angebot_id ? parseInt(req.body.angebot_id) : null;
      const documentType = req.body.document_type || 'angebot';

      // Branch isolation
      const branchCheck = req.branchId
        ? await pool.query('SELECT id FROM aufmass_leads WHERE id = $1 AND branch_id = $2', [leadId, req.branchId])
        : await pool.query('SELECT id FROM aufmass_leads WHERE id = $1', [leadId]);
      if (branchCheck.rows.length === 0) return res.status(404).json({ error: 'Lead not found' });

      const dir = path.join(process.cwd(), 'aufmass-pdfs', 'cached');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const filename = `lead${leadId}_ang${angebotId || 'main'}_${documentType}_${Date.now()}.pdf`;
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, req.file.buffer);

      // Remove old cache file if exists, then upsert
      const old = await pool.query(
        `SELECT file_path FROM aufmass_lead_pdf_cache WHERE lead_id = $1
         AND (angebot_id = $2 OR ($2 IS NULL AND angebot_id IS NULL)) AND document_type = $3`,
        [leadId, angebotId, documentType]
      );
      if (old.rows.length > 0) {
        const oldPath = path.join(dir, old.rows[0].file_path);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        await pool.query(
          `UPDATE aufmass_lead_pdf_cache SET file_path = $1, created_at = NOW()
           WHERE lead_id = $2 AND (angebot_id = $3 OR ($3 IS NULL AND angebot_id IS NULL))
             AND document_type = $4`,
          [filename, leadId, angebotId, documentType]
        );
      } else {
        await pool.query(
          `INSERT INTO aufmass_lead_pdf_cache (lead_id, angebot_id, document_type, file_path, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [leadId, angebotId, documentType, filename]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error('Error caching PDF:', err);
      res.status(500).json({ error: 'Cache failed' });
    }
  });
});

// Internal helper: invalidate cache for a lead (called after lead/angebot edits)
async function invalidateLeadPdfCache(leadId, angebotId = null) {
  try {
    const dir = path.join(process.cwd(), 'aufmass-pdfs', 'cached');
    let toDelete;
    if (angebotId !== null) {
      toDelete = await pool.query(
        `SELECT file_path FROM aufmass_lead_pdf_cache WHERE lead_id = $1 AND angebot_id = $2`,
        [leadId, angebotId]
      );
      await pool.query(`DELETE FROM aufmass_lead_pdf_cache WHERE lead_id = $1 AND angebot_id = $2`, [leadId, angebotId]);
    } else {
      toDelete = await pool.query(`SELECT file_path FROM aufmass_lead_pdf_cache WHERE lead_id = $1`, [leadId]);
      await pool.query(`DELETE FROM aufmass_lead_pdf_cache WHERE lead_id = $1`, [leadId]);
    }
    for (const row of toDelete.rows) {
      const p = path.join(dir, row.file_path);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } catch (err) {
    console.error('Error invalidating PDF cache:', err);
  }
}

// ============ BRANCH USAGE DASHBOARD (super admin only) ============

app.get('/api/admin/branch-stats', authenticateToken, requireAdmin, async (req, res) => {
  // Only accessible from admin domain (branchId = null)
  if (req.branchId) {
    return res.status(403).json({ error: 'Nur über die Admin-Domain verfügbar' });
  }

  try {
    const { from, to } = req.query;
    const dateFrom = from || '2020-01-01';
    const dateTo = to || '2099-12-31';

    // 1. All branches
    const branchesResult = await pool.query('SELECT slug, name FROM aufmass_branches ORDER BY name');
    const branches = branchesResult.rows;

    // 2. Aufmaß counts per branch
    const aufmassResult = await pool.query(`
      SELECT branch_id, COUNT(*) as count
      FROM aufmass_forms
      WHERE status != 'papierkorb'
        AND created_at >= $1 AND created_at <= ($2::date + interval '1 day')
      GROUP BY branch_id
    `, [dateFrom, dateTo]);
    const aufmassMap = {};
    for (const r of aufmassResult.rows) aufmassMap[r.branch_id] = parseInt(r.count);

    // 3. Angebot counts + revenue per branch
    const angebotResult = await pool.query(`
      SELECT l.branch_id,
             COUNT(DISTINCT la.id) as angebot_count,
             COALESCE(MAX(la.total_price), 0) as highest_invoice,
             COALESCE(SUM(la.total_price), 0) as total_revenue
      FROM aufmass_lead_angebote la
      JOIN aufmass_leads l ON la.lead_id = l.id
      WHERE la.created_at >= $1 AND la.created_at <= ($2::date + interval '1 day')
      GROUP BY l.branch_id
    `, [dateFrom, dateTo]);
    const angebotMap = {};
    for (const r of angebotResult.rows) {
      angebotMap[r.branch_id] = {
        count: parseInt(r.angebot_count),
        highest: parseFloat(r.highest_invoice),
        total: parseFloat(r.total_revenue)
      };
    }

    // 4. User breakdown per branch
    const userAufmassResult = await pool.query(`
      SELECT u.id, u.name, u.branch_id, COUNT(f.id) as aufmass_count
      FROM aufmass_users u
      LEFT JOIN aufmass_forms f ON f.created_by = u.id
        AND f.status != 'papierkorb'
        AND f.created_at >= $1 AND f.created_at <= ($2::date + interval '1 day')
      WHERE u.is_active = true
      GROUP BY u.id, u.name, u.branch_id
      ORDER BY u.branch_id, aufmass_count DESC
    `, [dateFrom, dateTo]);

    const userAngebotResult = await pool.query(`
      SELECT l.created_by as user_id, COUNT(DISTINCT la.id) as angebot_count
      FROM aufmass_lead_angebote la
      JOIN aufmass_leads l ON la.lead_id = l.id
      WHERE la.created_at >= $1 AND la.created_at <= ($2::date + interval '1 day')
      GROUP BY l.created_by
    `, [dateFrom, dateTo]);
    const userAngebotMap = {};
    for (const r of userAngebotResult.rows) userAngebotMap[r.user_id] = parseInt(r.angebot_count);

    // Build per-branch user lists
    const usersByBranch = {};
    for (const u of userAufmassResult.rows) {
      const bid = u.branch_id || '_global';
      if (!usersByBranch[bid]) usersByBranch[bid] = [];
      usersByBranch[bid].push({
        id: u.id,
        name: u.name,
        aufmass_count: parseInt(u.aufmass_count),
        angebot_count: userAngebotMap[u.id] || 0
      });
    }

    // 5. Assemble response
    const branchStats = branches.map(b => ({
      slug: b.slug,
      name: b.name,
      aufmass_count: aufmassMap[b.slug] || 0,
      angebot_count: angebotMap[b.slug]?.count || 0,
      highest_invoice: angebotMap[b.slug]?.highest || 0,
      total_revenue: angebotMap[b.slug]?.total || 0,
      users: (usersByBranch[b.slug] || []).filter(u => u.aufmass_count > 0 || u.angebot_count > 0)
    }));

    // Sort by total activity descending
    branchStats.sort((a, b) => (b.aufmass_count + b.angebot_count) - (a.aufmass_count + a.angebot_count));

    const totals = {
      aufmass_count: branchStats.reduce((s, b) => s + b.aufmass_count, 0),
      angebot_count: branchStats.reduce((s, b) => s + b.angebot_count, 0),
      highest_invoice: Math.max(0, ...branchStats.map(b => b.highest_invoice)),
      total_revenue: branchStats.reduce((s, b) => s + b.total_revenue, 0)
    };

    res.json({ branches: branchStats, totals });
  } catch (err) {
    console.error('Branch stats error:', err);
    res.status(500).json({ error: 'Failed to fetch branch stats' });
  }
});

// GET /api/admin/branch-details - Conversion funnel, trends, pipeline, activity
app.get('/api/admin/branch-details', authenticateToken, requireAdmin, async (req, res) => {
  if (req.branchId) {
    return res.status(403).json({ error: 'Nur über die Admin-Domain verfügbar' });
  }

  try {
    const { from, to } = req.query;
    const dateFrom = from || '2020-01-01';
    const dateTo = to || '2099-12-31';

    // 1. Conversion funnel per branch (Aufmaß statuses)
    const funnelResult = await pool.query(`
      SELECT branch_id,
        COUNT(*) FILTER (WHERE status NOT IN ('papierkorb','entwurf')) as total_aufmass,
        COUNT(*) FILTER (WHERE status IN ('angebot_versendet','auftrag_erteilt','bauantrag','anzahlung','bestellt','montage_geplant','montage_gestartet','abnahme','reklamation_eingegangen','reklamation_bestellt')) as has_angebot,
        COUNT(*) FILTER (WHERE status IN ('auftrag_erteilt','bauantrag','anzahlung','bestellt','montage_geplant','montage_gestartet','abnahme')) as has_auftrag,
        COUNT(*) FILTER (WHERE status IN ('abnahme')) as completed
      FROM aufmass_forms
      WHERE created_at >= $1 AND created_at <= ($2::date + interval '1 day')
      GROUP BY branch_id
    `, [dateFrom, dateTo]);

    const funnel = {};
    for (const r of funnelResult.rows) {
      funnel[r.branch_id] = {
        aufmass: parseInt(r.total_aufmass),
        angebot: parseInt(r.has_angebot),
        auftrag: parseInt(r.has_auftrag),
        completed: parseInt(r.completed)
      };
    }

    // 2. Monthly trend (last 12 months)
    const trendResult = await pool.query(`
      SELECT branch_id,
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as aufmass_count
      FROM aufmass_forms
      WHERE status != 'papierkorb'
        AND created_at >= (CURRENT_DATE - interval '12 months')
      GROUP BY branch_id, TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month
    `);

    const trends = {};
    for (const r of trendResult.rows) {
      if (!trends[r.branch_id]) trends[r.branch_id] = {};
      trends[r.branch_id][r.month] = parseInt(r.aufmass_count);
    }

    // Angebot trend
    const angebotTrendResult = await pool.query(`
      SELECT l.branch_id,
        TO_CHAR(la.created_at, 'YYYY-MM') as month,
        COUNT(*) as count
      FROM aufmass_lead_angebote la
      JOIN aufmass_leads l ON la.lead_id = l.id
      WHERE la.created_at >= (CURRENT_DATE - interval '12 months')
      GROUP BY l.branch_id, TO_CHAR(la.created_at, 'YYYY-MM')
      ORDER BY month
    `);

    const angebotTrends = {};
    for (const r of angebotTrendResult.rows) {
      if (!angebotTrends[r.branch_id]) angebotTrends[r.branch_id] = {};
      angebotTrends[r.branch_id][r.month] = parseInt(r.count);
    }

    // 3. Status pipeline (all branches combined)
    const pipelineResult = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM aufmass_forms
      WHERE status NOT IN ('papierkorb','entwurf')
        AND created_at >= $1 AND created_at <= ($2::date + interval '1 day')
      GROUP BY status
      ORDER BY count DESC
    `, [dateFrom, dateTo]);

    const pipeline = pipelineResult.rows.map(r => ({ status: r.status, count: parseInt(r.count) }));

    // 4. Recent activity (last 20 events)
    const activityResult = await pool.query(`
      (
        SELECT 'aufmass' as type, f.id, f.branch_id,
          COALESCE(f.kunde_vorname,'') || ' ' || COALESCE(f.kunde_nachname,'') as detail,
          u.name as user_name, f.created_at as event_time,
          f.status
        FROM aufmass_forms f
        LEFT JOIN aufmass_users u ON f.created_by = u.id
        WHERE f.status != 'papierkorb'
        ORDER BY f.created_at DESC LIMIT 10
      )
      UNION ALL
      (
        SELECT 'angebot' as type, la.id, l.branch_id,
          COALESCE(l.customer_firstname,'') || ' ' || COALESCE(l.customer_lastname,'') as detail,
          u.name as user_name, la.created_at as event_time,
          la.angebot_nummer as status
        FROM aufmass_lead_angebote la
        JOIN aufmass_leads l ON la.lead_id = l.id
        LEFT JOIN aufmass_users u ON l.created_by = u.id
        ORDER BY la.created_at DESC LIMIT 10
      )
      ORDER BY event_time DESC LIMIT 20
    `);

    // 5. Processing speed: avg days from form creation to angebot_versendet
    const speedResult = await pool.query(`
      SELECT f.branch_id,
        AVG(EXTRACT(DAY FROM (sh.changed_at - f.created_at))) as avg_days
      FROM aufmass_forms f
      JOIN aufmass_status_history sh ON sh.form_id = f.id AND sh.status = 'angebot_versendet'
      WHERE f.created_at >= $1 AND f.created_at <= ($2::date + interval '1 day')
      GROUP BY f.branch_id
    `, [dateFrom, dateTo]);

    const speed = {};
    for (const r of speedResult.rows) {
      speed[r.branch_id] = Math.round(parseFloat(r.avg_days) || 0);
    }

    // Build 12-month labels
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }

    res.json({ funnel, trends, angebotTrends, months, pipeline, activity: activityResult.rows, speed });
  } catch (err) {
    console.error('Branch details error:', err);
    res.status(500).json({ error: 'Failed to fetch branch details' });
  }
});

// Start server
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
