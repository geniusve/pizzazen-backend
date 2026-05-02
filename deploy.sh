#!/bin/bash
set -e
echo "🍕 Deploy PizzaZen..."
cd /opt/pizzazen-backend
git pull origin main
npm install --production
pm2 reload pizzazen-backend
echo "✅ Deploy completato!"
pm2 status