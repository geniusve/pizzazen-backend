const router = require('express').Router();
const { body } = require('express-validator');
const db       = require('../config/database');
const { validate }   = require('../middleware/validate');
const { ok, badRequest, serverError, notFound } = require('../utils/response');
const logger   = require('../utils/logger');

const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generaCodiceCliente() {
  let c = '';
  for (let i = 0; i < 8; i++) c += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  return c;
}

async function codiceUnico() {
  let codice, esiste;
  do {
    codice = generaCodiceCliente();
    esiste = await db.query('SELECT id FROM clienti WHERE codice_cliente = $1', [codice]);
  } while (esiste.rows.length > 0);
  return codice;
}

// ── Chiave segreta centralino ────────────────────────────────────────────────
const verificaChiaveCentralino = (req, res, next) => {
  const chiave = req.headers['x-centralino-key'];
  if (!chiave || chiave !== process.env.CENTRALINO_KEY) {
    logger.warn(`Accesso centralino non autorizzato da ${req.ip}`);
    return res.status(401).json({ ok: false, messaggio: 'Non autorizzato' });
  }
  next();
};

// ── Logica condivisa: trova/crea cliente e genera link ───────────────────────
async function elaboraChiamata(numeroPizzeria, numeroCliente, pizzeriaId) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const numPiz = numeroPizzeria.replace(/[\s\-\+]/g, '');
    const numCli = numeroCliente?.replace(/[\s\-\+]/g, '') || null;

    // Trova pizzeria
    let pizzeria;
    if (pizzeriaId) {
      const r = await client.query(
        'SELECT id, nome, slug, wa_session_attiva FROM pizzerie WHERE id = $1 AND attiva = true',
        [pizzeriaId]
      );
      pizzeria = r.rows[0];
    } else {
      const r = await client.query(
        `SELECT id, nome, slug, wa_session_attiva FROM pizzerie
         WHERE (REPLACE(REPLACE(telefono,' ',''),'-','') = $1
             OR REPLACE(REPLACE(cellulare,' ',''),'-','') = $1)
           AND attiva = true`,
        [numPiz]
      );
      pizzeria = r.rows[0];
    }

    if (!pizzeria) {
      await client.query('ROLLBACK');
      return { errore: 'pizzeria_non_trovata' };
    }

    if (!numCli) {
      await client.query('ROLLBACK');
      return {
        pizzeria_id:        pizzeria.id,
        pizzeria_nome:      pizzeria.nome,
        numero_disponibile: false,
        messaggio:          'Numero cliente non disponibile — chiedere al cliente di digitarlo'
      };
    }

    // Trova o crea cliente
    let clienteId, codiceCliente, clienteNuovo = false;
    const clienteRes = await client.query(
      'SELECT id, codice_cliente FROM clienti WHERE cellulare = $1', [numCli]
    );

    if (clienteRes.rows[0]) {
      clienteId     = clienteRes.rows[0].id;
      codiceCliente = clienteRes.rows[0].codice_cliente;
    } else {
      // Genera codice unico
      let codice, esiste;
      do {
        codice = generaCodiceCliente();
        esiste = await client.query('SELECT id FROM clienti WHERE codice_cliente = $1', [codice]);
      } while (esiste.rows.length > 0);

      const insRes = await client.query(
        `INSERT INTO clienti (cellulare, codice_cliente, tipo_inserimento, whatsapp_abilitato)
         VALUES ($1,$2,'centralino',true) RETURNING id`,
        [numCli, codice]
      );
      clienteId    = insRes.rows[0].id;
      codiceCliente = codice;
      clienteNuovo = true;
    }

    await client.query(
      `INSERT INTO clienti_pizzerie (cliente_id, pizzeria_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [clienteId, pizzeria.id]
    );

    await client.query('COMMIT');

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const link    = `${baseUrl}/ordina/${pizzeria.slug}/${codiceCliente}`;

    return {
      pizzeria_id:        pizzeria.id,
      pizzeria_nome:      pizzeria.nome,
      pizzeria:           pizzeria,
      cliente_id:         clienteId,
      cliente_nuovo:      clienteNuovo,
      codice_cliente:     codiceCliente,
      link,
      numero_disponibile: true,
      numero_cliente:     numCli
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/centralino/chiamata
// ═══════════════════════════════════════════════════════════════════════════
router.post('/chiamata', verificaChiaveCentralino, [
  body('numero_pizzeria').notEmpty().trim().withMessage('numero_pizzeria obbligatorio'),
  body('numero_cliente').optional({ nullable: true }).trim(),
  body('azione').optional().isIn(['link_whatsapp', 'solo_crea']),
  validate
], async (req, res) => {
  try {
    const { numero_cliente, numero_pizzeria, azione = 'link_whatsapp' } = req.body;

    const risultato = await elaboraChiamata(numero_pizzeria, numero_cliente, null);

    if (risultato.errore === 'pizzeria_non_trovata') {
      return notFound(res, `Nessuna pizzeria trovata per il numero ${numero_pizzeria}`);
    }
    if (!risultato.numero_disponibile) {
      return ok(res, risultato);
    }

    // Manda WhatsApp se richiesto e WAHA attivo
    let waInviato = false;
    if (azione === 'link_whatsapp' && risultato.pizzeria?.wa_session_attiva) {
      try {
        await mandaLinkWhatsApp(risultato.pizzeria, risultato.numero_cliente, risultato.link);
        waInviato = true;
      } catch (waErr) {
        logger.error(`Centralino WA error: ${waErr.message}`);
      }
    }

    logger.info(`Centralino: link=${risultato.link} wa=${waInviato}`);

    return ok(res, {
      pizzeria_id:        risultato.pizzeria_id,
      pizzeria_nome:      risultato.pizzeria_nome,
      cliente_id:         risultato.cliente_id,
      cliente_nuovo:      risultato.cliente_nuovo,
      codice_cliente:     risultato.codice_cliente,
      link:               risultato.link,
      wa_inviato:         waInviato,
      numero_disponibile: true
    });

  } catch (err) {
    logger.error('Errore centralino/chiamata:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/centralino/digita-numero
// Usato quando il numero cliente non era disponibile dalla deviazione.
// FIX: ora usa la stessa funzione condivisa invece di router.handle()
// ═══════════════════════════════════════════════════════════════════════════
router.post('/digita-numero', verificaChiaveCentralino, [
  body('numero_cliente').notEmpty().trim().withMessage('numero_cliente obbligatorio'),
  body('numero_pizzeria').notEmpty().trim().withMessage('numero_pizzeria obbligatorio'),
  validate
], async (req, res) => {
  try {
    const { numero_cliente, numero_pizzeria } = req.body;

    const risultato = await elaboraChiamata(numero_pizzeria, numero_cliente, null);

    if (risultato.errore === 'pizzeria_non_trovata') {
      return notFound(res, `Nessuna pizzeria trovata per il numero ${numero_pizzeria}`);
    }

    let waInviato = false;
    if (risultato.pizzeria?.wa_session_attiva && risultato.numero_cliente) {
      try {
        await mandaLinkWhatsApp(risultato.pizzeria, risultato.numero_cliente, risultato.link);
        waInviato = true;
      } catch (waErr) {
        logger.error(`Centralino WA error: ${waErr.message}`);
      }
    }

    return ok(res, {
      pizzeria_id:    risultato.pizzeria_id,
      pizzeria_nome:  risultato.pizzeria_nome,
      cliente_id:     risultato.cliente_id,
      cliente_nuovo:  risultato.cliente_nuovo,
      codice_cliente: risultato.codice_cliente,
      link:           risultato.link,
      wa_inviato:     waInviato,
      numero_disponibile: true
    });

  } catch (err) {
    logger.error('Errore centralino/digita-numero:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/centralino/link-manuale
// Usato dal cassiere dal tablet
// ═══════════════════════════════════════════════════════════════════════════
router.post('/link-manuale', [
  body('numero_cliente').notEmpty().trim().withMessage('Numero cliente obbligatorio'),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente?.pizzeriaId;
    if (!pizzeriaId) return res.status(401).json({ ok: false, messaggio: 'Non autorizzato' });

    const numCli = req.body.numero_cliente.replace(/[\s\-\+]/g, '');
    const risultato = await elaboraChiamata('', numCli, pizzeriaId);

    if (risultato.errore) return serverError(res);

    let waInviato = false;
    if (req.body.manda_whatsapp && risultato.pizzeria?.wa_session_attiva) {
      try {
        await mandaLinkWhatsApp(risultato.pizzeria, numCli, risultato.link);
        waInviato = true;
      } catch (err) {
        logger.error('Errore WA link manuale:', err.message);
      }
    }

    return ok(res, {
      cliente_id:     risultato.cliente_id,
      cliente_nuovo:  risultato.cliente_nuovo,
      codice_cliente: risultato.codice_cliente,
      link:           risultato.link,
      wa_inviato:     waInviato
    });

  } catch (err) {
    logger.error('Errore link-manuale:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/centralino/pizzerie
// Lista numeri pizzerie per FreePBX
// ═══════════════════════════════════════════════════════════════════════════
router.get('/pizzerie', verificaChiaveCentralino, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nome, slug, telefono, cellulare, wa_session_attiva
       FROM pizzerie WHERE attiva = true ORDER BY nome`
    );
    return ok(res, result.rows);
  } catch (err) {
    logger.error('Errore GET centralino/pizzerie:', err);
    return serverError(res);
  }
});

// ── Helper WAHA ───────────────────────────────────────────────────────────
async function mandaLinkWhatsApp(pizzeria, numeroCli, link) {
  const wahaUrl = process.env.WAHA_URL || 'http://localhost:3001';
  let numero = numeroCli.replace(/\D/g, '');
  if (numero.startsWith('0')) numero = '39' + numero.slice(1);
  if (!numero.startsWith('39')) numero = '39' + numero;
  const chatId = `${numero}@c.us`;
  const testo  =
    `🍕 *${pizzeria.nome}*\n\n` +
    `Ciao! Ordina comodamente online cliccando qui:\n${link}\n\n` +
    `_Il link è tuo e puoi usarlo sempre per i tuoi ordini!_`;

  const response = await fetch(`${wahaUrl}/api/sendText`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ session: `pizzeria_${pizzeria.id}`, chatId, text: testo })
  });
  if (!response.ok) throw new Error(`WAHA risposta ${response.status}`);
  return response.json();
}

module.exports = router;
module.exports.generaCodiceCliente = generaCodiceCliente;
module.exports.codiceUnico = codiceUnico;
