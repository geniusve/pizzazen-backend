-- ═══════════════════════════════════════════════════════════════
-- Migrazione 003: sostituisce chiaveweb (UUID) con codice_cliente
-- (8 caratteri alfanumerici, es: K7X2M9QP)
-- ═══════════════════════════════════════════════════════════════

-- Funzione per generare codice cliente casuale 8 chars
-- Alfabeto senza caratteri ambigui: 0/O, 1/I/L rimossi
CREATE OR REPLACE FUNCTION genera_codice_cliente()
RETURNS VARCHAR(8) AS $$
DECLARE
    alfabeto TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    codice   TEXT := '';
    i        INT;
BEGIN
    FOR i IN 1..8 LOOP
        codice := codice || substr(alfabeto, floor(random() * length(alfabeto) + 1)::int, 1);
    END LOOP;
    RETURN codice;
END;
$$ LANGUAGE plpgsql;

-- 1. Aggiunge la nuova colonna codice_cliente
ALTER TABLE clienti ADD COLUMN IF NOT EXISTS codice_cliente VARCHAR(8) UNIQUE;

-- 2. Genera codice_cliente per i clienti esistenti
DO $$
DECLARE
    rec    RECORD;
    nuovo  VARCHAR(8);
    ok     BOOLEAN;
BEGIN
    FOR rec IN SELECT id FROM clienti WHERE codice_cliente IS NULL LOOP
        ok := FALSE;
        WHILE NOT ok LOOP
            nuovo := genera_codice_cliente();
            BEGIN
                UPDATE clienti SET codice_cliente = nuovo WHERE id = rec.id;
                ok := TRUE;
            EXCEPTION WHEN unique_violation THEN
                ok := FALSE;
            END;
        END LOOP;
    END LOOP;
END;
$$;

-- 3. Rende codice_cliente obbligatorio
ALTER TABLE clienti ALTER COLUMN codice_cliente SET NOT NULL;

-- 4. Indice per ricerca rapida
CREATE INDEX IF NOT EXISTS idx_clienti_codice ON clienti(codice_cliente);

-- 5. Rimuove chiaveweb (sostituita da codice_cliente)
--    NOTA: chiave_tracking degli ORDINI rimane UUID — è diversa!
ALTER TABLE clienti DROP COLUMN IF EXISTS chiaveweb;

-- 6. Aggiunge campi WhatsApp alle pizzerie
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS wa_session_attiva BOOLEAN DEFAULT false;
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS wa_numero VARCHAR(20);

-- Verifica finale
SELECT id, cellulare, codice_cliente FROM clienti LIMIT 5;
