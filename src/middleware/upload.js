const multer = require('multer');
const { badRequest } = require('../utils/response');

// Tipi MIME accettati per le immagini
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

// Salva in memoria (il file viene poi processato da sharp e salvato)
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Formato non supportato. Usa JPG, PNG o WebP'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE }
});

/**
 * Middleware per gestire gli errori di upload
 */
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return badRequest(res, 'File troppo grande. Massimo 5 MB');
    }
    return badRequest(res, `Errore upload: ${err.message}`);
  }
  if (err) {
    return badRequest(res, err.message);
  }
  next();
};

module.exports = { upload, handleUploadError };
