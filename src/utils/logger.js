const { createLogger, format, transports } = require('winston');
const path = require('fs');
const fs   = require('fs');

// Crea cartella logs se non esiste
if (!fs.existsSync('./logs')) fs.mkdirSync('./logs');

const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, stack }) => {
      return stack
        ? `${timestamp} [${level.toUpperCase()}] ${message}\n${stack}`
        : `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [
    // Console (sempre attiva in sviluppo)
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message }) =>
          `${timestamp} ${level}: ${message}`
        )
      )
    }),
    // File error
    new transports.File({ filename: './logs/error.log', level: 'error' }),
    // File combinato
    new transports.File({ filename: './logs/combined.log' }),
  ]
});

module.exports = logger;
