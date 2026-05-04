const router = require('express').Router();
const { body } = require('express-validator');
const db     = require('../../config/database');
const { validate }             = require('../../middleware/validate');
const { requireAdminPizzeria } = require('../../middleware/auth');
const { ok, serverError, badRequest, notFound } = require('../../utils/response');
const logger = require('../../utils/logger');

// ── Helper: chiama WAHA API ───────────────────────────────────
async function wahaRequest(method, path, body = null) {
  const wahaUrl = process.env.WAHA_URL  || 'http://localhost:3001';
  const apiKey  = process.env.WAHA_API_KEY || '';

  const opts = {
    method,
    headers: {
      'X-Api-Key':    apiKey,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const response = await fetch(`${wahaUrl}${path}`, opts);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

// ── Determina nome sessione WAHA per pizzeria ─────────────────
// Core: usa sempre 'default' (1 sessione)
// Plus: usa 'pizzeria_{id}'
function sessionName(pizzeriaId) {
  const tier = process.env.WAHA_TIER || 'core';
  return tier === 'plus' ? `pizzeria_${pizzeriaId}` : 'default';
}

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/whatsapp/stato
// Stato della sessione WhatsApp della pizzeria
// ═══════════════════════════════════════════════════════════════
router.get('/stato', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const session    = sessionName(pizzeriaId);

    // Stato nel nostro DB
    const dbRes = await db.query(
      'SELECT wa_session_attiva, wa_numero FROM pizzerie WHERE id = $1',
      [pizzeriaId]
    );
    const { wa_session_attiva, wa_numero } = dbRes.rows[0];

    // Stato reale da WAHA
    const waha = await wahaRequest('GET', `/api/sessions/${session}`);

    if (!waha.ok) {
      // WAHA non raggiungibile o sessione non esiste
      return ok(res, {
        stato:          'non_configurato',
        wa_attivo:      false,
        wa_numero:      null,
        waha_disponibile: false,
      });
    }

    const statoWaha   = waha.data.status; // WORKING, SCAN_QR_CODE, STOPPED, ecc.
    const numeroWaha  = waha.data.me?.id?.replace('@c.us', '') || null;

    // Aggiorna DB se lo stato è cambiato
    const attivo = statoWaha === 'WORKING';
    if (attivo !== wa_session_attiva || (numeroWaha && numeroWaha !== wa_numero)) {
      await db.query(
        'UPDATE pizzerie SET wa_session_attiva = $1, wa_numero = $2 WHERE id = $3',
        [attivo, numeroWaha || wa_numero, pizzeriaId]
      );
    }

    return ok(res, {
      stato:            statoWaha,
      wa_attivo:        attivo,
      wa_numero:        numeroWaha || wa_numero,
      waha_disponibile: true,
      push_name:        waha.data.me?.pushName || null,
    });
  } catch (err) {
    logger.error('GET whatsapp stato:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/whatsapp/connetti
// Avvia la sessione WhatsApp e restituisce il QR code
// ═══════════════════════════════════════════════════════════════
router.post('/connetti', requireAdminPizzeria, async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const session    = sessionName(pizzeriaId);

    // Controlla stato attuale
    const statoRes = await wahaRequest('GET', `/api/sessions/${session}`);

    if (statoRes.ok && statoRes.data.status === 'WORKING') {
      return ok(res, { stato: 'WORKING', messaggio: 'WhatsApp già connesso' });
    }

    // Se sessione non esiste → creala
    if (!statoRes.ok || statoRes.data.status === 'STOPPED') {
      // Prova ad avviarla
      const startRes = await wahaRequest('POST', `/api/sessions/${session}/start`);
      if (!startRes.ok && statoRes.status === 404) {
        // Sessione non esiste, creala
        await wahaRequest('POST', '/api/sessions', { name: session, start: true });
      }
    }

    // Aspetta che raggiunga SCAN_QR_CODE
    await new Promise(r => setTimeout(r, 2000));

    // Recupera QR come base64
    const qrRes = await wahaRequest('GET', `/api/${session}/auth/qr`);

    if (!qrRes.ok) {
      return ok(res, {
        stato:    'STARTING',
        messaggio: 'Sessione in avvio, riprova tra qualche secondo'
      });
    }

    return ok(res, {
      stato:    'SCAN_QR_CODE',
      qr_code:  qrRes.data.value,   // stringa base64 del QR
      messaggio: 'Scansiona il QR con WhatsApp sul telefono della pizzeria'
    });
  } catch (err) {
    logger.error('POST whatsapp connetti:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/whatsapp/qr
// Recupera il QR aggiornato (polling dal frontend ogni 10 sec)
// ═══════════════════════════════════════════════════════════════
router.get('/qr', requireAdminPizzeria, async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const session    = sessionName(pizzeriaId);

    // Controlla se già connesso
    const statoRes = await wahaRequest('GET', `/api/sessions/${session}`);
    if (statoRes.data?.status === 'WORKING') {
      // Aggiorna DB
      const numero = statoRes.data.me?.id?.replace('@c.us', '') || null;
      await db.query(
        'UPDATE pizzerie SET wa_session_attiva = true, wa_numero = $1 WHERE id = $2',
        [numero, pizzeriaId]
      );
      return ok(res, {
        stato:    'WORKING',
        wa_numero: numero,
        push_name: statoRes.data.me?.pushName,
        messaggio: 'WhatsApp connesso con successo!'
      });
    }

    // Recupera QR
    const qrRes = await wahaRequest('GET', `/api/${session}/auth/qr`);
    if (!qrRes.ok) {
      return ok(res, {
        stato:    statoRes.data?.status || 'UNKNOWN',
        qr_code:  null,
        messaggio: 'QR non disponibile, riprova tra qualche secondo'
      });
    }

    return ok(res, {
      stato:   'SCAN_QR_CODE',
      qr_code: qrRes.data.value,
    });
  } catch (err) {
    logger.error('GET whatsapp qr:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/whatsapp/disconnetti
// Disconnette la sessione WhatsApp
// ═══════════════════════════════════════════════════════════════
router.post('/disconnetti', requireAdminPizzeria, async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const session    = sessionName(pizzeriaId);

    await wahaRequest('POST', `/api/sessions/${session}/stop`);

    await db.query(
      'UPDATE pizzerie SET wa_session_attiva = false WHERE id = $1',
      [pizzeriaId]
    );

    return ok(res, null, 'WhatsApp disconnesso');
  } catch (err) {
    logger.error('POST whatsapp disconnetti:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/whatsapp/test
// Manda un messaggio di test al numero della pizzeria
// ═══════════════════════════════════════════════════════════════
router.post('/test', requireAdminPizzeria, [
  body('numero').notEmpty().trim().withMessage('Numero obbligatorio'),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const session    = sessionName(pizzeriaId);

    let numero = req.body.numero.replace(/\D/g, '');
    if (numero.startsWith('0')) numero = '39' + numero.slice(1);
    if (!numero.startsWith('39')) numero = '39' + numero;
    const chatId = `${numero}@c.us`;

    const pizzeriaRes = await db.query('SELECT nome FROM pizzerie WHERE id = $1', [pizzeriaId]);
    const nomePizzeria = pizzeriaRes.rows[0]?.nome || 'Pizzeria';

    const testo =
      `🍕 *${nomePizzeria}*\n\n` +
      `✅ Test WhatsApp riuscito!\n` +
      `Il sistema di notifiche è attivo e funzionante.`;

    const sendRes = await wahaRequest('POST', '/api/sendText', {
      session: session,
      chatId,
      text: testo
    });

    if (!sendRes.ok) {
      return badRequest(res, `Errore invio: ${sendRes.data?.message || 'sconosciuto'}`);
    }

    return ok(res, { numero: req.body.numero }, 'Messaggio di test inviato');
  } catch (err) {
    logger.error('POST whatsapp test:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// Funzione esportata: manda notifica WhatsApp ordine
// Usata da ordini.js e selfOrder.js
// ═══════════════════════════════════════════════════════════════
async function mandaNotificaOrdine(pizzeriaId, numeroCli, testo) {
  const session = sessionName(pizzeriaId);

  // Controlla che la sessione sia attiva
  const dbRes = await db.query(
    'SELECT wa_session_attiva FROM pizzerie WHERE id = $1', [pizzeriaId]
  );
  if (!dbRes.rows[0]?.wa_session_attiva) return false;

  let numero = numeroCli.replace(/\D/g, '');
  if (numero.startsWith('0')) numero = '39' + numero.slice(1);
  if (!numero.startsWith('39')) numero = '39' + numero;

  const res = await wahaRequest('POST', '/api/sendText', {
    session,
    chatId: `${numero}@c.us`,
    text:   testo
  });

  return res.ok;
}

module.exports = router;
module.exports.mandaNotificaOrdine = mandaNotificaOrdine;
module.exports.sessionName = sessionName;
