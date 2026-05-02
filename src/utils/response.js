/**
 * Helper per risposte API standardizzate
 * Tutti gli endpoint usano questi helper per coerenza
 */

/**
 * Risposta di successo
 * @param {object} res - Express response
 * @param {*} data - dati da restituire
 * @param {string} [messaggio] - messaggio opzionale
 * @param {number} [status=200] - HTTP status code
 */
const ok = (res, data, messaggio = null, status = 200) => {
  const body = { ok: true };
  if (messaggio) body.messaggio = messaggio;
  if (data !== undefined && data !== null) body.data = data;
  return res.status(status).json(body);
};

/**
 * Risposta di creazione (201 Created)
 */
const created = (res, data, messaggio = null) => {
  return ok(res, data, messaggio, 201);
};

/**
 * Risposta di errore
 * @param {object} res - Express response
 * @param {number} status - HTTP status code
 * @param {string} codice - codice errore leggibile (es: 'NOT_FOUND')
 * @param {string} messaggio - messaggio human-readable
 * @param {*} [dettagli] - dettagli aggiuntivi opzionali
 */
const error = (res, status, codice, messaggio, dettagli = null) => {
  const body = { ok: false, errore: true, codice, messaggio };
  if (dettagli) body.dettagli = dettagli;
  return res.status(status).json(body);
};

// Shorthand per gli errori più comuni
const notFound     = (res, msg = 'Risorsa non trovata') =>
  error(res, 404, 'NOT_FOUND', msg);

const badRequest   = (res, msg, dettagli = null) =>
  error(res, 400, 'BAD_REQUEST', msg, dettagli);

const unauthorized = (res, msg = 'Non autorizzato') =>
  error(res, 401, 'UNAUTHORIZED', msg);

const forbidden    = (res, msg = 'Accesso negato') =>
  error(res, 403, 'FORBIDDEN', msg);

const conflict     = (res, codice, msg, dettagli = null) =>
  error(res, 409, codice, msg, dettagli);

const serverError  = (res, msg = 'Errore interno del server') =>
  error(res, 500, 'SERVER_ERROR', msg);

const validation   = (res, dettagli) =>
  error(res, 422, 'VALIDATION_ERROR', 'Dati non validi', dettagli);

module.exports = {
  ok, created, error,
  notFound, badRequest, unauthorized,
  forbidden, conflict, serverError, validation
};
