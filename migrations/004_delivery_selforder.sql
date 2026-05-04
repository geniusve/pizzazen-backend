-- ═══════════════════════════════════════════════════════════════
-- Migrazione 004: aggiunge campi delivery e self-order alle pizzerie
-- ═══════════════════════════════════════════════════════════════

-- ── Delivery ──────────────────────────────────────────────────
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS delivery_attivo      BOOLEAN DEFAULT false;
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS delivery_costo_tipo  VARCHAR(20) DEFAULT 'per_ordine';
  -- 'per_ordine' → costo fisso per consegna (es: €3.00)
  -- 'per_pizza'  → costo per ogni pizza (es: €1.00 a pizza)
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS delivery_costo       NUMERIC(5,2) DEFAULT 0.00;
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS delivery_note        TEXT;
  -- es: "Consegna solo entro 5km", "Minimo ordine €15"

-- ── Self-order ────────────────────────────────────────────────
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS selforder_attivo     BOOLEAN DEFAULT true;
  -- permette di disabilitare il self-order per una pizzeria specifica

-- ── Descrizione pizzeria (visibile nel self-order) ────────────
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS descrizione          TEXT;
  -- es: "La migliore pizza di Verona dal 1985"

-- Verifica
SELECT nome, delivery_attivo, delivery_costo_tipo,
       delivery_costo, selforder_attivo
FROM pizzerie;
