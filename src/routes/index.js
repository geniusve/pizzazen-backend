const router = require('express').Router();

// Le route vengono aggiunte progressivamente
// man mano che sviluppiamo il backend

router.use('/auth',    require('./auth'));

// Placeholder — verranno aggiunte nelle prossime sessioni
// router.use('/admin',   require('./admin'));
// router.use('/pizzeria', require('./pizzeria'));
// router.use('/self-order', require('./selfOrder'));
// router.use('/tracking', require('./tracking'));

module.exports = router;
