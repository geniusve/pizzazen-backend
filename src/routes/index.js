const router = require('express').Router();

// Le route vengono aggiunte progressivamente
// man mano che sviluppiamo il backend

router.use('/auth',       require('./auth'));
router.use('/admin',      require('./admin/index'));
router.use('/pizzeria',   require('./pizzeria/index'));
router.use('/tracking',   require('./tracking'));
router.use('/centralino', require('./centralino'));

// Placeholder
// router.use('/self-order', require('./selfOrder'));

module.exports = router;
