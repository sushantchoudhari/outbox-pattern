# Session Management — ElastiCache Redis

Shared, Redis-backed HTTP sessions that survive across any number of ECS task replicas. Any ECS task — Task A, B, or C — that picks up a browser request can look up the exact same session from the central Redis store and continue the user journey seamlessly.

---

## Table of Contents

1. [Why Redis sessions alongside JWT?](#1-why-redis-sessions-alongside-jwt)
2. [How it works end-to-end](#2-how-it-works-end-to-end)
3. [Architecture diagram walk-through](#3-architecture-diagram-walk-through)
4. [Session cookie properties](#4-session-cookie-properties)
5. [What is stored in Redis](#5-what-is-stored-in-redis)
6. [CSRF protection design](#6-csrf-protection-design)
7. [New files](#7-new-files)
8. [Startup sequence](#8-startup-sequence)
9. [Middleware reference](#9-middleware-reference)
10. [Auth endpoint changes](#10-auth-endpoint-changes)
11. [Protecting a route with sessions](#11-protecting-a-route-with-sessions)
12. [Environment variables](#12-environment-variables)
13. [Local development setup](#13-local-development-setup)
14. [Production deployment notes](#14-production-deployment-notes)
15. [Security properties](#15-security-properties)

---

## 1. Why Redis sessions alongside JWT?

JWTs provide **stateless** authentication — the server issues a signed token, and any node can verify it without touching a data store. Sessions provide **stateful** authentication — the server controls the session lifecycle and can revoke access instantly.

| Concern | JWT only | Session + Redis |
|---------|----------|-----------------|
| Instant logout / revocation | ✗ token lives until expiry | ✓ `session.destroy()` removes it immediately |
| Server-side state inspection | ✗ payload read-only after issue | ✓ can enrich/update session data (e.g. permissions) |
| CSRF linkage | ✗ separate mechanism needed | ✓ `csrfToken` stored directly in session |
| Scalability across ECS tasks | ✓ stateless, no shared store | ✓ Redis shared store handles fan-out |
| Cookie security flags | ✗ client must store token | ✓ `httpOnly` cookie prevents JS access |

This implementation adds sessions for **browser clients** (React SPA, server-rendered pages). JWT Bearer tokens continue to work for **API clients** (mobile apps, third-party integrations, service-to-service calls).

---

## 2. How it works end-to-end

```
╔══════════════════════════════════════════════════════════╗
║                       LOGIN FLOW                         ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  1. Browser         POST /api/v1/auth/login              ║
║                     { email, password }                  ║
║                                                          ║
║  2. Auth controller  verifies credentials (bcrypt)       ║
║                     generates csrfToken (32 random bytes) ║
║                     writes to Redis via express-session: ║
║                       { userId, role, loginAt,           ║
║                         csrfToken }                      ║
║                                                          ║
║  3. Express-session  issues signed Set-Cookie header:    ║
║                       sid=<signed-sessionId>             ║
║                       httpOnly; SameSite=Strict;         ║
║                       Secure (prod); Max-Age=86400       ║
║                                                          ║
║  4. Response body    { user, token, csrfToken }          ║
║                     Browser stores csrfToken in memory   ║
║                                                          ║
╠══════════════════════════════════════════════════════════╣
║                   SUBSEQUENT REQUEST FLOW               ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║  5. Browser         GET /api/v1/users (any protected route)
║                     Cookie: sid=<signed-sessionId>       ║
║                     X-CSRF-Token: <csrfToken>            ║
║                                                          ║
║  6. ALB             Routes to any healthy ECS task       ║
║                     (Task A, B, or C — does not matter)  ║
║                                                          ║
║  7. express-session  decodes cookie signature            ║
║                     fetches session from Redis:          ║
║                       key: sess:<sessionId>              ║
║                       value: { userId, role, loginAt,    ║
║                                csrfToken }               ║
║                     populates req.session                ║
║                                                          ║
║  8. authenticateSession middleware                       ║
║                     checks req.session.userId is present  ║
║                                                          ║
║  9. csrfProtect middleware (on mutating methods)         ║
║                     compares req.headers['x-csrf-token'] ║
║                     against req.session.csrfToken        ║
║                                                          ║
║ 10. Controller / service  processes the request normally ║
║                                                          ║
╠══════════════════════════════════════════════════════════╣
║                       LOGOUT FLOW                        ║
╠══════════════════════════════════════════════════════════╣
║                                                          ║
║ 11. Browser         POST /api/v1/auth/logout             ║
║                     Cookie: sid=<signed-sessionId>       ║
║                                                          ║
║ 12. Auth controller  req.session.destroy()               ║
║                     → Redis key is deleted immediately   ║
║                     → res.clearCookie('sid')             ║
║                     → 204 No Content                     ║
║                                                          ║
║ 13. Subsequent requests with the old cookie              ║
║                     → Redis lookup → miss → 401          ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
```

---

## 3. Architecture diagram walk-through

Based on the architecture diagram, each numbered step maps to this code:

| Step | Code location |
|------|---------------|
| **1** — Browser sends HTTPS request with secure session cookie | `browser → ALB` |
| **2** — ALB routes to healthy ECS task | `docker-compose: redis + express-ts-api` |
| **3** — ECS Task A/B/C calls `session.lookup(sessionId)` | `session/session.loader.ts` → `connect-redis` |
| **4** — Subsequent request may land on different ECS task | ALB round-robin; task is stateless |
| **5** — Any task retrieves the same session from Redis | `RedisStore.get(sessionId)` in `ElastiCache` |
| **6** — Response sent back to browser | `authenticateSession` + route handler |

**Session principles from the diagram:**

| Principle | Implementation |
|-----------|----------------|
| Cookie stores `sessionId` only — Secure, HttpOnly, SameSite, expiry | `session.loader.ts` cookie options |
| ECS tasks remain stateless — no task-local session dependency | All data written to Redis, not `Map` / memory |
| Session state stored in ElastiCache for Redis — user context, timestamps, permissions, CSRF linkage | `req.session.{ userId, role, loginAt, csrfToken }` |

---

## 4. Session cookie properties

| Property | Value | Reason |
|----------|-------|--------|
| `name` | `sid` | Hides the session library (`connect.sid` default would reveal it) |
| `httpOnly` | `true` | JavaScript running in the browser cannot read the cookie — prevents XSS token theft |
| `secure` | `true` in production, `false` in development | Forces HTTPS-only transmission behind the ALB; `trust proxy 1` is set so Express honours the flag when the ALB terminates TLS |
| `sameSite` | `strict` | Browser only sends the cookie on same-site navigation — first layer of CSRF defence |
| `maxAge` | `SESSION_MAX_AGE_MS` (default `86400000` = 24 h) | Controlled expiry; override per environment |

---

## 5. What is stored in Redis

Each session key in Redis is `sess:<sessionId>` and holds a JSON object:

```json
{
  "cookie": {
    "originalMaxAge": 86400000,
    "expires": "2026-03-31T10:00:00.000Z",
    "httpOnly": true,
    "secure": true,
    "sameSite": "strict"
  },
  "userId":    "550e8400-e29b-41d4-a716-446655440000",
  "role":      "user",
  "loginAt":   1743340800000,
  "csrfToken": "a3f81c...64 hex chars"
}
```

| Field | Type | Set by | Used by |
|-------|------|--------|---------|
| `userId` | UUID string | `auth.controller` at login/register | `authenticateSession` to confirm the user is authenticated |
| `role` | `'user'` \| `'admin'` | `auth.controller` at login/register | `authorizeSession()` for role-based route protection |
| `loginAt` | Unix ms timestamp | `auth.controller` at login/register | Available for session age assertions / audit logs |
| `csrfToken` | 32-byte hex string | `auth.controller` at login/register via `crypto.randomBytes` | `csrfProtect` validates the `X-CSRF-Token` request header |

---

## 6. CSRF protection design

Two independent CSRF layers are applied:

### Layer 1 — `SameSite=strict` cookie

The browser only sends the `sid` cookie when navigating within the same origin. A forged form on `evil.com` cannot trigger a request that includes the session cookie.

### Layer 2 — Double-submit CSRF token (synchroniser token pattern)

At login the server generates `csrfToken = randomBytes(32).toString('hex')` and stores it in the Redis session. The **response body** returns the token to the browser. The browser stores it **in memory only** (not in another cookie or `localStorage`).

On every state-mutating request (`POST`, `PATCH`, `DELETE`) the browser attaches the token as a custom header:

```
X-CSRF-Token: a3f81c...
```

The `csrfProtect` middleware in `sessionAuth.middleware.ts` compares this header against `req.session.csrfToken`. An attacker making a cross-origin forged request cannot:
- Read the login response body to obtain the token (blocked by CORS)
- Access the session cookie to forge a valid header (blocked by `httpOnly`)

```
GET, HEAD, OPTIONS  →  bypass (read-only, no state change)
POST / PATCH / DELETE →  header X-CSRF-Token must match session token
```

---

## 7. New files

```
express-ts-api/src/

session/
├── redisClient.ts          — node-redis v4 singleton with error/reconnect logging
└── session.loader.ts       — builds and exports the configured express-session middleware

loaders/
└── redis.loader.ts         — connectRedis(): opens the connection, sends PING,
                              fails fast before HTTP traffic is accepted

middlewares/
└── sessionAuth.middleware.ts
       authenticateSession  — rejects requests without req.session.userId
       authorizeSession()   — role guard backed by session data
       csrfProtect          — validates X-CSRF-Token header vs session token

docs/
└── SESSION.md              — this file
```

**Modified files:**

| File | Change |
|------|--------|
| `src/config/index.ts` | Added `REDIS_URL`, `SESSION_SECRET`, `SESSION_MAX_AGE_MS` to Zod schema and exported config object |
| `src/common/types/express.d.ts` | Added `SessionData` interface augmentation (`userId`, `role`, `loginAt`, `csrfToken`) |
| `src/loaders/index.ts` | Added `connectRedis()` call between `connectDatabase()` and `loadExpress()` |
| `src/loaders/express.loader.ts` | Added `app.set('trust proxy', 1)` + `app.use(buildSessionMiddleware())` after request-id middleware |
| `src/modules/auth/auth.controller.ts` | `login()` and `register()` now populate the Redis session; `logout()` function added |
| `src/modules/auth/auth.routes.ts` | Added `POST /logout` route |

---

## 8. Startup sequence

```
server.ts
  └── initLoaders(app)
        ├── connectDatabase()      — confirms PostgreSQL is reachable
        ├── connectRedis()         — PINGs Redis; crashes with clear error if unreachable
        └── loadExpress(app)       — registers middleware (session wired at step 5 below)

loadExpress middleware order:
  1. trust proxy 1
  2. helmet()
  3. cors()
  4. rateLimit()
  5. compression()
  6. express.json / urlencoded
  7. requestId
  8. buildSessionMiddleware()   ← session backed by Redis
  9. routes (auth, users, health)
 10. swagger (non-prod)
 11. notFound
 12. errorHandler
```

If Redis is unreachable at startup, the server will **not start**. This is intentional — a server accepting requests without a working session store would silently fail all authenticated requests.

---

## 9. Middleware reference

### `authenticateSession`

```typescript
import { authenticateSession } from '../../middlewares/sessionAuth.middleware';

// Rejects with 401 if req.session.userId is absent
router.get('/dashboard', authenticateSession, controller.dashboard);
```

Returns `401 Unauthorized` — `"Session expired or not found — please log in again"`.

---

### `authorizeSession(...roles)`

```typescript
import { authenticateSession, authorizeSession } from '../../middlewares/sessionAuth.middleware';

// Always chain AFTER authenticateSession
router.delete('/:id', authenticateSession, authorizeSession('admin'), controller.remove);
```

Returns `403 Forbidden` — `"You do not have permission to perform this action"`.

---

### `csrfProtect`

```typescript
import { authenticateSession, csrfProtect } from '../../middlewares/sessionAuth.middleware';

// Chain: session check → CSRF check → handler
router.post('/order', authenticateSession, csrfProtect, controller.create);
```

Returns `403 Forbidden` — `"CSRF token missing or invalid"`.  
Safe HTTP methods (`GET`, `HEAD`, `OPTIONS`) bypass this check automatically.

---

### Comparison with JWT middleware

| Concern | JWT middleware | Session middleware |
|---------|----------------|-------------------|
| Import from | `auth.middleware.ts` | `sessionAuth.middleware.ts` |
| Auth check | `authenticate` | `authenticateSession` |
| Role guard | `authorize('admin')` | `authorizeSession('admin')` |
| Identity on `req` | `req.user.id`, `req.user.role` | `req.session.userId`, `req.session.role` |
| Revocable | No (stateless) | Yes (`session.destroy()`) |
| CSRF protection | Manual | `csrfProtect` middleware |

---

## 10. Auth endpoint changes

### `POST /api/v1/auth/login`

**Before:** returned `{ user, token }`.  
**After:** sets the Redis session and returns `{ user, token, csrfToken }`.

```bash
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"alice@example.com","password":"secret123"}'
```

Response body:
```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "name": "Alice", "email": "alice@example.com", "role": "user", "createdAt": "...", "updatedAt": "..." },
    "token": "eyJ...",
    "csrfToken": "a3f81c2e..."
  }
}
```

Response cookie (Set-Cookie header):
```
sid=s%3A<sessionId>.<signature>; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400
```

The browser stores this cookie automatically. Subsequent requests automatically include it.

---

### `POST /api/v1/auth/register`

Same behaviour as login regarding the session — the user is auto-logged in immediately after account creation.

---

### `POST /api/v1/auth/logout` *(new)*

Destroys the Redis session and clears the `sid` cookie from the browser.

```bash
curl -X POST http://localhost:3000/api/v1/auth/logout \
  -b cookies.txt
```

Response: `204 No Content`

The session key is deleted from Redis immediately. Any subsequent request with the old `sid` cookie gets `401 Unauthorized`.

---

## 11. Protecting a route with sessions

### Session auth only

```typescript
// src/modules/my-feature/my-feature.routes.ts
import { Router } from 'express';
import { authenticateSession } from '../../middlewares/sessionAuth.middleware';
import { myController } from './my-feature.controller';

const router = Router();

router.get('/',    authenticateSession, myController.list);
router.get('/:id', authenticateSession, myController.getById);

export default router;
```

### Session auth + role guard

```typescript
router.delete('/:id',
  authenticateSession,
  authorizeSession('admin'),
  myController.remove,
);
```

### Session auth + CSRF protection (for browser-originated mutations)

```typescript
router.post('/',
  authenticateSession,
  csrfProtect,
  validate(createSchema),
  myController.create,
);

router.patch('/:id',
  authenticateSession,
  csrfProtect,
  validate(updateSchema),
  myController.update,
);
```

### Reading session data inside a controller

```typescript
async function getById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // req.session.userId and req.session.role are always present
    // after authenticateSession has run
    const result = await myService.getById(req.params.id, req.session.userId);
    ok(res, result);
  } catch (err) {
    next(err);
  }
}
```

---

## 12. Environment variables

Add these to `.env.development` (and the equivalent file for each environment):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection string. Use the ElastiCache cluster endpoint in production: `redis://<cluster>.cache.amazonaws.com:6379` |
| `SESSION_SECRET` | **Yes** | — | Secret used to sign the `sid` cookie. Min 32 characters. Changing this invalidates all existing sessions. |
| `SESSION_MAX_AGE_MS` | No | `86400000` (24 h) | Session and cookie TTL in milliseconds. |

Generate a strong `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## 13. Local development setup

### 1. Start Redis

Redis is included in `docker-compose.yml`:

```bash
# Start just Redis (if you don't want the full outbox stack)
docker compose up redis

# Or start everything
docker compose up
```

### 2. Set environment variables

Add to `express-ts-api/.env.development`:

```bash
# Redis
REDIS_URL=redis://localhost:6379

# Session
SESSION_SECRET=replace-with-64-char-random-hex-string
SESSION_MAX_AGE_MS=86400000
```

### 3. Start the dev server

```bash
cd express-ts-api
npm run dev
```

You should see in the logs:
```
[info] Redis connected
[info] Redis loader complete
[info] Express loader complete
[info] Server started  port=3000 env=development
```

### 4. Test the session flow

```bash
# Login — cookie saved to cookies.txt, csrfToken printed
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"alice@example.com","password":"secret123"}' | jq .data.csrfToken

# Use session for a protected GET (no CSRF header needed for GET)
curl -s http://localhost:3000/api/v1/users \
  -b cookies.txt | jq

# Use session for a protected mutation (CSRF header required)
curl -s -X PATCH http://localhost:3000/api/v1/users/<id> \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <paste csrfToken here>" \
  -b cookies.txt \
  -d '{"name":"Alice Updated"}' | jq

# Logout — session removed from Redis
curl -s -X POST http://localhost:3000/api/v1/auth/logout \
  -b cookies.txt -w "%{http_code}"
# → 204

# Verify session is gone
curl -s http://localhost:3000/api/v1/users \
  -b cookies.txt | jq .error
# → "Session expired or not found — please log in again"
```

### 5. Inspect sessions in Redis

```bash
# Connect to the local Redis container
docker compose exec redis redis-cli

# List all session keys
KEYS sess:*

# Read a specific session
GET sess:<sessionId>

# Check TTL remaining
TTL sess:<sessionId>
```

---

## 14. Production deployment notes

### ElastiCache configuration

1. **Cluster mode off** (single node) for simplicity, or **cluster mode on** for horizontal scale.
2. Set the cluster endpoint as `REDIS_URL`:  
   `redis://<cluster-endpoint>.cache.amazonaws.com:6379`
3. For TLS-enabled ElastiCache use the `rediss://` scheme:  
   `rediss://<cluster-endpoint>.cache.amazonaws.com:6379`
4. Configure `SESSION_MAX_AGE_MS` to match the ElastiCache node's TTL policy.

### ECS task configuration

- **No session state in ECS tasks** — `saveUninitialized: false` + `resave: false` ensures nothing is written to Redis for unauthenticated visitors.
- The ALB does **not** need sticky sessions. Any task can serve any request because session state lives in Redis, not in process memory.
- Add the ECS task's security group as an inbound rule on the ElastiCache security group (port `6379`).

### Infrastructure checklist

- [ ] ElastiCache Redis cluster created (Redis 7+)
- [ ] `REDIS_URL` set in ECS task definition (from Secrets Manager / Parameter Store)
- [ ] `SESSION_SECRET` set (from Secrets Manager — never in plaintext env block)
- [ ] Security group rule: ECS tasks → ElastiCache port 6379
- [ ] `SESSION_MAX_AGE_MS` set to match your compliance/UX requirements
- [ ] In-transit encryption enabled (`rediss://`) for production

### Session revocation

Because sessions live in Redis, you can revoke all sessions for a user immediately:

```bash
# List all session keys (if you store userId in the key — advanced use)
KEYS sess:*

# Or flush all sessions (drastic — logs out every user)
redis-cli FLUSHDB
```

For per-user revocation at scale, consider storing session IDs against `userId` in a secondary Redis set.

---

## 15. Security properties

| Property | Value |
|----------|-------|
| Session secret strength | Min 32 chars, validated at startup by Zod |
| Cookie `httpOnly` | ✓ — JavaScript cannot read `sid` |
| Cookie `secure` | ✓ in production — HTTPS only |
| Cookie `sameSite` | `strict` — prevents cross-site cookie delivery |
| CSRF token entropy | 32 bytes = 256 bits from `crypto.randomBytes` |
| CSRF token storage | Server-side only (Redis); client holds a copy in memory, never in a cookie |
| Session storage | Redis server-side only — cookie holds a signed ID reference, not data |
| Logout | `session.destroy()` removes the Redis key immediately — token cannot be reused |
| Startup failure | Server refuses to start if `SESSION_SECRET` is missing or Redis is unreachable |
| `trust proxy 1` | Set to correctly handle `X-Forwarded-Proto` from the ALB |
