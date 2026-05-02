/**
 * Runner migrazioni database
 * Esegui con: npm run migrate
 * 
 * Applica le migrazioni in ordine numerico
 * e tiene traccia di quelle già eseguite.
 */
require('dotenv').config();
const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  const client = await pool.connect();

  // Crea tabella di tracking migrazioni se non esiste
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrazioni (
      id          SERIAL PRIMARY KEY,
      nome        VARCHAR(200) UNIQUE NOT NULL,
      eseguita_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Leggi tutti i file .sql nella cartella migrations/
  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort(); // ordine alfabetico = ordine numerico (001_, 002_...)

  for (const file of files) {
    // Controlla se già eseguita
    const { rows } = await client.query(
      'SELECT id FROM _migrazioni WHERE nome = $1',
      [file]
    );
    if (rows.length > 0) {
      console.log(`⏭  Già eseguita: ${file}`);
      continue;
    }

    // Esegui la migrazione
    console.log(`🔄 Eseguo: ${file}...`);
    const sql = fs.readFileSync(path.join(__dirname, file), 'utf8');

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO _migrazioni (nome) VALUES ($1)',
        [file]
      );
      await client.query('COMMIT');
      console.log(`✅ Completata: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`❌ Errore in ${file}:`, err.message);
      process.exit(1);
    }
  }

  client.release();
  await pool.end();
  console.log('\n✅ Tutte le migrazioni completate');
}

run().catch(err => {
  console.error('Errore runner migrazioni:', err);
  process.exit(1);
});
