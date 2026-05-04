const router = require('express').Router();
const { authMiddleware } = require('../../middleware/auth');

// Tutte le route /pizzeria richiedono autenticazione
router.use(authMiddleware);

router.use('/orari',        require('./orari'));
router.use('/ingredienti',  require('./ingredienti'));
router.use('/menu',         require('./menu'));
router.use('/clienti',      require('./clienti'));
router.use('/slot',         require('./slot'));
router.use('/ordini',       require('./ordini'));
router.use('/stats',        require('./stats'));
router.use('/impostazioni', require('./impostazioni'));
router.use('/whatsapp',     require('./whatsapp'));

module.exports = router;
