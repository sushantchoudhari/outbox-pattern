'use strict';

/**
 * controllers/user.controller.js — User HTTP Handler
 * ─────────────────────────────────────────────────────
 * The controller layer is the bridge between HTTP and the service layer.
 *
 * RESPONSIBILITIES:
 *   - Read data from the HTTP request (req.params, req.body, req.user).
 *   - Call the appropriate service method.
 *   - Send the HTTP response using the response helpers.
 *   - Pass any error to Express's error handler via next(err).
 *
 * WHAT THIS LAYER DOES NOT DO:
 *   - It does not contain business rules (those live in the service).
 *   - It does not validate input (that is the validator middleware's job).
 *   - It does not access the database directly (that is the repository's job).
 *
 * The try/catch in every method does one thing: forward unhandled errors
 * to Express's central error handler (src/middlewares/error.middleware.js).
 */

const userService           = require('../services/user.service');
const { ok, created, noContent } = require('../utils/response');

const userController = {
  /**
   * GET /api/v1/users
   * Returns a list of all users.
   */
  async getAll(req, res, next) {
    try {
      const users = await userService.getAllUsers();
      return ok(res, users);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/v1/users/:id
   * Returns a single user by UUID.
   */
  async getById(req, res, next) {
    try {
      const user = await userService.getUserById(req.params.id);
      return ok(res, user);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/v1/users
   * Creates a new user.  Input has already been validated by the middleware.
   */
  async create(req, res, next) {
    try {
      const newUser = await userService.createUser(req.body);
      return created(res, newUser);
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/v1/users/:id
   * Partially updates a user.
   */
  async update(req, res, next) {
    try {
      const updatedUser = await userService.updateUser(req.params.id, req.body);
      return ok(res, updatedUser);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DELETE /api/v1/users/:id
   * Deletes a user.  Returns 204 No Content on success.
   */
  async remove(req, res, next) {
    try {
      await userService.deleteUser(req.params.id);
      return noContent(res);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = userController;
