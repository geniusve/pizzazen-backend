const router = require('express').Router();
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use('/auth',       require('./auth'));
router.use('/admin',      require('./admin/index'));
router.use('/pizzeria',   require('./pizzeria/index'));
router.use('/tracking',   require('./tracking'));
router.use('/centralino', require('./centralino'));
router.use('/self-order', require('./selfOrder'));

// Utenti pizzeria — mergeParams per passare pizzeriaId
const utentiRouter = require('./admin/utenti');
router.use('/admin/pizzerie/:pizzeriaId/utenti',
  authMiddleware,
  requireAdmin,
  utentiRouter
);

module.exports = router;

// Ping — health check pubblico via Nginx
router.get('/ping', (req, res) => res.json({ ok: true }));
