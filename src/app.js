// Imposta timezone PRIMA di tutto - deve essere la prima istruzione
process.env.TZ = 'Europe/Rome';

// Carica variabili d'ambiente
require('dotenv').config();
require('dotenv').config();

const express       = require('express');
const { createServer } = require('http');
const { Server }    = require('socket.io');
const cors          = require('cors');
const helmet        = require('helmet');
const morgan        = require('morgan');
const path          = require('path');
const rateLimit     = require('express-rate-limit');

const logger        = require('./utils/logger');
const { testConnection } = require('./config/database');
const { getClient } = require('./config/redis');
const { initSocket } = require('./socket');
const routes        = require('./routes');

const app    = express();
app.set('trust proxy', 1);
const server = createServer(app);

// ─── Socket.io ───────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin:  process.env.CORS_ORIGIN?.split(',') || '*',
    methods: ['GET', 'POST']
  },
  pingTimeout:  20000,
  pingInterval: 10000,
});
initSocket(io);

// ─── Middleware globali ───────────────────────────────────────

// Sicurezza headers HTTP
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // permette accesso alle immagini
}));

// CORS
app.use(cors({
  origin:      process.env.CORS_ORIGIN?.split(',') || '*',
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting (anti-spam/DDoS)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max:      500,             // max 500 richieste per IP per finestra
  standardHeaders: true,
  legacyHeaders:   false,
  message: { ok: false, codice: 'RATE_LIMIT', messaggio: 'Troppe richieste, riprova tra poco' }
}));

// Parsing JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Log delle richieste HTTP
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── File statici (immagini storage) ─────────────────────────
const storagePath = path.resolve(process.env.STORAGE_PATH || './storage');
app.use('/storage', express.static(storagePath, {
  maxAge:     '7d',   // cache 7 giorni per le immagini
  etag:       true,
  lastModified: true,
}));

// ─── API Routes ───────────────────────────────────────────────
app.use('/api/v1', routes);

// ─── Health check ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok:          true,
    servizio:    'PizzaPax Backend',
    versione:    '1.0.0',
    ambiente:    process.env.NODE_ENV,
    timestamp:   new Date().toISOString(),
  });
});

// ─── 404 handler ──────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    ok:       false,
    codice:   'NOT_FOUND',
    messaggio: `Route non trovata: ${req.method} ${req.path}`,
  });
});

// ─── Error handler globale ────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(`Errore non gestito: ${err.message}`, err);
  res.status(500).json({
    ok:       false,
    codice:   'SERVER_ERROR',
    messaggio: process.env.NODE_ENV === 'production'
      ? 'Errore interno del server'
      : err.message,
  });
});

// ─── Avvio server ─────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;

const start = async () => {
  logger.info('🍕 Avvio PizzaPax Backend...');

  // Connessione database
  const dbOk = await testConnection();
  if (!dbOk) {
    logger.error('❌ Impossibile connettersi al database. Uscita.');
    process.exit(1);
  }

  // Connessione Redis
  try {
    await getClient();
  } catch (err) {
    logger.error('❌ Impossibile connettersi a Redis:', err.message);
    process.exit(1);
  }

  // Avvia il server HTTP
  server.listen(PORT, '0.0.0.0', () => {
    logger.info(`✅ Server in ascolto su porta ${PORT}`);
    logger.info(`🌍 Ambiente: ${process.env.NODE_ENV}`);
    logger.info(`📡 Health check: http://localhost:${PORT}/health`);
    logger.info(`🔌 Socket.io attivo`);
  });
};

// Gestione shutdown graceful
process.on('SIGTERM', () => {
  logger.info('SIGTERM ricevuto — spegnimento graceful...');
  server.close(() => {
    logger.info('Server chiuso');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection:', reason);
});

start();

module.exports = { app, server, io };
