---
description: "Use when creating Express.js routes, controllers, services, repositories, middleware, or API modules. Covers strict layer separation, error handling, response formatting, request validation, and security middleware setup."
---

# Express API Architecture Patterns

## Layer separation — non-negotiable

```
Route → Controller → Service → Repository
```

| Layer | File suffix | Responsibility | Must NOT |
|-------|------------|----------------|----------|
| Route | `*.routes.ts` | HTTP method + path + middleware chain | Business logic, DB calls |
| Controller | `*.controller.ts` | Read `req`, call service, send response | Business rules, direct DB access |
| Service | `*.service.ts` | Business rules, throw `ApiError` | Import controllers/routes |
| Repository | `*.repository.ts` | Read/write data store | Business logic |

Never skip a layer. `Controller → Repository` (skipping service) is always wrong.

## Module file structure
New modules always follow this pattern (example: `product`):
```
src/modules/product/
  product.model.ts        TypeScript interfaces, builder fn, sanitize fn
  product.repository.ts   Data access — Map (dev) or pg pool (prod)
  product.service.ts      Business logic, throws ApiError
  product.controller.ts   HTTP handlers with try/catch → next(err)
  product.schema.ts       Zod schemas for body/params/query
  product.routes.ts       Route definitions + middleware chain
```
Mount the new router in `src/loaders/express.loader.ts`.

## Error handling
Always throw `ApiError` from services. Never write `res.status()` inside a service.

```typescript
// ✅ correct
throw ApiError.notFound('User not found');
throw ApiError.conflict('Email already in use');
throw ApiError.unprocessableEntity('Invalid input');

// ❌ wrong
throw new Error('not found');
res.status(404).json({ error: 'not found' });   // inside service
```

## Response formatting
All successful responses use `response.helper.ts` helpers. Never `res.json()` directly.

```typescript
import { ok, created, noContent } from '../../common/helpers/response.helper';

ok(res, data);               // 200 { success: true, data }
created(res, data);          // 201 { success: true, data }
noContent(res);              // 204 (no body)
```

## Request validation
Every route with user input (body/params/query) must use a Zod schema + `validate()` middleware.
Never validate inside a controller or service.

```typescript
// ✅ correct
router.post('/', validate(createProductSchema), productController.create);
router.get('/:id', validate(idParamSchema, 'params'), productController.getById);

// ❌ wrong — manual validation inside controller
if (!req.body.name) return res.status(400)...
```

## Middleware order in express.loader.ts
Always register in this order:
1. `helmet()` — security headers
2. `cors()` — CORS
3. `rateLimit()` — rate limiting
4. `compression()` — response compression
5. `express.json()` / `express.urlencoded()` — body parsing
6. `requestId` — inject UUID per request
7. Health check route (`GET /api/health`)
8. API routes (versioned: `/api/v1/...`)
9. Swagger UI (non-production only)
10. `notFound` middleware — 404 catch-all
11. `errorHandler` middleware — **must be last**

## Authentication middleware
```typescript
// Protect a route
router.get('/me', authenticate, profileController.get);

// Protect + restrict by role
router.delete('/:id', authenticate, authorize('admin'), userController.remove);
```

## Config and environment
- Load env with `dotenv` using `NODE_ENV`-specific files: `.env.development`, `.env.testing`, `.env.preprod`, `.env.production`.
- Validate the env schema with Zod in `src/config/index.ts`. Crash startup with a clear message on invalid config.
- Never hardcode secrets, ports, or URLs. Everything comes from `config`.
- `__dirname`-relative path for `.env` resolution (not `process.cwd()`).

## Logging
Use the shared Pino logger from `src/common/helpers/logger.ts`.
Never use `console.log` in production code paths.

```typescript
import { logger } from '../../common/helpers/logger';
logger.info({ userId }, 'User created');
logger.error({ err }, 'Failed to publish event');
```
