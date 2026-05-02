const { validationResult } = require('express-validator');
const { validation } = require('../utils/response');

/**
 * Da usare dopo i validator di express-validator.
 * Se ci sono errori li restituisce formattati, altrimenti chiama next().
 *
 * Esempio uso in route:
 *   router.post('/',
 *     body('nome').notEmpty().withMessage('Nome obbligatorio'),
 *     validate,
 *     controller
 *   );
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return validation(res, errors.array().map(e => ({
      campo:    e.path,
      valore:   e.value,
      problema: e.msg
    })));
  }
  next();
};

module.exports = { validate };
