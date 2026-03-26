'use strict';

/**
 * routes/user.routes.js — User Resource Routes
 * ──────────────────────────────────────────────
 * Defines every HTTP verb + path combination for the /v1/users resource.
 *
 * MIDDLEWARE CHAIN ORDER (left → right):
 *   authenticate  — verify JWT, set req.user              (auth required routes)
 *   authorize     — check req.user.role against allowed list (admin-only routes)
 *   *Rules        — express-validator field declarations
 *   validate      — inspect validation results, return 422 if invalid
 *   controller    — actual handler, always last
 *
 * ROUTE DECISIONS:
 *   POST /        is public — anyone can register.
 *   GET, PATCH    require a valid JWT (logged-in user).
 *   DELETE        requires a valid JWT AND the "admin" role.
 */

const { Router }  = require('express');
const controller  = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middlewares/auth.middleware');
const {
  validate,
  createUserRules,
  updateUserRules,
  idParamRules,
} = require('../validators/user.validator');

const router = Router();

// GET /v1/users — list every user (admins, support agents, etc.)
router.get('/',
  authenticate,
  controller.getAll
);

// GET /v1/users/:id — fetch a single user by UUID
router.get('/:id',
  authenticate,
  idParamRules,
  validate,
  controller.getById
);

// POST /v1/users — register a new account (public, no auth required)
router.post('/',
  createUserRules,
  validate,
  controller.create
);

// PATCH /v1/users/:id — update name / email / password (partial update)
router.patch('/:id',
  authenticate,
  updateUserRules,
  validate,
  controller.update
);

// DELETE /v1/users/:id — permanently remove a user (admin role only)
router.delete('/:id',
  authenticate,
  authorize('admin'),
  idParamRules,
  validate,
  controller.remove
);

module.exports = router;
