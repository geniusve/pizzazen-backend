const router = require('express').Router();
const { body, param } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { requireGestioneMenu } = require('../../middleware/auth');
const { upload, handleUploadError } = require('../../middleware/upload');
const storage = require('../../config/storage');
const { ok, created, notFound, serverError, badRequest } = require('../../utils/response');
const logger = require('../../utils/logger');

// ════════════════════════════════════════
// CATEGORIE
// ════════════════════════════════════════

// ─── GET /pizzeria/menu/categorie ────────────────────────────
router.get('/categorie', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `SELECT c.id, c.nome, c.icona_url, c.ordine, c.attiva,
              COUNT(ma.id) AS num_articoli
       FROM categorie_menu c
       LEFT JOIN menu_articoli ma
         ON ma.categoria_id = c.id AND ma.non_in_uso = false
       WHERE c.pizzeria_id = $1
       GROUP BY c.id
       ORDER BY c.ordine, c.nome`,
      [pizzeriaId]
    );
    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET categorie menu:', err);
    return serverError(res);
  }
});

// ─── POST /pizzeria/menu/categorie ───────────────────────────
router.post('/categorie', requireGestioneMenu, [
  body('nome').notEmpty().trim().withMessage('Nome obbligatorio'),
  body('ordine').optional().isInt({ min: 0 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { nome, icona_url, ordine = 0 } = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `INSERT INTO categorie_menu (pizzeria_id, nome, icona_url, ordine)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [pizzeriaId, nome, icona_url || null, ordine]
    );
    return created(res, result.rows[0], 'Categoria creata');
  } catch (err) {
    logger.error('POST categorie menu:', err);
    return serverError(res);
  }
});

// ─── PUT /pizzeria/menu/categorie/:id ────────────────────────
router.put('/categorie/:id', requireGestioneMenu, [
  param('id').isInt({ min: 1 }).toInt(),
  body('nome').optional().notEmpty().trim(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { nome, icona_url, ordine, attiva } = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `UPDATE categorie_menu SET
         nome      = COALESCE($1, nome),
         icona_url = COALESCE($2, icona_url),
         ordine    = COALESCE($3, ordine),
         attiva    = COALESCE($4, attiva)
       WHERE id = $5 AND pizzeria_id = $6
       RETURNING *`,
      [nome, icona_url, ordine, attiva, req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Categoria non trovata');
    return ok(res, result.rows[0], 'Categoria aggiornata');
  } catch (err) {
    logger.error('PUT categorie menu:', err);
    return serverError(res);
  }
});

// ─── PUT /pizzeria/menu/categorie/ordine ─────────────────────
// Riordina categorie (drag & drop)
// Body: { ordini: [ {id: 1, ordine: 0}, {id: 2, ordine: 1} ] }
router.put('/categorie/ordine', requireGestioneMenu, [
  body('ordini').isArray().withMessage('ordini deve essere un array'),
  validate
], async (req, res) => {
  const pizzeriaId = req.utente.pizzeriaId;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.pizzeria_id = '${pizzeriaId}'`);

    for (const item of req.body.ordini) {
      await client.query(
        `UPDATE categorie_menu SET ordine = $1
         WHERE id = $2 AND pizzeria_id = $3`,
        [item.ordine, item.id, pizzeriaId]
      );
    }
    await client.query('COMMIT');
    return ok(res, null, 'Ordine categorie aggiornato');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('PUT ordine categorie:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ─── DELETE /pizzeria/menu/categorie/:id ─────────────────────
router.delete('/categorie/:id', requireGestioneMenu, [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    // Controlla se ha articoli attivi
    const check = await db.queryRLS(pizzeriaId,
      `SELECT COUNT(*) FROM menu_articoli
       WHERE categoria_id = $1 AND non_in_uso = false`,
      [req.params.id]
    );
    if (parseInt(check.rows[0].count) > 0) {
      return badRequest(res,
        'Impossibile eliminare: la categoria ha articoli attivi. Spostali o disattivali prima.'
      );
    }

    const result = await db.queryRLS(pizzeriaId,
      `DELETE FROM categorie_menu
       WHERE id = $1 AND pizzeria_id = $2
       RETURNING id, nome`,
      [req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Categoria non trovata');
    return ok(res, result.rows[0], 'Categoria eliminata');
  } catch (err) {
    logger.error('DELETE categoria:', err);
    return serverError(res);
  }
});

// ════════════════════════════════════════
// ARTICOLI
// ════════════════════════════════════════

// ─── GET /pizzeria/menu/articoli ─────────────────────────────
// Lista completa con ingredienti e allergeni calcolati
router.get('/articoli', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { categoria_id, includi_non_in_uso } = req.query;

    let where = ['ma.pizzeria_id = $1'];
    let params = [pizzeriaId];
    let idx = 2;

    if (!includi_non_in_uso) {
      where.push('ma.non_in_uso = false');
    }
    if (categoria_id) {
      where.push(`ma.categoria_id = $${idx}`);
      params.push(parseInt(categoria_id));
      idx++;
    }

    const result = await db.queryRLS(pizzeriaId,
      `SELECT
         ma.id, ma.categoria_id, c.nome AS categoria_nome,
         ma.nome, ma.icona_url, ma.prezzo,
         ma.allergeni_extra, ma.note, ma.ordine,
         ma.non_disponibile, ma.non_in_uso,
         ma.created_at, ma.updated_at,
         -- Ingredienti come array JSON
         COALESCE(
           json_agg(
             json_build_object(
               'id', i.id,
               'descrizione', i.descrizione,
               'prezzo', i.prezzo,
               'allergeni', i.allergeni
             )
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'
         ) AS ingredienti,
         -- Allergeni calcolati
         get_allergeni_articolo(ma.id) AS allergeni_calcolati
       FROM menu_articoli ma
       JOIN categorie_menu c ON c.id = ma.categoria_id
       LEFT JOIN menu_articoli_ingredienti mai ON mai.articolo_id = ma.id
       LEFT JOIN ingredienti i ON i.id = mai.ingrediente_id
       WHERE ${where.join(' AND ')}
       GROUP BY ma.id, c.nome
       ORDER BY ma.categoria_id, ma.ordine, ma.nome`,
      params
    );

    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET articoli menu:', err);
    return serverError(res);
  }
});

// ─── GET /pizzeria/menu/articoli/:id ─────────────────────────
router.get('/articoli/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `SELECT
         ma.*, c.nome AS categoria_nome,
         COALESCE(
           json_agg(
             json_build_object(
               'id', i.id, 'descrizione', i.descrizione,
               'prezzo', i.prezzo, 'allergeni', i.allergeni
             )
           ) FILTER (WHERE i.id IS NOT NULL), '[]'
         ) AS ingredienti,
         get_allergeni_articolo(ma.id) AS allergeni_calcolati
       FROM menu_articoli ma
       JOIN categorie_menu c ON c.id = ma.categoria_id
       LEFT JOIN menu_articoli_ingredienti mai ON mai.articolo_id = ma.id
       LEFT JOIN ingredienti i ON i.id = mai.ingrediente_id
       WHERE ma.id = $1 AND ma.pizzeria_id = $2
       GROUP BY ma.id, c.nome`,
      [req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Articolo non trovato');
    return ok(res, result.rows[0]);
  } catch (err) {
    logger.error('GET articolo singolo:', err);
    return serverError(res);
  }
});

// ─── POST /pizzeria/menu/articoli ────────────────────────────
router.post('/articoli', requireGestioneMenu, [
  body('categoria_id').isInt({ min: 1 }).toInt().withMessage('Categoria obbligatoria'),
  body('nome').notEmpty().trim().withMessage('Nome obbligatorio'),
  body('prezzo').isFloat({ min: 0 }).toFloat().withMessage('Prezzo obbligatorio'),
  body('ingredienti_ids').optional().isArray(),
  body('allergeni_extra').optional().isArray(),
  validate
], async (req, res) => {
  const pizzeriaId = req.utente.pizzeriaId;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.pizzeria_id = '${pizzeriaId}'`);

    const {
      categoria_id, nome, icona_url, prezzo,
      ingredienti_ids = [], allergeni_extra = [],
      note, ordine = 0
    } = req.body;

    // Crea articolo
    const artRes = await client.query(
      `INSERT INTO menu_articoli
         (pizzeria_id, categoria_id, nome, icona_url, prezzo,
          allergeni_extra, note, ordine)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [pizzeriaId, categoria_id, nome, icona_url || null,
       prezzo, allergeni_extra, note || null, ordine]
    );
    const articolo = artRes.rows[0];

    // Associa ingredienti
    for (const ingId of ingredienti_ids) {
      await client.query(
        `INSERT INTO menu_articoli_ingredienti (articolo_id, ingrediente_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [articolo.id, ingId]
      );
    }

    await client.query('COMMIT');

    // Recupera con allergeni calcolati
    const full = await db.queryRLS(pizzeriaId,
      `SELECT ma.*, get_allergeni_articolo(ma.id) AS allergeni_calcolati
       FROM menu_articoli ma WHERE ma.id = $1`,
      [articolo.id]
    );

    return created(res, full.rows[0], 'Articolo creato');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('POST articolo menu:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ─── PUT /pizzeria/menu/articoli/:id ─────────────────────────
router.put('/articoli/:id', requireGestioneMenu, [
  param('id').isInt({ min: 1 }).toInt(),
  body('prezzo').optional().isFloat({ min: 0 }).toFloat(),
  body('ingredienti_ids').optional().isArray(),
  body('allergeni_extra').optional().isArray(),
  validate
], async (req, res) => {
  const pizzeriaId = req.utente.pizzeriaId;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.pizzeria_id = '${pizzeriaId}'`);

    const {
      categoria_id, nome, icona_url, prezzo,
      allergeni_extra, note, ordine,
      ingredienti_ids
    } = req.body;

    // Aggiorna dati articolo
    const result = await client.query(
      `UPDATE menu_articoli SET
         categoria_id    = COALESCE($1, categoria_id),
         nome            = COALESCE($2, nome),
         icona_url       = COALESCE($3, icona_url),
         prezzo          = COALESCE($4, prezzo),
         allergeni_extra = COALESCE($5, allergeni_extra),
         note            = COALESCE($6, note),
         ordine          = COALESCE($7, ordine)
       WHERE id = $8 AND pizzeria_id = $9
       RETURNING id`,
      [categoria_id, nome, icona_url, prezzo,
       allergeni_extra, note, ordine,
       req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) {
      await client.query('ROLLBACK');
      return notFound(res, 'Articolo non trovato');
    }

    // Se inviati gli ingredienti, rimpiazza completamente
    if (ingredienti_ids !== undefined) {
      await client.query(
        'DELETE FROM menu_articoli_ingredienti WHERE articolo_id = $1',
        [req.params.id]
      );
      for (const ingId of ingredienti_ids) {
        await client.query(
          `INSERT INTO menu_articoli_ingredienti (articolo_id, ingrediente_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [req.params.id, ingId]
        );
      }
    }

    await client.query('COMMIT');

    const full = await db.queryRLS(pizzeriaId,
      `SELECT ma.*, get_allergeni_articolo(ma.id) AS allergeni_calcolati
       FROM menu_articoli ma WHERE ma.id = $1`,
      [req.params.id]
    );

    return ok(res, full.rows[0], 'Articolo aggiornato');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('PUT articolo menu:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ─── PATCH /pizzeria/menu/articoli/:id/disponibilita ─────────
// Toggle non_disponibile (senza richiedere permessi menu)
router.patch('/articoli/:id/disponibilita', [
  param('id').isInt({ min: 1 }).toInt(),
  body('non_disponibile').isBoolean().toBoolean(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `UPDATE menu_articoli
       SET non_disponibile = $1
       WHERE id = $2 AND pizzeria_id = $3
       RETURNING id, nome, non_disponibile`,
      [req.body.non_disponibile, req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Articolo non trovato');
    const stato = req.body.non_disponibile ? 'non disponibile' : 'disponibile';
    return ok(res, result.rows[0], `Articolo segnato come ${stato}`);
  } catch (err) {
    logger.error('PATCH disponibilita:', err);
    return serverError(res);
  }
});

// ─── DELETE /pizzeria/menu/articoli/:id ──────────────────────
// Soft delete — segna come non_in_uso (mantiene storico ordini)
router.delete('/articoli/:id', requireGestioneMenu, [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `UPDATE menu_articoli SET non_in_uso = true
       WHERE id = $1 AND pizzeria_id = $2
       RETURNING id, nome`,
      [req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Articolo non trovato');
    return ok(res, result.rows[0], 'Articolo rimosso dal menu (storico preservato)');
  } catch (err) {
    logger.error('DELETE articolo:', err);
    return serverError(res);
  }
});

// ─── POST /pizzeria/menu/articoli/:id/immagine ───────────────
router.post('/articoli/:id/immagine',
  requireGestioneMenu,
  upload.single('immagine'),
  handleUploadError,
  async (req, res) => {
    try {
      const pizzeriaId = req.utente.pizzeriaId;
      if (!req.file) return badRequest(res, 'File non ricevuto');

      const url = await storage.saveMenuImage(
        req.file.buffer, pizzeriaId, req.params.id
      );
      const relativePath = `pizzerie/${pizzeriaId}/menu/${req.params.id}.webp`;

      await db.queryRLS(pizzeriaId,
        `UPDATE menu_articoli SET icona_url = $1
         WHERE id = $2 AND pizzeria_id = $3`,
        [relativePath, req.params.id, pizzeriaId]
      );

      return ok(res, { icona_url: url }, 'Immagine aggiornata');
    } catch (err) {
      logger.error('POST immagine articolo:', err);
      return serverError(res);
    }
  }
);

module.exports = router;
