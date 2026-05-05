/**
 * ═══════════════════════════════════════════════════════════════
 * MOTORE PROMOZIONI PIZZAZEN
 * ═══════════════════════════════════════════════════════════════
 *
 * Una promozione è definita da una "regola" JSONB con questa struttura:
 *
 * {
 *   "condizioni": [...],   // TUTTE devono essere vere (AND)
 *   "azione": {...}        // cosa viene applicato
 * }
 *
 * CONDIZIONI disponibili:
 *   { tipo: "importo_minimo",        valore: 45 }
 *   { tipo: "importo_massimo",       valore: 100 }
 *   { tipo: "tipo_ordine",           valore: "delivery" }
 *   { tipo: "giorno_settimana",      giorni: [2] }          // 0=Lun 6=Dom
 *   { tipo: "ora_tra",               dalle: "18:00", alle: "19:00" }
 *   { tipo: "min_pizze",             quantita: 3 }          // totale pizze ordine
 *   { tipo: "min_pizze_categoria",   categoria_id: 1, quantita: 5 }
 *   { tipo: "articolo_presente",     articolo_id: 42, quantita: 2 }
 *
 * AZIONI disponibili:
 *   { tipo: "sconto_percentuale",    valore: 10 }            // -10% sul totale
 *   { tipo: "sconto_fisso",          valore: 5 }             // -€5 sul totale
 *   { tipo: "consegna_gratuita" }                            // costo_consegna = 0
 *   { tipo: "prezzo_fisso_categoria", categoria_id: 1, valore: 7 }  // pizze a €7
 *   { tipo: "articolo_omaggio",      articolo_id: 42, quantita: 1 } // articolo gratis
 *   { tipo: "sconto_articolo",       articolo_id: 42, percentuale: 50 }
 */

const db     = require('../config/database');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════
// VERIFICA CONDIZIONI
// ═══════════════════════════════════════════════════════════════

function verificaCondizioni(condizioni, contesto) {
  if (!condizioni || condizioni.length === 0) return true;
  return condizioni.every(c => verificaCondizione(c, contesto));
}

