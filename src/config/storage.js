const path = require('path');
const fs   = require('fs');
const sharp = require('sharp');

const STORAGE_PATH = process.env.STORAGE_PATH
  ? path.resolve(process.env.STORAGE_PATH)
  : path.join(__dirname, '../../storage');

// Crea le cartelle necessarie se non esistono
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Cartelle base
ensureDir(path.join(STORAGE_PATH, 'defaults/ingredienti'));
ensureDir(path.join(STORAGE_PATH, 'defaults/placeholder'));

/**
 * Salva un file immagine ottimizzato
 * @param {Buffer} buffer - dati del file
 * @param {string} relativePath - percorso relativo es: "pizzerie/1/logo.webp"
 * @param {object} opts - opzioni di ridimensionamento
 * @returns {string} URL pubblico del file
 */
const saveImage = async (buffer, relativePath, opts = {}) => {
  const {
    width   = 800,
    height  = 800,
    fit     = 'inside',
    quality = 85
  } = opts;

  const fullPath = path.join(STORAGE_PATH, relativePath);
  ensureDir(path.dirname(fullPath));

  // Ottimizza con sharp: ridimensiona e converti in webp
  await sharp(buffer)
    .resize(width, height, { fit, withoutEnlargement: true })
    .webp({ quality })
    .toFile(fullPath.replace(/\.[^.]+$/, '.webp'));

  // Ritorna il path con estensione webp
  const webpPath = relativePath.replace(/\.[^.]+$/, '.webp');
  return buildUrl(webpPath);
};

/**
 * Salva il logo di una pizzeria
 */
const saveLogo = async (buffer, pizzeriaId) => {
  return saveImage(buffer, `pizzerie/${pizzeriaId}/logo.webp`, {
    width: 400, height: 400, fit: 'inside', quality: 90
  });
};

/**
 * Salva l'immagine di un articolo del menu
 */
const saveMenuImage = async (buffer, pizzeriaId, articoloId) => {
  return saveImage(buffer, `pizzerie/${pizzeriaId}/menu/${articoloId}.webp`, {
    width: 600, height: 600, fit: 'cover', quality: 85
  });
};

/**
 * Salva l'icona di una categoria
 */
const saveCategoriaIcon = async (buffer, pizzeriaId, categoriaId) => {
  return saveImage(buffer, `pizzerie/${pizzeriaId}/categorie/${categoriaId}.webp`, {
    width: 200, height: 200, fit: 'cover', quality: 90
  });
};

/**
 * Salva l'icona di un ingrediente (globale o di pizzeria)
 */
const saveIngredienteIcon = async (buffer, ingredienteId, isDefault = false) => {
  const subPath = isDefault
    ? `defaults/ingredienti/${ingredienteId}.webp`
    : `ingredienti/${ingredienteId}.webp`;
  return saveImage(buffer, subPath, {
    width: 200, height: 200, fit: 'cover', quality: 90
  });
};

/**
 * Elimina un file dallo storage
 */
const deleteFile = (relativePath) => {
  if (!relativePath) return;
  const fullPath = path.join(STORAGE_PATH, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
};

/**
 * Costruisce l'URL pubblico di un file
 */
const buildUrl = (relativePath) => {
  if (!relativePath) return null;
  const base = process.env.BASE_URL || 'http://localhost:3000';
  return `${base}/storage/${relativePath}`;
};

/**
 * Restituisce l'URL di default se non c'è un'immagine personalizzata
 */
const getImageUrl = (storedPath, tipo = 'pizza') => {
  if (storedPath) return buildUrl(storedPath);
  const defaults = {
    pizza:        buildUrl('defaults/placeholder/pizza-default.png'),
    logo:         buildUrl('defaults/placeholder/logo-default.png'),
    ingrediente:  buildUrl('defaults/placeholder/ingrediente-default.png'),
    categoria:    buildUrl('defaults/placeholder/categoria-default.png'),
  };
  return defaults[tipo] || null;
};

module.exports = {
  saveLogo,
  saveMenuImage,
  saveCategoriaIcon,
  saveIngredienteIcon,
  deleteFile,
  buildUrl,
  getImageUrl,
  STORAGE_PATH,
};
