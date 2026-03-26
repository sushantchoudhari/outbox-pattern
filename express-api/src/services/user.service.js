'use strict';

/**
 * services/user.service.js — User Business Logic
 * ─────────────────────────────────────────────────
 * The service layer is where BUSINESS RULES live.
 *
 * It sits between the controller (HTTP concerns) and the repository
 * (storage concerns).  A service method answers the question:
 * "Given valid input, what should actually happen?"
 *
 * RESPONSIBILITIES OF THIS LAYER:
 *   - Hash passwords before saving (security rule).
 *   - Enforce uniqueness constraints (business rule).
 *   - Return sanitized user objects (no passwords exposed).
 *   - Throw AppError with the correct HTTP status when something is wrong.
 *
 * WHAT THIS LAYER DOES NOT DO:
 *   - It does not parse HTTP requests (that is the controller's job).
 *   - It does not write SQL (that is the repository's job).
 */

const bcrypt       = require('bcryptjs');
const userRepo     = require('../repositories/user.repository');
const { buildUser, sanitizeUser } = require('../models/user.model');
const { AppError } = require('../utils/errors');

const BCRYPT_SALT_ROUNDS = 10;

const userService = {
  /**
   * Returns all users (without passwords).
   * @returns {Promise<object[]>}
   */
  async getAllUsers() {
    const users = await userRepo.findAll();
    return users.map(sanitizeUser);
  },

  /**
   * Returns a single user by ID.
   * Throws 404 if not found.
   * @param   {string}  id
   * @returns {Promise<object>}
   */
  async getUserById(id) {
    const user = await userRepo.findById(id);
    if (!user) throw new AppError('User not found', 404);
    return sanitizeUser(user);
  },

  /**
   * Creates a new user account.
   * Throws 409 if the email is already registered.
   *
   * @param {object} params
   * @param {string} params.name
   * @param {string} params.email
   * @param {string} params.password  - Plain-text; will be hashed here.
   * @param {string} [params.role]
   * @returns {Promise<object>}  The created user (no password).
   */
  async createUser({ name, email, password, role }) {
    // Enforce unique emails — duplicate accounts cause support headaches.
    const existing = await userRepo.findByEmail(email);
    if (existing) throw new AppError('Email is already registered', 409);

    // Hash the password before it ever touches storage.
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    const user = buildUser({ name, email, password: hashedPassword, role });
    await userRepo.save(user);

    return sanitizeUser(user);
  },

  /**
   * Partially updates a user.
   * - Re-hashes password if a new one is provided.
   * - Checks for email conflicts if the email is being changed.
   * Throws 404 if user not found, 409 if new email is already taken.
   *
   * @param   {string}  id
   * @param   {object}  changes  - Fields to update.
   * @returns {Promise<object>}  The updated user (no password).
   */
  async updateUser(id, changes) {
    const user = await userRepo.findById(id);
    if (!user) throw new AppError('User not found', 404);

    // Only check for email conflicts when the email is actually changing.
    if (changes.email && changes.email.toLowerCase() !== user.email) {
      const conflict = await userRepo.findByEmail(changes.email);
      if (conflict) throw new AppError('Email is already registered', 409);
    }

    // Hash the new password if one was provided.
    if (changes.password) {
      changes.password = await bcrypt.hash(changes.password, BCRYPT_SALT_ROUNDS);
    }

    const updated = await userRepo.update(id, changes);
    return sanitizeUser(updated);
  },

  /**
   * Deletes a user by ID.
   * Throws 404 if the user does not exist.
   * @param {string} id
   */
  async deleteUser(id) {
    const user = await userRepo.findById(id);
    if (!user) throw new AppError('User not found', 404);
    await userRepo.remove(id);
  },
};

module.exports = userService;
