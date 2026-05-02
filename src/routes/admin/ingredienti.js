const router = require('express').Router();
const { body, param } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { ok, created, notFound, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /admin/ingredienti ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, descrizione, icona_url, prezzo, nota, allergeni, attivo, created_at
       FROM ingredienti_default
       ORDER BY descrizione ASC`
    );
    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET admin/ingredienti:', err);
    return serverError(res);
  }
});

// ─── POST /admin/ingredienti ──────────────────────────────────
router.post('/', [
  body('descrizione').notEmpty().trim().withMessage('Descrizione obbligatoria'),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('allergeni').optional().isArray(),
  validate
], async (req, res) => {
  try {
    const { descrizione, icona_url, prezzo = 0, nota, allergeni = [] } = req.body;

    const result = await db.query(
      `INSERT INTO ingredienti_default (descrizione, icona_url, prezzo, nota, allergeni)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [descrizione, icona_url || null, prezzo, nota || null, allergeni]
    );

    return created(res, result.rows[0],
      'Ingrediente creato. Verrà assegnato alle nuove pizzerie.'
    );
  } catch (err) {
    logger.error('POST admin/ingredienti:', err);
    return serverError(res);
  }
});

// ─── PUT /admin/ingredienti/:id ───────────────────────────────
router.put('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  body('descrizione').optional().notEmpty().trim(),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('allergeni').optional().isArray(),
  validate
], async (req, res) => {
  try {
    const { descrizione, icona_url, prezzo, nota, allergeni, attivo } = req.body;

    const result = await db.query(
      `UPDATE ingredienti_default SET
        descrizione = COALESCE($1, descrizione),
        icona_url   = COALESCE($2, icona_url),
        prezzo      = COALESCE($3, prezzo),
        nota        = COALESCE($4, nota),
        allergeni   = COALESCE($5, allergeni),
        attivo      = COALESCE($6, attivo)
       WHERE id = $7
       RETURNING *`,
      [descrizione, icona_url, prezzo, nota, allergeni, attivo, req.params.id]
    );

    if (!result.rows[0]) return notFound(res, 'Ingrediente non trovato');
    return ok(res, result.rows[0], 'Ingrediente aggiornato');
  } catch (err) {
    logger.error('PUT admin/ingredienti:', err);
    return serverError(res);
  }
});

// ─── DELETE /admin/ingredienti/:id ───────────────────────────
router.delete('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE ingredienti_default SET attivo = false
       WHERE id = $1 RETURNING id, descrizione`,
      [req.params.id]
    );
    if (!result.rows[0]) return notFound(res, 'Ingrediente non trovato');
    return ok(res, result.rows[0], 'Ingrediente disattivato');
  } catch (err) {
    logger.error('DELETE admin/ingredienti:', err);
    return serverError(res);
  }
});

module.exports = router;
