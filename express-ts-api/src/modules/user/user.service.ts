/**
 * modules/user/user.service.ts — User Business Logic
 * ─────────────────────────────────────────────────────
 * The service layer owns all business rules.
 * It sits between controllers (HTTP) and the repository (storage).
 *
 * RULES ENFORCED HERE:
 *   - Passwords are hashed before storage — never stored as plaintext.
 *   - Email addresses must be unique — checked before insert and update.
 *   - Responses are always sanitized (password stripped) before returning.
 *
 * ERRORS:
 *   Use ApiError factory methods so the central error middleware can map
 *   them to the correct HTTP status code automatically.
 */

import bcrypt from 'bcryptjs';
import { ApiError } from '../../common/errors/ApiError';
import { buildUser, sanitizeUser, SafeUser, UserRole } from './user.model';
import { userRepository } from './user.repository';

const BCRYPT_SALT_ROUNDS = 10;

async function createUser(data: {
  name:     string;
  email:    string;
  password: string;
  role?:    UserRole;
}): Promise<SafeUser> {
  if (userRepository.findByEmail(data.email)) {
    throw ApiError.conflict('Email is already in use');
  }

  const hash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);
  const user = buildUser({ ...data, password: hash });
  userRepository.save(user);
  return sanitizeUser(user);
}

function getAllUsers(): SafeUser[] {
  return userRepository.findAll().map(sanitizeUser);
}

function getUserById(id: string): SafeUser {
  const user = userRepository.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  return sanitizeUser(user);
}

async function updateUser(
  id: string,
  updates: { name?: string; email?: string; password?: string },
): Promise<SafeUser> {
  const existing = userRepository.findById(id);
  if (!existing) throw ApiError.notFound('User not found');

  // Check that the new email isn't already taken by a different user.
  if (updates.email && updates.email !== existing.email) {
    const conflict = userRepository.findByEmail(updates.email);
    if (conflict) throw ApiError.conflict('Email is already in use');
  }

  const payload: Partial<Omit<typeof existing, 'id' | 'createdAt'>> = {};
  if (updates.name)  payload.name  = updates.name;
  if (updates.email) payload.email = updates.email.toLowerCase().trim();
  if (updates.password) {
    payload.password = await bcrypt.hash(updates.password, BCRYPT_SALT_ROUNDS);
  }

  const updated = userRepository.update(id, payload);
  if (!updated) throw ApiError.notFound('User not found');
  return sanitizeUser(updated);
}

function deleteUser(id: string): void {
  if (!userRepository.findById(id)) throw ApiError.notFound('User not found');
  userRepository.remove(id);
}

export const userService = { createUser, getAllUsers, getUserById, updateUser, deleteUser };
