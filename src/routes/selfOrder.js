const router   = require('express').Router();
const { param, body } = require('express-validator');
const db       = require('../config/database');
const { validate }    = require('../middleware/validate');
const { ok, notFound, badRequest, created, serverError, conflict } = require('../utils/response');
const { calcolaSlot } = require('./pizzeria/slot');
const logger   = require('../utils/logger');

// ── Rate limiting anti-bruteforce ────────────────────────────
// Ritardo 5 secondi su codice sbagliato
const tentativi = new Map(); // IP → { count, lastReset }

function rateLimitSelfOrder(req, res, next) {
  const ip   = req.ip;
  const ora  = Date.now();
  const rec  = tentativi.get(ip) || { count: 0, lastReset: ora };

  // Reset finestra ogni minuto
  if (ora - rec.lastReset > 60000) {
    rec.count     = 0;
    rec.lastReset = ora;
  }

  rec.count++;
  tentativi.set(ip, rec);

  // Dopo 10 tentativi falliti → delay 5 secondi
  if (rec.count > 10) {
    return new Promise(resolve => setTimeout(resolve, 5000)).then(() => {
      res.status(429).json({
        ok:       false,
        codice:   'RATE_LIMIT',
        messaggio: 'Troppi tentativi. Riprova tra qualche minuto.'
      });
    });
  }

  next();
}

// ── Helper: trova pizzeria + cliente dal codice ────────────────
async function trovaPizzeriaCliente(slug, codice) {
  const pizzeria = await db.query(
    `SELECT id, nome, slug, logo_url, descrizione,
            delivery_attivo, delivery_costo_tipo, delivery_costo,
            delivery_note, selforder_attivo,
            slot_minuti, slot_max_pizze
     FROM pizzerie
     WHERE slug = $1 AND attiva = true`,
    [slug]
  );
  if (!pizzeria.rows[0]) return { errore: 'pizzeria' };
  if (!pizzeria.rows[0].selforder_attivo) return { errore: 'selforder_disabilitato' };

  const cliente = await db.query(
    'SELECT * FROM clienti WHERE codice_cliente = $1',
    [codice]
  );
  if (!cliente.rows[0]) return { errore: 'cliente' };

  return {
    pizzeria: pizzeria.rows[0],
    cliente:  cliente.rows[0]
  };
}

