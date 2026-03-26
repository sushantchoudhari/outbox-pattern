/**
 * modules/auth/auth.service.ts — Authentication Business Logic
 * ──────────────────────────────────────────────────────────────
 * Handles account creation, credential verification, and JWT issuance.
 *
 * RELATIONSHIP WITH userService:
 *   register() delegates user creation to userService.createUser() so that
 *   password hashing and uniqueness enforcement stay in one place.
 *
 *   login() reads directly from userRepository because it needs the raw
 *   password hash to call bcrypt.compare() — sanitizeUser() strips it.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { ApiError } from '../../common/errors/ApiError';
import { sanitizeUser } from '../user/user.model';
import { userRepository } from '../user/user.repository';
import { userService } from '../user/user.service';

/** Register a new account — returns the safe user object and a JWT. */
async function register(name: string, email: string, password: string) {
  // userService.createUser handles hashing + uniqueness check.
  const user = await userService.createUser({ name, email, password });
  const token = signToken(user.id, user.role);
  return { user, token };
}

/** Verify credentials and issue a JWT. */
async function login(email: string, password: string) {
  // Fetch the full record (includes password hash) directly from repository.
  const record = userRepository.findByEmail(email);

  // Use the same error to prevent user enumeration (leaking valid emails).
  if (!record) throw ApiError.unauthorized('Invalid email or password');

  const valid = await bcrypt.compare(password, record.password);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');

  const token = signToken(record.id, record.role);
  return { user: sanitizeUser(record), token };
}

/** Return the profile of the currently authenticated user. */
function profile(userId: string) {
  const user = userRepository.findById(userId);
  if (!user) throw ApiError.notFound('User not found');
  return sanitizeUser(user);
}

// ─── Private helper ───────────────────────────────────────────────────────────

function signToken(id: string, role: string): string {
  return jwt.sign({ id, role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
}

export const authService = { register, login, profile };
