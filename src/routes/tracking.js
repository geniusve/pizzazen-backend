const router = require('express').Router();
const { param } = require('express-validator');
const db     = require('../config/database');
const { validate } = require('../middleware/validate');
const { ok, notFound, serverError } = require('../utils/response');
const logger = require('../utils/logger');

// ─── GET /tracking/:chiave ────────────────────────────────────
// Stato ordine per il cliente (pubblico, nessuna autenticazione)
router.get('/:chiave', [
  param('chiave').isUUID().withMessage('Chiave tracking non valida'),
  validate
], async (req, res) => {
  try {
    // Query senza RLS — usiamo la chiave tracking come token di accesso
    const result = await db.query(
      `SELECT
         o.id, o.numero_ordine, o.data_ordine, o.ora_ordine,
         o.tipo_ordine, o.stato, o.stato_pagamento,
         o.slot_richiesto, o.totale, o.note,
         o.created_at,
         -- Nome cliente
         COALESCE(
           NULLIF(TRIM(CONCAT(COALESCE(c.nome,''), ' ', COALESCE(c.cognome,''))), ''),
           o.nome_cliente_temp
         ) AS cliente_nome,
         -- Pizzeria
         p.nome AS pizzeria_nome,
         p.telefono AS pizzeria_telefono,
         -- Articoli
         COALESCE(
           json_agg(
             json_build_object(
               'nome',     oa.nome_articolo,
               'quantita', oa.quantita,
               'note',     oa.note,
               'modifiche', (
                 SELECT COALESCE(json_agg(json_build_object(
                   'tipo',        m.tipo,
                   'ingrediente', m.nome_ingrediente
                 )), '[]')
                 FROM ordine_articoli_modifiche m
                 WHERE m.ordine_articolo_id = oa.id
               )
             )
           ) FILTER (WHERE oa.id IS NOT NULL),
           '[]'
         ) AS articoli
       FROM ordini o
       JOIN pizzerie p ON p.id = o.pizzeria_id
       LEFT JOIN clienti c ON c.id = o.cliente_id
       LEFT JOIN ordine_articoli oa ON oa.ordine_id = o.id
       WHERE o.chiave_tracking = $1
       GROUP BY o.id, c.id, p.id`,
      [req.params.chiave]
    );

    if (!result.rows[0]) {
      return notFound(res, 'Ordine non trovato');
    }

    const ordine = result.rows[0];

    // Mappa stati in messaggi leggibili per il cliente
    const messaggiStato = {
      ricevuto:        '📋 Ordine ricevuto, in attesa di conferma',
      confermato:      '✅ Ordine confermato dalla pizzeria',
      in_preparazione: '👨‍🍳 Il tuo ordine è in preparazione',
      pronto:          '🍕 Pronto! Puoi venire a ritirare',
      consegnato:      '✅ Ordine consegnato. Buon appetito!',
      annullato:       '❌ Ordine annullato',
    };

    return ok(res, {
      ...ordine,
      stato_messaggio: messaggiStato[ordine.stato] || ordine.stato,
    });
  } catch (err) {
    logger.error('GET tracking:', err);
    return serverError(res);
  }
});

module.exports = router;
