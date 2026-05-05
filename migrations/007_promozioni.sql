-- ═══════════════════════════════════════════════════════════════
-- Migrazione 007: sistema promozioni
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE promozioni (
    id              SERIAL PRIMARY KEY,
    pizzeria_id     INT NOT NULL REFERENCES pizzerie(id) ON DELETE CASCADE,

    -- Identificazione
    nome            VARCHAR(100) NOT NULL,
    descrizione     TEXT,
    attiva          BOOLEAN DEFAULT true,

    -- Validità temporale
    data_inizio     DATE,
    data_fine       DATE,

    -- La logica (costruita dal wizard frontend, interpretata dal motore)
    regola          JSONB NOT NULL,

    -- Tipo di applicazione
    -- 'manuale'    → cassiere la sceglie dalla lista
    -- 'automatica' → si applica da sola se condizioni ok
    -- 'codice'     → richiede codice promo
    applicazione    VARCHAR(20) NOT NULL DEFAULT 'manuale'
                    CHECK (applicazione IN ('manuale','automatica','codice')),

    -- Codice promo (solo per applicazione='codice')
    codice          VARCHAR(20),

    -- Limiti utilizzo
    max_utilizzi    INT,          -- null = illimitati
    utilizzi_count  INT DEFAULT 0,
    max_per_cliente INT,          -- null = illimitati per cliente

    -- Comportamento con altre promozioni
    cumulabile      BOOLEAN DEFAULT false,

    -- Dove si applica
    valida_cassa        BOOLEAN DEFAULT true,
    valida_selforder    BOOLEAN DEFAULT true,
    valida_app          BOOLEAN DEFAULT true,

    -- Visibilità (solo app vede la lista completa)
    visibile_selforder  BOOLEAN DEFAULT false,
    visibile_app        BOOLEAN DEFAULT true,

    priorita        INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Unicità codice per pizzeria
    UNIQUE (pizzeria_id, codice)
);

-- Storico applicazioni promozioni agli ordini
CREATE TABLE ordini_promozioni (
    id                  SERIAL PRIMARY KEY,
    ordine_id           BIGINT NOT NULL REFERENCES ordini(id) ON DELETE CASCADE,
    promozione_id       INT NOT NULL REFERENCES promozioni(id),
    pizzeria_id         INT NOT NULL,
    nome_promo          VARCHAR(100) NOT NULL,  -- snapshot del nome
    sconto_importo      NUMERIC(8,2) DEFAULT 0, -- € scontati
    dettaglio           JSONB,                  -- cosa è stato applicato esattamente
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Storico utilizzi per cliente (per max_per_cliente)
CREATE TABLE promozioni_utilizzi (
    id              SERIAL PRIMARY KEY,
    promozione_id   INT NOT NULL REFERENCES promozioni(id) ON DELETE CASCADE,
    cliente_id      BIGINT REFERENCES clienti(id),
    ordine_id       BIGINT REFERENCES ordini(id),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indici
CREATE INDEX idx_promozioni_pizzeria ON promozioni(pizzeria_id, attiva);
CREATE INDEX idx_promozioni_codice   ON promozioni(codice) WHERE codice IS NOT NULL;
CREATE INDEX idx_ordini_promo        ON ordini_promozioni(ordine_id);
CREATE INDEX idx_promo_utilizzi      ON promozioni_utilizzi(promozione_id, cliente_id);

-- Trigger updated_at
CREATE TRIGGER trg_promozioni_upd
    BEFORE UPDATE ON promozioni
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE promozioni ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_promozioni ON promozioni
    USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);

ALTER TABLE ordini_promozioni ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_ordini_promo ON ordini_promozioni
    USING (pizzeria_id = NULLIF(current_setting('app.pizzeria_id', true), '')::int);
