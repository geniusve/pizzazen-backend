const router = require('express').Router();
const { body, param, query } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { requireAdminPizzeria } = require('../../middleware/auth');
const { ok, created, notFound, serverError, badRequest } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /pizzeria/orari ──────────────────────────────────────
// Restituisce orari settimanali + straordinari della pizzeria
router.get('/', async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;

    const settimanali = await db.queryRLS(pizzeriaId,
      `SELECT id, giorno_settimana, ora_apertura, ora_chiusura, attivo
       FROM orari_settimanali
       WHERE pizzeria_id = $1
       ORDER BY giorno_settimana, ora_apertura`,
      [pizzeriaId]
    );

    const straordinari = await db.queryRLS(pizzeriaId,
      `SELECT id, data, tipo, ora_apertura, ora_chiusura, descrizione
       FROM orari_straordinari
       WHERE pizzeria_id = $1 AND data >= CURRENT_DATE
       ORDER BY data`,
      [pizzeriaId]
    );

    // Raggruppa settimanali per giorno
    const giorni = {};
    for (let i = 0; i <= 6; i++) giorni[i] = [];
    settimanali.rows.forEach(r => {
      giorni[r.giorno_settimana].push({
        id:           r.id,
        ora_apertura: r.ora_apertura,
        ora_chiusura: r.ora_chiusura,
        attivo:       r.attivo
      });
    });

    return ok(res, {
      settimanali:  giorni,
      straordinari: straordinari.rows
    });
  } catch (err) {
    logger.error('GET orari:', err);
    return serverError(res);
  }
});

// ─── PUT /pizzeria/orari/settimanali ─────────────────────────
// Salva tutti gli orari settimanali (rimpiazza completamente)
// Body: { orari: [ { giorno_settimana: 0, ore: [{ora_apertura, ora_chiusura}] } ] }
router.put('/settimanali', requireAdminPizzeria, [
  body('orari').isArray().withMessage('orari deve essere un array'),
  body('orari.*.giorno_settimana').isInt({ min: 0, max: 6 }),
  body('orari.*.ore').isArray(),
  validate
], async (req, res) => {
  const pizzeriaId = req.utente.pizzeriaId;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.pizzeria_id = '${pizzeriaId}'`);

    // Elimina tutti gli orari esistenti
    await client.query(
      'DELETE FROM orari_settimanali WHERE pizzeria_id = $1',
      [pizzeriaId]
    );

    // Inserisce i nuovi
    for (const giorno of req.body.orari) {
      for (const fascia of giorno.ore) {
        if (!fascia.ora_apertura || !fascia.ora_chiusura) continue;
        if (fascia.ora_apertura >= fascia.ora_chiusura) continue;

        await client.query(
          `INSERT INTO orari_settimanali
             (pizzeria_id, giorno_settimana, ora_apertura, ora_chiusura)
           VALUES ($1, $2, $3, $4)`,
          [pizzeriaId, giorno.giorno_settimana, fascia.ora_apertura, fascia.ora_chiusura]
        );
      }
    }

    await client.query('COMMIT');
    return ok(res, null, 'Orari settimanali aggiornati');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('PUT orari settimanali:', err);
    return serverError(res);
  } finally {
    client.release();
  }
});

// ─── POST /pizzeria/orari/straordinari ───────────────────────
// Aggiunge apertura o chiusura straordinaria
router.post('/straordinari', requireAdminPizzeria, [
  body('data').isDate().withMessage('Data non valida (formato: YYYY-MM-DD)'),
  body('tipo').isIn(['apertura', 'chiusura']).withMessage('Tipo: apertura o chiusura'),
  body('ora_apertura').if(body('tipo').equals('apertura'))
    .notEmpty().withMessage('ora_apertura obbligatoria per apertura straordinaria'),
  body('ora_chiusura').if(body('tipo').equals('apertura'))
    .notEmpty().withMessage('ora_chiusura obbligatoria per apertura straordinaria'),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const { data, tipo, ora_apertura, ora_chiusura, descrizione } = req.body;

    const result = await db.queryRLS(pizzeriaId,
      `INSERT INTO orari_straordinari
         (pizzeria_id, data, tipo, ora_apertura, ora_chiusura, descrizione)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [pizzeriaId, data, tipo,
       tipo === 'apertura' ? ora_apertura : null,
       tipo === 'apertura' ? ora_chiusura : null,
       descrizione || null]
    );

    return created(res, result.rows[0], 'Orario straordinario aggiunto');
  } catch (err) {
    logger.error('POST orari straordinari:', err);
    return serverError(res);
  }
});

// ─── DELETE /pizzeria/orari/straordinari/:id ─────────────────
router.delete('/straordinari/:id', requireAdminPizzeria, [
  param('id').isInt({ min: 1 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const result = await db.queryRLS(pizzeriaId,
      `DELETE FROM orari_straordinari
       WHERE id = $1 AND pizzeria_id = $2
       RETURNING id, data, tipo`,
      [req.params.id, pizzeriaId]
    );
    if (!result.rows[0]) return notFound(res, 'Orario straordinario non trovato');
    return ok(res, result.rows[0], 'Orario straordinario eliminato');
  } catch (err) {
    logger.error('DELETE orari straordinari:', err);
    return serverError(res);
  }
});

module.exports = router;
