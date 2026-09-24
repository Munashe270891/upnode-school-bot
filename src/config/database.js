const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
  process.exit(-1);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schools (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        tier TEXT,
        db_type TEXT CHECK (db_type IN ('sheets','hosted')) DEFAULT 'hosted',
        whatsapp_phone_id TEXT,
        company_domain TEXT,
        expiry_date TIMESTAMP,
        media_used_this_month INTEGER DEFAULT 0,
        queries_used_this_month INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
        phone TEXT,
        role TEXT CHECK (role IN ('admin','teacher','parent','student','stranger')) DEFAULT 'parent',
        name TEXT,
        classes TEXT[]
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
        name TEXT,
        class TEXT,
        age INTEGER,
        address TEXT,
        parent_name TEXT,
        parent_phone TEXT,
        student_phone TEXT,
        textbooks_borrowed JSONB DEFAULT '[]'::jsonb,
        uniform_status TEXT,
        fees_balance NUMERIC(12,2) DEFAULT 0,
        other_charges JSONB DEFAULT '{}'::jsonb,
        report_term1 TEXT,
        report_term2 TEXT,
        report_term3 TEXT,
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS records (
        id SERIAL PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
        teacher_id INTEGER REFERENCES users(id),
        type TEXT CHECK (type IN ('homework','notice','fees_statement','general')),
        target_classes TEXT[],
        content TEXT,
        media_url TEXT,
        visibility TEXT CHECK (visibility IN ('public_class','private_admin','public_all')) DEFAULT 'public_class',
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL,
        method TEXT CHECK (method IN ('paynow','ecocash_manual')),
        status TEXT CHECK (status IN ('pending','paid','rejected')) DEFAULT 'pending',
        paynow_reference TEXT,
        created_at TIMESTAMP DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        phone TEXT,
        school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE,
        current_state TEXT,
        meta JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP DEFAULT now()
      );
    `);

    // indexes to speed up multi-tenant queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_school ON users(school_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_records_school ON records(school_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_payments_school ON payments(school_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone);`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('initDb error', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, initDb };
