/**
 * tests/unit/user.service.test.ts — User Service Unit Tests
 * ────────────────────────────────────────────────────────────
 * Tests the service layer in isolation — no HTTP, no real database.
 * The in-memory repository is cleared before each test so tests are
 * independent and can run in any order.
 */

import { userService } from '../../src/modules/user/user.service';
import { userRepository } from '../../src/modules/user/user.repository';
import { ApiError } from '../../src/common/errors/ApiError';

beforeEach(() => {
  userRepository.clear();
});

// ─── createUser ───────────────────────────────────────────────────────────────

describe('userService.createUser()', () => {
  it('creates a user and returns a sanitized object (no password field)', async () => {
    const user = await userService.createUser({
      name:     'Alice',
      email:    'alice@example.com',
      password: 'password123',
    });

    expect(user.id).toBeDefined();
    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@example.com');
    expect(user.role).toBe('user');
    expect('password' in user).toBe(false);
  });

  it('normalises email to lowercase', async () => {
    const user = await userService.createUser({
      name:  'Bob',
      email: 'Bob@Example.COM',
      password: 'password123',
    });
    expect(user.email).toBe('bob@example.com');
  });

  it('throws 409 ApiError when email is already in use', async () => {
    await userService.createUser({ name: 'Alice', email: 'alice@example.com', password: 'pw12345678' });

    await expect(
      userService.createUser({ name: 'Alice 2', email: 'alice@example.com', password: 'pw12345678' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

// ─── getUserById ──────────────────────────────────────────────────────────────

describe('userService.getUserById()', () => {
  it('returns the user for a valid id', async () => {
    const created = await userService.createUser({
      name: 'Carol', email: 'carol@example.com', password: 'password123',
    });
    const found = userService.getUserById(created.id);
    expect(found.id).toBe(created.id);
  });

  it('throws 404 ApiError for an unknown id', () => {
    expect(() => userService.getUserById('00000000-0000-0000-0000-000000000000')).toThrow(ApiError);
    expect(() => userService.getUserById('00000000-0000-0000-0000-000000000000'))
      .toThrow(expect.objectContaining({ statusCode: 404 }));
  });
});

// ─── getAllUsers ──────────────────────────────────────────────────────────────

describe('userService.getAllUsers()', () => {
  it('returns an empty array when no users exist', () => {
    expect(userService.getAllUsers()).toEqual([]);
  });

  it('returns all created users without password fields', async () => {
    await userService.createUser({ name: 'A', email: 'a@test.com', password: 'pw12345678' });
    await userService.createUser({ name: 'B', email: 'b@test.com', password: 'pw12345678' });

    const all = userService.getAllUsers();
    expect(all).toHaveLength(2);
    all.forEach((u) => expect('password' in u).toBe(false));
  });
});

// ─── updateUser ───────────────────────────────────────────────────────────────

describe('userService.updateUser()', () => {
  it('updates name and returns updated user', async () => {
    const user = await userService.createUser({
      name: 'Dave', email: 'dave@example.com', password: 'password123',
    });
    const updated = await userService.updateUser(user.id, { name: 'David' });
    expect(updated.name).toBe('David');
  });

  it('throws 409 when updating to an email already used by another user', async () => {
    await userService.createUser({ name: 'A', email: 'a@test.com', password: 'pw12345678' });
    const b = await userService.createUser({ name: 'B', email: 'b@test.com', password: 'pw12345678' });

    await expect(
      userService.updateUser(b.id, { email: 'a@test.com' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

// ─── deleteUser ───────────────────────────────────────────────────────────────

describe('userService.deleteUser()', () => {
  it('deletes an existing user without throwing', async () => {
    const user = await userService.createUser({
      name: 'Eve', email: 'eve@example.com', password: 'password123',
    });
    expect(() => userService.deleteUser(user.id)).not.toThrow();
    expect(() => userService.getUserById(user.id)).toThrow(expect.objectContaining({ statusCode: 404 }));
  });

  it('throws 404 ApiError when trying to delete a non-existent user', () => {
    expect(() => userService.deleteUser('00000000-0000-0000-0000-000000000000'))
      .toThrow(expect.objectContaining({ statusCode: 404 }));
  });
});
