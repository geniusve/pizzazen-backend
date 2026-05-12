const router = require('express').Router();
const bcrypt = require('bcrypt');
const { body, param, query } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { upload, handleUploadError } = require('../../middleware/upload');
const storage = require('../../config/storage');
const { ok, created, notFound, badRequest, serverError } = require('../../utils/response');
const logger = require('../../utils/logger');

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
    let where = [], params = [], idx = 1;
    if (req.query.cerca) { where.push(`(nome ILIKE $${idx} OR citta ILIKE $${idx} OR email ILIKE $${idx})`); params.push(`%${req.query.cerca}%`); idx++; }
    if (req.query.attiva !== undefined) { where.push(`attiva = $${idx}`); params.push(req.query.attiva); idx++; }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRes = await db.query(`SELECT COUNT(*) FROM pizzerie ${whereClause}`, params);
    const result = await db.query(
      `SELECT id, nome, slug, citta, provincia, telefono, cellulare,
              tipo_pizzeria, attiva, logo_url, nome_titolare, email,
              created_at, slot_minuti, slot_max_pizze,
              delivery_attivo, delivery_costo_tipo, delivery_costo,
              selforder_attivo, descrizione,
              commissione_percentuale, commissione_fissa, commissione_mensile
       FROM pizzerie ${whereClause} ORDER BY nome ASC LIMIT $${idx} OFFSET $${idx+1}`,
      [...params, perPagina, offset]
    );
    const totale = parseInt(countRes.rows[0].count);
    return ok(res, { pizzerie: result.rows, totale, pagina, per_pagina: perPagina, pagine: Math.ceil(totale/perPagina) });
  } catch (err) { logger.error('GET /admin/pizzerie:', err); return serverError(res); }
});

router.get('/:id', [param('id').isInt({ min: 1 }).toInt(), validate], async (req, res) => {
  try {
    const result = await db.query(
      `SELECT p.*, COUNT(DISTINCT u.id) AS num_utenti, COUNT(DISTINCT ma.id) AS num_articoli_menu
       FROM pizzerie p
       LEFT JOIN utenti u ON u.pizzeria_id = p.id
       LEFT JOIN menu_articoli ma ON ma.pizzeria_id = p.id AND ma.non_in_uso = false
       WHERE p.id = $1 GROUP BY p.id`, [req.params.id]
    );
    if (!result.rows[0]) return notFound(res, 'Pizzeria non trovata');
    const orari = await db.query(
      `SELECT giorno_settimana, ora_apertura, ora_chiusura, attivo FROM orari_settimanali
       WHERE pizzeria_id = $1 ORDER BY giorno_settimana, ora_apertura`, [req.params.id]
    );
    return ok(res, { ...result.rows[0], orari_settimanali: orari.rows });
  } catch (err) { logger.error('GET /admin/pizzerie/:id:', err); return serverError(res); }
});

