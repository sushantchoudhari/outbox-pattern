'use strict';

/**
 * middlewares/auth.middleware.js — JWT Authentication & Role-Based Authorization
 * ──────────────────────────────────────────────────────────────────────────────
 * Two exported middleware functions:
 *
 *   authenticate  — Verifies the Bearer token in the Authorization header.
 *                   On success it attaches the decoded payload to req.user
 *                   so downstream handlers know who is making the request.
 *
 *   authorize     — Restricts a route to users with specific role(s).
 *                   Always called AFTER authenticate:
 *                     router.delete('/:id', authenticate, authorize('admin'), controller.remove);
 *
 * WHY JWT?
 *   JWTs are self-contained — the server doesn't need a database lookup on every
 *   request to verify identity. The signature proves the token hasn't been tampered
 *   with; the payload contains everything we need (id, role, expiry).
 */

const jwt     = require('jsonwebtoken');
const config  = require('../config');

/**
 * Reads the "Authorization: Bearer <token>" header, verifies the JWT,
 * and attaches the decoded payload to req.user.
 *
 * Returns 401 if the header is missing, malformed, or the token is invalid/expired.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  // Header must be present and start with "Bearer " (note the space).
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authorization header missing or malformed — expected: Bearer <token>',
    });
  }

  // Strip the "Bearer " prefix to get the raw token.
  const token = authHeader.slice(7);

  try {
    // jwt.verify throws if the token is expired, tampered with, or signed with
    // a different secret. On success it returns the decoded payload object.
    req.user = jwt.verify(token, config.auth.jwtSecret);
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      error: 'Token is invalid or has expired',
    });
  }
}

/**
 * Restricts a route to users whose role is in the provided list.
 * Returns a middleware function, so it's used as: authorize('admin', 'manager').
 *
 * MUST be placed after authenticate in the middleware chain — authorize relies
 * on req.user being set by authenticate.
 *
 * @param  {...string} roles  One or more allowed roles.
 * @returns {Function}        An Express middleware function.
 */
function authorize(...roles) {
  return (req, res, next) => {
    // req.user is set by authenticate(); if it's missing the chain is misconfigured.
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to perform this action',
      });
    }
    next();
  };
}

module.exports = { authenticate, authorize };
