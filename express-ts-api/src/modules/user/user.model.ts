/**
 * modules/user/user.model.ts — User Shape & Constructors
 * ─────────────────────────────────────────────────────────
 * Defines what a User looks like in this application and provides
 * the two helper functions every layer uses:
 *
 *   buildUser    — constructs a new User from raw input (generates id, timestamps)
 *   sanitizeUser — strips the password field before sending to a client
 *
 * WHY KEEP THESE HERE?
 *   The same User type is used by the repository, service, and auth module.
 *   Putting the constructors here gives one authoritative place for the shape
 *   instead of duplicating object literals across layers.
 */

import { v4 as uuidv4 } from 'uuid';

export type UserRole = 'user' | 'admin';

/** Full database row — password is a bcrypt hash, never plaintext. */
export interface User {
  id:        string;
  name:      string;
  email:     string;
  password:  string;
  role:      UserRole;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/** The safe public representation — password is omitted. */
export type SafeUser = Omit<User, 'password'>;

/** Create a new User object ready to be handed to the repository. */
export function buildUser(input: {
  name:     string;
  email:    string;
  password: string; // must already be hashed by the caller
  role?:    UserRole;
}): User {
  const now = new Date().toISOString();
  return {
    id:        uuidv4(),
    name:      input.name.trim(),
    email:     input.email.toLowerCase().trim(),
    password:  input.password,
    role:      input.role ?? 'user',
    createdAt: now,
    updatedAt: now,
  };
}

/** Returns a copy of the user without the password field. */
export function sanitizeUser(user: User): SafeUser {
  const { password: _omit, ...safe } = user;
  return safe;
}
