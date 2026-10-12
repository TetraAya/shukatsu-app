const { Pool } = require('pg');

const isLocal = !process.env.DATABASE_URL ||
  /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Renderの内部URL以外（外部接続）ではSSLが必要
  ssl: isLocal || process.env.DATABASE_SSL === 'false'
    ? false
    : { rejectUnauthorized: false },
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      openai_key_enc TEXT,
      openai_model VARCHAR(50) DEFAULT 'gpt-4o-mini',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS companies (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      industry VARCHAR(50) DEFAULT '未設定',
      priority VARCHAR(20) DEFAULT '中',
      status VARCHAR(50) DEFAULT '未応募',
      url TEXT DEFAULT '',
      memo TEXT DEFAULT '',
      es_draft TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_companies_user ON companies(user_id);

    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL,           -- 'es' | 'interview' | 'test'
      title VARCHAR(200) DEFAULT '',
      due_date DATE NOT NULL,
      due_time VARCHAR(5) DEFAULT '',
      done BOOLEAN DEFAULT FALSE,
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, due_date);

    CREATE TABLE IF NOT EXISTS ai_results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      kind VARCHAR(20) NOT NULL,           -- 'research' | 'es_review'
      result TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_ai_company ON ai_results(company_id, kind, created_at DESC);

    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
  `);
}

module.exports = { pool, initDb };
