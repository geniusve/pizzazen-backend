const router = require('express').Router();
const { body, param } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { requireGestioneMenu } = require('../../middleware/auth');
const { ok, created, notFound, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /pizzeria/ingredienti ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `SELECT id, ingrediente_default_id, descrizione,
              icona_url, prezzo, nota, allergeni, attivo
       FROM ingredienti
       WHERE pizzeria_id = $1
       ORDER BY descrizione ASC`,
      [pizzeriaId]
    );
    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET ingredienti pizzeria:', err);
    return serverError(res);
  }
});

// ─── POST /pizzeria/ingredienti ───────────────────────────────
// Aggiunge ingrediente personalizzato (non da default)
router.post('/', requireGestioneMenu, [
  body('descrizione').notEmpty().trim().withMessage('Descrizione obbligatoria'),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('allergeni').optional().isArray(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { descrizione, icona_url, prezzo = 0, nota, allergeni = [] } = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `INSERT INTO ingredienti
         (pizzeria_id, descrizione, icona_url, prezzo, nota, allergeni)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [pizzeriaId, descrizione, icona_url || null, prezzo, nota || null, allergeni]
    );
    return created(res, result.rows[0], 'Ingrediente aggiunto');
  } catch (err) {
    logger.error('POST ingredienti pizzeria:', err);
    return serverError(res);
  }
});

// ─── PUT /pizzeria/ingredienti/:id ───────────────────────────
router.put('/:id', requireGestioneMenu, [
  param('id').isInt({ min: 1 }).toInt(),
  body('descrizione').optional().notEmpty().trim(),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('allergeni').optional().isArray(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { descrizione, icona_url, prezzo, nota, allergeni, attivo } = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `UPDATE ingredienti SET
         descrizione = COALESCE($1, descrizione),
         icona_url   = COALESCE($2, icona_url),
         prezzo      = COALESCE($3, prezzo),
         nota        = COALESCE($4, nota),
         allergeni   = COALESCE($5, allergeni),
         attivo      = COALESCE($6, attivo)
       WHERE id = $7 AND pizzeria_id = $8
       RETURNING *`,
      [descrizione, icona_url, prezzo, nota, allergeni, attivo,
       req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Ingrediente non trovato');
    return ok(res, result.rows[0], 'Ingrediente aggiornato');
  } catch (err) {
    logger.error('PUT ingredienti pizzeria:', err);
    return serverError(res);
  }
});

// ─── DELETE /pizzeria/ingredienti/:id ────────────────────────
router.delete('/:id', requireGestioneMenu, [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `UPDATE ingredienti SET attivo = false
       WHERE id = $1 AND pizzeria_id = $2
       RETURNING id, descrizione`,
      [req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Ingrediente non trovato');
    return ok(res, result.rows[0], 'Ingrediente disattivato');
  } catch (err) {
    logger.error('DELETE ingredienti pizzeria:', err);
    return serverError(res);
  }
});

module.exports = router;
