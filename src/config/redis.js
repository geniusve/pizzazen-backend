const { createClient } = require('redis');
const logger = require('../utils/logger');

let client = null;

const getClient = async () => {
  if (client && client.isReady) return client;

  client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
    }
  });

  client.on('error',   (err) => logger.error('Redis error:', err.message));
  client.on('connect', ()    => logger.info('✅ Redis connesso'));
  client.on('reconnecting', () => logger.warn('Redis: riconnessione...'));

  await client.connect();
  return client;
};

/**
 * Salva un valore in Redis con scadenza opzionale
 * @param {string} key
 * @param {*} value  - verrà serializzato in JSON
 * @param {number} [ttlSeconds] - scadenza in secondi (opzionale)
 */
const set = async (key, value, ttlSeconds = null) => {
  const c = await getClient();
  const serialized = JSON.stringify(value);
  if (ttlSeconds) {
    await c.setEx(key, ttlSeconds, serialized);
  } else {
    await c.set(key, serialized);
  }
};

/**
 * Recupera un valore da Redis
 * @param {string} key
 * @returns {*} valore deserializzato, o null se non esiste
 */
const get = async (key) => {
  const c = await getClient();
  const val = await c.get(key);
  if (!val) return null;
  try { return JSON.parse(val); }
  catch { return val; }
};

/**
 * Elimina una chiave da Redis
 */
const del = async (key) => {
  const c = await getClient();
  await c.del(key);
};

/**
 * Pubblica un messaggio su un canale Redis
 * (per comunicazioni future tra processi)
 */
const publish = async (channel, message) => {
  const c = await getClient();
  await c.publish(channel, JSON.stringify(message));
};

module.exports = { getClient, set, get, del, publish };
