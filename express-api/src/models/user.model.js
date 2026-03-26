'use strict';

/**
 * models/user.model.js — User Shape Definition
 * ──────────────────────────────────────────────
 * The model layer defines the SHAPE of domain objects.
 * It does NOT talk to the database — that is the repository's job.
 *
 * WHY SEPARATE MODELS FROM REPOSITORIES?
 * - The model says "a user looks like this".
 * - The repository says "here is how to store and retrieve a user".
 * If you later switch from an in-memory store to PostgreSQL to MongoDB,
 * you only change the repository — the model stays the same.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Creates a new user object with all fields populated.
 * Call this in the service layer before saving to the repository.
 *
 * NOTE: `password` must already be hashed by the caller (the service).
 * The model never hashes — that is business logic, not a data shape concern.
 *
 * @param {object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {string} params.password  - Pre-hashed password string.
 * @param {string} [params.role]    - Default: 'user'.
 * @returns {object} A fully populated user object.
 */
function buildUser({ name, email, password, role = 'user' }) {
  const now = new Date().toISOString();
  return {
    id:        uuidv4(),
    name,
    email:     email.toLowerCase().trim(),
    password,           // stored as bcrypt hash — never the plain text value
    role,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Strips sensitive fields before sending a user in an API response.
 * Always call this before returning a user object from a controller.
 *
 * @param {object} user
 * @returns {object} User without the `password` field.
 */
function sanitizeUser(user) {
  const { password, ...publicFields } = user;
  return publicFields;
}

module.exports = { buildUser, sanitizeUser };
