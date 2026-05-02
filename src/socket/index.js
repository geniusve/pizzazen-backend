const jwt    = require('jsonwebtoken');
const logger = require('../utils/logger');

let io = null;

/**
 * Inizializza Socket.io con autenticazione JWT
 */
const initSocket = (socketIo) => {
  io = socketIo;

  // Middleware autenticazione per Socket.io
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      // Connessione pubblica (es: self-order cliente) — permessa senza JWT
      socket.utente = null;
      return next();
    }
    try {
      socket.utente = jwt.verify(token, process.env.JWT_SECRET);
      next();
    } catch {
      return next(new Error('Token non valido'));
    }
  });

  io.on('connection', (socket) => {
    const id = socket.utente?.username || 'cliente_anonimo';
    logger.info(`🔌 Socket connesso: ${socket.id} (${id})`);

    // Il tablet/cassa si unisce alla stanza della sua pizzeria
    socket.on('join_pizzeria', (pizzeriaId) => {
      const room = `pizzeria_${parseInt(pizzeriaId)}`;
      socket.join(room);
      logger.info(`Socket ${socket.id} → room ${room}`);
      socket.emit('joined', { room });
    });

    // Il cliente self-order si unisce alla stanza del suo ordine
    socket.on('join_ordine', (chiaveTracking) => {
      const room = `ordine_${chiaveTracking}`;
      socket.join(room);
      socket.emit('joined', { room });
    });

    socket.on('disconnect', () => {
      logger.info(`🔌 Socket disconnesso: ${socket.id}`);
    });

    socket.on('error', (err) => {
      logger.error(`Errore socket ${socket.id}:`, err);
    });
  });

  logger.info('✅ Socket.io inizializzato');
};

/**
 * Emette un evento a tutti i dispositivi di una pizzeria
 * (tablet cassa, tablet cucina, ecc.)
 */
const emitToPizzeria = (pizzeriaId, evento, dati) => {
  if (!io) return;
  io.to(`pizzeria_${pizzeriaId}`).emit(evento, dati);
};

/**
 * Emette un evento al cliente che sta seguendo un ordine
 */
const emitToOrdine = (chiaveTracking, evento, dati) => {
  if (!io) return;
  io.to(`ordine_${chiaveTracking}`).emit(evento, dati);
};

/**
 * Notifica tutte le stanze: nuovo ordine arrivato
 */
const notificaNuovoOrdine = (pizzeriaId, ordine) => {
  emitToPizzeria(pizzeriaId, 'ordine:nuovo', ordine);
};

/**
 * Notifica cambio di stato di un ordine
 */
const notificaStatoOrdine = (pizzeriaId, chiaveTracking, dati) => {
  emitToPizzeria(pizzeriaId, 'ordine:stato', dati);
  emitToOrdine(chiaveTracking, 'ordine:stato', dati);
};

module.exports = {
  initSocket,
  emitToPizzeria,
  emitToOrdine,
  notificaNuovoOrdine,
  notificaStatoOrdine,
};
