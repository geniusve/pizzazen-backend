-- Fix foreign key ingrediente_default_id per permettere eliminazione
ALTER TABLE ingredienti
  DROP CONSTRAINT IF EXISTS ingredienti_ingrediente_default_id_fkey;

ALTER TABLE ingredienti
  ADD CONSTRAINT ingredienti_ingrediente_default_id_fkey
  FOREIGN KEY (ingrediente_default_id)
  REFERENCES ingredienti_default(id)
  ON DELETE SET NULL;
