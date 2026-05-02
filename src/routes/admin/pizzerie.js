const router = require('express').Router();
const bcrypt = require('bcrypt');
const { body, param, query } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { upload, handleUploadError } = require('../../middleware/upload');
const storage = require('../../config/storage');
const {
  ok, created, notFound, badRequest, conflict, serverError
} = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /admin/pizzerie ──────────────────────────────────────
// Lista tutte le pizzerie con filtri e paginazione
router.get('/', [
  query('pagina').optional().isInt({ min: 1 }).toInt(),
  query('per_pagina').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('cerca').optional().trim(),
  query('attiva').optional().isBoolean().toBoolean(),
  validate
], async (req, res) => {
  try {
    const pagina    = req.query.pagina    || 1;
    const perPagina = req.query.per_pagina || 20;
    const offset    = (pagina - 1) * perPagina;
    const cerca     = req.query.cerca;
    const attiva    = req.query.attiva;

    let where  = [];
    let params = [];
    let idx    = 1;

    if (cerca) {
      where.push(`(nome ILIKE $${idx} OR citta ILIKE $${idx} OR email ILIKE $${idx})`);
      params.push(`%${cerca}%`);
      idx++;
    }
    if (attiva !== undefined) {
      where.push(`attiva = $${idx}`);
      params.push(attiva);
      idx++;
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await db.query(
      `SELECT COUNT(*) FROM pizzerie ${whereClause}`,
      params
    );
    const totale = parseInt(countRes.rows[0].count);

    const result = await db.query(
      `SELECT id, nome, citta, provincia, telefono, cellulare,
              tipo_pizzeria, attiva, logo_url,
              nome_titolare, email, created_at,
              slot_minuti, slot_max_pizze
       FROM pizzerie
       ${whereClause}
       ORDER BY nome ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, perPagina, offset]
    );

    return ok(res, {
      pizzerie:  result.rows,
      totale,
      pagina,
      per_pagina: perPagina,
      pagine:    Math.ceil(totale / perPagina)
    });
  } catch (err) {
    logger.error('GET /admin/pizzerie:', err);
    return serverError(res);
  }
});

// ─── GET /admin/pizzerie/:id ──────────────────────────────────
// Dettaglio completo pizzeria
router.get('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*,
              COUNT(DISTINCT u.id) AS num_utenti,
              COUNT(DISTINCT ma.id) AS num_articoli_menu
       FROM pizzerie p
       LEFT JOIN utenti u ON u.pizzeria_id = p.id
       LEFT JOIN menu_articoli ma ON ma.pizzeria_id = p.id AND ma.non_in_uso = false
       WHERE p.id = $1
       GROUP BY p.id`,
      [req.params.id]
    );

    if (!result.rows[0]) return notFound(res, 'Pizzeria non trovata');

    // Recupera anche gli orari settimanali
    const orari = await db.query(
      `SELECT giorno_settimana, ora_apertura, ora_chiusura, attivo
       FROM orari_settimanali
       WHERE pizzeria_id = $1
       ORDER BY giorno_settimana, ora_apertura`,
      [req.params.id]
    );

    return ok(res, {
      ...result.rows[0],
      orari_settimanali: orari.rows
    });
  } catch (err) {
    logger.error('GET /admin/pizzerie/:id:', err);
    return serverError(res);
  }
});

// ─── POST /admin/pizzerie ─────────────────────────────────────
// Crea nuova pizzeria + clona ingredienti + crea admin pizzeria
router.post('/', [
  body('nome').notEmpty().trim().withMessage('Nome obbligatorio'),
  body('email').optional({ nullable: true }).isEmail().withMessage('Email non valida'),
  body('partita_iva').optional({ nullable: true }).trim(),
  body('slot_minuti').optional().isInt({ min: 5, max: 60 }).toInt(),
  body('slot_max_pizze').optional().isInt({ min: 1, max: 50 }).toInt(),
  // Credenziali primo utente admin
  body('admin_username').notEmpty().trim().withMessage('Username admin obbligatorio'),
  body('admin_password').isLength({ min: 6 }).withMessage('Password min 6 caratteri'),
  body('admin_email').optional({ nullable: true }).isEmail(),
  validate
], async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const {
      nome, ragione_sociale, partita_iva, codice_sdi, pec, email,
      via, numero_civico, cap, citta, provincia, nazione,
      telefono, cellulare, nome_titolare, telefono_titolare,
      tipo_pizzeria, note,
      slot_minuti = 10, slot_max_pizze = 8,
      admin_username, admin_password, admin_email, admin_nome
    } = req.body;

    // Genera slug univoco dal nome
    const slug = await generateSlug(nome, client);

    // 1. Crea la pizzeria
    const pizzeriaRes = await client.query(
      `INSERT INTO pizzerie (
        nome, ragione_sociale, partita_iva, codice_sdi, pec, email,
        via, numero_civico, cap, citta, provincia, nazione,
        telefono, cellulare, nome_titolare, telefono_titolare,
        tipo_pizzeria, note, slot_minuti, slot_max_pizze
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        $13,$14,$15,$16,$17,$18,$19,$20
      ) RETURNING id, nome`,
      [
        nome, ragione_sociale, partita_iva, codice_sdi, pec, email,
        via, numero_civico, cap, citta, provincia, nazione || 'Italia',
        telefono, cellulare, nome_titolare, telefono_titolare,
        tipo_pizzeria, note, slot_minuti, slot_max_pizze
      ]
    );
    const pizzeria = pizzeriaRes.rows[0];

    // 2. Clona ingredienti default nella pizzeria
    await client.query(
      `INSERT INTO ingredienti (
        pizzeria_id, ingrediente_default_id,
        descrizione, icona_url, prezzo, nota, allergeni
       )
       SELECT $1, id, descrizione, icona_url, prezzo, nota, allergeni
       FROM ingredienti_default
       WHERE attivo = true`,
      [pizzeria.id]
    );

    // 3. Crea categorie default
    const categorieDefault = [
      { nome: 'Pizze Rosse',   ordine: 1 },
      { nome: 'Pizze Bianche', ordine: 2 },
      { nome: 'Calzoni',       ordine: 3 },
      { nome: 'Bibite',        ordine: 4 },
      { nome: 'Dolci',         ordine: 5 },
      { nome: 'Altro',         ordine: 6 },
    ];
    for (const cat of categorieDefault) {
      await client.query(
        `INSERT INTO categorie_menu (pizzeria_id, nome, ordine)
         VALUES ($1, $2, $3)`,
        [pizzeria.id, cat.nome, cat.ordine]
      );
    }

    // 4. Crea il primo utente admin della pizzeria
    const passwordHash = await bcrypt.hash(admin_password, 12);
    await client.query(
      `INSERT INTO utenti (
        pizzeria_id, username, password_hash, email_recupero,
        nome, tipo,
        puo_gestire_menu, puo_gestire_clienti, puo_vedere_stats
       ) VALUES ($1,$2,$3,$4,$5,'admin_pizzeria',true,true,true)`,
      [
        pizzeria.id, admin_username, passwordHash,
        admin_email || null, admin_nome || admin_username
      ]
    );

    await client.query('COMMIT');

    logger.info(`✅ Pizzeria creata: ${pizzeria.nome} (id: ${pizzeria.id})`);

    return created(res, {
      id:   pizzeria.id,
      nome: pizzeria.nome,
      slug,
      admin_username,
      messaggio: 'Pizzeria creata. Ingredienti default clonati. Admin creato.'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('POST /admin/pizzerie:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ─── PUT /admin/pizzerie/:id ──────────────────────────────────
// Modifica dati pizzeria
router.put('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  body('nome').optional().notEmpty().trim(),
  body('email').optional({ nullable: true }).isEmail(),
  body('slot_minuti').optional().isInt({ min: 5, max: 60 }).toInt(),
  body('slot_max_pizze').optional().isInt({ min: 1, max: 50 }).toInt(),
  validate
], async (req, res) => {
  try {
    const id = req.params.id;

    // Controlla che esista
    const existing = await db.query(
      'SELECT id FROM pizzerie WHERE id = $1', [id]
    );
    if (!existing.rows[0]) return notFound(res, 'Pizzeria non trovata');

    // Costruisce la query dinamicamente con solo i campi inviati
    const campiAggiornabili = [
      'nome','ragione_sociale','partita_iva','codice_sdi','pec','email',
      'via','numero_civico','cap','citta','provincia','nazione',
      'telefono','cellulare','nome_titolare','telefono_titolare',
      'tipo_pizzeria','note','slot_minuti','slot_max_pizze'
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

    if (sets.length === 0) {
      return badRequest(res, 'Nessun campo da aggiornare');
    }

    params.push(id);
    const result = await db.query(
      `UPDATE pizzerie SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, nome`,
      params
    );

    return ok(res, result.rows[0], 'Pizzeria aggiornata');
  } catch (err) {
    logger.error('PUT /admin/pizzerie/:id:', err);
    return serverError(res);
  }
});

// ─── POST /admin/pizzerie/:id/logo ────────────────────────────
// Upload logo pizzeria
router.post('/:id/logo',
  param('id').isInt({ min: 1 }).toInt(),
  upload.single('logo'),
  handleUploadError,
  async (req, res) => {
    try {
      const id = req.params.id;
      if (!req.file) return badRequest(res, 'File non ricevuto');

      const existing = await db.query(
        'SELECT id, logo_url FROM pizzerie WHERE id = $1', [id]
      );
      if (!existing.rows[0]) return notFound(res, 'Pizzeria non trovata');

      // Elimina logo precedente se esiste
      if (existing.rows[0].logo_url) {
        const oldPath = existing.rows[0].logo_url
          .replace(`${process.env.BASE_URL}/storage/`, '');
        storage.deleteFile(oldPath);
      }

      const url = await storage.saveLogo(req.file.buffer, id);

      // Salva il path relativo nel DB (non l'URL completo)
      const relativePath = `pizzerie/${id}/logo.webp`;
      await db.query(
        'UPDATE pizzerie SET logo_url = $1 WHERE id = $2',
        [relativePath, id]
      );

      return ok(res, { logo_url: url }, 'Logo aggiornato');
    } catch (err) {
      logger.error('POST /admin/pizzerie/:id/logo:', err);
      return serverError(res);
    }
  }
);

// ─── DELETE /admin/pizzerie/:id ───────────────────────────────
// Disattiva pizzeria (soft delete)
router.delete('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE pizzerie SET attiva = false WHERE id = $1 RETURNING id, nome`,
      [req.params.id]
    );
    if (!result.rows[0]) return notFound(res, 'Pizzeria non trovata');
    return ok(res, result.rows[0], 'Pizzeria disattivata');
  } catch (err) {
    logger.error('DELETE /admin/pizzerie/:id:', err);
    return serverError(res);
  }
});

// ─── POST /admin/pizzerie/:id/attiva ─────────────────────────
// Riattiva pizzeria
router.post('/:id/attiva', [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const result = await db.query(
      `UPDATE pizzerie SET attiva = true WHERE id = $1 RETURNING id, nome`,
      [req.params.id]
    );
    if (!result.rows[0]) return notFound(res, 'Pizzeria non trovata');
    return ok(res, result.rows[0], 'Pizzeria riattivata');
  } catch (err) {
    logger.error('POST /admin/pizzerie/:id/attiva:', err);
    return serverError(res);
  }
});

// ─── Helpers ──────────────────────────────────────────────────

async function generateSlug(nome, client) {
  const base = nome
    .toLowerCase()
    .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e')
    .replace(/[ìíîï]/g, 'i').replace(/[òóôõ]/g, 'o')
    .replace(/[ùúûü]/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Cerca se esiste già uno slug simile
  const existing = await (client || db).query(
    `SELECT slug FROM pizzerie WHERE slug LIKE $1`,
    [`${base}%`]
  );
  if (existing.rows.length === 0) return base;
  return `${base}-${existing.rows.length + 1}`;
}

module.exports = router;
module.exports.generateSlug = generateSlug;
