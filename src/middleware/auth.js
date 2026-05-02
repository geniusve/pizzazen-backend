const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { unauthorized, forbidden } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * Verifica il JWT e aggiunge req.utente alla request.
 * Usato su tutte le route protette.
 */
const authMiddleware = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return unauthorized(res, 'Token mancante');
    }

    const token = header.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return unauthorized(res, 'Token scaduto');
      }
      return unauthorized(res, 'Token non valido');
    }

    // Verifica che l'utente esista ancora e sia attivo
    if (payload.tipo === 'admin_globale') {
      const result = await query(
        'SELECT id, username, nome FROM admin_globali WHERE id = $1 AND attivo = true',
        [payload.id]
      );
      if (!result.rows[0]) return unauthorized(res, 'Utente non trovato');

      req.utente = {
        id:          result.rows[0].id,
        username:    result.rows[0].username,
        nome:        result.rows[0].nome,
        tipo:        'admin_globale',
        pizzeriaId:  null,
        isAdmin:     true,
      };
    } else {
      const result = await query(
        `SELECT u.id, u.username, u.nome, u.tipo, u.pizzeria_id,
                u.puo_gestire_menu, u.puo_gestire_clienti, u.puo_vedere_stats,
                p.nome AS pizzeria_nome, p.attiva AS pizzeria_attiva
         FROM utenti u
         JOIN pizzerie p ON p.id = u.pizzeria_id
         WHERE u.id = $1 AND u.attivo = true`,
        [payload.id]
      );
      if (!result.rows[0]) return unauthorized(res, 'Utente non trovato');
      if (!result.rows[0].pizzeria_attiva) {
        return forbidden(res, 'Pizzeria disattivata');
      }

      const u = result.rows[0];
      req.utente = {
        id:                 u.id,
        username:           u.username,
        nome:               u.nome,
        tipo:               u.tipo,
        pizzeriaId:         u.pizzeria_id,
        pizzeriaNome:       u.pizzeria_nome,
        puoGestireMenu:     u.puo_gestire_menu,
        puoGestireClienti:  u.puo_gestire_clienti,
        puoVedereStats:     u.puo_vedere_stats,
        isAdmin:            false,
      };
    }

    next();
  } catch (err) {
    logger.error('Errore authMiddleware:', err);
    return unauthorized(res, 'Errore autenticazione');
  }
};

/**
 * Richiede che l'utente sia admin globale
 */
const requireAdmin = (req, res, next) => {
  if (!req.utente?.isAdmin) {
    return forbidden(res, 'Richiede privilegi di amministratore globale');
  }
  next();
};

/**
 * Richiede che l'utente sia admin della sua pizzeria
 */
const requireAdminPizzeria = (req, res, next) => {
  if (req.utente?.isAdmin) return next(); // admin globale bypassa
  if (req.utente?.tipo !== 'admin_pizzeria') {
    return forbidden(res, 'Richiede privilegi di amministratore pizzeria');
  }
  next();
};

/**
 * Richiede il permesso specifico di gestire il menu
 */
const requireGestioneMenu = (req, res, next) => {
  if (req.utente?.isAdmin) return next();
  if (!req.utente?.puoGestireMenu && req.utente?.tipo !== 'admin_pizzeria') {
    return forbidden(res, 'Non hai il permesso di gestire il menu');
  }
  next();
};

/**
 * Richiede il permesso di vedere le statistiche
 */
const requireStats = (req, res, next) => {
  if (req.utente?.isAdmin) return next();
  if (!req.utente?.puoVedereStats && req.utente?.tipo !== 'admin_pizzeria') {
    return forbidden(res, 'Non hai il permesso di vedere le statistiche');
  }
  next();
};

module.exports = {
  authMiddleware,
  requireAdmin,
  requireAdminPizzeria,
  requireGestioneMenu,
  requireStats,
};
