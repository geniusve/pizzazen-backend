-- Aggiunge categoria agli ingredienti default e alle pizzerie
ALTER TABLE ingredienti_default
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(30) DEFAULT 'extra';

ALTER TABLE ingredienti
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(30) DEFAULT 'extra';

-- Svuota ingredienti default esistenti
TRUNCATE ingredienti_default RESTART IDENTITY CASCADE;

-- Inserisce la lista completa con allergeni e categorie
INSERT INTO ingredienti_default (descrizione, categoria, allergeni, prezzo, nota) VALUES

-- IMPASTO
('Impasto classico',      'impasto', '{"glutine"}', 0, null),
('Impasto integrale',     'impasto', '{"glutine"}', 0.50, null),
('Impasto al Kamut',      'impasto', '{"glutine"}', 0.50, null),
('Impasto multicereali',  'impasto', '{"glutine"}', 0.50, null),
('Impasto senza glutine', 'impasto', '{}', 1.50, null),
('Impasto alla soia',     'impasto', '{"glutine","soia"}', 0.50, null),
('Impasto al farro',      'impasto', '{"glutine"}', 0.50, null),

-- SALSE
('Passata di pomodoro',       'salse', '{}', 0, null),
('Pomodori pelati',           'salse', '{}', 0, null),
('Salsa di pomodorini gialli','salse', '{}', 0, null),
('Pesto alla genovese',       'salse', '{"frutta_a_guscio"}', 0.50, 'Contiene pinoli'),
('Crema di zucca',            'salse', '{}', 0.50, null),
('Crema di pistacchio',       'salse', '{"frutta_a_guscio"}', 1.00, null),
('Crema di tartufo',          'salse', '{}', 1.50, null),
('Crema di carciofi',         'salse', '{}', 0.50, null),
('Salsa di noci',             'salse', '{"frutta_a_guscio"}', 0.50, null),

-- FORMAGGI
('Mozzarella',                    'formaggi', '{"latte"}', 0, null),
('Fior di latte',                 'formaggi', '{"latte"}', 0, null),
('Mozzarella di bufala DOP',      'formaggi', '{"latte"}', 1.50, null),
('Burrata',                       'formaggi', '{"latte"}', 1.50, null),
('Stracciatella',                 'formaggi', '{"latte"}', 1.50, null),
('Provola affumicata',            'formaggi', '{"latte"}', 0.50, null),
('Gorgonzola',                    'formaggi', '{"latte"}', 0.50, 'Dolce o piccante'),
('Parmigiano Reggiano',           'formaggi', '{"latte"}', 0.50, 'A scaglie o grattugiato'),
('Pecorino Romano',               'formaggi', '{"latte"}', 0.50, null),
('Scamorza',                      'formaggi', '{"latte"}', 0.50, null),
('Ricotta fresca',                'formaggi', '{"latte"}', 0.50, null),
('Ricotta salata',                'formaggi', '{"latte"}', 0.50, null),
('Mascarpone',                    'formaggi', '{"latte"}', 0.50, null),
('Brie',                          'formaggi', '{"latte"}', 0.50, null),
('Fontina',                       'formaggi', '{"latte"}', 0.50, null),
('Feta',                          'formaggi', '{"latte"}', 0.50, null),

-- SALUMI
('Prosciutto cotto',              'salumi', '{}', 0.50, null),
('Prosciutto crudo',              'salumi', '{}', 1.00, 'Es. Parma, San Daniele'),
('Salame piccante',               'salumi', '{}', 0.50, 'Spianata calabra'),
('Salame dolce',                  'salumi', '{}', 0.50, 'Milano'),
('Salsiccia fresca',              'salumi', '{}', 0.50, null),
('Speck',                         'salumi', '{}', 1.00, 'Alto Adige'),
('Pancetta',                      'salumi', '{}', 0.50, 'Arrotolata o affumicata'),
('Guanciale',                     'salumi', '{}', 0.50, null),
('Bresaola',                      'salumi', '{}', 1.00, 'Della Valtellina'),
('Mortadella',                    'salumi', '{"frutta_a_guscio"}', 0.50, 'Spesso abbinata al pistacchio'),
('Wurstel',                       'salumi', '{}', 0.50, null),
('Nduja di Spilinga',             'salumi', '{}', 0.50, null),
('Porchetta',                     'salumi', '{}', 0.50, null),
('Sfilacci di cavallo',           'salumi', '{}', 1.00, null),
('Pollo',                         'salumi', '{}', 0.50, null),

