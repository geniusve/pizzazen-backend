const router = require('express').Router();
const { param, query } = require('express-validator');
const db = require('../../config/database');
const { validate } = require('../../middleware/validate');
const { ok, serverError, badRequest } = require('../../utils/response');
const logger = require('../../utils/logger');

// ─── GET /pizzeria/slot/:data ─────────────────────────────────
// Calcola slot disponibili per una data specifica
// Segue la gerarchia: straordinari > settimanali
router.get('/:data', [
  param('data').isDate().withMessage('Data non valida (YYYY-MM-DD)'),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const data       = req.params.data;

    const slots = await calcolaSlot(pizzeriaId, data);
    return ok(res, slots);
  } catch (err) {
    logger.error('GET slot:', err);
    return serverError(res);
  }
});

// ─── GET /pizzeria/slot ───────────────────────────────────────
// Slot disponibili per oggi e i prossimi N giorni
router.get('/', [
  query('giorni').optional().isInt({ min: 1, max: 30 }).toInt(),
  validate
], async (req, res) => {
  try {
    const pizzeriaId = req.utente.pizzeriaId;
    const giorni     = req.query.giorni || 2;
    const risultati  = [];

    for (let i = 0; i < giorni; i++) {
      const data = new Date();
      data.setDate(data.getDate() + i);
      const dataStr = data.toISOString().split('T')[0];
      const slots   = await calcolaSlot(pizzeriaId, dataStr);
      risultati.push({ data: dataStr, slots });
    }

    return ok(res, risultati);
  } catch (err) {
    logger.error('GET slot multi-giorno:', err);
    return serverError(res);
  }
});

// ════════════════════════════════════════
// LOGICA CALCOLO SLOT
// ════════════════════════════════════════

/**
 * Calcola gli slot disponibili per una pizzeria in una data.
 * 
 * Gerarchia di priorità:
 * 1. orari_straordinari tipo='chiusura' → nessuno slot
 * 2. orari_straordinari tipo='apertura' → usa quegli orari
 * 3. orari_settimanali del giorno → usa quegli orari
 * 4. Nessun orario trovato → nessuno slot
 */
async function calcolaSlot(pizzeriaId, dataStr) {
  // Config pizzeria (slot_minuti, slot_max_pizze)
  const configRes = await db.query(
    'SELECT slot_minuti, slot_max_pizze FROM pizzerie WHERE id = $1',
    [pizzeriaId]
  );
  const { slot_minuti, slot_max_pizze } = configRes.rows[0];

  // 1. Controlla orari straordinari per questa data
  const straordRes = await db.queryRLS(pizzeriaId,
    `SELECT tipo, ora_apertura, ora_chiusura
     FROM orari_straordinari
     WHERE pizzeria_id = $1 AND data = $2
     ORDER BY ora_apertura`,
    [pizzeriaId, dataStr]
  );

  let fasce = [];
  let tipoOrario = 'standard';

  if (straordRes.rows.length > 0) {
    // Chiusura straordinaria → nessuno slot
    if (straordRes.rows[0].tipo === 'chiusura') {
      return {
        data:       dataStr,
        aperta:     false,
        tipo:       'chiusura_straordinaria',
        slots:      []
      };
    }
    // Apertura straordinaria
    fasce      = straordRes.rows;
    tipoOrario = 'apertura_straordinaria';
  } else {
    // 2. Orari settimanali — giorno 0=Lun, 6=Dom
    // JS: getDay() → 0=Dom, 1=Lun... convertiamo a 0=Lun
    const jsDay   = new Date(dataStr + 'T12:00:00Z').getDay();
    const dbGiorno = jsDay === 0 ? 6 : jsDay - 1; // 0=Lun...6=Dom

    const settimanaliRes = await db.queryRLS(pizzeriaId,
      `SELECT ora_apertura, ora_chiusura
       FROM orari_settimanali
       WHERE pizzeria_id = $1
         AND giorno_settimana = $2
         AND attivo = true
       ORDER BY ora_apertura`,
      [pizzeriaId, dbGiorno]
    );

    if (settimanaliRes.rows.length === 0) {
      return {
        data:   dataStr,
        aperta: false,
        tipo:   'chiuso',
        slots:  []
      };
    }
    fasce = settimanaliRes.rows;
  }

  // 3. Genera slot per ogni fascia oraria
  const slots = [];

  for (const fascia of fasce) {
    const [hAp, mAp] = fascia.ora_apertura.split(':').map(Number);
    const [hCh, mCh] = fascia.ora_chiusura.split(':').map(Number);

    let current = new Date(`${dataStr}T00:00:00Z`);
    current.setUTCHours(hAp, mAp, 0, 0);

    const fine = new Date(`${dataStr}T00:00:00Z`);
    fine.setUTCHours(hCh, mCh, 0, 0);

    while (current < fine) {
      const slotFine = new Date(current.getTime() + slot_minuti * 60000);
      if (slotFine > fine) break;

      // Conta pizze già prenotate in questo slot
      const prenotateRes = await db.queryRLS(pizzeriaId,
        `SELECT COALESCE(SUM(oa.quantita), 0) AS totale
         FROM ordini o
         JOIN ordine_articoli oa ON oa.ordine_id = o.id
         WHERE o.pizzeria_id = $1
           AND o.slot_richiesto >= $2
           AND o.slot_richiesto < $3
           AND o.stato NOT IN ('annullato')`,
        [pizzeriaId, current.toISOString(), slotFine.toISOString()]
      );

      const pizzePrenotate = parseInt(prenotateRes.rows[0].totale);

      slots.push({
        inizio:          current.toISOString(),
        fine:            slotFine.toISOString(),
        ora_inizio:      current.toISOString().slice(11, 16),
        ora_fine:        slotFine.toISOString().slice(11, 16),
        pizze_max:       slot_max_pizze,
        pizze_prenotate: pizzePrenotate,
        disponibile:     pizzePrenotate < slot_max_pizze,
        posti_rimasti:   Math.max(0, slot_max_pizze - pizzePrenotate)
      });

      current = slotFine;
    }
  }

  return {
    data:        dataStr,
    aperta:      true,
    tipo:        tipoOrario,
    slot_minuti,
    slot_max_pizze,
    slots
  };
}

module.exports = router;
module.exports.calcolaSlot = calcolaSlot;
