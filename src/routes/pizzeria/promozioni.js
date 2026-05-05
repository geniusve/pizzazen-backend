const router = require('express').Router();
const { body, param, query } = require('express-validator');
const db     = require('../../config/database');
const { validate }             = require('../../middleware/validate');
const { requireAdminPizzeria } = require('../../middleware/auth');
const { ok, created, notFound, badRequest, serverError } = require('../../utils/response');
const { valutaPromozioni }     = require('../../services/promozioni');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/promozioni — Lista
// ═══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `SELECT id, nome, descrizione, attiva,
              data_inizio, data_fine,
              applicazione, codice,
              max_utilizzi, utilizzi_count, max_per_cliente,
              cumulabile, priorita,
              valida_cassa, valida_selforder, valida_app,
              visibile_selforder, visibile_app,
              regola, created_at
       FROM promozioni
       WHERE pizzeria_id = $1
       ORDER BY priorita DESC, nome ASC`,
      [pizzeriaId]
    );
    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET promozioni:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/promozioni/valuta
// DEVE stare PRIMA di /:id altrimenti Express cattura 'valuta' come id
// ═══════════════════════════════════════════════════════════════
router.get('/valuta', [
  query('subtotale').isFloat({ min: 0 }).toFloat(),
  query('tipo_ordine').isIn(['walk_in','telefono','delivery','self_order_web']),
  query('costo_consegna').optional().isFloat({ min: 0 }).toFloat(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { subtotale, tipo_ordine, costo_consegna = 0, cliente_id } = req.query;

    let articoli = [];
    if (req.query.articoli) {
      try { articoli = JSON.parse(req.query.articoli); }
      catch { return badRequest(res, 'articoli non valido — deve essere JSON'); }
    }

    const ordineSimulato = {
      subtotale,
      costo_consegna,
      tipo_ordine,
      cliente_id: cliente_id ? parseInt(cliente_id) : null,
    };

    const applicabili = await valutaPromozioni(
      pizzeriaId, ordineSimulato, articoli,
      { soloManuali: true, origine: 'cassa' }
    );

    return ok(res, {
      promozioni_applicabili: applicabili,
      totale_sconto_max: applicabili.reduce(
        (s, p) => s + (p.effetto.sconto_importo || 0), 0
      )
    });
  } catch (err) {
    logger.error('GET valuta promozioni:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/promozioni/valida-codice
// DEVE stare PRIMA di /:id
// ═══════════════════════════════════════════════════════════════
router.post('/valida-codice', [
  body('codice').notEmpty().trim().toUpperCase().withMessage('Codice obbligatorio'),
  body('subtotale').isFloat({ min: 0 }).toFloat(),
  body('tipo_ordine').notEmpty(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { codice, subtotale, tipo_ordine, costo_consegna = 0, cliente_id } = req.body;
    const articoli = req.body.articoli || [];

    const ordineSimulato = { subtotale, costo_consegna, tipo_ordine, cliente_id: cliente_id || null };

    const risultati = await valutaPromozioni(
      pizzeriaId, ordineSimulato, articoli,
      { codice, origine: 'cassa' }
    );

    if (risultati.length === 0) {
      return badRequest(res, 'Codice non valido o promozione non applicabile a questo ordine');
    }

    return ok(res, risultati[0], 'Codice valido!');
  } catch (err) {
    logger.error('POST valida-codice:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/promozioni/:id
// ═══════════════════════════════════════════════════════════════
router.get('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `SELECT * FROM promozioni WHERE id = $1 AND pizzeria_id = $2`,
      [req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Promozione non trovata');
    return ok(res, result.rows[0]);
  } catch (err) {
    logger.error('GET promozione singola:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/promozioni — Crea
// ═══════════════════════════════════════════════════════════════
router.post('/', requireAdminPizzeria, [
  body('nome').notEmpty().trim().withMessage('Nome obbligatorio'),
  body('regola').isObject().withMessage('Regola obbligatoria'),
  body('regola.condizioni').isArray().withMessage('Condizioni devono essere un array'),
  body('regola.azione').isObject().withMessage('Azione obbligatoria'),
  body('applicazione').isIn(['manuale','automatica','codice'])
    .withMessage('applicazione: manuale, automatica o codice'),
  body('codice').if(body('applicazione').equals('codice'))
    .notEmpty().trim().toUpperCase()
    .withMessage('Codice obbligatorio per promozioni con codice'),
  body('data_inizio').optional({ nullable: true }).isDate(),
  body('data_fine').optional({ nullable: true }).isDate(),
  body('max_utilizzi').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  body('max_per_cliente').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
  body('priorita').optional().isInt({ min: 0 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const {
      nome, descrizione, regola,
      applicazione = 'manuale', codice,
      data_inizio, data_fine,
      max_utilizzi, max_per_cliente,
      cumulabile = false, priorita = 0,
      valida_cassa = true, valida_selforder = true, valida_app = true,
      visibile_selforder = false, visibile_app = true,
    } = req.body;

    const codiceNorm = codice ? codice.toUpperCase() : null;

    if (codiceNorm) {
      const dup = await db.query(
        'SELECT id FROM promozioni WHERE pizzeria_id = $1 AND codice = $2',
        [pizzeriaId, codiceNorm]
      );
      if (dup.rows[0]) return badRequest(res, `Codice "${codiceNorm}" già in uso`);
    }

    const result = await db.queryRLS(pizzeriaId,
      `INSERT INTO promozioni (
         pizzeria_id, nome, descrizione, regola,
         applicazione, codice, data_inizio, data_fine,
         max_utilizzi, max_per_cliente, cumulabile, priorita,
         valida_cassa, valida_selforder, valida_app,
         visibile_selforder, visibile_app
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        pizzeriaId, nome, descrizione || null, JSON.stringify(regola),
        applicazione, codiceNorm, data_inizio || null, data_fine || null,
        max_utilizzi || null, max_per_cliente || null, cumulabile, priorita,
        valida_cassa, valida_selforder, valida_app, visibile_selforder, visibile_app
      ]
    );

    logger.info(`Promozione creata: ${nome} (pizzeria ${pizzeriaId})`);
    return created(res, result.rows[0], 'Promozione creata');
  } catch (err) {
    logger.error('POST promozione:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// PUT /pizzeria/promozioni/:id
// ═══════════════════════════════════════════════════════════════
router.put('/:id', requireAdminPizzeria, [
  param('id').isInt({ min: 1 }).toInt(),
  body('nome').optional().notEmpty().trim(),
  body('applicazione').optional().isIn(['manuale','automatica','codice']),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const existing = await db.queryRLS(pizzeriaId,
      'SELECT id FROM promozioni WHERE id = $1 AND pizzeria_id = $2',
      [req.params.id, pizzeriaId]
    );
    if (!existing.rows[0]) return notFound(res, 'Promozione non trovata');

    const campi = [
      'nome','descrizione','attiva','regola','applicazione','codice',
      'data_inizio','data_fine','max_utilizzi','max_per_cliente',
      'cumulabile','priorita','valida_cassa','valida_selforder','valida_app',
      'visibile_selforder','visibile_app',
    ];

    const sets = [], params = [];
    let idx = 1;
    for (const campo of campi) {
      if (req.body[campo] !== undefined) {
        let val = req.body[campo];
        if (campo === 'regola') val = JSON.stringify(val);
        if (campo === 'codice' && val) val = val.toUpperCase();
        sets.push(`${campo} = $${idx}`);
        params.push(val);
        idx++;
      }
    }

    if (sets.length === 0) return badRequest(res, 'Nessun campo da aggiornare');

    params.push(req.params.id, pizzeriaId);
    const result = await db.queryRLS(pizzeriaId,
      `UPDATE promozioni SET ${sets.join(', ')}
       WHERE id = $${idx} AND pizzeria_id = $${idx+1}
       RETURNING *`,
      params
    );

    return ok(res, result.rows[0], 'Promozione aggiornata');
  } catch (err) {
    logger.error('PUT promozione:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /pizzeria/promozioni/:id
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', requireAdminPizzeria, [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `UPDATE promozioni SET attiva = false
       WHERE id = $1 AND pizzeria_id = $2
       RETURNING id, nome`,
      [req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Promozione non trovata');
    return ok(res, result.rows[0], 'Promozione disattivata');
  } catch (err) {
    logger.error('DELETE promozione:', err);
    return serverError(res);
  }
});

module.exports = router;
