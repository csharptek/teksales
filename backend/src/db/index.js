const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Initialize all tables on startup
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Settings table (single row, upserted by key)
      CREATE TABLE IF NOT EXISTS settings (
        id          SERIAL PRIMARY KEY,
        key         VARCHAR(100) UNIQUE NOT NULL,
        value       TEXT,
        updated_at  TIMESTAMP DEFAULT NOW()
      );

      -- Leads / Proposals
      CREATE TABLE IF NOT EXISTS proposals (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name     VARCHAR(255),
        title           VARCHAR(500) NOT NULL,
        description     TEXT,
        questions       TEXT,
        figma_link      VARCHAR(500),
        budget          VARCHAR(100),
        analysis        JSONB,
        proposal_text   TEXT,
        status          VARCHAR(50) DEFAULT 'Draft',
        estimated_value NUMERIC(12,2),
        score           VARCHAR(50),
        risk_flag       VARCHAR(50),
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      );

      -- Portfolio projects
      CREATE TABLE IF NOT EXISTS portfolio (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title       VARCHAR(500) NOT NULL,
        description TEXT,
        tech_stack  VARCHAR(500),
        category    VARCHAR(100),
        link        VARCHAR(500),
        created_at  TIMESTAMP DEFAULT NOW()
      );

      -- Attachments
      CREATE TABLE IF NOT EXISTS attachments (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        proposal_id   UUID REFERENCES proposals(id) ON DELETE CASCADE,
        filename      VARCHAR(500),
        blob_url      VARCHAR(1000),
        uploaded_at   TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log("✅ Database tables initialized");
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
