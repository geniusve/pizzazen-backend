-- ═══════════════════════════════════════════════════════════════
-- Migrazione 006: aggiunge campi per la stampa termica
-- ═══════════════════════════════════════════════════════════════

-- Logo dedicato alla stampa (diverso dal logo webapp, ottimizzato B/N per termica)
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS stampa_logo_url    TEXT;

-- Testo intestazione stampa (campo libero, supporta \n per andare a capo)
-- Popolato automaticamente alla creazione pizzeria
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS stampa_intestazione TEXT;

-- Popola il campo stampa_intestazione per le pizzerie esistenti
-- che non ce l'hanno ancora
UPDATE pizzerie
SET stampa_intestazione = CONCAT_WS(E'\n',
    nome,
    NULLIF(TRIM(CONCAT_WS(' ', via, numero_civico)), ''),
    NULLIF(TRIM(CONCAT_WS(' ', cap, citta)), ''),
    telefono
)
WHERE stampa_intestazione IS NULL;
