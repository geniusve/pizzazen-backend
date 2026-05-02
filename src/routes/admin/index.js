const router = require('express').Router();
const { authMiddleware, requireAdmin } = require('../../middleware/auth');

// Tutte le route /admin richiedono autenticazione come admin globale
router.use(authMiddleware);
router.use(requireAdmin);

// Sub-routes
router.use('/pizzerie',              require('./pizzerie'));
router.use('/pizzerie/:pizzeriaId/utenti', require('./utenti'));
router.use('/ingredienti',           require('./ingredienti'));

module.exports = router;
