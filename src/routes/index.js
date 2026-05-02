const router = require('express').Router();

// Le route vengono aggiunte progressivamente
// man mano che sviluppiamo il backend

router.use('/auth',    require('./auth'));
router.use('/admin',  require('./admin/index'));

// Placeholder — verranno aggiunte nelle prossime sessioni
// router.use('/pizzeria',   require('./pizzeria/index'));
// router.use('/self-order', require('./selfOrder'));
// router.use('/tracking',   require('./tracking'));

module.exports = router;
