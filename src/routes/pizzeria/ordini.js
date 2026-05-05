const router  = require('express').Router();
const { body, param, query } = require('express-validator');
const db      = require('../../config/database');
const { validate }           = require('../../middleware/validate');
const { ok, created, notFound, conflict, serverError, badRequest } = require('../../utils/response');
const { notificaNuovoOrdine, notificaStatoOrdine } = require('../../socket');
const logger  = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/ordini
// Lista ordini con filtri
// ═══════════════════════════════════════════════════════════════
router.get('/', [
  query('stato').optional().trim(),
  query('data').optional().isDate(),
  query('tipo_ordine').optional().trim(),
  query('pagina').optional().isInt({ min: 1 }).toInt(),
  query('per_pagina').optional().isInt({ min: 1, max: 100 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const pagina     = req.query.pagina     || 1;
    const perPagina  = req.query.per_pagina || 50;
    const offset     = (pagina - 1) * perPagina;

    let where  = ['o.pizzeria_id = $1'];
    let params = [pizzeriaId];
    let idx    = 2;

    if (req.query.stato) {
      where.push(`o.stato = $${idx}`); params.push(req.query.stato); idx++;
    }
    if (req.query.data) {
      where.push(`o.data_ordine = $${idx}`); params.push(req.query.data); idx++;
    } else {
      where.push(`o.data_ordine = CURRENT_DATE`);
    }
    if (req.query.tipo_ordine) {
      where.push(`o.tipo_ordine = $${idx}`); params.push(req.query.tipo_ordine); idx++;
    }

    const whereClause = where.join(' AND ');

    const result = await db.queryRLS(pizzeriaId,
      `SELECT o.id, o.numero_ordine, o.data_ordine, o.ora_ordine,
              o.tipo_ordine, o.stato, o.stato_pagamento,
              o.slot_richiesto, o.totale, o.note,
              o.nome_cliente_temp, o.telefono_temp,
              c.nome AS cliente_nome, c.cognome AS cliente_cognome,
              c.cellulare AS cliente_cellulare,
              o.chiave_tracking, o.created_at
       FROM ordini o
       LEFT JOIN clienti c ON c.id = o.cliente_id
       WHERE ${whereClause}
       ORDER BY o.ora_ordine DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, perPagina, offset]
    );

    const countRes = await db.queryRLS(pizzeriaId,
      `SELECT COUNT(*) FROM ordini o WHERE ${whereClause}`,
      params
    );

    return ok(res, {
      ordini:    result.rows,
      totale:    parseInt(countRes.rows[0].count),
      pagina,
      per_pagina: perPagina
    });
  } catch (err) {
    logger.error('GET ordini:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/ordini/oggi
// Ordini di oggi ottimizzati per il tablet cassa (real-time)
// ═══════════════════════════════════════════════════════════════
router.get('/oggi', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const result = await db.queryRLS(pizzeriaId,
      `SELECT o.id, o.numero_ordine, o.ora_ordine,
              o.tipo_ordine, o.stato, o.stato_pagamento,
              o.slot_richiesto, o.totale, o.note,
              o.nome_cliente_temp, o.telefono_temp,
              c.nome AS cliente_nome, c.cognome AS cliente_cognome,
              c.cellulare AS cliente_cellulare,
              c.whatsapp_abilitato,
              -- Articoli come JSON array
              COALESCE(
                json_agg(
                  json_build_object(
                    'id',             oa.id,
                    'nome',           oa.nome_articolo,
                    'quantita',       oa.quantita,
                    'prezzo',         oa.prezzo_unitario,
                    'subtotale',      oa.subtotale_articolo,
                    'note',           oa.note,
                    'modifiche',      (
                      SELECT COALESCE(json_agg(json_build_object(
                        'tipo',             m.tipo,
                        'ingrediente',      m.nome_ingrediente,
                        'prezzo_extra',     m.prezzo_extra
                      )), '[]')
                      FROM ordine_articoli_modifiche m
                      WHERE m.ordine_articolo_id = oa.id
                    )
                  )
                ) FILTER (WHERE oa.id IS NOT NULL),
                '[]'
              ) AS articoli
       FROM ordini o
       LEFT JOIN clienti c ON c.id = o.cliente_id
       LEFT JOIN ordine_articoli oa ON oa.ordine_id = o.id
       WHERE o.pizzeria_id = $1
         AND o.data_ordine = CURRENT_DATE
         AND o.stato != 'annullato'
       GROUP BY o.id, c.id
       ORDER BY o.ora_ordine ASC`,
      [pizzeriaId]
    );

    return ok(res, result.rows);
  } catch (err) {
    logger.error('GET ordini oggi:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/ordini/:id
// Dettaglio ordine completo
// ═══════════════════════════════════════════════════════════════
router.get('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const ordine = await db.queryRLS(pizzeriaId,
      `SELECT o.*,
              c.nome AS cliente_nome, c.cognome AS cliente_cognome,
              c.cellulare AS cliente_cellulare, c.email AS cliente_email,
              c.via AS cliente_via, c.citta AS cliente_citta,
              c.whatsapp_abilitato
       FROM ordini o
       LEFT JOIN clienti c ON c.id = o.cliente_id
       WHERE o.id = $1 AND o.pizzeria_id = $2`,
      [req.params.id, pizzeriaId]
    );
    if (!ordine.rows[0]) return notFound(res, 'Ordine non trovato');

    const articoli = await db.queryRLS(pizzeriaId,
      `SELECT oa.*,
              COALESCE(
                json_agg(json_build_object(
                  'tipo',         m.tipo,
                  'ingrediente',  m.nome_ingrediente,
                  'prezzo_extra', m.prezzo_extra
                )) FILTER (WHERE m.id IS NOT NULL),
                '[]'
              ) AS modifiche
       FROM ordine_articoli oa
       LEFT JOIN ordine_articoli_modifiche m ON m.ordine_articolo_id = oa.id
       WHERE oa.ordine_id = $1
       GROUP BY oa.id
       ORDER BY oa.id`,
      [req.params.id]
    );

    const comunicazioni = await db.queryRLS(pizzeriaId,
      `SELECT canale, testo, stato, inviato_at
       FROM ordine_comunicazioni
       WHERE ordine_id = $1
       ORDER BY inviato_at DESC`,
      [req.params.id]
    );

    return ok(res, {
      ...ordine.rows[0],
      articoli:       articoli.rows,
      comunicazioni:  comunicazioni.rows
    });
  } catch (err) {
    logger.error('GET ordine singolo:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/ordini
// Crea nuovo ordine
// ═══════════════════════════════════════════════════════════════
router.post('/', [
  body('articoli').isArray({ min: 1 }).withMessage('Almeno un articolo obbligatorio'),
  body('articoli.*.articolo_id').isInt({ min: 1 }).toInt(),
  body('articoli.*.quantita').isInt({ min: 1 }).toInt(),
  body('tipo_ordine').isIn([
    'walk_in','telefono','self_order_web','self_order_link','delivery'
  ]).withMessage('Tipo ordine non valido'),
  body('sconto').optional().isFloat({ min: 0 }).toFloat(),
  body('costo_consegna').optional().isFloat({ min: 0 }).toFloat(),
  body('servizi').optional().isFloat({ min: 0 }).toFloat(),
  validate
], async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const pizzeriaId = req.utente.pizzeriaId;
    await client.query(`SET LOCAL app.pizzeria_id = '${pizzeriaId}'`);

    const {
      cliente_id,
      nome_cliente_temp,
      telefono_temp,
      tipo_ordine,
      slot_richiesto,
      articoli,
      sconto          = 0,
      costo_consegna  = 0,
      servizi         = 0,
      tipo_pagamento,
      note,
    } = req.body;

    // 1. Numero ordine progressivo giornaliero
    const numRes = await client.query(
      'SELECT next_numero_ordine($1, CURRENT_DATE) AS num',
      [pizzeriaId]
    );
    const numeroOrdine = numRes.rows[0].num;

    // 2. Calcola subtotale articoli
    let subtotale = 0;
    const articoliElaborati = [];

    for (const art of articoli) {
      // Recupera prezzo attuale dal menu
      const menuRes = await client.query(
        `SELECT id, nome, prezzo FROM menu_articoli
         WHERE id = $1 AND pizzeria_id = $2 AND non_in_uso = false`,
        [art.articolo_id, pizzeriaId]
      );
      if (!menuRes.rows[0]) {
        await client.query('ROLLBACK');
        return badRequest(res,
          `Articolo id ${art.articolo_id} non trovato o non disponibile`
        );
      }
      const menuArt = menuRes.rows[0];

      // Calcola extra dalle aggiunte ingredienti
      let extraPrezzo = 0;
      const modifiche = art.modifiche || [];
      for (const mod of modifiche) {
        if (mod.tipo === 'aggiunta' && mod.ingrediente_id) {
          const ingRes = await client.query(
            'SELECT prezzo, descrizione FROM ingredienti WHERE id = $1 AND pizzeria_id = $2',
            [mod.ingrediente_id, pizzeriaId]
          );
          if (ingRes.rows[0]) {
            extraPrezzo += parseFloat(ingRes.rows[0].prezzo);
            mod.nome_ingrediente = ingRes.rows[0].descrizione;
          }
        } else if (mod.tipo === 'rimozione' && mod.ingrediente_id) {
          const ingRes = await client.query(
            'SELECT descrizione FROM ingredienti WHERE id = $1 AND pizzeria_id = $2',
            [mod.ingrediente_id, pizzeriaId]
          );
          if (ingRes.rows[0]) mod.nome_ingrediente = ingRes.rows[0].descrizione;
        }
      }

      const prezzoUnitario  = parseFloat(menuArt.prezzo) + extraPrezzo;
      const subtotaleArt    = prezzoUnitario * art.quantita;
      subtotale            += subtotaleArt;

      articoliElaborati.push({
        articolo_id:        art.articolo_id,
        nome_articolo:      menuArt.nome,
        prezzo_unitario:    prezzoUnitario,
        quantita:           art.quantita,
        subtotale_articolo: subtotaleArt,
        note:               art.note || null,
        modifiche,
      });
    }

    // 3. Calcola costo consegna automatico se delivery e non specificato
    let costoConsegnaFinale = costo_consegna;
    if (tipo_ordine === 'delivery' && costo_consegna === 0) {
      const configRes = await client.query(
        'SELECT delivery_attivo, delivery_costo_tipo, delivery_costo FROM pizzerie WHERE id = $1',
        [pizzeriaId]
      );
      const cfg = configRes.rows[0];
      if (cfg?.delivery_attivo) {
        if (cfg.delivery_costo_tipo === 'per_ordine') {
          costoConsegnaFinale = parseFloat(cfg.delivery_costo);
        } else if (cfg.delivery_costo_tipo === 'per_pizza') {
          const totalePizze = articoliElaborati.reduce((s, a) => s + a.quantita, 0);
          costoConsegnaFinale = parseFloat(cfg.delivery_costo) * totalePizze;
        }
      }
    }

    // Calcola totale finale
    const totale = Math.max(0, subtotale - sconto) + costoConsegnaFinale + servizi;

    // 4. Crea ordine
    const ordineRes = await client.query(
      `INSERT INTO ordini (
         pizzeria_id, numero_ordine, tipo_ordine,
         cliente_id, nome_cliente_temp, telefono_temp,
         slot_richiesto, tipo_pagamento, note,
         subtotale, sconto, costo_consegna, servizi, totale
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        pizzeriaId, numeroOrdine, tipo_ordine,
        cliente_id || null, nome_cliente_temp || null, telefono_temp || null,
        slot_richiesto || null, tipo_pagamento || null, note || null,
        subtotale.toFixed(2), sconto, costoConsegnaFinale, servizi, totale.toFixed(2)
      ]
    );
    const ordine = ordineRes.rows[0];

    // 5. Inserisce articoli e modifiche
    for (const art of articoliElaborati) {
      const artRes = await client.query(
        `INSERT INTO ordine_articoli (
           ordine_id, pizzeria_id, articolo_id, nome_articolo,
           prezzo_unitario, quantita, subtotale_articolo, note
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          ordine.id, pizzeriaId, art.articolo_id, art.nome_articolo,
          art.prezzo_unitario.toFixed(2), art.quantita,
          art.subtotale_articolo.toFixed(2), art.note
        ]
      );
      const ordineArticoloId = artRes.rows[0].id;

      // Inserisce modifiche (aggiunte/rimozioni ingredienti)
      for (const mod of art.modifiche) {
        await client.query(
          `INSERT INTO ordine_articoli_modifiche (
             ordine_articolo_id, ingrediente_id, nome_ingrediente,
             tipo, prezzo_extra
           ) VALUES ($1,$2,$3,$4,$5)`,
          [
            ordineArticoloId,
            mod.ingrediente_id || null,
            mod.nome_ingrediente || mod.tipo,
            mod.tipo,
            mod.tipo === 'aggiunta' ? (mod.prezzo_extra || 0) : 0
          ]
        );
      }
    }

    // 6. Associa cliente alla pizzeria se non già associato
    if (cliente_id) {
      await client.query(
        `INSERT INTO clienti_pizzerie (cliente_id, pizzeria_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [cliente_id, pizzeriaId]
      );
    }

    await client.query('COMMIT');

    // 7. Recupera ordine completo per risposta e Socket.io
    const ordineFull = await db.queryRLS(pizzeriaId,
      `SELECT o.*,
              c.nome AS cliente_nome, c.cognome AS cliente_cognome,
              c.cellulare AS cliente_cellulare
       FROM ordini o
       LEFT JOIN clienti c ON c.id = o.cliente_id
       WHERE o.id = $1`,
      [ordine.id]
    );

    // 8. Notifica real-time al tablet
    const io = req.app.get('io');
    if (io) notificaNuovoOrdine(pizzeriaId, ordineFull.rows[0]);

    logger.info(`✅ Ordine #${numeroOrdine} creato — pizzeria ${pizzeriaId} — €${totale.toFixed(2)}`);

    return created(res, {
      ...ordineFull.rows[0],
      chiave_tracking: ordine.chiave_tracking,
      link_tracking:   `${process.env.BASE_URL}/tracking/${ordine.chiave_tracking}`
    }, `Ordine #${numeroOrdine} creato`);

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('POST ordine:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /pizzeria/ordini/:id/stato
// Cambia stato ordine + notifica Socket.io + log WA
// ═══════════════════════════════════════════════════════════════
router.patch('/:id/stato', [
  param('id').isInt({ min: 1 }).toInt(),
  body('stato').isIn([
    'ricevuto','confermato','in_preparazione','pronto','consegnato','annullato'
  ]).withMessage('Stato non valido'),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { stato }  = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `UPDATE ordini SET stato = $1
       WHERE id = $2 AND pizzeria_id = $3
       RETURNING id, numero_ordine, stato, chiave_tracking,
                 cliente_id, nome_cliente_temp, totale`,
      [stato, req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Ordine non trovato');

    const ordine = result.rows[0];

    // Notifica Socket.io
    const io = req.app.get('io');
    if (io) {
      notificaStatoOrdine(pizzeriaId, ordine.chiave_tracking, {
        ordine_id:      ordine.id,
        numero_ordine:  ordine.numero_ordine,
        stato,
        updated_at:     new Date().toISOString()
      });
    }

    // Notifica WhatsApp reale tramite WAHA
    const messaggiStato = {
      confermato:       `✅ Ordine #${ordine.numero_ordine} confermato! Ti avviseremo quando sarà pronto.`,
      in_preparazione:  `👨‍🍳 Il tuo ordine #${ordine.numero_ordine} è in preparazione!`,
      pronto:           `🍕 Il tuo ordine #${ordine.numero_ordine} è PRONTO per il ritiro!`,
      consegnato:       `✅ Ordine #${ordine.numero_ordine} consegnato. Grazie e buon appetito!`,
      annullato:        `❌ Ordine #${ordine.numero_ordine} annullato. Ci scusiamo per il disagio.`,
    };

    if (messaggiStato[stato]) {
      // Salva comunicazione nel DB
      await db.queryRLS(pizzeriaId,
        `INSERT INTO ordine_comunicazioni (ordine_id, canale, testo, stato)
         VALUES ($1, 'whatsapp', $2, 'in_attesa')`,
        [ordine.id, messaggiStato[stato]]
      );

      // Manda WA se cliente ha numero
      const numeroCliente = ordine.cliente_id
        ? (await db.query('SELECT cellulare FROM clienti WHERE id = $1', [ordine.cliente_id])).rows[0]?.cellulare
        : ordine.telefono_temp;

      if (numeroCliente) {
        try {
          const { mandaNotificaOrdine } = require('../whatsapp');
          const inviato = await mandaNotificaOrdine(
            pizzeriaId, numeroCliente, messaggiStato[stato]
          );
          // Aggiorna stato comunicazione
          await db.queryRLS(pizzeriaId,
            `UPDATE ordine_comunicazioni SET stato = $1
             WHERE ordine_id = $2 AND canale = 'whatsapp'
             ORDER BY inviato_at DESC LIMIT 1`,
            [inviato ? 'inviato' : 'errore', ordine.id]
          );
        } catch (waErr) {
          logger.warn(`WA notifica fallita ordine ${ordine.id}:`, waErr.message);
        }
      }
    }

    return ok(res, ordine, `Stato aggiornato: ${stato}`);
  } catch (err) {
    logger.error('PATCH stato ordine:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /pizzeria/ordini/:id/pagamento
// Aggiorna stato pagamento
// ═══════════════════════════════════════════════════════════════
router.patch('/:id/pagamento', [
  param('id').isInt({ min: 1 }).toInt(),
  body('stato_pagamento').isIn(['pagato','non_pagato','parziale']),
  body('tipo_pagamento').optional().isIn(['contanti','carta','online','pos']),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { stato_pagamento, tipo_pagamento } = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `UPDATE ordini SET
         stato_pagamento = $1,
         tipo_pagamento  = COALESCE($2, tipo_pagamento)
       WHERE id = $3 AND pizzeria_id = $4
       RETURNING id, numero_ordine, stato_pagamento, tipo_pagamento`,
      [stato_pagamento, tipo_pagamento || null, req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Ordine non trovato');

    // Notifica Socket.io
    const io = req.app.get('io');
    if (io) {
      const { emitToPizzeria } = require('../../socket');
      emitToPizzeria(pizzeriaId, 'ordine:pagamento', result.rows[0]);
    }

    return ok(res, result.rows[0], 'Pagamento aggiornato');
  } catch (err) {
    logger.error('PATCH pagamento ordine:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /pizzeria/ordini/:id
// Annulla ordine
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const result = await db.queryRLS(pizzeriaId,
      `UPDATE ordini SET stato = 'annullato'
       WHERE id = $1 AND pizzeria_id = $2
         AND stato NOT IN ('consegnato','annullato')
       RETURNING id, numero_ordine, chiave_tracking`,
      [req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) {
      return badRequest(res, 'Ordine non trovato o non annullabile');
    }

    const io = req.app.get('io');
    if (io) {
      notificaStatoOrdine(pizzeriaId, result.rows[0].chiave_tracking, {
        ordine_id: result.rows[0].id,
        stato:     'annullato'
      });
    }

    return ok(res, result.rows[0], 'Ordine annullato');
  } catch (err) {
    logger.error('DELETE ordine:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/ordini/:id/stampa
// Prepara dati per stampa termica (cucina o cassa)
// ═══════════════════════════════════════════════════════════════
router.post('/:id/stampa', [
  param('id').isInt({ min: 1 }).toInt(),
  body('tipo').isIn(['cucina','cassa']).withMessage('tipo: cucina o cassa'),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const ordine = await db.queryRLS(pizzeriaId,
      `SELECT o.id, o.numero_ordine, o.data_ordine, o.ora_ordine,
              o.tipo_ordine, o.stato, o.note,
              o.subtotale, o.sconto, o.costo_consegna, o.servizi, o.totale,
              o.tipo_pagamento, o.stato_pagamento,
              o.nome_cliente_temp, o.telefono_temp,
              o.slot_richiesto,
              c.nome AS cliente_nome, c.cognome AS cliente_cognome,
              c.cellulare AS cliente_cellulare,
              c.via AS cliente_via, c.citta AS cliente_citta,
              p.nome AS pizzeria_nome,
              TRIM(CONCAT_WS(', ',
                NULLIF(TRIM(CONCAT(COALESCE(p.via,''), ' ', COALESCE(p.numero_civico,''))), ''),
                NULLIF(TRIM(CONCAT(COALESCE(p.cap,''), ' ', COALESCE(p.citta,''))), '')
              )) AS pizzeria_indirizzo,
              p.telefono AS pizzeria_telefono,
              p.stampa_intestazione,
              p.stampa_logo_url,
              p.stampante_cassa_ip, p.stampante_cassa_porta,
              p.stampante_cucina_ip, p.stampante_cucina_porta
       FROM ordini o
       LEFT JOIN clienti c ON c.id = o.cliente_id
       JOIN pizzerie p ON p.id = o.pizzeria_id
       WHERE o.id = $1 AND o.pizzeria_id = $2`,
      [req.params.id, pizzeriaId]
    );
    if (!ordine.rows[0]) return notFound(res, 'Ordine non trovato');

    const articoli = await db.queryRLS(pizzeriaId,
      `SELECT oa.nome_articolo, oa.quantita, oa.prezzo_unitario,
              oa.subtotale_articolo, oa.note,
              COALESCE(
                json_agg(json_build_object(
                  'tipo', m.tipo,
                  'ingrediente', m.nome_ingrediente
                )) FILTER (WHERE m.id IS NOT NULL),
                '[]'
              ) AS modifiche
       FROM ordine_articoli oa
       LEFT JOIN ordine_articoli_modifiche m ON m.ordine_articolo_id = oa.id
       WHERE oa.ordine_id = $1
       GROUP BY oa.id
       ORDER BY oa.id`,
      [req.params.id]
    );

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const o       = ordine.rows[0];

    // Struttura dati ottimizzata per la stampante termica
    const datiStampa = {
      tipo:         req.body.tipo,
      timestamp:    new Date().toISOString(),
      pizzeria: {
        nome:             o.pizzeria_nome,
        indirizzo:        o.pizzeria_indirizzo,
        telefono:         o.pizzeria_telefono,
        stampa_intestazione: o.stampa_intestazione,
        stampa_logo_url:  o.stampa_logo_url
          ? `${baseUrl}/storage/${o.stampa_logo_url}`
          : `${baseUrl}/storage/defaults/placeholder/logo-default.png`,
      },
      // IP stampante per il frontend
      stampante: {
        ip:    req.body.tipo === 'cassa'
          ? o.stampante_cassa_ip
          : o.stampante_cucina_ip,
        porta: req.body.tipo === 'cassa'
          ? (o.stampante_cassa_porta || 8008)
          : (o.stampante_cucina_porta || 8008),
      },
      ordine: {
        numero:     o.numero_ordine,
        data:       o.data_ordine,
        ora:        o.ora_ordine,
        tipo:       o.tipo_ordine,
        slot:       o.slot_richiesto,
        note:       o.note,
      },
      cliente: {
        nome:     o.cliente_nome || o.nome_cliente_temp,
        telefono: o.cliente_cellulare || o.telefono_temp,
        via:      o.cliente_via,
        citta:    o.cliente_citta,
      },
      articoli: articoli.rows,
    };

    // Per la cassa aggiungi i totali
    if (req.body.tipo === 'cassa') {
      datiStampa.totali = {
        subtotale:       o.subtotale,
        sconto:          o.sconto,
        costo_consegna:  o.costo_consegna,
        servizi:         o.servizi,
        totale:          o.totale,
        pagamento:       o.tipo_pagamento,
        stato_pagamento: o.stato_pagamento,
      };
    }

    // Emetti evento Socket.io per far stampare il tablet
    const io = req.app.get('io');
    if (io) {
      const { emitToPizzeria } = require('../../socket');
      emitToPizzeria(pizzeriaId, 'stampa:richiesta', datiStampa);
    }

    return ok(res, datiStampa, 'Dati stampa pronti');
  } catch (err) {
    logger.error('POST stampa ordine:', err);
    return serverError(res);
  }
});

module.exports = router;
