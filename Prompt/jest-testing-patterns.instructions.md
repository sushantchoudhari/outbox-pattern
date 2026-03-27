---
description: "Use when writing unit tests, integration tests, or test configuration. Covers Jest + ts-jest setup, test structure, mocking patterns, supertest for routes, and isolation conventions."
applyTo: "**/*.test.ts"
---

# Jest Testing Patterns

## Test runner setup
- Test framework: `jest` with `ts-jest` transformer.
- Test file naming: `*.test.ts` (never `.spec.ts` unless the project already uses it).
- Location: `tests/unit/` for unit tests, `tests/integration/` for route tests.
- Setup file: `tests/setup.ts` — sets `process.env.NODE_ENV = 'testing'` before all tests.

## Jest config (`jest.config.ts`)
```typescript
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['./tests/setup.ts'],
  testPathPattern: 'tests/',
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts', '!src/docs/**'],
};
```

## Unit tests (services, utilities)
- One `describe` block per function or method.
- `beforeEach`: reset in-memory store with `repository.clear()` or equivalent.
- Assert both success path and every error case (`ApiError.notFound`, `ApiError.conflict`, etc.).

```typescript
describe('UserService.createUser', () => {
  beforeEach(() => userRepository.clear());

  it('creates a user and returns sanitized data', async () => { ... });
  it('throws conflict if email already exists', async () => {
    await userService.createUser(input);
    await expect(userService.createUser(input)).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
```

## Integration tests (routes)
- Use `supertest` — never start a real server (no port binding).
- Build the app with the loader directly: `loadExpress(express())`.
- `beforeEach`: call `repository.clear()` so each test starts with a clean state.
- Mock external services (SNS, SQS, third-party HTTP calls) with `jest.mock()`.

```typescript
import request from 'supertest';
import express from 'express';
import { loadExpress } from '../../src/loaders/express.loader';

const app = express();
loadExpress(app);

describe('POST /api/v1/users', () => {
  beforeEach(() => userRepository.clear());

  it('returns 201 with created user', async () => {
    const res = await request(app).post('/api/v1/users').send({ ... });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('returns 422 on missing required field', async () => {
    const res = await request(app).post('/api/v1/users').send({});
    expect(res.status).toBe(422);
  });
});
```

## Coverage requirements
- Every new service function needs at least one unit test for the happy path and one for each error case.
- Every new route needs at least one integration test for 2xx and one for the expected 4xx.

## Environment in tests
- Always use `NODE_ENV=testing` and `.env.testing`.
- Never use production JWT secrets or DB connections in tests.
- Use a short `JWT_SECRET` (min 32 chars) in `.env.testing` — never a real secret.

## Mocking
```typescript
// Mock a module
jest.mock('../../src/modules/user/user.repository');

// Mock a specific method
jest.spyOn(userService, 'createUser').mockResolvedValue(mockUser);

// Reset mocks between tests
afterEach(() => jest.clearAllMocks());
```
