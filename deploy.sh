#!/bin/bash
# Script di deploy PizzaZen
# Esegui con: ./deploy.sh

set -e  # interrompi se qualcosa va storto

echo ""
echo "🍕 ================================"
echo "   PizzaZen Deploy"
echo "================================ 🍕"
echo ""

# Vai nella cartella del progetto
cd /opt/pizzazen-backend

echo "📥 Pull aggiornamenti da GitHub..."
git pull origin main

echo "📦 Installa dipendenze..."
npm install --production

echo "🔄 Riavvio backend..."
pm2 reload pizzazen-backend || pm2 start ecosystem.config.js

echo ""
echo "✅ Deploy completato!"
echo ""
pm2 status
