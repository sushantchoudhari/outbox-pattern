/**
 * tests/integration/user.routes.test.ts — User API Integration Tests
 * ─────────────────────────────────────────────────────────────────────
 * Tests the full HTTP stack — request → middleware → controller → service →
 * repository → response — using supertest to send real HTTP requests against
 * a test-only Express instance (no port binding needed).
 *
 * Each test gets a fresh Express app and a cleared in-memory store so tests
 * are fully independent.
 */

import request from 'supertest';
import express from 'express';
import { loadExpress } from '../../src/loaders/express.loader';
import { userRepository } from '../../src/modules/user/user.repository';

function buildApp(): express.Application {
  const app = express();
  loadExpress(app);
  return app;
}

beforeEach(() => {
  userRepository.clear();
});

// ─── Health check ─────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 with ok status', async () => {
    const res = await request(buildApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(typeof res.body.data.uptime).toBe('number');
  });
});

// ─── POST /api/v1/users ───────────────────────────────────────────────────────

describe('POST /api/v1/users', () => {
  it('returns 201 and the created user without a password field', async () => {
    const res = await request(buildApp())
      .post('/api/v1/users')
      .send({ name: 'Alice', email: 'alice@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe('alice@example.com');
    expect(res.body.data.password).toBeUndefined();
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('returns 422 with field-level details for invalid input', async () => {
    const res = await request(buildApp())
      .post('/api/v1/users')
      .send({ name: 'x' }); // too short, missing email + password

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('returns 409 when the email is already registered', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/v1/users')
      .send({ name: 'Alice', email: 'alice@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/v1/users')
      .send({ name: 'Alice 2', email: 'alice@example.com', password: 'password123' });

    expect(res.status).toBe(409);
  });
});

// ─── GET /api/v1/users/:id ────────────────────────────────────────────────────

describe('GET /api/v1/users/:id', () => {
  it('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/v1/users/some-id');
    expect(res.status).toBe(401);
  });

  it('returns 422 for a non-UUID id', async () => {
    // We need a token — register first to get one
    const app = buildApp();
    const authRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Tester', email: 'tester@example.com', password: 'password123' });

    const token: string = authRes.body.data.token;

    const res = await request(app)
      .get('/api/v1/users/not-a-uuid')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(422);
  });
});

// ─── 404 catch-all ────────────────────────────────────────────────────────────

describe('404 handler', () => {
  it('returns 404 for an unknown route', async () => {
    const res = await request(buildApp()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /api/v1/auth/register + login ──────────────────────────────────────

describe('Auth flow', () => {
  it('register → login → profile', async () => {
    const app = buildApp();

    // Register
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Bob', email: 'bob@example.com', password: 'password123' });

    expect(reg.status).toBe(201);
    expect(typeof reg.body.data.token).toBe('string');

    // Login
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'bob@example.com', password: 'password123' });

    expect(login.status).toBe(200);
    const token: string = login.body.data.token;

    // Profile
    const profile = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(profile.status).toBe(200);
    expect(profile.body.data.email).toBe('bob@example.com');
  });

  it('login with wrong password returns 401', async () => {
    const app = buildApp();
    await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Bob', email: 'bob@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'bob@example.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });
});
