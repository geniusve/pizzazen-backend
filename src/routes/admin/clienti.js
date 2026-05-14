const router = require('express').Router();
const { query: qv, param } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { ok, created, notFound, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /admin/clienti ──────────────────────────────────────
router.get('/', [
  qv('cerca').optional().trim(),
  qv('pagina').optional().isInt({ min: 1 }).toInt(),
  validate,
], async (req, res) => {
  try {
    const cerca     = req.query.cerca;
    const pagina    = req.query.pagina    || 1;
    const perPagina = 30;
    const offset    = (pagina - 1) * perPagina;

    let where  = ['1=1'];
    let params = [];
    let idx    = 1;

    if (cerca) {
      where.push(`(c.nome ILIKE $${idx} OR c.cognome ILIKE $${idx} OR c.cellulare ILIKE $${idx})`);
      params.push(`%${cerca}%`);
      idx++;
    }

    const whereClause = where.join(' AND ');

    const countRes = await db.query(
      `SELECT COUNT(*) FROM clienti c WHERE ${whereClause}`,
      params
    );

    const result = await db.query(
      `SELECT
         c.id, c.nome, c.cognome, c.cellulare, c.telefono,
         c.email, c.codice_cliente, c.whatsapp_abilitato,
         c.via, c.numero_civico, c.cap, c.citta, c.provincia, c.note,
         c.tipo_inserimento, c.created_at,
         (SELECT MIN(cp.data_primo_ordine) FROM clienti_pizzerie cp WHERE cp.cliente_id = c.id) AS data_primo_ordine,
         (SELECT COUNT(*) FROM ordini o WHERE o.cliente_id = c.id AND o.stato != 'annullato') AS totale_ordini,
         (SELECT COUNT(*) FROM clienti_pizzerie cp WHERE cp.cliente_id = c.id) AS num_pizzerie
       FROM clienti c
       WHERE ${whereClause}
       ORDER BY c.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, perPagina, offset]
    );

    const totale = parseInt(countRes.rows[0].count);
    return ok(res, {
      clienti:   result.rows,
      totale,
      pagina,
      per_pagina: perPagina,
      pagine:    Math.ceil(totale / perPagina),
    });
  } catch (err) {
    logger.error('GET admin/clienti:', err);
    return serverError(res);
  }
});

// ─── GET /admin/clienti/:id ──────────────────────────────────
router.get('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate,
], async (req, res) => {
  try {
    const clienteRes = await db.query(
      `SELECT c.*,
         (SELECT MIN(cp.data_primo_ordine) FROM clienti_pizzerie cp WHERE cp.cliente_id = c.id) AS data_primo_ordine,
         (SELECT COUNT(*) FROM ordini o WHERE o.cliente_id = c.id AND o.stato != 'annullato') AS totale_ordini
       FROM clienti c
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!clienteRes.rows[0]) return notFound(res, 'Cliente non trovato');

    // Pizzerie con cui è associato e totale ordini per ognuna
    const pizzerieRes = await db.query(
      `SELECT p.id, p.nome, p.slug,
              cp.data_primo_ordine,
              COUNT(o.id) AS totale_ordini
       FROM clienti_pizzerie cp
       JOIN pizzerie p ON p.id = cp.pizzeria_id
       LEFT JOIN ordini o ON o.cliente_id = $1 AND o.pizzeria_id = p.id AND o.stato != 'annullato'
       WHERE cp.cliente_id = $1
       GROUP BY p.id, p.nome, p.slug, cp.data_primo_ordine
       ORDER BY cp.data_primo_ordine DESC`,
      [req.params.id]
    );

    return ok(res, {
      ...clienteRes.rows[0],
      pizzerie: pizzerieRes.rows,
    });
  } catch (err) {
    logger.error('GET admin/clienti/:id:', err);
    return serverError(res);
  }
});

// ─── GET /admin/clienti/:id/ordini ───────────────────────────
// Ordini paginati per pizzeria
router.get('/:id/ordini', [
  param('id').isInt({ min: 1 }).toInt(),
  qv('pizzeria_id').isInt({ min: 1 }).toInt(),
  qv('pagina').optional().isInt({ min: 1 }).toInt(),
  validate,
], async (req, res) => {
  try {
    const clienteId  = req.params.id;
    const pizzeriaId = req.query.pizzeria_id;
    const pagina     = req.query.pagina || 1;
    const perPagina  = 10;
    const offset     = (pagina - 1) * perPagina;

    const countRes = await db.query(
      `SELECT COUNT(*) FROM ordini
       WHERE cliente_id = $1 AND pizzeria_id = $2 AND stato != 'annullato'`,
      [clienteId, pizzeriaId]
    );

    const result = await db.query(
      `SELECT id, numero_ordine, data_ordine, tipo_ordine, stato, totale, created_at
       FROM ordini
       WHERE cliente_id = $1 AND pizzeria_id = $2 AND stato != 'annullato'
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [clienteId, pizzeriaId, perPagina, offset]
    );

    const totale = parseInt(countRes.rows[0].count);
    return ok(res, {
      ordini: result.rows,
      totale,
      pagina,
      per_pagina: perPagina,
      pagine:    Math.ceil(totale / perPagina),
    });
  } catch (err) {
    logger.error('GET admin/clienti/:id/ordini:', err);
    return serverError(res);
  }
});

// ─── POST /admin/clienti/lookup ──────────────────────────────
router.post('/lookup', async (req, res) => {
  try {
    const cel = req.body.cellulare?.replace(/\s/g, '');
    if (!cel) return ok(res, { trovato: false, cliente: null });

    const result = await db.query(
      `SELECT id, nome, cognome, cellulare FROM clienti WHERE cellulare = $1`,
      [cel]
    );
    if (!result.rows[0]) return ok(res, { trovato: false, cliente: null });
    return ok(res, { trovato: true, cliente: result.rows[0] });
  } catch (err) {
    logger.error('POST admin/clienti/lookup:', err);
    return serverError(res);
  }
});

// ─── POST /admin/clienti ─────────────────────────────────────
router.post('/', async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const {
      nome, cognome, cellulare, telefono, email,
      via, numero_civico, cap, citta, provincia,
      note, whatsapp_abilitato = true,
    } = req.body;

    if (!cellulare?.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, messaggio: 'Cellulare obbligatorio' });
    }

    const cel = cellulare.replace(/\s/g, '');
    const existing = await client.query('SELECT id FROM clienti WHERE cellulare = $1', [cel]);
    if (existing.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ ok: false, messaggio: 'Cliente già esistente con questo cellulare' });
    }

    const ins = await client.query(
      `INSERT INTO clienti (nome, cognome, cellulare, telefono, email,
         via, numero_civico, cap, citta, provincia,
         note, whatsapp_abilitato, tipo_inserimento)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'admin')
       RETURNING *`,
      [nome, cognome, cel, telefono, email,
       via, numero_civico, cap, citta, provincia,
       note, whatsapp_abilitato]
    );

    await client.query('COMMIT');
    return created(res, ins.rows[0], 'Cliente creato');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('POST admin/clienti:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ─── PUT /admin/clienti/:id ──────────────────────────────────
router.put('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate,
], async (req, res) => {
  try {
    const {
      nome, cognome, telefono, email,
      via, numero_civico, cap, citta, provincia,
      note, whatsapp_abilitato,
    } = req.body;

    const result = await db.query(
      `UPDATE clienti SET
         nome               = COALESCE($1, nome),
         cognome            = COALESCE($2, cognome),
         telefono           = COALESCE($3, telefono),
         email              = COALESCE($4, email),
         via                = COALESCE($5, via),
         numero_civico      = COALESCE($6, numero_civico),
         cap                = COALESCE($7, cap),
         citta              = COALESCE($8, citta),
         provincia          = COALESCE($9, provincia),
         note               = COALESCE($10, note),
         whatsapp_abilitato = CASE WHEN $11::boolean IS NOT NULL THEN $11 ELSE whatsapp_abilitato END
       WHERE id = $12
       RETURNING *`,
      [nome, cognome, telefono, email,
       via, numero_civico, cap, citta, provincia,
       note, whatsapp_abilitato ?? null, req.params.id]
    );

    if (!result.rows[0]) return notFound(res, 'Cliente non trovato');
    return ok(res, result.rows[0], 'Cliente aggiornato');
  } catch (err) {
    logger.error('PUT admin/clienti/:id:', err);
    return serverError(res);
  }
});

module.exports = router;
