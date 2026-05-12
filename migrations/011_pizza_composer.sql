-- Pizza composer: immagini per composizione visiva e ordine ingredienti
ALTER TABLE ingredienti_default
  ADD COLUMN IF NOT EXISTS immagine_pizza_url TEXT;

ALTER TABLE ingredienti
  ADD COLUMN IF NOT EXISTS immagine_pizza_url TEXT;

ALTER TABLE menu_articoli
  ADD COLUMN IF NOT EXISTS immagine_generata_url TEXT;

ALTER TABLE menu_articoli_ingredienti
  ADD COLUMN IF NOT EXISTS ordine INTEGER DEFAULT 0;
