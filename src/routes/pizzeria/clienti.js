const router = require('express').Router();
const { body, param, query } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { ok, created, notFound, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /pizzeria/clienti ────────────────────────────────────
// Lista clienti della pizzeria con paginazione
router.get('/', [
  query('pagina').optional().isInt({ min: 1 }).toInt(),
  query('per_pagina').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('cerca').optional().trim(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const pagina    = req.query.pagina     || 1;
    const perPagina = req.query.per_pagina || 30;
    const offset    = (pagina - 1) * perPagina;
    const cerca     = req.query.cerca;

    let where  = ['cp.pizzeria_id = $1'];
    let params = [pizzeriaId];
    let idx    = 2;

    if (cerca) {
      where.push(`(
        c.nome ILIKE $${idx} OR c.cognome ILIKE $${idx} OR
        c.cellulare ILIKE $${idx} OR c.email ILIKE $${idx}
      )`);
      params.push(`%${cerca}%`);
      idx++;
    }

    const whereClause = where.join(' AND ');

    const countRes = await db.query(
      `SELECT COUNT(*) FROM clienti c
       JOIN clienti_pizzerie cp ON cp.cliente_id = c.id
       WHERE ${whereClause}`,
      params
    );

    const result = await db.query(
      `SELECT c.id, c.nome, c.cognome, c.cellulare, c.telefono,
              c.email, c.via, c.numero_civico, c.cap, c.citta,
              c.whatsapp_abilitato, c.tipo_inserimento,
              c.created_at, cp.data_primo_ordine,
              COUNT(o.id) AS totale_ordini
       FROM clienti c
       JOIN clienti_pizzerie cp ON cp.cliente_id = c.id
       LEFT JOIN ordini o ON o.cliente_id = c.id AND o.pizzeria_id = $1
                         AND o.stato != 'annullato'
       WHERE ${whereClause}
       GROUP BY c.id, cp.data_primo_ordine
       ORDER BY cp.data_primo_ordine DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, perPagina, offset]
    );

    return ok(res, {
      clienti:   result.rows,
      totale:    parseInt(countRes.rows[0].count),
      pagina,
      per_pagina: perPagina,
      pagine:    Math.ceil(parseInt(countRes.rows[0].count) / perPagina)
    });
  } catch (err) {
    logger.error('GET clienti:', err);
    return serverError(res);
  }
});

// ─── GET /pizzeria/clienti/:id ───────────────────────────────
// Dettaglio cliente con ultimi ordini
router.get('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const cliente = await db.query(
      `SELECT c.*, cp.data_primo_ordine
       FROM clienti c
       JOIN clienti_pizzerie cp ON cp.cliente_id = c.id
       WHERE c.id = $1 AND cp.pizzeria_id = $2`,
      [req.params.id, pizzeriaId]
    );
    if (!cliente.rows[0]) return notFound(res, 'Cliente non trovato');

    // Ultimi 10 ordini del cliente in questa pizzeria
    const ordini = await db.queryRLS(pizzeriaId,
      `SELECT id, numero_ordine, data_ordine, tipo_ordine,
              stato, totale, created_at
       FROM ordini
       WHERE cliente_id = $1 AND pizzeria_id = $2
         AND stato != 'annullato'
       ORDER BY created_at DESC
       LIMIT 10`,
      [req.params.id, pizzeriaId]
    );

    return ok(res, {
      ...cliente.rows[0],
      ultimi_ordini: ordini.rows
    });
  } catch (err) {
    logger.error('GET cliente singolo:', err);
    return serverError(res);
  }
});

// ─── POST /pizzeria/clienti/lookup ───────────────────────────
// Cerca cliente per cellulare — usato dalla cassa durante presa ordine
// Se non trovato restituisce trovato: false senza errore
router.post('/lookup', [
  body('cellulare').notEmpty().trim().withMessage('Cellulare obbligatorio'),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const cellulare  = req.body.cellulare.replace(/\s/g, '');

    const result = await db.query(
      `SELECT c.id, c.nome, c.cognome, c.cellulare, c.telefono,
              c.email, c.via, c.numero_civico, c.cap, c.citta,
              c.whatsapp_abilitato, c.note,
              EXISTS(
                SELECT 1 FROM clienti_pizzerie cp
                WHERE cp.cliente_id = c.id AND cp.pizzeria_id = $2
              ) AS cliente_noto
       FROM clienti c
       WHERE c.cellulare = $1`,
      [cellulare, pizzeriaId]
    );

    if (!result.rows[0]) {
      return ok(res, { trovato: false, cliente: null });
    }

    // Conta ordini in questa pizzeria
    const ordiniCount = await db.query(
      `SELECT COUNT(*) FROM ordini
       WHERE cliente_id = $1 AND pizzeria_id = $2 AND stato != 'annullato'`,
      [result.rows[0].id, pizzeriaId]
    );

    return ok(res, {
      trovato: true,
      cliente: {
        ...result.rows[0],
        totale_ordini: parseInt(ordiniCount.rows[0].count)
      }
    });
  } catch (err) {
    logger.error('POST clienti lookup:', err);
    return serverError(res);
  }
});

// ─── POST /pizzeria/clienti ───────────────────────────────────
// Crea nuovo cliente e lo associa alla pizzeria
router.post('/', [
  body('cellulare').notEmpty().trim().withMessage('Cellulare obbligatorio'),
  body('email').optional({ nullable: true }).isEmail(),
  validate
], async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const pizzeriaId = req.utente.pizzeriaId;
    const {
      nome, cognome, cellulare, telefono, email,
      via, numero_civico, cap, citta, provincia,
      note, whatsapp_abilitato = true,
      tipo_inserimento = 'cassa'
    } = req.body;

    const cel = cellulare.replace(/\s/g, '');

    // Controlla se esiste già con quel cellulare
    const existing = await client.query(
      'SELECT id FROM clienti WHERE cellulare = $1',
      [cel]
    );

    let clienteId;

    if (existing.rows[0]) {
      clienteId = existing.rows[0].id;
    } else {
      const ins = await client.query(
        `INSERT INTO clienti (
           nome, cognome, cellulare, telefono, email,
           via, numero_civico, cap, citta, provincia,
           note, whatsapp_abilitato, tipo_inserimento
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [nome, cognome, cel, telefono, email,
         via, numero_civico, cap, citta, provincia,
         note, whatsapp_abilitato, tipo_inserimento]
      );
      clienteId = ins.rows[0].id;
    }

    // Associa alla pizzeria (se non già associato)
    await client.query(
      `INSERT INTO clienti_pizzerie (cliente_id, pizzeria_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [clienteId, pizzeriaId]
    );

    await client.query('COMMIT');

    const risultato = await db.query(
      'SELECT * FROM clienti WHERE id = $1',
      [clienteId]
    );

    return created(res, risultato.rows[0], 'Cliente salvato');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('POST clienti:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ─── PUT /pizzeria/clienti/:id ───────────────────────────────
router.put('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  body('email').optional({ nullable: true }).isEmail(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    // Verifica che il cliente appartenga alla pizzeria
    const check = await db.query(
      `SELECT c.id FROM clienti c
       JOIN clienti_pizzerie cp ON cp.cliente_id = c.id
       WHERE c.id = $1 AND cp.pizzeria_id = $2`,
      [req.params.id, pizzeriaId]
    );
    if (!check.rows[0]) return notFound(res, 'Cliente non trovato');

    const {
      nome, cognome, telefono, email,
      via, numero_civico, cap, citta, provincia,
      note, whatsapp_abilitato
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
         whatsapp_abilitato = COALESCE($11, whatsapp_abilitato)
       WHERE id = $12
       RETURNING *`,
      [nome, cognome, telefono, email,
       via, numero_civico, cap, citta, provincia,
       note, whatsapp_abilitato, req.params.id]
    );

    return ok(res, result.rows[0], 'Cliente aggiornato');
  } catch (err) {
    logger.error('PUT cliente:', err);
    return serverError(res);
  }
});

module.exports = router;
