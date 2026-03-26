# express-ts-api — Coding Standards for Copilot and Agents

These rules apply **every time** a Copilot suggestion or agent edit touches this project.
They encode the architectural decisions made when the project was first built.

---

## Architecture — Non-negotiable rules

### Strict layer separation
Each layer has exactly one responsibility. Never cross boundaries:

| Layer | Responsibility | Must NOT |
|-------|---------------|----------|
| Route | Declare HTTP method + path, apply middleware chain | Contain business logic or DB calls |
| Controller | Read `req`, call service, send response | Contain business rules or direct DB access |
| Service | Apply business rules, throw `ApiError` | Import from controllers or routes |
| Repository | Read/write from the data store | Contain business logic |

**Pattern to follow:**
```
Controller → Service → Repository
```
Never: `Controller → Repository` (skip service), or `Route → Service` (skip controller).

### Error handling — use ApiError
Every expected error MUST be thrown as an `ApiError` from `src/common/errors/ApiError.ts`.
Never call `res.status(...).json(...)` directly in a service. Never use raw `new Error()` for HTTP errors.

```typescript
// ✅ correct
throw ApiError.notFound('User not found');
throw ApiError.conflict('Email is already in use');

// ❌ wrong
throw new Error('User not found');
res.status(404).json({ error: 'not found' }); // inside a service
```

### Response shape — use response.helper.ts
All successful responses must use helpers from `src/common/helpers/response.helper.ts`.
Never call `res.json(...)` directly in a controller.

```typescript
// ✅ correct
import { ok, created, noContent } from '../../common/helpers/response.helper';
ok(res, data);

// ❌ wrong
res.json({ data });
res.status(200).send(data);
```

### Validation — use Zod via validate middleware
Every route that accepts user input (body, params, query) MUST have a Zod schema and
use the `validate()` middleware before the controller. Never validate inside a controller or service.

```typescript
// ✅ correct
router.post('/', validate(createUserSchema), controller.create);

// ❌ wrong
async function create(req, res) {
  if (!req.body.email) return res.status(400)...  // manual validation in controller
}
```

### New modules — follow the existing file pattern
When adding a new module (e.g. `product`), create these files:
```
src/modules/product/
  product.model.ts       — TypeScript interfaces, buildProduct(), sanitize()
  product.repository.ts  — data access (follows user.repository.ts pattern)
  product.service.ts     — business logic, throws ApiError
  product.controller.ts  — HTTP handlers, try/catch → next(err)
  product.schema.ts      — Zod schemas for request validation
  product.routes.ts      — route definitions with middleware chain
```
Mount the router in `src/loaders/express.loader.ts`.

---

## TypeScript rules

- **Strict mode is on** (`tsconfig.json` has `"strict": true`). Never disable it.
- No `any` types. Use `unknown` and narrow with type guards if needed.
- Prefix unused parameters with `_` (e.g. `_req`, `_next`).
- Return types on async functions: always declare `Promise<void>` or `Promise<T>`.
- Use `const` over `let`; avoid `var`.

---

## Security rules

- Never log passwords, tokens, or secret keys. Use `_` prefix to mark unused password fields.
- Never commit `.env` files. Only `.env.example` is tracked.
- JWT_SECRET must be at least 32 characters. Validation enforces this on startup.
- Always hash passwords with bcrypt before storing. Never store plaintext passwords.
- Never return the `password` field in responses. Use `sanitize*` helpers to strip it.
- All routes that expose data require JWT authentication (`authenticate` middleware) unless documented as public.

---

## Environment rules

- Load env with `dotenv` using `NODE_ENV`-specific files (`.env.development`, `.env.testing`, etc.).
- Validate env schema with Zod in `src/config/index.ts`. Invalid config must crash startup with a clear error.
- The four supported environments: `development`, `testing`, `preprod`, `production`.

---

## Testing rules

- Every new service must have a unit test in `tests/unit/`.
- Every new route must have an integration test in `tests/integration/`.
- Use `userRepository.clear()` (or equivalent) in `beforeEach` to reset the in-memory store.
- Tests use `NODE_ENV=testing` and `.env.testing`. Never use production secrets in tests.
- Mock external services (external HTTP calls, third-party SDKs) using `jest.mock()`.

---

## Logging rules

- Use the shared `logger` from `src/common/helpers/logger.ts`. Never use `console.log` directly.
- Log at the appropriate level: `debug` for dev tracing, `info` for startup/lifecycle events, `warn` for handled errors, `error` for unexpected failures.
- Include `requestId` in log fields when available.

---

## Code style

- No magic numbers or hardcoded strings — use constants from `src/common/constants/`.
- No business logic in route files.
- No MongoDB-style callbacks — use `async/await`.
- All `catch` blocks must either call `next(err)` (in controllers/routes) or rethrow.