// ═══════════════════════════════════════════════════════════════
// GET /self-order/:slug/:codice
// Schermata iniziale — logo, nome pizzeria, info delivery
// ═══════════════════════════════════════════════════════════════
router.get('/:slug/:codice', rateLimitSelfOrder, [
  param('slug').trim(),
  param('codice').isLength({ min: 8, max: 8 }).trim().toUpperCase(),
  validate
], async (req, res) => {
  try {
    const { slug, codice } = req.params;
    const result = await trovaPizzeriaCliente(slug, codice);

    if (result.errore === 'pizzeria') {
      return notFound(res, 'Pizzeria non trovata');
    }
    if (result.errore === 'selforder_disabilitato') {
      return badRequest(res, 'Il self-order non è attivo per questa pizzeria');
    }
    if (result.errore === 'cliente') {
      // Delay 5s anti-bruteforce
      await new Promise(r => setTimeout(r, 5000));
      return notFound(res, 'Link non valido');
    }

    const { pizzeria, cliente } = result;

    // Azzera contatore tentativi per questo IP (ha trovato il link)
    tentativi.delete(req.ip);

    // Costruisce URL logo
    const baseUrl  = process.env.BASE_URL || 'http://localhost:3000';
    const logoUrl  = pizzeria.logo_url
      ? `${baseUrl}/storage/${pizzeria.logo_url}`
      : `${baseUrl}/storage/defaults/placeholder/logo-default.png`;

    return ok(res, {
      pizzeria: {
        id:               pizzeria.id,
        nome:             pizzeria.nome,
        slug:             pizzeria.slug,
        logo_url:         logoUrl,
        descrizione:      pizzeria.descrizione,
        delivery_attivo:  pizzeria.delivery_attivo,
        delivery_costo_tipo: pizzeria.delivery_costo_tipo,
        delivery_costo:   pizzeria.delivery_costo,
        delivery_note:    pizzeria.delivery_note,
      },
      cliente: {
        // Dati precompilati ma non esponiamo info sensibili
        nome:           cliente.nome,
        cognome:        cliente.cognome,
        cellulare:      cliente.cellulare,
        email:          cliente.email,
        via:            cliente.via,
        numero_civico:  cliente.numero_civico,
        cap:            cliente.cap,
        citta:          cliente.citta,
        provincia:      cliente.provincia,
        // Flag se il profilo è completo
        profilo_completo: !!(cliente.nome && cliente.cognome),
      }
    });
  } catch (err) {
    logger.error('GET self-order iniziale:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /self-order/:slug/:codice/menu
// Menu completo della pizzeria (categorie + articoli)
// ═══════════════════════════════════════════════════════════════
router.get('/:slug/:codice/menu', [
  param('slug').trim(),
  param('codice').isLength({ min: 8, max: 8 }).trim().toUpperCase(),
  validate
], async (req, res) => {
  try {
    const result = await trovaPizzeriaCliente(req.params.slug, req.params.codice);
    if (result.errore) return notFound(res, 'Link non valido');

    const { pizzeria } = result;

    // Categorie con articoli
    const categorie = await db.query(
      `SELECT id, nome, icona_url, ordine
       FROM categorie_menu
       WHERE pizzeria_id = $1 AND attiva = true
       ORDER BY ordine, nome`,
      [pizzeria.id]
    );

    const articoli = await db.query(
      `SELECT
         ma.id, ma.categoria_id, ma.nome, ma.icona_url,
         ma.prezzo, ma.note, ma.ordine,
         ma.non_disponibile,
         ma.allergeni_extra,
         get_allergeni_articolo(ma.id) AS allergeni_calcolati,
         COALESCE(
           json_agg(
             json_build_object(
               'id',          i.id,
               'descrizione', i.descrizione,
               'prezzo',      i.prezzo
             )
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'
         ) AS ingredienti
       FROM menu_articoli ma
       LEFT JOIN menu_articoli_ingredienti mai ON mai.articolo_id = ma.id
       LEFT JOIN ingredienti i ON i.id = mai.ingrediente_id
       WHERE ma.pizzeria_id = $1
         AND ma.non_in_uso = false
       GROUP BY ma.id
       ORDER BY ma.categoria_id, ma.ordine, ma.nome`,
      [pizzeria.id]
    );

    // Costruisce URL immagini
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const articoliConUrl = articoli.rows.map(a => ({
      ...a,
      icona_url: a.icona_url
        ? `${baseUrl}/storage/${a.icona_url}`
        : `${baseUrl}/storage/defaults/placeholder/pizza-default.png`
    }));

    // Raggruppa articoli per categoria
    const menu = categorie.rows.map(cat => ({
      ...cat,
      articoli: articoliConUrl.filter(a => a.categoria_id === cat.id)
    })).filter(cat => cat.articoli.length > 0);

    return ok(res, { menu });
  } catch (err) {
    logger.error('GET self-order menu:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /self-order/:slug/:codice/slot
// Slot disponibili per oggi e domani
// ═══════════════════════════════════════════════════════════════
router.get('/:slug/:codice/slot', [
  param('slug').trim(),
  param('codice').isLength({ min: 8, max: 8 }).trim().toUpperCase(),
  validate
], async (req, res) => {
  try {
    const result = await trovaPizzeriaCliente(req.params.slug, req.params.codice);
    if (result.errore) return notFound(res, 'Link non valido');

    const { pizzeria } = result;
    const ora = new Date();

    // Calcola slot per oggi e domani
    const giorni = [];
    for (let i = 0; i < 2; i++) {
      const data = new Date(ora);
      data.setDate(data.getDate() + i);
      const dataStr = data.toISOString().split('T')[0];

      const slotGiorno = await calcolaSlot(pizzeria.id, dataStr);

      // Filtra slot già passati (per oggi)
      if (i === 0 && slotGiorno.slots) {
        const oraCorrente = ora.toISOString();
        // Lascia solo slot futuri con almeno 20 minuti di anticipo
        const limiteMin = new Date(ora.getTime() + 20 * 60000).toISOString();
        slotGiorno.slots = slotGiorno.slots.filter(
          s => s.inizio > limiteMin && s.disponibile
        );
      } else if (slotGiorno.slots) {
        slotGiorno.slots = slotGiorno.slots.filter(s => s.disponibile);
      }

      giorni.push(slotGiorno);
    }

    return ok(res, { giorni });
  } catch (err) {
    logger.error('GET self-order slot:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /self-order/:slug/:codice/ordine
// Crea l'ordine dal self-order
// ═══════════════════════════════════════════════════════════════
router.post('/:slug/:codice/ordine', [
  param('slug').trim(),
  param('codice').isLength({ min: 8, max: 8 }).trim().toUpperCase(),
  body('tipo_ordine').isIn(['asporto', 'delivery'])
    .withMessage('Tipo ordine non valido'),
  body('slot_richiesto').notEmpty()
    .withMessage('Slot orario obbligatorio'),
  body('articoli').isArray({ min: 1 })
    .withMessage('Almeno un articolo obbligatorio'),
  body('articoli.*.articolo_id').isInt({ min: 1 }).toInt(),
  body('articoli.*.quantita').isInt({ min: 1 }).toInt(),
  // Dati cliente (possono aggiornare il profilo)
  body('cliente.nome').notEmpty().trim()
    .withMessage('Nome obbligatorio'),
  body('cliente.cognome').notEmpty().trim()
    .withMessage('Cognome obbligatorio'),
  body('cliente.cellulare').notEmpty().trim(),
  // Delivery: indirizzo obbligatorio
  body('cliente.via').if(body('tipo_ordine').equals('delivery'))
    .notEmpty().withMessage('Via obbligatoria per la consegna'),
  body('cliente.citta').if(body('tipo_ordine').equals('delivery'))
    .notEmpty().withMessage('Città obbligatoria per la consegna'),
  validate
], async (req, res) => {
  const dbClient = await db.pool.connect();
  try {
    await dbClient.query('BEGIN');

    const result = await trovaPizzeriaCliente(req.params.slug, req.params.codice);
    if (result.errore) {
      await dbClient.query('ROLLBACK');
      return notFound(res, 'Link non valido');
    }

    const { pizzeria, cliente } = result;
    const { tipo_ordine, slot_richiesto, articoli, note } = req.body;
    const datiCliente = req.body.cliente;

    // ── Verifica delivery abilitato ────────────────────────────
    if (tipo_ordine === 'delivery' && !pizzeria.delivery_attivo) {
      await dbClient.query('ROLLBACK');
      return badRequest(res, 'La consegna a domicilio non è disponibile');
    }

    // ── Verifica slot disponibile ──────────────────────────────
    const slotData  = new Date(slot_richiesto).toISOString().split('T')[0];
    const slotCheck = await calcolaSlot(pizzeria.id, slotData);
    const slotTrovato = slotCheck.slots?.find(
      s => s.inizio === new Date(slot_richiesto).toISOString() && s.disponibile
    );
    if (!slotTrovato) {
      await dbClient.query('ROLLBACK');
      return conflict(res, 'SLOT_NON_DISPONIBILE',
        'Lo slot selezionato non è più disponibile. Scegli un altro orario.');
    }

    // ── Aggiorna dati cliente (nome, cognome, indirizzo) ───────
    await dbClient.query(
      `UPDATE clienti SET
         nome          = COALESCE($1, nome),
         cognome       = COALESCE($2, cognome),
         email         = COALESCE($3, email),
         via           = COALESCE($4, via),
         numero_civico = COALESCE($5, numero_civico),
         cap           = COALESCE($6, cap),
         citta         = COALESCE($7, citta),
         provincia     = COALESCE($8, provincia),
         note          = COALESCE($9, note)
       WHERE id = $10`,
      [
        datiCliente.nome         || null,
        datiCliente.cognome      || null,
        datiCliente.email        || null,
        datiCliente.via          || null,
        datiCliente.numero_civico|| null,
        datiCliente.cap          || null,
        datiCliente.citta        || null,
        datiCliente.provincia    || null,
        datiCliente.note_consegna|| null,
        cliente.id
      ]
    );

    // ── Associa cliente alla pizzeria ──────────────────────────
    await dbClient.query(
      `INSERT INTO clienti_pizzerie (cliente_id, pizzeria_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [cliente.id, pizzeria.id]
    );

    // ── Calcola subtotale articoli ─────────────────────────────
    await dbClient.query(`SET LOCAL app.pizzeria_id = '${pizzeria.id}'`);

    let subtotale = 0;
    const articoliElaborati = [];

    for (const art of articoli) {
      const menuRes = await dbClient.query(
        `SELECT id, nome, prezzo FROM menu_articoli
         WHERE id = $1 AND pizzeria_id = $2
           AND non_in_uso = false AND non_disponibile = false`,
        [art.articolo_id, pizzeria.id]
      );
      if (!menuRes.rows[0]) {
        await dbClient.query('ROLLBACK');
        return badRequest(res, `Articolo non disponibile: id ${art.articolo_id}`);
      }

      const menuArt = menuRes.rows[0];
      let   extraPrezzo = 0;
      const modifiche   = art.modifiche || [];

      for (const mod of modifiche) {
        if (mod.tipo === 'aggiunta' && mod.ingrediente_id) {
          const ingRes = await dbClient.query(
            'SELECT prezzo, descrizione FROM ingredienti WHERE id = $1 AND pizzeria_id = $2',
            [mod.ingrediente_id, pizzeria.id]
          );
          if (ingRes.rows[0]) {
            extraPrezzo        += parseFloat(ingRes.rows[0].prezzo);
            mod.nome_ingrediente = ingRes.rows[0].descrizione;
          }
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

    // ── Calcola costo consegna ─────────────────────────────────
    let costoConsegna = 0;
    if (tipo_ordine === 'delivery') {
      if (pizzeria.delivery_costo_tipo === 'per_ordine') {
        costoConsegna = parseFloat(pizzeria.delivery_costo);
      } else if (pizzeria.delivery_costo_tipo === 'per_pizza') {
        const totalePizze = articoliElaborati.reduce(
          (sum, a) => sum + a.quantita, 0
        );
        costoConsegna = parseFloat(pizzeria.delivery_costo) * totalePizze;
      }
    }

    const totale = subtotale + costoConsegna;

    // ── Numero ordine progressivo giornaliero ──────────────────
    const numRes = await dbClient.query(
      'SELECT next_numero_ordine($1, CURRENT_DATE) AS num',
      [pizzeria.id]
    );
    const numeroOrdine = numRes.rows[0].num;

    // ── Crea ordine ───────────────────────────────────────────
    const ordineRes = await dbClient.query(
      `INSERT INTO ordini (
         pizzeria_id, numero_ordine, tipo_ordine,
         cliente_id, slot_richiesto, note,
         subtotale, costo_consegna, totale,
         stato, stato_pagamento
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ricevuto','non_pagato')
       RETURNING *`,
      [
        pizzeria.id, numeroOrdine,
        tipo_ordine === 'delivery' ? 'delivery' : 'self_order_web',
        cliente.id, slot_richiesto, note || null,
        subtotale.toFixed(2), costoConsegna.toFixed(2), totale.toFixed(2)
      ]
    );
    const ordine = ordineRes.rows[0];

    // ── Inserisce articoli ────────────────────────────────────
    for (const art of articoliElaborati) {
      const artRes = await dbClient.query(
        `INSERT INTO ordine_articoli (
           ordine_id, pizzeria_id, articolo_id, nome_articolo,
           prezzo_unitario, quantita, subtotale_articolo, note
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [
          ordine.id, pizzeria.id, art.articolo_id, art.nome_articolo,
          art.prezzo_unitario.toFixed(2), art.quantita,
          art.subtotale_articolo.toFixed(2), art.note
        ]
      );
      for (const mod of art.modifiche) {
        await dbClient.query(
          `INSERT INTO ordine_articoli_modifiche
             (ordine_articolo_id, ingrediente_id, nome_ingrediente, tipo, prezzo_extra)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            artRes.rows[0].id,
            mod.ingrediente_id || null,
            mod.nome_ingrediente || '',
            mod.tipo,
            mod.tipo === 'aggiunta' ? (mod.prezzo_extra || 0) : 0
          ]
        );
      }
    }

    await dbClient.query('COMMIT');

    // ── Notifica Socket.io al tablet ───────────────────────────
    const io = require('../app').io;
    if (io) {
      const { notificaNuovoOrdine } = require('../socket');
      notificaNuovoOrdine(pizzeria.id, {
        ...ordine,
        cliente_nome:    `${datiCliente.nome} ${datiCliente.cognome}`,
        cliente_cellulare: cliente.cellulare
      });
    }

    logger.info(`Self-order #${numeroOrdine} — ${pizzeria.nome} — €${totale.toFixed(2)}`);

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    return created(res, {
      ordine_id:       ordine.id,
      numero_ordine:   numeroOrdine,
      totale:          totale.toFixed(2),
      costo_consegna:  costoConsegna.toFixed(2),
      slot_richiesto,
      tipo_ordine,
      chiave_tracking: ordine.chiave_tracking,
      link_tracking:   `${baseUrl}/api/v1/tracking/${ordine.chiave_tracking}`,
      messaggio:       `Ordine #${numeroOrdine} ricevuto! Ti aggiorneremo sullo stato.`
    }, `Ordine #${numeroOrdine} ricevuto`);

  } catch (err) {
    await dbClient.query('ROLLBACK');
    logger.error('POST self-order ordine:', err);
    return serverError(res);
  } finally {
    dbClient.release();
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /self-order/inizia
// Link generico (QR code / sito) — riceve numero telefono
// e manda il link personalizzato via WhatsApp o SMS
// ═══════════════════════════════════════════════════════════════
router.post('/:slug/inizia', [
  param('slug').trim(),
  body('cellulare').notEmpty().trim()
    .withMessage('Numero di cellulare obbligatorio'),
  body('ha_whatsapp').isBoolean().toBoolean()
    .withMessage('Indicare se ha WhatsApp'),
  validate
], async (req, res) => {
  const dbClient = await db.pool.connect();
  try {
    await dbClient.query('BEGIN');

    const { slug }      = req.params;
    const { cellulare, ha_whatsapp } = req.body;
    const numCli = cellulare.replace(/[\s\-\+]/g, '');

    // Trova pizzeria
    const pizzeriaRes = await dbClient.query(
      `SELECT id, nome, slug, wa_session_attiva
       FROM pizzerie WHERE slug = $1 AND attiva = true`,
      [slug]
    );
    if (!pizzeriaRes.rows[0]) {
      await dbClient.query('ROLLBACK');
      return notFound(res, 'Pizzeria non trovata');
    }
    const pizzeria = pizzeriaRes.rows[0];

    // Trova o crea cliente
    let clienteId, codiceCliente, clienteNuovo = false;

    const clienteRes = await dbClient.query(
      'SELECT id, codice_cliente FROM clienti WHERE cellulare = $1',
      [numCli]
    );

    if (clienteRes.rows[0]) {
      clienteId     = clienteRes.rows[0].id;
      codiceCliente = clienteRes.rows[0].codice_cliente;
    } else {
      // Genera codice unico
      let codice, esiste;
      do {
        codice = generaCodice();
        esiste = await dbClient.query(
          'SELECT id FROM clienti WHERE codice_cliente = $1', [codice]
        );
      } while (esiste.rows.length > 0);

      const insRes = await dbClient.query(
        `INSERT INTO clienti
           (cellulare, codice_cliente, whatsapp_abilitato, tipo_inserimento)
         VALUES ($1, $2, $3, 'web') RETURNING id`,
        [numCli, codice, ha_whatsapp]
      );
      clienteId     = insRes.rows[0].id;
      codiceCliente = codice;
      clienteNuovo  = true;
    }

    // Aggiorna flag whatsapp se il cliente esiste già
    if (!clienteNuovo) {
      await dbClient.query(
        'UPDATE clienti SET whatsapp_abilitato = $1 WHERE id = $2',
        [ha_whatsapp, clienteId]
      );
    }

    // Associa a pizzeria
    await dbClient.query(
      `INSERT INTO clienti_pizzerie (cliente_id, pizzeria_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [clienteId, pizzeria.id]
    );

    await dbClient.query('COMMIT');

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const link    = `${baseUrl}/ordina/${pizzeria.slug}/${codiceCliente}`;

    // Manda WA se disponibile e cliente ha WA
    let inviato = false;
    if (ha_whatsapp && pizzeria.wa_session_attiva) {
      try {
        await mandaLinkWA(pizzeria, numCli, link);
        inviato = true;
      } catch (err) {
        logger.error('Errore invio WA self-order inizia:', err.message);
      }
    }

    return ok(res, {
      link,
      inviato_whatsapp: inviato,
      messaggio: inviato
        ? 'Ti abbiamo inviato il link su WhatsApp!'
        : `Il tuo link: ${link}`
    });

  } catch (err) {
    await dbClient.query('ROLLBACK');
    logger.error('POST self-order inizia:', err);
    return serverError(res);
  } finally {
    dbClient.release();
  }
});

// ─── Helpers ──────────────────────────────────────────────────
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function generaCodice() {
  let c = '';
  for (let i = 0; i < 8; i++) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return c;
}

async function mandaLinkWA(pizzeria, numero, link) {
  const wahaUrl   = process.env.WAHA_URL || 'http://localhost:3001';
  const sessionId = `pizzeria_${pizzeria.id}`;
  let   num       = numero.replace(/\D/g, '');
  if (num.startsWith('0')) num = '39' + num.slice(1);
  if (!num.startsWith('39')) num = '39' + num;

  const testo =
    `🍕 *${pizzeria.nome}*\n\n` +
    `Clicca qui per ordinare online:\n${link}\n\n` +
    `_Salva questo link per i tuoi prossimi ordini!_`;

  const r = await fetch(`${wahaUrl}/api/sendText`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ session: sessionId, chatId: `${num}@c.us`, text: testo })
  });
  if (!r.ok) throw new Error(`WAHA ${r.status}`);
}

module.exports = router;
