const router = require('express').Router({ mergeParams: true });
const bcrypt = require('bcrypt');
const { body, param } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { ok, created, notFound, conflict, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /admin/pizzerie/:pizzeriaId/utenti ───────────────────
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, username, nome, tipo, email_recupero,
              puo_gestire_menu, puo_gestire_clienti, puo_vedere_stats,
              attivo, ultimo_accesso, created_at
       FROM utenti
       WHERE pizzeria_id = $1
       ORDER BY tipo, username`,
      [req.params.pizzeriaId]
    );
    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET utenti pizzeria:', err);
    return serverError(res);
  }
});

// ─── POST /admin/pizzerie/:pizzeriaId/utenti ──────────────────
router.post('/', [
  body('username').notEmpty().trim().withMessage('Username obbligatorio'),
  body('password').isLength({ min: 6 }).withMessage('Password min 6 caratteri'),
  body('tipo').isIn(['admin_pizzeria', 'cassiere', 'visualizzatore'])
    .withMessage('Tipo non valido'),
  body('email_recupero').optional({ nullable: true }).isEmail(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.params.pizzeriaId;
    const { username, password, tipo, nome, email_recupero,
            puo_gestire_menu, puo_gestire_clienti, puo_vedere_stats } = req.body;

    // Controlla username duplicato nella stessa pizzeria
    const dup = await db.query(
      'SELECT id FROM utenti WHERE pizzeria_id = $1 AND username = $2',
      [pizzeriaId, username]
    );
    if (dup.rows[0]) {
      return conflict(res, 'USERNAME_DUPLICATO',
        `Username "${username}" già in uso in questa pizzeria`);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // I permessi variano in base al tipo
    const isAdmin = tipo === 'admin_pizzeria';
    const result = await db.query(
      `INSERT INTO utenti (
        pizzeria_id, username, password_hash, email_recupero,
        nome, tipo,
        puo_gestire_menu, puo_gestire_clienti, puo_vedere_stats
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, username, nome, tipo`,
      [
        pizzeriaId, username, passwordHash, email_recupero || null,
        nome || username, tipo,
        puo_gestire_menu ?? isAdmin,
        puo_gestire_clienti ?? true,
        puo_vedere_stats ?? isAdmin
      ]
    );

    return created(res, result.rows[0], 'Utente creato');
  } catch (err) {
    logger.error('POST utenti pizzeria:', err);
    return serverError(res);
  }
});

// ─── PUT /admin/pizzerie/:pizzeriaId/utenti/:id ───────────────
router.put('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  body('tipo').optional().isIn(['admin_pizzeria', 'cassiere', 'visualizzatore']),
  validate
], async (req, res) => {
  try {
    const { nome, tipo, email_recupero,
            puo_gestire_menu, puo_gestire_clienti, puo_vedere_stats } = req.body;

    const result = await db.query(
      `UPDATE utenti SET
        nome                = COALESCE($1, nome),
        tipo                = COALESCE($2, tipo),
        email_recupero      = COALESCE($3, email_recupero),
        puo_gestire_menu    = COALESCE($4, puo_gestire_menu),
        puo_gestire_clienti = COALESCE($5, puo_gestire_clienti),
        puo_vedere_stats    = COALESCE($6, puo_vedere_stats)
       WHERE id = $7 AND pizzeria_id = $8
       RETURNING id, username, nome, tipo`,
      [nome, tipo, email_recupero,
       puo_gestire_menu, puo_gestire_clienti, puo_vedere_stats,
       req.params.id, req.params.pizzeriaId]
    );

    if (!result.rows[0]) return notFound(res, 'Utente non trovato');
    return ok(res, result.rows[0], 'Utente aggiornato');
  } catch (err) {
    logger.error('PUT utenti pizzeria:', err);
    return serverError(res);
  }
});

// ─── POST /admin/pizzerie/:pizzeriaId/utenti/:id/reset-password
router.post('/:id/reset-password', [
  param('id').isInt({ min: 1 }).toInt(),
  body('nuova_password').isLength({ min: 6 }).withMessage('Password min 6 caratteri'),
  validate
], async (req, res) => {
  try {
    const hash = await bcrypt.hash(req.body.nuova_password, 12);
    const result = await db.query(
      `UPDATE utenti SET password_hash = $1
       WHERE id = $2 AND pizzeria_id = $3
       RETURNING id, username`,
      [hash, req.params.id, req.params.pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Utente non trovato');
    return ok(res, result.rows[0], 'Password aggiornata');
  } catch (err) {
    logger.error('Reset password utente:', err);
    return serverError(res);
  }
});

// ─── DELETE /admin/pizzerie/:pizzeriaId/utenti/:id ────────────
router.delete('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE utenti SET attivo = false
       WHERE id = $1 AND pizzeria_id = $2
       RETURNING id, username`,
      [req.params.id, req.params.pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Utente non trovato');
    return ok(res, result.rows[0], 'Utente disattivato');
  } catch (err) {
    logger.error('DELETE utente pizzeria:', err);
    return serverError(res);
  }
});

module.exports = router;
