'use strict';

/**
 * repositories/user.repository.js — User Data Access Layer
 * ──────────────────────────────────────────────────────────
 * The repository is the ONLY place that knows how data is stored.
 * Services call repository methods; they never write SQL or touch the
 * in-memory store directly.
 *
 * CURRENT IMPLEMENTATION: in-memory Map
 * Works out of the box — no database setup needed.
 * Data is lost when the server restarts.
 *
 * TO SWITCH TO POSTGRESQL:
 * Replace the Map operations with pool.query() calls using the pool from
 * src/database/connection.js.  The service layer needs zero changes.
 *
 * EXAMPLE PostgreSQL implementation of findById:
 *
 *   const pool = require('../database/connection');
 *
 *   async findById(id) {
 *     const { rows } = await pool.query(
 *       'SELECT * FROM users WHERE id = $1', [id]
 *     );
 *     return rows[0] || null;
 *   }
 */

// In-memory store: key = user.id, value = user object
const store = new Map();

const userRepository = {
  /**
   * Returns all users.
   * @returns {Promise<object[]>}
   */
  async findAll() {
    return Array.from(store.values());
  },

  /**
   * Finds a user by their UUID.
   * @param   {string}        id
   * @returns {Promise<object|null>}  The user, or null if not found.
   */
  async findById(id) {
    return store.get(id) || null;
  },

  /**
   * Finds a user by their email address (case-insensitive).
   * @param   {string}        email
   * @returns {Promise<object|null>}
   */
  async findByEmail(email) {
    const normalised = email.toLowerCase();
    for (const user of store.values()) {
      if (user.email === normalised) return user;
    }
    return null;
  },

  /**
   * Persists a new user object.
   * @param   {object}  user  - Fully populated user object (from buildUser).
   * @returns {Promise<object>}  The saved user.
   */
  async save(user) {
    store.set(user.id, user);
    return user;
  },

  /**
   * Applies partial changes to an existing user.
   * @param   {string}  id
   * @param   {object}  changes  - Only the fields to update.
   * @returns {Promise<object|null>}  Updated user, or null if not found.
   */
  async update(id, changes) {
    const existing = store.get(id);
    if (!existing) return null;

    const updated = {
      ...existing,
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    store.set(id, updated);
    return updated;
  },

  /**
   * Removes a user by ID.
   * @param   {string}   id
   * @returns {Promise<boolean>}  True if deleted, false if not found.
   */
  async remove(id) {
    return store.delete(id);
  },
};

module.exports = userRepository;
