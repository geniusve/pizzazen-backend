const router = require('express').Router();
const { body } = require('express-validator');
const db       = require('../config/database');
const { validate }   = require('../middleware/validate');
const { ok, badRequest, serverError, notFound } = require('../utils/response');
const logger   = require('../utils/logger');

// ─── Alfabeto codice cliente (senza caratteri ambigui 0/O, 1/I/L) ──────────
const ALFABETO = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generaCodiceCliente() {
  let codice = '';
  for (let i = 0; i < 8; i++) {
    codice += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return codice;
}

async function codiceUnico() {
  let codice, esiste;
  do {
    codice  = generaCodiceCliente();
    esiste  = await db.query(
      'SELECT id FROM clienti WHERE codice_cliente = $1', [codice]
    );
  } while (esiste.rows.length > 0);
  return codice;
}

// ─── Middleware: verifica chiave segreta centralino ────────────────────────
// FreePBX deve inviare nell'header: X-Centralino-Key: <valore da .env>
const verificaChiaveCentralino = (req, res, next) => {
  const chiave = req.headers['x-centralino-key'];
  if (!chiave || chiave !== process.env.CENTRALINO_KEY) {
    logger.warn(`Tentativo accesso centralino non autorizzato da ${req.ip}`);
    return res.status(401).json({ ok: false, messaggio: 'Non autorizzato' });
  }
  next();
};

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/centralino/chiamata
//
// Chiamato da FreePBX quando il cliente preme 1 (vuole il link WhatsApp).
// Body:
//   numero_cliente:  numero chiamante (potrebbe essere null se mascherato)
//   numero_pizzeria: numero chiamato (DID) — identifica la pizzeria
//   azione:          'link_whatsapp' | 'solo_crea' (default: link_whatsapp)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/chiamata', verificaChiaveCentralino, [
  body('numero_pizzeria').notEmpty().trim()
    .withMessage('numero_pizzeria obbligatorio'),
  body('numero_cliente').optional({ nullable: true }).trim(),
  body('azione').optional().isIn(['link_whatsapp', 'solo_crea']),
  validate
], async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const {
      numero_cliente,
      numero_pizzeria,
      azione = 'link_whatsapp'
    } = req.body;

    // Normalizza numeri (rimuovi spazi, +, ecc.)
    const numPiz = numero_pizzeria.replace(/[\s\-\+]/g, '');
    const numCli = numero_cliente?.replace(/[\s\-\+]/g, '') || null;

    // ── 1. Trova la pizzeria dal numero chiamato ──────────────────────────
    const pizzeriaRes = await client.query(
      `SELECT id, nome, slug, wa_session_attiva
       FROM pizzerie
       WHERE REPLACE(REPLACE(telefono, ' ', ''), '-', '') = $1
          OR REPLACE(REPLACE(cellulare, ' ', ''), '-', '') = $1
         AND attiva = true`,
      [numPiz]
    );

    if (!pizzeriaRes.rows[0]) {
      await client.query('ROLLBACK');
      logger.warn(`Centralino: pizzeria non trovata per numero ${numPiz}`);
      return notFound(res, `Nessuna pizzeria trovata per il numero ${numPiz}`);
    }

    const pizzeria = pizzeriaRes.rows[0];

    // ── 2. Numero cliente non disponibile (deviazione mascherata) ─────────
    if (!numCli) {
      await client.query('ROLLBACK');
      logger.info(`Centralino: numero cliente non disponibile per pizzeria ${pizzeria.nome}`);
      return ok(res, {
        pizzeria_id:   pizzeria.id,
        pizzeria_nome: pizzeria.nome,
        numero_disponibile: false,
        messaggio: 'Numero cliente non disponibile — chiedere al cliente di digitarlo'
      });
    }

    // ── 3. Trova o crea il cliente ────────────────────────────────────────
    let clienteId, codiceCliente, clienteNuovo = false;

    const clienteRes = await client.query(
      'SELECT id, codice_cliente, nome, whatsapp_abilitato FROM clienti WHERE cellulare = $1',
      [numCli]
    );

    if (clienteRes.rows[0]) {
      // Cliente già esistente
      clienteId     = clienteRes.rows[0].id;
      codiceCliente = clienteRes.rows[0].codice_cliente;
      logger.info(`Centralino: cliente esistente id=${clienteId} per ${numCli}`);
    } else {
      // Cliente nuovo — crea con solo il numero
      codiceCliente = await codiceUnico();
      const insRes  = await client.query(
        `INSERT INTO clienti (cellulare, codice_cliente, tipo_inserimento, whatsapp_abilitato)
         VALUES ($1, $2, 'centralino', true)
         RETURNING id`,
        [numCli, codiceCliente]
      );
      clienteId  = insRes.rows[0].id;
      clienteNuovo = true;
      logger.info(`Centralino: nuovo cliente id=${clienteId} codice=${codiceCliente}`);
    }

    // ── 4. Associa cliente alla pizzeria ──────────────────────────────────
    await client.query(
      `INSERT INTO clienti_pizzerie (cliente_id, pizzeria_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [clienteId, pizzeria.id]
    );

    await client.query('COMMIT');

    // ── 5. Genera link self-order ─────────────────────────────────────────
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const link    = `${baseUrl}/ordina/${pizzeria.slug}/${codiceCliente}`;

    // ── 6. Manda WhatsApp (se WAHA attivo) ───────────────────────────────
    let waInviato = false;
    if (azione === 'link_whatsapp' && pizzeria.wa_session_attiva) {
      try {
        await mandaLinkWhatsApp(pizzeria, numCli, link);
        waInviato = true;
      } catch (waErr) {
        // Non blocca il flusso — logga e continua
        logger.error(`Centralino: errore WA per ${numCli}:`, waErr.message);
      }
    }

    logger.info(`Centralino: link generato ${link} — WA: ${waInviato}`);

    return ok(res, {
      pizzeria_id:    pizzeria.id,
      pizzeria_nome:  pizzeria.nome,
      cliente_id:     clienteId,
      cliente_nuovo:  clienteNuovo,
      codice_cliente: codiceCliente,
      link,
      wa_inviato:     waInviato,
      numero_disponibile: true
    });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Errore route centralino/chiamata:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/centralino/digita-numero
//
// Usato quando il numero cliente non era disponibile dalla deviazione.
// FreePBX ha fatto digitare il numero al cliente e ora lo invia qui.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/digita-numero', verificaChiaveCentralino, [
  body('numero_cliente').notEmpty().trim()
    .withMessage('numero_cliente obbligatorio'),
  body('numero_pizzeria').notEmpty().trim()
    .withMessage('numero_pizzeria obbligatorio'),
  validate
], async (req, res) => {
  // Riusa la stessa logica della route principale
  req.body.azione = 'link_whatsapp';
  return router.handle(
    Object.assign(req, { url: '/chiamata', method: 'POST' }),
    res,
    () => {}
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/centralino/link-manuale
//
// Usato dal cassiere dal tablet: inserisce manualmente il numero
// e genera il link (senza che sia arrivata una chiamata FreePBX).
// Autenticazione normale JWT — non usa X-Centralino-Key.
// ═══════════════════════════════════════════════════════════════════════════
router.post('/link-manuale', [
  body('numero_cliente').notEmpty().trim()
    .withMessage('Numero cliente obbligatorio'),
  validate
], async (req, res) => {
  // Questa route richiede auth JWT normale (non chiave centralino)
  // Il middleware auth è già montato nel router pizzeria
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const pizzeriaId = req.utente?.pizzeriaId;
    if (!pizzeriaId) {
      return res.status(401).json({ ok: false, messaggio: 'Non autorizzato' });
    }

    const numCli = req.body.numero_cliente.replace(/[\s\-\+]/g, '');

    // Trova pizzeria
    const pizzeriaRes = await client.query(
      'SELECT id, nome, slug, wa_session_attiva FROM pizzerie WHERE id = $1',
      [pizzeriaId]
    );
    const pizzeria = pizzeriaRes.rows[0];

    // Trova o crea cliente
    let clienteId, codiceCliente, clienteNuovo = false;

    const clienteRes = await client.query(
      'SELECT id, codice_cliente FROM clienti WHERE cellulare = $1',
      [numCli]
    );

    if (clienteRes.rows[0]) {
      clienteId     = clienteRes.rows[0].id;
      codiceCliente = clienteRes.rows[0].codice_cliente;
    } else {
      codiceCliente = await codiceUnico();
      const insRes  = await client.query(
        `INSERT INTO clienti (cellulare, codice_cliente, tipo_inserimento, whatsapp_abilitato)
         VALUES ($1, $2, 'cassa', true) RETURNING id`,
        [numCli, codiceCliente]
      );
      clienteId    = insRes.rows[0].id;
      clienteNuovo = true;
    }

    await client.query(
      `INSERT INTO clienti_pizzerie (cliente_id, pizzeria_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [clienteId, pizzeriaId]
    );

    await client.query('COMMIT');

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const link    = `${baseUrl}/ordina/${pizzeria.slug}/${codiceCliente}`;

    // Manda WA se disponibile
    let waInviato = false;
    if (req.body.manda_whatsapp && pizzeria.wa_session_attiva) {
      try {
        await mandaLinkWhatsApp(pizzeria, numCli, link);
        waInviato = true;
      } catch (waErr) {
        logger.error('Errore WA link manuale:', waErr.message);
      }
    }

    return ok(res, {
      cliente_id:     clienteId,
      cliente_nuovo:  clienteNuovo,
      codice_cliente: codiceCliente,
      link,
      wa_inviato:     waInviato
    });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Errore link-manuale:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/centralino/pizzerie
//
// Restituisce la lista dei numeri di telefono delle pizzerie attive.
// FreePBX può usarla per aggiornare il suo dialplan automaticamente.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/pizzerie', verificaChiaveCentralino, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nome, slug, telefono, cellulare, wa_session_attiva
       FROM pizzerie WHERE attiva = true
       ORDER BY nome`
    );
    return ok(res, result.rows);
  } catch (err) {
    logger.error('Errore GET centralino/pizzerie:', err);
    return serverError(res);
  }
});

// ─── Helper: manda link via WhatsApp tramite WAHA ─────────────────────────
async function mandaLinkWhatsApp(pizzeria, numeroCli, link) {
  const wahaUrl   = process.env.WAHA_URL || 'http://localhost:3001';
  const sessionId = `pizzeria_${pizzeria.id}`;

  // Normalizza numero per WhatsApp (formato internazionale italiano)
  let numero = numeroCli.replace(/\D/g, '');
  if (numero.startsWith('0')) numero = '39' + numero.slice(1);
  if (!numero.startsWith('39')) numero = '39' + numero;
  const chatId = `${numero}@c.us`;

  const testo =
    `🍕 *${pizzeria.nome}*\n\n` +
    `Ciao! Ordina comodamente online cliccando qui:\n` +
    `${link}\n\n` +
    `_Il link è tuo e puoi usarlo sempre per i tuoi ordini!_`;

  const response = await fetch(`${wahaUrl}/api/sendText`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ session: sessionId, chatId, text: testo })
  });

  if (!response.ok) {
    throw new Error(`WAHA risposta ${response.status}`);
  }

  return response.json();
}

module.exports = router;
module.exports.generaCodiceCliente = generaCodiceCliente;
module.exports.codiceUnico = codiceUnico;