function verificaCondizione(condizione, ctx) {
  const { ordine, articoli, oggi, oraCorrente } = ctx;

  switch (condizione.tipo) {

    case 'importo_minimo':
      return parseFloat(ordine.subtotale) >= condizione.valore;

    case 'importo_massimo':
      return parseFloat(ordine.subtotale) <= condizione.valore;

    case 'tipo_ordine':
      return ordine.tipo_ordine === condizione.valore ||
             (Array.isArray(condizione.valore) && condizione.valore.includes(ordine.tipo_ordine));

    case 'giorno_settimana': {
      // JS: 0=Dom → DB: 0=Lun
      const jsDay = oggi.getDay();
      const dbDay = jsDay === 0 ? 6 : jsDay - 1;
      return condizione.giorni.includes(dbDay);
    }

    case 'ora_tra': {
      const [hDa, mDa] = condizione.dalle.split(':').map(Number);
      const [hA,  mA]  = condizione.alle.split(':').map(Number);
      const minutiOra  = oraCorrente.getHours() * 60 + oraCorrente.getMinutes();
      const minutiDa   = hDa * 60 + mDa;
      const minutiA    = hA  * 60 + mA;
      return minutiOra >= minutiDa && minutiOra <= minutiA;
    }

    case 'min_pizze': {
      const totPizze = articoli.reduce((s, a) => s + a.quantita, 0);
      return totPizze >= condizione.quantita;
    }

    case 'min_pizze_categoria': {
      const pizzeCat = articoli
        .filter(a => a.categoria_id === condizione.categoria_id)
        .reduce((s, a) => s + a.quantita, 0);
      return pizzeCat >= condizione.quantita;
    }

    case 'articolo_presente': {
      const artOrdine = articoli.find(a => a.articolo_id === condizione.articolo_id);
      return artOrdine && artOrdine.quantita >= (condizione.quantita || 1);
    }

    default:
      logger.warn(`Condizione promozione sconosciuta: ${condizione.tipo}`);
      return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// CALCOLA EFFETTO AZIONE
// ═══════════════════════════════════════════════════════════════

function calcolaEffetto(azione, contesto) {
  const { ordine, articoli } = contesto;
  const subtotale = parseFloat(ordine.subtotale);
  const costoConsegna = parseFloat(ordine.costo_consegna || 0);

  switch (azione.tipo) {

    case 'sconto_percentuale': {
      const sconto = Math.round((subtotale * azione.valore / 100) * 100) / 100;
      return {
        tipo:           'sconto_totale',
        sconto_importo: sconto,
        descrizione:    `-${azione.valore}% sul totale`,
      };
    }

    case 'sconto_fisso': {
      const sconto = Math.min(azione.valore, subtotale);
      return {
        tipo:           'sconto_totale',
        sconto_importo: sconto,
        descrizione:    `-€${azione.valore.toFixed(2)} sul totale`,
      };
    }

    case 'consegna_gratuita': {
      return {
        tipo:           'consegna_gratuita',
        sconto_importo: costoConsegna,
        descrizione:    'Consegna gratuita',
      };
    }

    case 'prezzo_fisso_categoria': {
      // Ricalcola il prezzo degli articoli di quella categoria
      let risparmio = 0;
      articoli
        .filter(a => a.categoria_id === azione.categoria_id)
        .forEach(a => {
          const prezzoOriginale = parseFloat(a.prezzo_unitario) * a.quantita;
          const prezzoPromo     = azione.valore * a.quantita;
          if (prezzoOriginale > prezzoPromo) {
            risparmio += prezzoOriginale - prezzoPromo;
          }
        });
      return {
        tipo:           'prezzo_fisso_categoria',
        sconto_importo: Math.round(risparmio * 100) / 100,
        categoria_id:   azione.categoria_id,
        prezzo_fisso:   azione.valore,
        descrizione:    `Pizze a €${azione.valore.toFixed(2)}`,
      };
    }

    case 'articolo_omaggio': {
      return {
        tipo:            'articolo_omaggio',
        sconto_importo:  0,  // non riduce il totale, aggiunge un articolo gratis
        articolo_id:     azione.articolo_id,
        quantita:        azione.quantita || 1,
        descrizione:     `Articolo in omaggio`,
      };
    }

    case 'sconto_articolo': {
      const art = articoli.find(a => a.articolo_id === azione.articolo_id);
      if (!art) return { tipo: 'nessuno', sconto_importo: 0, descrizione: '' };
      const prezzoArt = parseFloat(art.prezzo_unitario) * art.quantita;
      const sconto    = Math.round((prezzoArt * azione.percentuale / 100) * 100) / 100;
      return {
        tipo:           'sconto_articolo',
        sconto_importo: sconto,
        articolo_id:    azione.articolo_id,
        descrizione:    `-${azione.percentuale}% su articolo specifico`,
      };
    }

    default:
      logger.warn(`Azione promozione sconosciuta: ${azione.tipo}`);
      return { tipo: 'nessuno', sconto_importo: 0, descrizione: '' };
  }
}

// ═══════════════════════════════════════════════════════════════
// FUNZIONE PRINCIPALE: valuta promozioni applicabili
// ═══════════════════════════════════════════════════════════════

/**
 * Valuta quali promozioni sono applicabili a un ordine.
 *
 * @param {number} pizzeriaId
 * @param {object} ordine - { subtotale, costo_consegna, tipo_ordine, cliente_id }
 * @param {Array}  articoli - [{ articolo_id, categoria_id, quantita, prezzo_unitario }]
 * @param {object} opts - { soloAutomatiche, soloManuali, codice, origine }
 * @returns {Array} Lista promozioni applicabili con effetto calcolato
 */
async function valutaPromozioni(pizzeriaId, ordine, articoli, opts = {}) {
  try {
    const { soloAutomatiche, soloManuali, codice, origine = 'cassa' } = opts;

    // Costruisce filtro per tipo applicazione
    let filtroApplicazione = '';
    if (soloAutomatiche) filtroApplicazione = `AND applicazione = 'automatica'`;
    if (soloManuali)     filtroApplicazione = `AND applicazione IN ('manuale','automatica')`;
    if (codice)          filtroApplicazione = `AND applicazione = 'codice' AND codice = $2`;

    // Filtro per origine (cassa/selforder/app)
    const campoValida = origine === 'selforder' ? 'valida_selforder'
                      : origine === 'app'       ? 'valida_app'
                      : 'valida_cassa';

    const params = [pizzeriaId];
    if (codice) params.push(codice.toUpperCase());

    const result = await db.query(
      `SELECT * FROM promozioni
       WHERE pizzeria_id = $1
         AND attiva = true
         AND ${campoValida} = true
         AND (data_inizio IS NULL OR data_inizio <= CURRENT_DATE)
         AND (data_fine   IS NULL OR data_fine   >= CURRENT_DATE)
         AND (max_utilizzi IS NULL OR utilizzi_count < max_utilizzi)
         ${filtroApplicazione}
       ORDER BY priorita DESC, id ASC`,
      params
    );

    if (result.rows.length === 0) return [];

    const contesto = {
      ordine,
      articoli,
      oggi:        new Date(),
      oraCorrente: new Date(),
    };

    const applicabili = [];

    for (const promo of result.rows) {
      const regola = promo.regola;

      // Verifica condizioni
      const soddisfatta = verificaCondizioni(regola.condizioni, contesto);
      if (!soddisfatta) continue;

      // Verifica limite per cliente
      if (promo.max_per_cliente && ordine.cliente_id) {
        const utilizziCliente = await db.query(
          `SELECT COUNT(*) FROM promozioni_utilizzi
           WHERE promozione_id = $1 AND cliente_id = $2`,
          [promo.id, ordine.cliente_id]
        );
        if (parseInt(utilizziCliente.rows[0].count) >= promo.max_per_cliente) continue;
      }

      // Calcola effetto
      const effetto = calcolaEffetto(regola.azione, contesto);

      applicabili.push({
        promozione_id:  promo.id,
        nome:           promo.nome,
        descrizione:    promo.descrizione,
        applicazione:   promo.applicazione,
        codice:         promo.codice,
        cumulabile:     promo.cumulabile,
        priorita:       promo.priorita,
        effetto,
      });

      // Se non cumulabile, fermati alla prima applicabile con priorità più alta
      if (!promo.cumulabile) break;
    }

    return applicabili;

  } catch (err) {
    logger.error('Errore motore promozioni:', err);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// APPLICA PROMOZIONI A UN ORDINE (salva in DB)
// ═══════════════════════════════════════════════════════════════

async function applicaPromozioni(dbClient, ordineId, pizzeriaId, promozioniSelezionate) {
  let scontoTotale = 0;
  const omaggi = [];

  for (const promo of promozioniSelezionate) {
    const { effetto } = promo;

    // Salva in ordini_promozioni
    await dbClient.query(
      `INSERT INTO ordini_promozioni
         (ordine_id, promozione_id, pizzeria_id, nome_promo, sconto_importo, dettaglio)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        ordineId, promo.promozione_id, pizzeriaId,
        promo.nome, effetto.sconto_importo,
        JSON.stringify(effetto)
      ]
    );

    // Incrementa contatore utilizzi
    await dbClient.query(
      `UPDATE promozioni SET utilizzi_count = utilizzi_count + 1 WHERE id = $1`,
      [promo.promozione_id]
    );

    scontoTotale += effetto.sconto_importo || 0;

    // Raccoglie omaggi da aggiungere all'ordine
    if (effetto.tipo === 'articolo_omaggio') {
      omaggi.push({
        articolo_id: effetto.articolo_id,
        quantita:    effetto.quantita,
      });
    }

    // Consegna gratuita
    if (effetto.tipo === 'consegna_gratuita') {
      await dbClient.query(
        'UPDATE ordini SET costo_consegna = 0 WHERE id = $1',
        [ordineId]
      );
    }
  }

  return { scontoTotale, omaggi };
}

// ═══════════════════════════════════════════════════════════════
// REGISTRA UTILIZZO PER CLIENTE
// ═══════════════════════════════════════════════════════════════

async function registraUtilizzoCliente(dbClient, promozioneId, clienteId, ordineId) {
  if (!clienteId) return;
  await dbClient.query(
    `INSERT INTO promozioni_utilizzi (promozione_id, cliente_id, ordine_id)
     VALUES ($1,$2,$3)`,
    [promozioneId, clienteId, ordineId]
  );
}

module.exports = {
  valutaPromozioni,
  applicaPromozioni,
  registraUtilizzoCliente,
  verificaCondizioni,
  calcolaEffetto,
};
