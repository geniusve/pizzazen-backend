const router = require('express').Router();
const { body } = require('express-validator');
const db      = require('../../config/database');
const { validate }          = require('../../middleware/validate');
const { requireAdminPizzeria } = require('../../middleware/auth');
const { upload, handleUploadError } = require('../../middleware/upload');
const storage = require('../../config/storage');
const { ok, serverError, badRequest } = require('../../utils/response');
const logger  = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════
// GET /pizzeria/impostazioni
// Tutti i dati della pizzeria visibili e modificabili dal titolare
// ═══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const baseUrl    = process.env.BASE_URL || 'http://localhost:3000';

    const result = await db.query(
      `SELECT
         id, nome, ragione_sociale, partita_iva, codice_sdi, pec, email,
         via, numero_civico, cap, citta, provincia, nazione,
         telefono, cellulare, telefono_visibile,
         nome_titolare, telefono_titolare,
         tipo_pizzeria, descrizione, orario_testo,
         logo_url,
         -- Slot
         slot_minuti, slot_max_pizze,
         -- Delivery
         delivery_attivo, delivery_costo_tipo, delivery_costo, delivery_note,
         -- Self-order
         selforder_attivo,
         -- Stampanti
         stampante_cassa_ip, stampante_cassa_porta,
         stampante_cucina_ip, stampante_cucina_porta,
         -- WhatsApp
         wa_session_attiva, wa_numero,
         -- Slug
         slug
       FROM pizzerie WHERE id = $1`,
      [pizzeriaId]
    );

    const p = result.rows[0];

    return ok(res, {
      ...p,
      logo_url: p.logo_url
        ? `${baseUrl}/storage/${p.logo_url}`
        : `${baseUrl}/storage/defaults/placeholder/logo-default.png`,
    });
  } catch (err) {
    logger.error('GET impostazioni:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// PUT /pizzeria/impostazioni
// Aggiorna le impostazioni della pizzeria
// ═══════════════════════════════════════════════════════════════
router.put('/', requireAdminPizzeria, [
  body('nome').optional().notEmpty().trim(),
  body('email').optional({ nullable: true }).isEmail(),
  body('slot_minuti').optional().isInt({ min: 5, max: 60 }).toInt(),
  body('slot_max_pizze').optional().isInt({ min: 1, max: 50 }).toInt(),
  body('delivery_attivo').optional().isBoolean().toBoolean(),
  body('delivery_costo_tipo').optional().isIn(['per_ordine', 'per_pizza']),
  body('delivery_costo').optional().isFloat({ min: 0 }).toFloat(),
  body('selforder_attivo').optional().isBoolean().toBoolean(),
  body('stampante_cassa_ip').optional({ nullable: true }).isIP(),
  body('stampante_cucina_ip').optional({ nullable: true }).isIP(),
  body('stampante_cassa_porta').optional().isInt({ min: 1, max: 65535 }).toInt(),
  body('stampante_cucina_porta').optional().isInt({ min: 1, max: 65535 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const campiAggiornabili = [
      // Anagrafica
      'nome', 'ragione_sociale', 'partita_iva', 'codice_sdi', 'pec', 'email',
      'via', 'numero_civico', 'cap', 'citta', 'provincia',
      'telefono', 'cellulare', 'telefono_visibile',
      'nome_titolare', 'telefono_titolare',
      'tipo_pizzeria', 'descrizione', 'orario_testo',
      // Slot
      'slot_minuti', 'slot_max_pizze',
      // Delivery
      'delivery_attivo', 'delivery_costo_tipo', 'delivery_costo', 'delivery_note',
      // Self-order
      'selforder_attivo',
      // Stampanti
      'stampante_cassa_ip', 'stampante_cassa_porta',
      'stampante_cucina_ip', 'stampante_cucina_porta',
    ];

    const sets   = [];
    const params = [];
    let   idx    = 1;

    for (const campo of campiAggiornabili) {
      if (req.body[campo] !== undefined) {
        sets.push(`${campo} = $${idx}`);
        params.push(req.body[campo]);
        idx++;
      }
    }

    if (sets.length === 0) return badRequest(res, 'Nessun campo da aggiornare');

    params.push(pizzeriaId);
    await db.query(
      `UPDATE pizzerie SET ${sets.join(', ')} WHERE id = $${idx}`,
      params
    );

    return ok(res, null, 'Impostazioni aggiornate');
  } catch (err) {
    logger.error('PUT impostazioni:', err);
    return serverError(res);
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/impostazioni/logo
// Upload logo della pizzeria
// ═══════════════════════════════════════════════════════════════
router.post('/logo',
  requireAdminPizzeria,
  upload.single('logo'),
  handleUploadError,
  async (req, res) => {
    try {
      const pizzeriaId = req.utente.pizzeriaId;
      if (!req.file) return badRequest(res, 'File non ricevuto');

      // Elimina logo precedente
      const existing = await db.query(
        'SELECT logo_url FROM pizzerie WHERE id = $1', [pizzeriaId]
      );
      if (existing.rows[0]?.logo_url) {
        storage.deleteFile(existing.rows[0].logo_url);
      }

      await storage.saveLogo(req.file.buffer, pizzeriaId);
      const relativePath = `pizzerie/${pizzeriaId}/logo.webp`;

      await db.query(
        'UPDATE pizzerie SET logo_url = $1 WHERE id = $2',
        [relativePath, pizzeriaId]
      );

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      return ok(res, {
        logo_url: `${baseUrl}/storage/${relativePath}`
      }, 'Logo aggiornato');
    } catch (err) {
      logger.error('POST logo impostazioni:', err);
      return serverError(res);
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// POST /pizzeria/impostazioni/stampante/test
// Testa la connessione a una stampante termica Epson
// ═══════════════════════════════════════════════════════════════
router.post('/stampante/test', requireAdminPizzeria, [
  body('tipo').isIn(['cassa', 'cucina']).withMessage('tipo: cassa o cucina'),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { tipo }   = req.body;

    const result = await db.query(
      `SELECT stampante_${tipo}_ip AS ip, stampante_${tipo}_porta AS porta
       FROM pizzerie WHERE id = $1`,
      [pizzeriaId]
    );

    const { ip, porta } = result.rows[0];
    if (!ip) {
      return badRequest(res, `IP stampante ${tipo} non configurato`);
    }

    // Tenta connessione TCP alla stampante
    const net = require('net');
    const socket = new net.Socket();
    const timeout = 3000;

    const connesso = await new Promise((resolve) => {
      socket.setTimeout(timeout);
      socket.connect(porta || 9100, ip, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });

    if (connesso) {
      return ok(res, { ip, porta, raggiungibile: true },
        `Stampante ${tipo} raggiungibile su ${ip}:${porta}`);
    } else {
      return ok(res, { ip, porta, raggiungibile: false },
        `Stampante ${tipo} non raggiungibile su ${ip}:${porta}`);
    }
  } catch (err) {
    logger.error('POST test stampante:', err);
    return serverError(res);
  }
});

module.exports = router;
