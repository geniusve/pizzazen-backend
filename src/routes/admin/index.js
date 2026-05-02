const router = require('express').Router();
const { authMiddleware, requireAdmin } = require('../../middleware/auth');

router.use(authMiddleware);
router.use(requireAdmin);

router.use('/pizzerie', require('./pizzerie'));
router.use('/ingredienti', require('./ingredienti'));

// Utenti montati separatamente con mergeParams sul router principale
module.exports = router;
module.exports.utenteRouter = require('./utenti');