router.post('/', [
  body('nome').notEmpty().trim().withMessage('Nome obbligatorio'),
  body('email').optional({ nullable: true }).isEmail(),
  body('slot_minuti').optional().isInt({ min: 5, max: 60 }).toInt(),
  body('slot_max_pizze').optional().isInt({ min: 1, max: 50 }).toInt(),
  body('delivery_attivo').optional().isBoolean().toBoolean(),
  body('delivery_costo_tipo').optional().isIn(['per_ordine','per_pizza']),
  body('delivery_costo').optional().isFloat({ min: 0 }).toFloat(),
  body('delivery_note').optional().trim(),
  body('selforder_attivo').optional().isBoolean().toBoolean(),
  body('descrizione').optional().trim(),
  body('commissione_percentuale').optional().isFloat({ min: 0 }).toFloat(),
  body('commissione_fissa').optional().isFloat({ min: 0 }).toFloat(),
  body('commissione_mensile').optional().isFloat({ min: 0 }).toFloat(),
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
      tipo_pizzeria, note, descrizione,
      slot_minuti = 10, slot_max_pizze = 8,
      delivery_attivo = false, delivery_costo_tipo = 'per_ordine',
      delivery_costo = 0, delivery_note,
      selforder_attivo = true,
      commissione_percentuale = 1.00,
      commissione_fissa = 0.00,
      commissione_mensile = 0.00,
      admin_username, admin_password, admin_email, admin_nome
    } = req.body;

    const slug = await generateSlug(nome, client);

    const pizzeriaRes = await client.query(
      `INSERT INTO pizzerie (
        nome, ragione_sociale, partita_iva, codice_sdi, pec, email,
        via, numero_civico, cap, citta, provincia, nazione,
        telefono, cellulare, nome_titolare, telefono_titolare,
        tipo_pizzeria, note, descrizione, slot_minuti, slot_max_pizze,
        delivery_attivo, delivery_costo_tipo, delivery_costo, delivery_note,
        selforder_attivo, slug, stampa_intestazione,
        commissione_percentuale, commissione_fissa, commissione_mensile
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
      RETURNING id, nome, slug`,
      [nome, ragione_sociale, partita_iva, codice_sdi, pec, email,
       via, numero_civico, cap, citta, provincia, nazione||'Italia',
       telefono, cellulare, nome_titolare, telefono_titolare,
       tipo_pizzeria, note, descrizione, slot_minuti, slot_max_pizze,
       delivery_attivo, delivery_costo_tipo, delivery_costo, delivery_note||null,
       selforder_attivo, slug,
       [nome, [via, numero_civico].filter(Boolean).join(' '),
        [cap, citta].filter(Boolean).join(' '), telefono]
         .filter(Boolean).join('\n'),
       commissione_percentuale, commissione_fissa, commissione_mensile
      ]
    );
    const pizzeria = pizzeriaRes.rows[0];

    await client.query(
      `INSERT INTO ingredienti (pizzeria_id, ingrediente_default_id, descrizione, icona_url, immagine_pizza_url, prezzo, nota, allergeni, categoria)
       SELECT $1, id, descrizione, icona_url, immagine_pizza_url, prezzo, nota, allergeni, categoria FROM ingredienti_default WHERE attivo = true`,
      [pizzeria.id]
    );

    for (const cat of [
      {nome:'Pizze Rosse',ordine:1},{nome:'Pizze Bianche',ordine:2},{nome:'Calzoni',ordine:3},
      {nome:'Bibite',ordine:4},{nome:'Dolci',ordine:5},{nome:'Altro',ordine:6}
    ]) {
      await client.query(`INSERT INTO categorie_menu (pizzeria_id, nome, ordine) VALUES ($1,$2,$3)`, [pizzeria.id, cat.nome, cat.ordine]);
    }

    const passwordHash = await bcrypt.hash(admin_password, 12);
    await client.query(
      `INSERT INTO utenti (pizzeria_id, username, password_hash, email_recupero, nome, tipo, puo_gestire_menu, puo_gestire_clienti, puo_vedere_stats)
       VALUES ($1,$2,$3,$4,$5,'admin_pizzeria',true,true,true)`,
      [pizzeria.id, admin_username, passwordHash, admin_email||null, admin_nome||admin_username]
    );

    await client.query('COMMIT');
    logger.info(`Pizzeria creata: ${pizzeria.nome} (id:${pizzeria.id})`);
    return created(res, { id: pizzeria.id, nome: pizzeria.nome, slug: pizzeria.slug, admin_username });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('POST /admin/pizzerie:', err);
    return serverError(res);
  } finally { client.release(); }
});

