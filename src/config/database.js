const { Pool, types } = require('pg');
const logger = require('../utils/logger');

// Fix timezone: pg restituisce date come stringhe senza conversione UTC
types.setTypeParser(1082, val => val);   // DATE → 'YYYY-MM-DD'
types.setTypeParser(1114, val => val);   // TIMESTAMP
types.setTypeParser(1184, val => val);   // TIMESTAMPTZ

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'pizzazen_db',
  user:     process.env.DB_USER     || 'pizzazen',
  password: process.env.DB_PASSWORD,
  max:      20,
  idleTimeoutMillis:    30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Errore pool PostgreSQL:', err);
});

/**
 * Esegue una query normale
 */
const query = (text, params) => pool.query(text, params);

/**
 * Esegue una query con Row Level Security attiva per la pizzeria.
 * USARE SEMPRE per query su tabelle protette da RLS.
 */
const queryRLS = async (pizzeriaId, text, params) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SET LOCAL app.pizzeria_id = '${parseInt(pizzeriaId)}'`
    );
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Restituisce un client con transazione e RLS già impostata.
 * Usare per operazioni multiple che devono essere atomiche.
 * 
 * Esempio:
 *   const client = await getClientRLS(pizzeriaId);
 *   try {
 *     await client.query('INSERT INTO ordini ...');
 *     await client.query('UPDATE slot_disponibili ...');
 *     await client.commit();
 *   } catch(e) {
 *     await client.rollback();
 *   } finally {
 *     client.release();
 *   }
 */
const getClientRLS = async (pizzeriaId) => {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(`SET LOCAL app.pizzeria_id = '${parseInt(pizzeriaId)}'`);
  
  // Aggiungi metodi helper al client
  client.commit   = () => client.query('COMMIT');
  client.rollback = () => client.query('ROLLBACK');
  
  return client;
};

/**
 * Testa la connessione al database.
 * Chiamata all'avvio dell'applicazione.
 */
const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW() as ora, version() as ver');
    logger.info(`✅ PostgreSQL connesso — ${res.rows[0].ora}`);
    return true;
  } catch (err) {
    logger.error('❌ Impossibile connettersi a PostgreSQL:', err.message);
    return false;
  }
};

module.exports = { query, queryRLS, getClientRLS, testConnection, pool };
