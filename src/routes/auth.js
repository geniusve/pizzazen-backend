const router  = require('express').Router();
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { body } = require('express-validator');
const { query } = require('../config/database');
const { validate } = require('../middleware/validate');
const { ok, unauthorized, serverError } = require('../utils/response');
const logger = require('../utils/logger');

const signToken = (payload) => jwt.sign(
  payload,
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
);

// ─── POST /auth/login ─────────────────────────────────────────
// Login per utenti delle pizzerie
// pizzeria_slug è opzionale — se non fornito cerca per username globalmente
router.post('/login', [
  body('username').notEmpty().withMessage('Username obbligatorio'),
  body('password').notEmpty().withMessage('Password obbligatoria'),
  validate
], async (req, res) => {
  try {
    const { username, password, pizzeria_slug } = req.body;

    // Se fornito lo slug usa quello, altrimenti cerca per username
    let queryText, queryParams;

    if (pizzeria_slug) {
      queryText = `SELECT u.id, u.username, u.password_hash, u.nome, u.tipo,
              u.pizzeria_id, u.attivo,
              u.puo_gestire_menu, u.puo_gestire_clienti, u.puo_vedere_stats,
              p.nome AS pizzeria_nome, p.attiva AS pizzeria_attiva, p.slug
       FROM utenti u
       JOIN pizzerie p ON p.id = u.pizzeria_id
       WHERE u.username = $1 AND p.slug = $2`;
      queryParams = [username, pizzeria_slug];
    } else {
      // Cerca username in tutte le pizzerie
      // Se lo username esiste in più pizzerie prende la prima attiva
      queryText = `SELECT u.id, u.username, u.password_hash, u.nome, u.tipo,
              u.pizzeria_id, u.attivo,
              u.puo_gestire_menu, u.puo_gestire_clienti, u.puo_vedere_stats,
              p.nome AS pizzeria_nome, p.attiva AS pizzeria_attiva, p.slug
       FROM utenti u
       JOIN pizzerie p ON p.id = u.pizzeria_id
       WHERE u.username = $1 AND u.attivo = true AND p.attiva = true
       ORDER BY u.id ASC
       LIMIT 1`;
      queryParams = [username];
    }

    const result = await query(queryText, queryParams);
    const utente = result.rows[0];

    if (!utente) return unauthorized(res, 'Credenziali non valide');
    if (!utente.attivo) return unauthorized(res, 'Account disabilitato');
    if (!utente.pizzeria_attiva) return unauthorized(res, 'Pizzeria disabilitata');

    const passwordOk = await bcrypt.compare(password, utente.password_hash);
    if (!passwordOk) return unauthorized(res, 'Credenziali non valide');

    // Aggiorna ultimo accesso
    await query('UPDATE utenti SET ultimo_accesso = NOW() WHERE id = $1', [utente.id]);

    const token = signToken({
      id:         utente.id,
      tipo:       utente.tipo,
      pizzeriaId: utente.pizzeria_id,
    });

    return ok(res, {
      token,
      utente: {
        id:                 utente.id,
        username:           utente.username,
        nome:               utente.nome,
        tipo:               utente.tipo,
        pizzeriaId:         utente.pizzeria_id,
        pizzeriaNome:       utente.pizzeria_nome,
        puoGestireMenu:     utente.puo_gestire_menu,
        puoGestireClienti:  utente.puo_gestire_clienti,
        puoVedereStats:     utente.puo_vedere_stats,
      }
    });
  } catch (err) {
    logger.error('Errore login:', err);
    return serverError(res);
  }
});

// ─── POST /auth/admin/login ───────────────────────────────────
// Login admin globale
router.post('/admin/login', [
  body('username').notEmpty(),
  body('password').notEmpty(),
  validate
], async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await query(
      'SELECT * FROM admin_globali WHERE username = $1 AND attivo = true',
      [username]
    );

    const admin = result.rows[0];
    if (!admin) return unauthorized(res, 'Credenziali non valide');

    const ok2 = await bcrypt.compare(password, admin.password_hash);
    if (!ok2) return unauthorized(res, 'Credenziali non valide');

    const token = signToken({ id: admin.id, tipo: 'admin_globale' });

    return ok(res, {
      token,
      utente: { id: admin.id, username: admin.username, nome: admin.nome, tipo: 'admin_globale' }
    });
  } catch (err) {
    logger.error('Errore admin login:', err);
    return serverError(res);
  }
});

// ─── POST /auth/refresh ───────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return unauthorized(res);
    const oldToken = header.split(' ')[1];

    let payload;
    try {
      // Permette di rinnovare anche token scaduti (entro 1 giorno)
      payload = jwt.verify(oldToken, process.env.JWT_SECRET, {
        ignoreExpiration: true
      });
    } catch {
      return unauthorized(res, 'Token non valido');
    }

    // Verifica che il token sia scaduto da meno di 24h
    const expiredAt = payload.exp * 1000;
    if (Date.now() - expiredAt > 24 * 60 * 60 * 1000) {
      return unauthorized(res, 'Token troppo vecchio, effettua di nuovo il login');
    }

    const newToken = signToken({
      id:         payload.id,
      tipo:       payload.tipo,
      pizzeriaId: payload.pizzeriaId,
    });

    return ok(res, { token: newToken });
  } catch (err) {
    logger.error('Errore refresh:', err);
    return serverError(res);
  }
});

module.exports = router;
