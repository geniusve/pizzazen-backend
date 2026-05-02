# 🍕 PizzaZen Backend

Sistema di gestione ordini per pizzerie d'asporto.

## Stack

- **Runtime:** Node.js 20 LTS
- **Framework:** Express.js
- **Database:** PostgreSQL 16 con Row Level Security
- **Cache / Real-time:** Redis + Socket.io
- **Auth:** JWT
- **Notifiche:** whatsapp-web.js
- **Process manager:** PM2

## Setup locale

```bash
# 1. Clona il repository
git clone https://github.com/tuousername/pizzazen-backend.git
cd pizzazen-backend

# 2. Installa dipendenze
npm install

# 3. Crea il file .env
cp .env.example .env
# Modifica .env con i tuoi valori

# 4. Esegui le migrazioni
npm run migrate

# 5. Avvia in sviluppo (con auto-reload)
npm run dev
```

## Struttura cartelle

```
src/
├── app.js              # Entry point
├── config/             # Database, Redis, Storage
├── routes/             # API endpoints
├── middleware/         # Auth, Upload, Validate
├── socket/             # Socket.io real-time
├── jobs/               # Cron jobs (notifiche, stats)
└── utils/              # Logger, Response helpers

migrations/             # SQL migrations in ordine
storage/                # File immagini (non in Git)
```

## API

Base URL: `http://localhost:3000/api/v1`

Health check: `GET /health`

Documentazione completa: vedi `docs/PizzaZen_Documentazione.docx`

## Deploy su server

```bash
./deploy.sh
```

## Credenziali default (CAMBIARE SUBITO)

- Admin globale: `admin` / `Admin2025!`
