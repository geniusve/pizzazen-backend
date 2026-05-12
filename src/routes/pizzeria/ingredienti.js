const router = require('express').Router();
const { body, param } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { requireGestioneMenu } = require('../../middleware/auth');
const { upload, handleUploadError } = require('../../middleware/upload');
const storage = require('../../config/storage');
const { ok, created, notFound, badRequest, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /pizzeria/ingredienti ────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const result = await db.queryRLS(pizzeriaId,
      `SELECT id, ingrediente_default_id, descrizione,
              icona_url, immagine_pizza_url, prezzo, nota, allergeni, attivo, categoria
       FROM ingredienti
       WHERE pizzeria_id = $1
       ORDER BY categoria ASC, descrizione ASC`,
      [pizzeriaId]
    );
    const rows = result.rows.map(r => ({
      ...r,
      icona_url: r.icona_url ? `${baseUrl}/storage/${r.icona_url}` : null,
      immagine_pizza_url: r.immagine_pizza_url ? `${baseUrl}/storage/${r.immagine_pizza_url}` : null,
    }));
    return ok(res, rows);
  } catch (err) {
    logger.error('GET ingredienti pizzeria:', err);
    return serverError(res);
  }
});

// ─── POST /pizzeria/ingredienti ───────────────────────────────
// Aggiunge ingrediente personalizzato (non da default)
router.post('/', requireGestioneMenu, [
  body('descrizione').notEmpty().trim().withMessage('Descrizione obbligatoria'),
  body('categoria').optional().isIn(['impasto','salse','formaggi','salumi','verdure','pesce','extra']),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('allergeni').optional().isArray(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { descrizione, icona_url, prezzo = 0, nota, allergeni = [], categoria = 'extra' } = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `INSERT INTO ingredienti
         (pizzeria_id, descrizione, icona_url, prezzo, nota, allergeni, categoria)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [pizzeriaId, descrizione, icona_url || null, prezzo, nota || null, allergeni, categoria]
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
  body('categoria').optional().isIn(['impasto','salse','formaggi','salumi','verdure','pesce','extra']),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('allergeni').optional().isArray(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { descrizione, icona_url, immagine_pizza_url, prezzo, nota, allergeni, attivo, categoria } = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `UPDATE ingredienti SET
         descrizione        = COALESCE($1, descrizione),
         icona_url          = COALESCE($2, icona_url),
         immagine_pizza_url = COALESCE($3, immagine_pizza_url),
         prezzo             = COALESCE($4, prezzo),
         nota               = COALESCE($5, nota),
         allergeni          = COALESCE($6, allergeni),
         attivo             = COALESCE($7, attivo),
         categoria          = COALESCE($8, categoria)
       WHERE id = $9 AND pizzeria_id = $10
       RETURNING *`,
      [descrizione, icona_url, immagine_pizza_url, prezzo, nota, allergeni, attivo, categoria,
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

// ─── POST /pizzeria/ingredienti/:id/icona ────────────────────
router.post('/:id/icona', requireGestioneMenu,
  param('id').isInt({ min: 1 }).toInt(),
  upload.single('icona'),
  handleUploadError,
  async (req, res) => {
    try {
      const pizzeriaId = req.utente.pizzeriaId;
      if (!req.file) return badRequest(res, 'File non ricevuto');

      const existing = await db.queryRLS(pizzeriaId,
        'SELECT id, icona_url FROM ingredienti WHERE id = $1 AND pizzeria_id = $2',
        [req.params.id, pizzeriaId]
      );
      if (!existing.rows[0]) return notFound(res, 'Ingrediente non trovato');

      // Elimina vecchia icona solo se è personalizzata (path pizzeria-specifico)
      const oldUrl = existing.rows[0].icona_url;
      if (oldUrl && oldUrl.startsWith(`pizzerie/${pizzeriaId}/ingredienti/`)) {
        storage.deleteFile(oldUrl);
      }

      const relativePath = `pizzerie/${pizzeriaId}/ingredienti/${req.params.id}.webp`;
      await storage.saveImage(req.file.buffer, relativePath, {
        width: 200, height: 200, fit: 'cover', quality: 90,
      });

      await db.queryRLS(pizzeriaId,
        'UPDATE ingredienti SET icona_url = $1 WHERE id = $2 AND pizzeria_id = $3',
        [relativePath, req.params.id, pizzeriaId]
      );

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      return ok(res, { icona_url: `${baseUrl}/storage/${relativePath}` }, 'Icona aggiornata');
    } catch (err) {
      logger.error('POST icona ingrediente pizzeria:', err);
      return serverError(res);
    }
  }
);

// ─── POST /pizzeria/ingredienti/:id/immagine-pizza ───────────
router.post('/:id/immagine-pizza', requireGestioneMenu,
  param('id').isInt({ min: 1 }).toInt(),
  upload.single('immagine'),
  handleUploadError,
  async (req, res) => {
    try {
      const pizzeriaId = req.utente.pizzeriaId;
      if (!req.file) return badRequest(res, 'File non ricevuto');

      const existing = await db.queryRLS(pizzeriaId,
        'SELECT id, immagine_pizza_url FROM ingredienti WHERE id = $1 AND pizzeria_id = $2',
        [req.params.id, pizzeriaId]
      );
      if (!existing.rows[0]) return notFound(res, 'Ingrediente non trovato');

      if (existing.rows[0].immagine_pizza_url) {
        storage.deleteFile(existing.rows[0].immagine_pizza_url);
      }

      const relativePath = await storage.savePizzaIngredientImage(
        req.file.buffer, req.params.id, false, pizzeriaId
      );

      await db.queryRLS(pizzeriaId,
        'UPDATE ingredienti SET immagine_pizza_url = $1 WHERE id = $2 AND pizzeria_id = $3',
        [relativePath, req.params.id, pizzeriaId]
      );

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      return ok(res, { immagine_pizza_url: `${baseUrl}/storage/${relativePath}` }, 'Immagine pizza aggiornata');
    } catch (err) {
      logger.error('POST immagine-pizza ingrediente pizzeria:', err);
      return serverError(res);
    }
  }
);

module.exports = router;
