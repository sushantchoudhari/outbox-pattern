/**
 * modules/user/user.repository.ts — User Data Access Layer
 * ──────────────────────────────────────────────────────────
 * All reads and writes to user storage go through this module.
 * The rest of the app never touches the store directly.
 *
 * CURRENT IMPLEMENTATION: in-memory Map
 *   No database is needed to run the app. Data resets on every restart.
 *
 * SWITCHING TO POSTGRESQL:
 *   Replace each Map operation with the equivalent pool.query() call.
 *   Example for findById():
 *
 *     import { pool } from '../../database';
 *     async findById(id: string): Promise<User | undefined> {
 *       const { rows } = await pool.query<User>('SELECT * FROM users WHERE id = $1', [id]);
 *       return rows[0];
 *     }
 *
 *   The service layer requires NO changes — it only calls this module.
 */

import { User } from './user.model';

// The in-memory store. Exported as a singleton so tests can call clear().
const store = new Map<string, User>();

function findAll(): User[] {
  return Array.from(store.values());
}

function findById(id: string): User | undefined {
  return store.get(id);
}

function findByEmail(email: string): User | undefined {
  return Array.from(store.values()).find((u) => u.email === email);
}

function save(user: User): User {
  store.set(user.id, user);
  return user;
}

function update(id: string, updates: Partial<Omit<User, 'id' | 'createdAt'>>): User | undefined {
  const existing = store.get(id);
  if (!existing) return undefined;

  const updated: User = {
    ...existing,
    ...updates,
    id:        existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  store.set(id, updated);
  return updated;
}

function remove(id: string): boolean {
  return store.delete(id);
}

/** Wipes the entire store — used in test beforeEach hooks. */
function clear(): void {
  store.clear();
}

export const userRepository = { findAll, findById, findByEmail, save, update, remove, clear };
