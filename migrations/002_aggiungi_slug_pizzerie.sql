-- Migrazione 002: aggiunge colonna slug alla tabella pizzerie
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS slug VARCHAR(150) UNIQUE;