router.put('/:id', [
  param('id').isInt({ min: 1 }).toInt(),
  body('nome').optional().notEmpty().trim(),
  body('email').optional({ nullable: true }).isEmail(),
  body('slot_minuti').optional().isInt({ min: 5, max: 60 }).toInt(),
  body('slot_max_pizze').optional().isInt({ min: 1, max: 50 }).toInt(),
  body('delivery_attivo').optional().isBoolean().toBoolean(),
  body('delivery_costo_tipo').optional().isIn(['per_ordine','per_pizza']),
  body('delivery_costo').optional().isFloat({ min: 0 }).toFloat(),
  body('selforder_attivo').optional().isBoolean().toBoolean(),
  body('commissione_percentuale').optional().isFloat({ min: 0 }).toFloat(),
  body('commissione_fissa').optional().isFloat({ min: 0 }).toFloat(),
  body('commissione_mensile').optional().isFloat({ min: 0 }).toFloat(),
  validate
], async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await db.query('SELECT id FROM pizzerie WHERE id = $1', [id]);
    if (!existing.rows[0]) return notFound(res, 'Pizzeria non trovata');

    const campiAggiornabili = [
      'nome','ragione_sociale','partita_iva','codice_sdi','pec','email',
      'via','numero_civico','cap','citta','provincia','nazione',
      'telefono','cellulare','nome_titolare','telefono_titolare',
      'tipo_pizzeria','note','descrizione','slot_minuti','slot_max_pizze',
      'delivery_attivo','delivery_costo_tipo','delivery_costo','delivery_note',
      'selforder_attivo','wa_numero',
      'commissione_percentuale','commissione_fissa','commissione_mensile',
    ];
    const sets = [], params = [];
    let idx = 1;
    for (const campo of campiAggiornabili) {
      if (req.body[campo] !== undefined) { sets.push(`${campo} = $${idx}`); params.push(req.body[campo]); idx++; }
    }
    if (sets.length === 0) return badRequest(res, 'Nessun campo da aggiornare');
    params.push(id);
    const result = await db.query(`UPDATE pizzerie SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, nome`, params);
    return ok(res, result.rows[0], 'Pizzeria aggiornata');
  } catch (err) { logger.error('PUT /admin/pizzerie/:id:', err); return serverError(res); }
});

router.post('/:id/logo', param('id').isInt({ min: 1 }).toInt(), upload.single('logo'), handleUploadError, async (req, res) => {
  try {
    const id = req.params.id;
    if (!req.file) return badRequest(res, 'File non ricevuto');
    const existing = await db.query('SELECT id, logo_url FROM pizzerie WHERE id = $1', [id]);
    if (!existing.rows[0]) return notFound(res, 'Pizzeria non trovata');
    if (existing.rows[0].logo_url) storage.deleteFile(existing.rows[0].logo_url);
    await storage.saveLogo(req.file.buffer, id);
    const relativePath = `pizzerie/${id}/logo.webp`;
    await db.query('UPDATE pizzerie SET logo_url = $1 WHERE id = $2', [relativePath, id]);
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    return ok(res, { logo_url: `${baseUrl}/storage/${relativePath}` }, 'Logo aggiornato');
  } catch (err) { logger.error('POST logo:', err); return serverError(res); }
});

router.delete('/:id', [param('id').isInt({ min: 1 }).toInt(), validate], async (req, res) => {
  try {
    const result = await db.query(`UPDATE pizzerie SET attiva = false WHERE id = $1 RETURNING id, nome`, [req.params.id]);
    if (!result.rows[0]) return notFound(res, 'Pizzeria non trovata');
    return ok(res, result.rows[0], 'Pizzeria disattivata');
  } catch (err) { logger.error('DELETE /admin/pizzerie/:id:', err); return serverError(res); }
});

router.post('/:id/attiva', [param('id').isInt({ min: 1 }).toInt(), validate], async (req, res) => {
  try {
    const result = await db.query(`UPDATE pizzerie SET attiva = true WHERE id = $1 RETURNING id, nome`, [req.params.id]);
    if (!result.rows[0]) return notFound(res, 'Pizzeria non trovata');
    return ok(res, result.rows[0], 'Pizzeria riattivata');
  } catch (err) { logger.error('POST /admin/pizzerie/:id/attiva:', err); return serverError(res); }
});

async function generateSlug(nome, client) {
  const base = nome.toLowerCase()
    .replace(/[àáâãä]/g,'a').replace(/[èéêë]/g,'e')
    .replace(/[ìíîï]/g,'i').replace(/[òóôõö]/g,'o')
    .replace(/[ùúûü]/g,'u').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const existing = await (client||db).query(`SELECT slug FROM pizzerie WHERE slug LIKE $1`, [`${base}%`]);
  if (existing.rows.length === 0) return base;
  return `${base}-${existing.rows.length+1}`;
}

module.exports = router;
module.exports.generateSlug = generateSlug;