-- VERDURE
('Funghi Champignon',             'verdure', '{}', 0.50, 'Freschi o trifolati'),
('Funghi Porcini',                'verdure', '{}', 1.00, null),
('Funghi Chiodini',               'verdure', '{}', 0.50, null),
('Carciofini',                    'verdure', '{}', 0.50, 'Sott''olio o freschi'),
('Olive nere',                    'verdure', '{}', 0.50, 'Denocciolate o taggiasche'),
('Olive verdi',                   'verdure', '{}', 0.50, null),
('Cipolla bianca',                'verdure', '{}', 0, null),
('Cipolla rossa di Tropea',       'verdure', '{}', 0.50, null),
('Peperoni',                      'verdure', '{}', 0.50, 'Arrostiti o freschi'),
('Melanzane',                     'verdure', '{}', 0.50, 'Grigliate o fritte'),
('Zucchine',                      'verdure', '{}', 0.50, 'Grigliate o a julienne'),
('Friarielli',                    'verdure', '{}', 0.50, 'Cime di rapa'),
('Rucola fresca',                 'verdure', '{}', 0, null),
('Radicchio',                     'verdure', '{}', 0.50, 'Spesso trevigiano'),
('Patate al forno',               'verdure', '{}', 0.50, null),
('Patatine fritte',               'verdure', '{}', 0.50, null),
('Pomodorini ciliegino',          'verdure', '{}', 0, 'O datterino'),
('Pomodori secchi',               'verdure', '{}', 0.50, 'Sott''olio'),
('Mais',                          'verdure', '{}', 0, null),
('Asparagi',                      'verdure', '{}', 0.50, null),
('Spinaci',                       'verdure', '{}', 0, null),
('Capperi',                       'verdure', '{}', 0, null),

-- PESCE
('Acciughe',                      'pesce', '{"pesce"}', 0.50, 'Sott''olio o salate'),
('Tonno',                         'pesce', '{"pesce"}', 0.50, 'Sott''olio'),
('Salmone affumicato',            'pesce', '{"pesce"}', 1.50, null),
('Gamberetti',                    'pesce', '{"crostacei"}', 1.50, null),
('Frutti di mare',                'pesce', '{"molluschi","crostacei"}', 2.00, 'Cozze, vongole, misto scoglio'),
('Calamari',                      'pesce', '{"molluschi"}', 1.50, null),
('Polpo',                         'pesce', '{"molluschi"}', 1.50, null),

-- EXTRA
('Basilico fresco',               'extra', '{}', 0, null),
('Origano',                       'extra', '{}', 0, null),
('Aglio',                         'extra', '{}', 0, null),
('Peperoncino',                   'extra', '{}', 0, 'Olio piccante o frantumato'),
('Olio extravergine d''oliva',    'extra', '{}', 0, null),
('Olio aromatizzato al tartufo',  'extra', '{}', 1.00, null),
('Granella di pistacchio',        'extra', '{"frutta_a_guscio"}', 1.00, null),
('Granella di nocciole',          'extra', '{"frutta_a_guscio"}', 0.50, null),
('Noci sgusciate',                'extra', '{"frutta_a_guscio"}', 0.50, null),
('Mandorle a scaglie',            'extra', '{"frutta_a_guscio"}', 0.50, null),
('Tartufo nero',                  'extra', '{}', 2.00, null),
('Miele',                         'extra', '{}', 0.50, null),
('Glassa di aceto balsamico',     'extra', '{}', 0.50, null),
('Limone',                        'extra', '{}', 0, null);
