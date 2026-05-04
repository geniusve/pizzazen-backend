-- Migrazione 005: aggiunge campi stampanti termiche e impostazioni
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS stampante_cassa_ip      VARCHAR(15);
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS stampante_cassa_porta    INT DEFAULT 8008;
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS stampante_cucina_ip      VARCHAR(15);
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS stampante_cucina_porta   INT DEFAULT 8008;
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS orario_testo             TEXT;
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS telefono_visibile        VARCHAR(20);
