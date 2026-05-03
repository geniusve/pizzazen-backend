-- Migrazione 002: aggiunge colonna slug alla tabella pizzerie
ALTER TABLE pizzerie ADD COLUMN IF NOT EXISTS slug VARCHAR(150) UNIQUE;

-- Genera slug per pizzerie esistenti che non ce l'hanno
UPDATE pizzerie
SET slug = LOWER(
    REGEXP_REPLACE(
        REGEXP_REPLACE(
            TRANSLATE(nome,
                'àáâãäåèéêëìíîïòóôõöùúûüýÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝ',
                'aaaaaaeeeeiiiioooooUUUUyAAAAAEEEEIIIIOOOOOUUUUY'
            ),
        '[^a-zA-Z0-9\s-]', '', 'g'),
    '\s+', '-', 'g')
)
WHERE slug IS NULL;