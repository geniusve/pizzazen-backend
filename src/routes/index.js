const router = require('express').Router();
const { authMiddleware, requireAdmin } = require('../middleware/auth');

router.use('/auth', require('./auth'));

// Admin globale
const adminRouter = require('./admin/index');
router.use('/admin', adminRouter);

// Utenti pizzeria — montato separatamente per mergeParams
const utentiRouter = require('./admin/utenti');
router.use('/admin/pizzerie/:pizzeriaId/utenti',
  authMiddleware,
  requireAdmin,
  utentiRouter
);

// Placeholder
// router.use('/pizzeria', require('./pizzeria/index'));
// router.use('/self-order', require('./selfOrder'));
// router.use('/tracking', require('./tracking'));

module.exports = router;