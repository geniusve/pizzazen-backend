const router = require('express').Router();
const db = require('../../config/database');
const { requireStats } = require('../../middleware/auth');
const { ok, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /pizzeria/stats/oggi ─────────────────────────────────
router.get('/oggi', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const result = await db.queryRLS(pizzeriaId,
      `SELECT
         COUNT(*)                                          AS totale_ordini,
         COUNT(*) FILTER (WHERE stato = 'ricevuto')       AS ricevuti,
         COUNT(*) FILTER (WHERE stato = 'confermato')     AS confermati,
         COUNT(*) FILTER (WHERE stato = 'in_preparazione')AS in_preparazione,
         COUNT(*) FILTER (WHERE stato = 'pronto')         AS pronti,
         COUNT(*) FILTER (WHERE stato = 'consegnato')     AS consegnati,
         COUNT(*) FILTER (WHERE stato = 'annullato')      AS annullati,
         COALESCE(SUM(totale) FILTER (WHERE stato != 'annullato'), 0) AS incasso,
         COALESCE(SUM(totale) FILTER (WHERE stato_pagamento = 'pagato'), 0) AS incassato,
         COUNT(*) FILTER (WHERE tipo_ordine = 'walk_in')        AS walk_in,
         COUNT(*) FILTER (WHERE tipo_ordine = 'telefono')       AS telefono,
         COUNT(*) FILTER (WHERE tipo_ordine LIKE 'self_order%') AS self_order,
         COUNT(*) FILTER (WHERE tipo_ordine = 'delivery')       AS delivery
       FROM ordini
       WHERE pizzeria_id = $1 AND data_ordine = CURRENT_DATE`,
      [pizzeriaId]
    );

    // Top articoli del giorno
    const topArticoli = await db.queryRLS(pizzeriaId,
      `SELECT oa.nome_articolo, SUM(oa.quantita) AS quantita_totale
       FROM ordine_articoli oa
       JOIN ordini o ON o.id = oa.ordine_id
       WHERE o.pizzeria_id = $1
         AND o.data_ordine = CURRENT_DATE
         AND o.stato != 'annullato'
       GROUP BY oa.nome_articolo
       ORDER BY quantita_totale DESC
       LIMIT 5`,
      [pizzeriaId]
    );

    return ok(res, {
      ...result.rows[0],
      top_articoli: topArticoli.rows
    });
  } catch (err) {
    logger.error('GET stats oggi:', err);
    return serverError(res);
  }
});

// ─── GET /pizzeria/stats/settimana ───────────────────────────
router.get('/settimana', requireStats, async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const result = await db.queryRLS(pizzeriaId,
      `SELECT
         data_ordine AS giorno,
         COUNT(*) AS ordini,
         COALESCE(SUM(totale) FILTER (WHERE stato != 'annullato'), 0) AS incasso
       FROM ordini
       WHERE pizzeria_id = $1
         AND data_ordine >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY data_ordine
       ORDER BY data_ordine`,
      [pizzeriaId]
    );

    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET stats settimana:', err);
    return serverError(res);
  }
});

// ─── GET /pizzeria/stats/top-articoli ────────────────────────
router.get('/top-articoli', requireStats, async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { giorni = 30 } = req.query;

    const result = await db.queryRLS(pizzeriaId,
      `SELECT oa.nome_articolo,
              SUM(oa.quantita)       AS quantita_totale,
              SUM(oa.subtotale_articolo) AS ricavo_totale,
              COUNT(DISTINCT o.id)   AS num_ordini
       FROM ordine_articoli oa
       JOIN ordini o ON o.id = oa.ordine_id
       WHERE o.pizzeria_id = $1
         AND o.data_ordine >= CURRENT_DATE - ($2 || ' days')::INTERVAL
         AND o.stato != 'annullato'
       GROUP BY oa.nome_articolo
       ORDER BY quantita_totale DESC
       LIMIT 20`,
      [pizzeriaId, parseInt(giorni)]
    );

    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET top articoli:', err);
    return serverError(res);
  }
});

module.exports = router;
