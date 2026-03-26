'use strict';

/**
 * validators/user.validator.js — User Request Validation Rules
 * ──────────────────────────────────────────────────────────────
 * Uses express-validator to declare what valid input looks like.
 * Rules are applied as middleware BEFORE the controller runs, so the
 * controller always receives clean, validated data.
 *
 * HOW IT WORKS:
 *   1. Rule arrays (e.g. createUserRules) are spread into the route definition.
 *   2. After all rules run, the `validate` middleware checks for errors.
 *   3. If any field is invalid, `validate` returns 422 immediately.
 *   4. If everything is fine, `validate` calls next() and the controller runs.
 *
 *   Route definition example:
 *     router.post('/', createUserRules, validate, userController.create);
 */

const { body, param, validationResult } = require('express-validator');

/**
 * Checks if the previous validators found any errors.
 * Must be the LAST item in a route's middleware chain before the controller.
 */
function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return res.status(422).json({
      success: false,
      error:   'Validation failed',
      // Map errors to a simple array of { field, message } objects.
      details: result.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// ─── Rule sets ────────────────────────────────────────────────────────────────

/**
 * Rules for POST /users (create a new user).
 * All fields are required.
 */
const createUserRules = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),

  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Email must be a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),

  body('role')
    .optional()
    .isIn(['user', 'admin']).withMessage('Role must be "user" or "admin"'),
];

/**
 * Rules for PATCH /users/:id (partial update).
 * All fields are optional — validate only the ones that are present.
 */
const updateUserRules = [
  param('id')
    .isUUID().withMessage('User ID must be a valid UUID'),

  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),

  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Email must be a valid email address')
    .normalizeEmail(),

  body('password')
    .optional()
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

/**
 * Rules for routes that take only a UUID in the path (GET, DELETE /users/:id).
 */
const idParamRules = [
  param('id').isUUID().withMessage('User ID must be a valid UUID'),
];

module.exports = { validate, createUserRules, updateUserRules, idParamRules };
