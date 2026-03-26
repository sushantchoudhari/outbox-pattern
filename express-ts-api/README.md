# express-ts-api

Production-ready **Express.js + TypeScript** REST API starter with a clean, scalable modular architecture.  
Runs immediately with **no database required** — uses an in-memory store by default.

---

## Quick start

```bash
cd express-ts-api

# Install dependencies
npm install

# Copy env file and set a strong JWT_SECRET
cp .env.example .env.development
# Edit .env.development → set JWT_SECRET to a 32+ char random string

# Start development server (auto-restarts on file changes)
npm run dev

# Server:  http://localhost:3000
# API docs: http://localhost:3000/api/docs
```

---

## Available scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with `tsx watch` (auto-restart) |
| `npm start` | Start compiled production build |
| `npm run build` | Compile TypeScript → `dist/` |
| `npm test` | Run all tests |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Check for linting errors |
| `npm run lint:fix` | Auto-fix linting errors |
| `npm run format` | Format with Prettier |

---

## API endpoints

All routes are prefixed with `/api`.

### System

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Server liveness check |
| GET | `/api/docs` | No | Swagger UI (non-production only) |

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/auth/register` | No | Create account + receive JWT |
| POST | `/api/v1/auth/login` | No | Verify credentials + receive JWT |
| GET | `/api/v1/auth/me` | Bearer | Get logged-in user profile |

### Users

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/api/v1/users` | No | — | Create user |
| GET | `/api/v1/users` | Bearer | any | List all users |
| GET | `/api/v1/users/:id` | Bearer | any | Get user by UUID |
| PATCH | `/api/v1/users/:id` | Bearer | any | Update user fields |
| DELETE | `/api/v1/users/:id` | Bearer | admin | Delete user |

### Quick example

```bash
# Register
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"secret123"}'

# Login — copy the token from the response
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"secret123"}'

# Use the token
curl http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer <your-token>"
```

---

## Project structure

```
src/
├── server.ts                   Entry point — HTTP listener + graceful shutdown
├── app.ts                      Express factory — creates bare app instance
│
├── config/
│   └── index.ts                Zod-validated env config, fails startup on bad env
│
├── loaders/
│   ├── index.ts                Orchestrates startup (DB → Express)
│   └── express.loader.ts       Registers all middleware and routes
│
├── common/
│   ├── errors/
│   │   └── ApiError.ts         Custom error class — statusCode, factory helpers
│   ├── constants/
│   │   └── http.constants.ts   Named HTTP status codes
│   ├── helpers/
│   │   ├── logger.ts           Pino JSON logger (pretty in dev, JSON in prod)
│   │   └── response.helper.ts  ok(), created(), noContent() response helpers
│   └── types/
│       └── express.d.ts        Augments Request with req.id and req.user
│
├── middlewares/
│   ├── auth.middleware.ts       authenticate (JWT) + authorize (role guard)
│   ├── error.middleware.ts      Central 4-arg error handler
│   ├── notFound.middleware.ts   404 catch-all
│   ├── requestId.middleware.ts  UUID per-request tracing
│   └── validate.middleware.ts   Zod schema validation factory
│
├── modules/
│   ├── auth/
│   │   ├── auth.schema.ts       Zod: registerSchema, loginSchema
│   │   ├── auth.service.ts      register(), login(), profile()
│   │   ├── auth.controller.ts   HTTP handlers forwarding to service
│   │   └── auth.routes.ts       Route definitions
│   └── user/
│       ├── user.model.ts        User interface, buildUser(), sanitizeUser()
│       ├── user.schema.ts       Zod: createUserSchema, updateUserSchema, idParamSchema
│       ├── user.repository.ts   In-memory Map store (pg migration guide inside)
│       ├── user.service.ts      Business logic — hashing, uniqueness, errors
│       ├── user.controller.ts   HTTP handlers forwarding to service
│       └── user.routes.ts       Route definitions with middleware chains
│
├── database/
│   └── index.ts                 PostgreSQL pool template (commented out)
│
└── docs/
    └── swagger.ts               OpenAPI 3.0 spec + swagger-ui-express setup

tests/
├── setup.ts                     Sets test env vars before every test file
├── unit/
│   └── user.service.test.ts     Service-layer unit tests (no HTTP)
└── integration/
    └── user.routes.test.ts      Full-stack HTTP tests via supertest
```

---

## Architecture

```
HTTP Request
     │
     ▼
 Middleware chain
 (security, rate limit, body parser, requestId)
     │
     ▼
  Validator  ──── Zod schema ──── 422 on failure
     │
     ▼
 Controller  ──── reads req, calls service, sends response
     │
     ▼
  Service    ──── business rules, throws ApiError
     │
     ▼
Repository   ──── data access (Map today, pg tomorrow)
     │
     ▼
  Response
```

Errors travel back up via `throw new ApiError(message, statusCode)`.  
The central **error middleware** (registered last in `express.loader.ts`) catches everything.

---

## Environment files

| File | Used when |
|------|-----------|
| `.env.development` | `NODE_ENV=development` (local dev) |
| `.env.testing` | `NODE_ENV=testing` (Jest tests) |
| `.env.preprod` | `NODE_ENV=preprod` (staging) |
| `.env.production` | `NODE_ENV=production` (live) |
| `.env.example` | Template — the only file committed to git |

All variables are validated by Zod in `src/config/index.ts`. Missing or
invalid values cause an immediate startup failure with a clear error message.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | Environment name |
| `JWT_SECRET` | — | **Required.** Min 32 chars. |
| `JWT_EXPIRES_IN` | `1d` | Token lifetime |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate limit window (15 min) |
| `RATE_LIMIT_MAX` | `100` | Max requests per window |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `LOG_LEVEL` | `info` | fatal/error/warn/info/debug/trace/silent |
| `DATABASE_URL` | — | Optional. Leave empty for in-memory store. |

---

## Switching from in-memory to PostgreSQL

1. `npm install pg && npm install -D @types/pg`
2. Uncomment the pool in `src/database/index.ts` and set `DATABASE_URL`
3. Replace the `Map` operations in `user.repository.ts` with `pool.query()` calls —
   each function has a ready-made pg example in its comments

---

## Adding a new module

1. Create `src/modules/product/` with these files:
   - `product.model.ts` — TypeScript type + `buildProduct()` + `sanitize()`
   - `product.repository.ts` — data access (Map or pg)
   - `product.service.ts` — business logic, throws `ApiError`
   - `product.controller.ts` — HTTP handlers → service → `ok/created/noContent`
   - `product.schema.ts` — Zod schemas for request validation
   - `product.routes.ts` — route definitions with middleware chain
2. Mount the router in `src/loaders/express.loader.ts`:
   ```typescript
   import productRoutes from '../modules/product/product.routes';
   app.use('/api/v1/products', productRoutes);
   ```
3. Add tests in `tests/unit/product.service.test.ts` and `tests/integration/product.routes.test.ts`

---

## Copilot / AI agent guardrails

This project includes `.github/copilot-instructions.md`.  
Every Copilot suggestion and agent edit automatically follows the coding standards
defined there: layer boundaries, error patterns, response shapes, validation rules,
security constraints, and testing expectations.
