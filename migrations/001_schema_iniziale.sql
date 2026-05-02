-- ═══════════════════════════════════════════════════════════════════════════
-- PIZZAZEN — Schema Database Completo v1.0
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- ══ PIZZERIE ══════════════════════════════════════════════════════════════

CREATE TABLE pizzerie (
    id                  SERIAL PRIMARY KEY,
    nome                VARCHAR(150) NOT NULL,
    ragione_sociale     VARCHAR(200),
    partita_iva         VARCHAR(20),
    codice_sdi          VARCHAR(10),
    pec                 VARCHAR(150),
    email               VARCHAR(150),
    via                 VARCHAR(200),
    numero_civico       VARCHAR(10),
    cap                 VARCHAR(10),
    citta               VARCHAR(100),
    provincia           VARCHAR(5),
    nazione             VARCHAR(50) DEFAULT 'Italia',
    telefono            VARCHAR(20),
    cellulare           VARCHAR(20),
    nome_titolare       VARCHAR(150),
    telefono_titolare   VARCHAR(20),
    tipo_pizzeria       VARCHAR(50),
    logo_url            TEXT,
    note                TEXT,
    slot_minuti         SMALLINT DEFAULT 10,
    slot_max_pizze      SMALLINT DEFAULT 8,
    attiva              BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ══ ORARI ════════════════════════════════════════════════════════════════

CREATE TABLE orari_settimanali (
    id               SERIAL PRIMARY KEY,
    pizzeria_id      INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    giorno_settimana SMALLINT NOT NULL CHECK (giorno_settimana BETWEEN 0 AND 6),
    ora_apertura     TIME NOT NULL,
    ora_chiusura     TIME NOT NULL,
    attivo           BOOLEAN DEFAULT true,
    CONSTRAINT chk_orario_sett CHECK (ora_apertura < ora_chiusura)
);

CREATE TABLE orari_straordinari (
    id           SERIAL PRIMARY KEY,
    pizzeria_id  INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    data         DATE NOT NULL,
    tipo         VARCHAR(20) NOT NULL CHECK (tipo IN ('apertura','chiusura')),
    ora_apertura TIME,
    ora_chiusura TIME,
    descrizione  VARCHAR(200),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_orario_straord CHECK (
        (tipo = 'chiusura') OR
        (tipo = 'apertura' AND ora_apertura IS NOT NULL
            AND ora_chiusura IS NOT NULL
            AND ora_apertura < ora_chiusura)
    )
);

-- ══ UTENTI ════════════════════════════════════════════════════════════════

CREATE TABLE utenti (
    id               SERIAL PRIMARY KEY,
    pizzeria_id      INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    username         VARCHAR(50) NOT NULL,
    password_hash    TEXT NOT NULL,
    email_recupero   VARCHAR(150),
    nome             VARCHAR(100),
    tipo             VARCHAR(30) NOT NULL DEFAULT 'cassiere',
    puo_gestire_menu    BOOLEAN DEFAULT false,
    puo_gestire_clienti BOOLEAN DEFAULT true,
    puo_vedere_stats    BOOLEAN DEFAULT false,
    attivo           BOOLEAN DEFAULT true,
    ultimo_accesso   TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (pizzeria_id, username)
);

CREATE TABLE admin_globali (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email         VARCHAR(150),
    nome          VARCHAR(100),
    attivo        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ══ INGREDIENTI ══════════════════════════════════════════════════════════

CREATE TABLE ingredienti_default (
    id          SERIAL PRIMARY KEY,
    descrizione VARCHAR(100) NOT NULL,
    icona_url   TEXT,
    prezzo      NUMERIC(5,2) DEFAULT 0.00,
    nota        TEXT,
    allergeni   TEXT[] DEFAULT '{}',
    attivo      BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ingredienti (
    id                      SERIAL PRIMARY KEY,
    pizzeria_id             INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    ingrediente_default_id  INT REFERENCES ingredienti_default(id),
    descrizione             VARCHAR(100) NOT NULL,
    icona_url               TEXT,
    prezzo                  NUMERIC(5,2) DEFAULT 0.00,
    nota                    TEXT,
    allergeni               TEXT[] DEFAULT '{}',
    attivo                  BOOLEAN DEFAULT true,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- ══ MENU ═════════════════════════════════════════════════════════════════

CREATE TABLE categorie_menu (
    id          SERIAL PRIMARY KEY,
    pizzeria_id INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    nome        VARCHAR(80) NOT NULL,
    icona_url   TEXT,
    ordine      SMALLINT DEFAULT 0,
    attiva      BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE menu_articoli (
    id              SERIAL PRIMARY KEY,
    pizzeria_id     INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    categoria_id    INT NOT NULL REFERENCES categorie_menu(id),
    nome            VARCHAR(100) NOT NULL,
    icona_url       TEXT,
    prezzo          NUMERIC(6,2) NOT NULL,
    allergeni_extra TEXT[] DEFAULT '{}',
    note            TEXT,
    ordine          SMALLINT DEFAULT 0,
    non_disponibile BOOLEAN DEFAULT false,
    non_in_uso      BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE menu_articoli_ingredienti (
    id             SERIAL PRIMARY KEY,
    articolo_id    INT NOT NULL REFERENCES menu_articoli(id) ON DELETE CASCADE,
    ingrediente_id INT NOT NULL REFERENCES ingredienti(id),
    UNIQUE (articolo_id, ingrediente_id)
);

-- ══ CLIENTI ══════════════════════════════════════════════════════════════

CREATE TABLE clienti (
    id                  BIGSERIAL PRIMARY KEY,
    nome                VARCHAR(100),
    cognome             VARCHAR(100),
    cellulare           VARCHAR(20),
    telefono            VARCHAR(20),
    email               VARCHAR(150),
    via                 VARCHAR(200),
    numero_civico       VARCHAR(10),
    cap                 VARCHAR(10),
    citta               VARCHAR(100),
    provincia           VARCHAR(5),
    note                TEXT,
    whatsapp_abilitato  BOOLEAN DEFAULT true,
    password_hash       TEXT,
    tempkey             VARCHAR(64),
    tempkey_scadenza    TIMESTAMPTZ,
    chiaveweb           UUID DEFAULT uuid_generate_v4() UNIQUE NOT NULL,
    tipo_inserimento    VARCHAR(30) DEFAULT 'cassa',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE clienti_pizzerie (
    cliente_id        BIGINT NOT NULL REFERENCES clienti(id) ON DELETE CASCADE,
    pizzeria_id       INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    data_primo_ordine TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (cliente_id, pizzeria_id)
);

-- ══ SLOT ═════════════════════════════════════════════════════════════════

CREATE TABLE slot_disponibili (
    id              BIGSERIAL PRIMARY KEY,
    pizzeria_id     INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    slot_inizio     TIMESTAMPTZ NOT NULL,
    slot_fine       TIMESTAMPTZ NOT NULL,
    pizze_max       SMALLINT NOT NULL,
    pizze_prenotate SMALLINT DEFAULT 0,
    bloccato        BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (pizzeria_id, slot_inizio)
);

-- ══ ORDINI ════════════════════════════════════════════════════════════════

CREATE TABLE ordini (
    id                  BIGSERIAL PRIMARY KEY,
    pizzeria_id         INT NOT NULL REFERENCES pizzerie(id),
    numero_ordine       INT NOT NULL,
    data_ordine         DATE NOT NULL DEFAULT CURRENT_DATE,
    ora_ordine          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    slot_id             BIGINT REFERENCES slot_disponibili(id),
    slot_richiesto      TIMESTAMPTZ,
    cliente_id          BIGINT REFERENCES clienti(id),
    nome_cliente_temp   VARCHAR(100),
    telefono_temp       VARCHAR(20),
    tipo_ordine         VARCHAR(30) NOT NULL DEFAULT 'asporto',
    tipo_pagamento      VARCHAR(30),
    stato_pagamento     VARCHAR(20) DEFAULT 'non_pagato',
    stato               VARCHAR(30) DEFAULT 'ricevuto',
    subtotale           NUMERIC(8,2) DEFAULT 0,
    sconto              NUMERIC(8,2) DEFAULT 0,
    costo_consegna      NUMERIC(6,2) DEFAULT 0,
    servizi             NUMERIC(6,2) DEFAULT 0,
    totale              NUMERIC(8,2) DEFAULT 0,
    note                TEXT,
    chiave_tracking     UUID DEFAULT uuid_generate_v4() UNIQUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (pizzeria_id, data_ordine, numero_ordine)
);

CREATE TABLE ordine_articoli (
    id                  BIGSERIAL PRIMARY KEY,
    ordine_id           BIGINT NOT NULL REFERENCES ordini(id) ON DELETE CASCADE,
    pizzeria_id         INT NOT NULL,
    articolo_id         INT NOT NULL REFERENCES menu_articoli(id),
    nome_articolo       VARCHAR(100) NOT NULL,
    prezzo_unitario     NUMERIC(6,2) NOT NULL,
    quantita            SMALLINT NOT NULL DEFAULT 1,
    subtotale_articolo  NUMERIC(8,2) NOT NULL,
    note                TEXT
);

CREATE TABLE ordine_articoli_modifiche (
    id                  SERIAL PRIMARY KEY,
    ordine_articolo_id  BIGINT NOT NULL REFERENCES ordine_articoli(id) ON DELETE CASCADE,
    ingrediente_id      INT REFERENCES ingredienti(id),
    nome_ingrediente    VARCHAR(100) NOT NULL,
    tipo                VARCHAR(10) NOT NULL CHECK (tipo IN ('aggiunta','rimozione')),
    prezzo_extra        NUMERIC(5,2) DEFAULT 0
);

CREATE TABLE ordine_comunicazioni (
    id         BIGSERIAL PRIMARY KEY,
    ordine_id  BIGINT NOT NULL REFERENCES ordini(id) ON DELETE CASCADE,
    canale     VARCHAR(20) NOT NULL,
    testo      TEXT NOT NULL,
    stato      VARCHAR(20) DEFAULT 'inviato',
    errore     TEXT,
    inviato_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══ STATISTICHE ══════════════════════════════════════════════════════════

CREATE TABLE stats_giornaliere (
    pizzeria_id       INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,
    giorno            DATE NOT NULL,
    totale_ordini     INT DEFAULT 0,
    ordini_asporto    INT DEFAULT 0,
    ordini_delivery   INT DEFAULT 0,
    ordini_self_order INT DEFAULT 0,
    totale_pizze      INT DEFAULT 0,
    ricavo_lordo      NUMERIC(10,2) DEFAULT 0,
    ricavo_netto      NUMERIC(10,2) DEFAULT 0,
    sconti_totali     NUMERIC(8,2) DEFAULT 0,
    PRIMARY KEY (pizzeria_id, giorno)
);

-- ══ INDICI ════════════════════════════════════════════════════════════════

CREATE INDEX idx_orari_sett        ON orari_settimanali(pizzeria_id, giorno_settimana);
CREATE INDEX idx_orari_straord     ON orari_straordinari(pizzeria_id, data);
CREATE INDEX idx_utenti_pizzeria   ON utenti(pizzeria_id);
CREATE INDEX idx_ingredienti_piz   ON ingredienti(pizzeria_id);
CREATE INDEX idx_menu_pizzeria     ON menu_articoli(pizzeria_id);
CREATE INDEX idx_menu_categoria    ON menu_articoli(categoria_id);
CREATE INDEX idx_menu_attivi       ON menu_articoli(pizzeria_id, non_in_uso) WHERE non_in_uso = false;
CREATE INDEX idx_clienti_cell      ON clienti(cellulare);
CREATE INDEX idx_clienti_chiave    ON clienti(chiaveweb);
CREATE INDEX idx_clienti_pizzerie  ON clienti_pizzerie(pizzeria_id);
CREATE INDEX idx_slot_pizzeria     ON slot_disponibili(pizzeria_id, slot_inizio);
CREATE INDEX idx_ordini_pizzeria   ON ordini(pizzeria_id, data_ordine DESC);
CREATE INDEX idx_ordini_stato      ON ordini(pizzeria_id, stato);
CREATE INDEX idx_ordini_tracking   ON ordini(chiave_tracking);
CREATE INDEX idx_ordini_cliente    ON ordini(cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX idx_oa_ordine         ON ordine_articoli(ordine_id);

-- ══ ROW LEVEL SECURITY ════════════════════════════════════════════════════

ALTER TABLE utenti                ENABLE ROW LEVEL SECURITY;
ALTER TABLE orari_settimanali     ENABLE ROW LEVEL SECURITY;
ALTER TABLE orari_straordinari    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredienti           ENABLE ROW LEVEL SECURITY;
ALTER TABLE categorie_menu        ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_articoli         ENABLE ROW LEVEL SECURITY;
ALTER TABLE slot_disponibili      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordini                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordine_articoli       ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_utenti        ON utenti             USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
CREATE POLICY rls_orari_sett    ON orari_settimanali  USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
CREATE POLICY rls_orari_straord ON orari_straordinari USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
CREATE POLICY rls_ingredienti   ON ingredienti        USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
CREATE POLICY rls_categorie     ON categorie_menu     USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
CREATE POLICY rls_menu          ON menu_articoli      USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
CREATE POLICY rls_slot          ON slot_disponibili   USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
CREATE POLICY rls_ordini        ON ordini             USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
CREATE POLICY rls_ord_articoli  ON ordine_articoli    USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);

-- ══ FUNZIONI ═════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION next_numero_ordine(p_pizzeria_id INT, p_data DATE)
RETURNS INT AS $$
DECLARE v_next INT;
BEGIN
    SELECT COALESCE(MAX(numero_ordine), 0) + 1
    INTO v_next
    FROM ordini
    WHERE pizzeria_id = p_pizzeria_id AND data_ordine = p_data;
    RETURN v_next;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_allergeni_articolo(p_articolo_id INT)
RETURNS TEXT[] AS $$
DECLARE v_allergeni TEXT[];
BEGIN
    SELECT ARRAY(
        SELECT DISTINCT u
        FROM (
            SELECT unnest(i.allergeni) AS u
            FROM menu_articoli_ingredienti mai
            JOIN ingredienti i ON i.id = mai.ingrediente_id
            WHERE mai.articolo_id = p_articolo_id
            UNION
            SELECT unnest(ma.allergeni_extra) AS u
            FROM menu_articoli ma
            WHERE ma.id = p_articolo_id
        ) t
        WHERE u IS NOT NULL AND u != ''
    ) INTO v_allergeni;
    RETURN COALESCE(v_allergeni, '{}');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pizzerie_upd  BEFORE UPDATE ON pizzerie      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_menu_upd      BEFORE UPDATE ON menu_articoli FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_ordini_upd    BEFORE UPDATE ON ordini        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clienti_upd   BEFORE UPDATE ON clienti       FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ══ INGREDIENTI DEFAULT ═══════════════════════════════════════════════════

INSERT INTO ingredienti_default (descrizione, prezzo, allergeni) VALUES
('Pomodoro',             0.00, '{}'),
('Mozzarella',           0.00, '{latte}'),
('Fior di latte',        0.00, '{latte}'),
('Mozzarella di bufala', 1.50, '{latte}'),
('Funghi',               0.50, '{}'),
('Prosciutto cotto',     1.00, '{glutine}'),
('Prosciutto crudo',     1.50, '{}'),
('Salame piccante',      0.80, '{glutine}'),
('Salsiccia',            1.00, '{}'),
('Olive',                0.50, '{}'),
('Carciofi',             0.50, '{}'),
('Peperoni',             0.50, '{}'),
('Cipolla',              0.00, '{}'),
('Aglio',                0.00, '{}'),
('Origano',              0.00, '{}'),
('Basilico',             0.00, '{}'),
('Rucola',               0.50, '{}'),
('Pomodorini',           0.50, '{}'),
('Acciughe',             0.80, '{pesce}'),
('Capperi',              0.30, '{}'),
('Wurstel',              0.80, '{glutine}'),
('Mais',                 0.30, '{}'),
('Gorgonzola',           1.00, '{latte}'),
('Speck',                1.50, '{}'),
('Brie',                 1.50, '{latte}'),
('Ricotta',              0.80, '{latte}'),
('Scamorza',             1.00, '{latte}'),
('Tonno',                1.00, '{pesce}'),
('Gamberetti',           2.00, '{crostacei}'),
('Salmone',              2.00, '{pesce}'),
('Pancetta',             0.80, '{}'),
('Patate',               0.50, '{}'),
('Melanzane',            0.50, '{}'),
('Zucchine',             0.50, '{}'),
('Spinaci',              0.50, '{}'),
('Nduja',                1.00, '{}'),
('Parmigiano',           0.80, '{latte}'),
('Pecorino',             0.80, '{latte}'),
('Uovo',                 0.50, '{uova}'),
('Olio EVO',             0.00, '{}');

-- ══ ADMIN GLOBALE DEFAULT (cambia la password subito!) ════════════════════
-- Password: Admin2025!
INSERT INTO admin_globali (username, password_hash, nome, email) VALUES (
    'admin',
    '$2b$12$SpnxHx6jcgS7d6zW7vSrZeMHB6FDcb13AOiJ9pEBtcrN4D5hekuW.',
    'Super Admin',
    'admin@pizzazen.it'
);
