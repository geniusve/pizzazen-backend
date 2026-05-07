-- Migrazione 009: aggiunge campi commissioni alle pizzerie
ALTER TABLE pizzerie
  ADD COLUMN IF NOT EXISTS commissione_percentuale NUMERIC(5,2) DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS commissione_fissa       NUMERIC(8,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS commissione_mensile     NUMERIC(8,2) DEFAULT 0.00;
