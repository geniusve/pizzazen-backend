const router = require('express').Router();
const { body, param } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { upload, handleUploadError } = require('../../middleware/upload');
const storage = require('../../config/storage');
const { ok, created, notFound, badRequest, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

const CATEGORIE_VALIDE = ['impasto','salse','formaggi','salumi','verdure','pesce','extra'];

// ─── GET /admin/ingredienti ───────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
    const result = await db.query(
      `SELECT id, descrizione, categoria, icona_url, immagine_pizza_url, prezzo, nota, allergeni, attivo, created_at
       FROM ingredienti_default
       ORDER BY categoria ASC, descrizione ASC`
    );
    const rows = result.rows.map(r => ({
      ...r,
      icona_url: r.icona_url ? `${baseUrl}/storage/${r.icona_url}` : null,
      immagine_pizza_url: r.immagine_pizza_url ? `${baseUrl}/storage/${r.immagine_pizza_url}` : null,
    }))
    return ok(res, rows);
  } catch (err) {
    logger.error('GET admin/ingredienti:', err);
    return serverError(res);
  }
});

// ─── POST /admin/ingredienti ──────────────────────────────────
router.post('/', [
  body('descrizione').notEmpty().trim().withMessage('Descrizione obbligatoria'),
  body('categoria').optional().isIn(CATEGORIE_VALIDE),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('allergeni').optional().isArray(),
  validate
], async (req, res) => {
  try {
    const { descrizione, categoria = 'extra', prezzo = 0, nota, allergeni = [] } = req.body;
    const result = await db.query(
      `INSERT INTO ingredienti_default (descrizione, categoria, prezzo, nota, allergeni)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [descrizione, categoria, prezzo, nota || null, allergeni]
    );
    return created(res, result.rows[0], 'Ingrediente creato');
  } catch (err) {
    logger.error('POST admin/ingredienti:', err);
    return serverError(res);
  }
});

// ─── PUT /admin/ingredienti/:id ───────────────────────────────
router.put('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  body('descrizione').optional().notEmpty().trim(),
  body('categoria').optional().isIn(CATEGORIE_VALIDE),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('allergeni').optional().isArray(),
  validate
], async (req, res) => {
  try {
    const { descrizione, categoria, prezzo, nota, allergeni, attivo } = req.body;
    const result = await db.query(
      `UPDATE ingredienti_default SET
        descrizione = COALESCE($1, descrizione),
        categoria   = COALESCE($2, categoria),
        prezzo      = COALESCE($3, prezzo),
        nota        = COALESCE($4, nota),
        allergeni   = COALESCE($5, allergeni),
        attivo      = COALESCE($6, attivo)
       WHERE id = $7
       RETURNING *`,
      [descrizione, categoria, prezzo, nota, allergeni, attivo, req.params.id]
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
      `DELETE FROM ingredienti_default WHERE id = $1 RETURNING id, descrizione`,
      [req.params.id]
    );
    if (!result.rows[0]) return notFound(res, 'Ingrediente non trovato');
    return ok(res, result.rows[0], 'Ingrediente eliminato');
  } catch (err) {
    logger.error('DELETE admin/ingredienti:', err);
    return serverError(res);
  }
});

// ─── POST /admin/ingredienti/:id/icona ───────────────────────
router.post('/:id/icona',
  param('id').isInt({ min: 1 }).toInt(),
  upload.single('icona'),
  handleUploadError,
  async (req, res) => {
    try {
      if (!req.file) return badRequest(res, 'File non ricevuto');

      const existing = await db.query(
        'SELECT id, icona_url FROM ingredienti_default WHERE id = $1',
        [req.params.id]
      );
      if (!existing.rows[0]) return notFound(res, 'Ingrediente non trovato');

      // Elimina vecchia icona — il path nel DB è relativo
      if (existing.rows[0].icona_url) {
        // Se già contiene http:// estrai solo il path relativo
        const oldPath = existing.rows[0].icona_url.includes('http')
          ? existing.rows[0].icona_url.split('/storage/')[1]
          : existing.rows[0].icona_url
        storage.deleteFile(oldPath)
      }

      await storage.saveIngredienteIcon(req.file.buffer, req.params.id, true);
      const relativePath = `defaults/ingredienti/${req.params.id}.webp`;

      await db.query(
        'UPDATE ingredienti_default SET icona_url = $1 WHERE id = $2',
        [relativePath, req.params.id]
      );

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
      return ok(res, {
        icona_url: `${baseUrl}/storage/${relativePath}`
      }, 'Icona aggiornata');
    } catch (err) {
      logger.error('POST icona ingrediente default:', err);
      return serverError(res);
    }
  }
);

// ─── POST /admin/ingredienti/:id/sync ────────────────────────
// Propaga i campi (tranne prezzo) a tutte le pizzerie che hanno questo ingrediente default
router.post('/:id/sync', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE ingredienti i
       SET
         descrizione        = d.descrizione,
         icona_url          = d.icona_url,
         immagine_pizza_url = d.immagine_pizza_url,
         nota               = d.nota,
         allergeni          = d.allergeni,
         categoria          = d.categoria
       FROM ingredienti_default d
       WHERE i.ingrediente_default_id = d.id
         AND d.id = $1
       RETURNING i.id`,
      [req.params.id]
    );
    return ok(res, { aggiornati: result.rowCount }, `Sincronizzati ${result.rowCount} ingredienti`);
  } catch (err) {
    logger.error('POST sync ingrediente default:', err);
    return serverError(res);
  }
});

// ─── POST /admin/ingredienti/:id/immagine-pizza ───────────────
router.post('/:id/immagine-pizza',
  param('id').isInt({ min: 1 }).toInt(),
  upload.single('immagine'),
  handleUploadError,
  async (req, res) => {
    try {
      if (!req.file) return badRequest(res, 'File non ricevuto');

      const existing = await db.query(
        'SELECT id, immagine_pizza_url FROM ingredienti_default WHERE id = $1',
        [req.params.id]
      );
      if (!existing.rows[0]) return notFound(res, 'Ingrediente non trovato');

      if (existing.rows[0].immagine_pizza_url) {
        storage.deleteFile(existing.rows[0].immagine_pizza_url);
      }

      const relativePath = await storage.savePizzaIngredientImage(
        req.file.buffer, req.params.id, true
      );

      await db.query(
        'UPDATE ingredienti_default SET immagine_pizza_url = $1 WHERE id = $2',
        [relativePath, req.params.id]
      );

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      return ok(res, { immagine_pizza_url: `${baseUrl}/storage/${relativePath}` }, 'Immagine pizza aggiornata');
    } catch (err) {
      logger.error('POST immagine-pizza ingrediente default:', err);
      return serverError(res);
    }
  }
);

module.exports = router;
