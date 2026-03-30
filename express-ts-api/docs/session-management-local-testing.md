# Session Management — Local Testing Guide

This guide explains how to run and test the Redis-backed session management layer locally, mirroring the ElastiCache setup used in production.

---

## How the Session System Works

```
Browser                     Express                       Redis (ElastiCache)
   │                            │                                │
   │  POST /auth/login           │                                │
   │ ─────────────────────────► │                                │
   │                            │  session.set(userId, role,     │
   │                            │    csrfToken) ─────────────► │
   │                            │                                │
   │  ◄──────────────────────── │  200 { token, csrfToken }     │
   │  Set-Cookie: sid=<signed>  │                                │
   │                            │                                │
   │  PATCH /users/:id           │                                │
   │  Cookie: sid=<signed>       │                                │
   │  X-CSRF-Token: <hex>        │                                │
   │ ─────────────────────────► │                                │
   │                            │  session.get(sid) ──────────► │
   │                            │  ◄─────── { userId, csrfToken }│
   │                            │  validate csrfToken            │
   │  ◄──────────────────────── │  200 { updated user }         │
   │                            │                                │
   │  POST /auth/logout          │                                │
   │ ─────────────────────────► │                                │
   │                            │  session.destroy(sid) ──────► │
   │  ◄──────────────────────── │  204 No Content               │
   │  Clear-Cookie: sid          │                                │
```

### What is stored in Redis

Each login creates one Redis key:

```
Key:   sess:<session-id>
Value: {
  "cookie": { "httpOnly": true, "sameSite": "strict", "maxAge": 86400000 },
  "userId":    "<user-uuid>",
  "role":      "user" | "admin",
  "loginAt":   1743000000000,
  "csrfToken": "<64-byte hex string>"
}
TTL: SESSION_MAX_AGE_MS (default 24 hours)
```

### CSRF token flow

| Step | Who | What |
|---|---|---|
| 1 | Server | Generates `randomBytes(32).toString('hex')` at login |
| 2 | Server | Stores token in `req.session.csrfToken` (saved to Redis) |
| 3 | Server | Returns token in the **response body** |
| 4 | Client | Stores token in memory (never in a cookie) |
| 5 | Client | Sends it as `X-CSRF-Token` header on every state-mutating request |
| 6 | Server | `csrfProtect` middleware compares header against Redis-stored token |

An attacker cannot forge this because the `sid` cookie is `sameSite: strict` and `httpOnly`, so a cross-origin page can never read the CSRF token from the login response.

---

## Prerequisites

| Requirement | Check |
|---|---|
| Docker Desktop running | `docker info` |
| `express-ts-api` dependencies installed | `ls express-ts-api/node_modules` |
| `.env.development` configured | See section below |

---

## Step 1 — Configure `.env.development`

Create or update `express-ts-api/.env.development`:

```bash
PORT=3000
NODE_ENV=development

JWT_SECRET=development-jwt-secret-must-be-at-least-32-chars
JWT_EXPIRES_IN=1d

RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100

CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=debug

DATABASE_URL=

# Local Redis (Docker Compose)
REDIS_URL=redis://localhost:6379

# Session cookie signing key — must be >= 32 characters
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
SESSION_SECRET=development-session-secret-must-be-at-least-32-chars
SESSION_MAX_AGE_MS=86400000
```

> **Never commit real secrets.** The values above are development-only placeholders.

---

## Step 2 — Start Redis

The `docker-compose.yml` at the repo root includes a Redis service:

```bash
cd /private/tmp/outbox-pattern
docker compose up redis -d
```

Confirm it is healthy:

```bash
docker compose exec redis redis-cli ping
# Expected output: PONG
```

---

## Step 3 — Start the API

```bash
cd /private/tmp/outbox-pattern/express-ts-api
npm run dev
```

Expected startup log lines (order matters — Redis must connect before Express):

```
{"level":"info","msg":"Database loader complete"}
{"level":"info","msg":"Redis connected"}
{"level":"info","msg":"Redis loader complete"}
{"level":"info","msg":"Server listening on port 3000"}
```

If you see `Redis client error` the server will still boot but sessions will not persist. Fix the `REDIS_URL` first.

---

## Step 4 — Test in Postman

Import the collection from `postman/express-ts-api.postman_collection.json` and set `base_url = http://localhost:3000`. See [postman/README.md](../postman/README.md) for import steps.

### 4a — Register (creates a session)

```
POST /api/v1/auth/register
Body: { "name": "Alice", "email": "alice@example.com", "password": "secret1234" }
```

**What to check in the response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "<uuid>", "role": "user", ... },
    "token": "<JWT>",
    "csrfToken": "<64-byte hex>"
  }
}
```
- Postman automatically captures `token`, `csrf_token`, `user_id` into collection variables.
- The `Set-Cookie: sid=<signed-value>` response header means the session was created in Redis.

### 4b — Inspect the session in Redis

```bash
# List all active session keys
docker compose exec redis redis-cli keys "sess:*"

# Read the session data (replace <id> with the real key suffix)
docker compose exec redis redis-cli get "sess:<id>"
```

Expected output:
```json
{"cookie":{"originalMaxAge":86400000,"httpOnly":true,"sameSite":"strict"},"userId":"<uuid>","role":"user","loginAt":1743000000000,"csrfToken":"<hex>"}
```

### 4c — Call a session-protected route (Logout)

```
POST /api/v1/auth/logout
```

- Postman sends the `sid` cookie automatically via its cookie jar.
- No `Authorization` header needed — this route uses session auth, not JWT.
- Expected response: `204 No Content` + `Clear-Cookie: sid` header.

**Verify the session is gone from Redis:**

```bash
docker compose exec redis redis-cli keys "sess:*"
# Expected: (empty list)
```

### 4d — Test CSRF protection

For any state-mutating request (`POST`, `PATCH`, `DELETE`) that uses session auth, add the header:

| Header | Value |
|---|---|
| `X-CSRF-Token` | `{{csrf_token}}` |

**To confirm rejection works**, send the same request without the header:

```json
{
  "success": false,
  "error": { "statusCode": 403, "message": "CSRF token missing or invalid" }
}
```

---

## Step 5 — Test Session Expiry

Temporarily shorten the TTL so you don't have to wait 24 hours:

1. Update `.env.development`:
   ```bash
   SESSION_MAX_AGE_MS=10000   # 10 seconds
   ```
2. Restart the API (`npm run dev`).
3. Login via Postman — note the `sid` cookie.
4. Wait 10+ seconds.
5. Call any session-protected route:
   ```json
   { "success": false, "error": { "statusCode": 401, "message": "Session expired or not found — please log in again" } }
   ```
6. Confirm Redis key has gone:
   ```bash
   docker compose exec redis redis-cli keys "sess:*"
   # (empty)
   ```
7. Restore `SESSION_MAX_AGE_MS=86400000` when done.

---

## Step 6 — Monitor Redis in real time

Stream all Redis commands while you run Postman requests to see exactly what happens:

```bash
docker compose exec redis redis-cli monitor
```

Example output during a login → request → logout flow:
```
"SET" "sess:abc123" "{...session json...}" "EX" "86400"   # login
"GET" "sess:abc123"                                         # authenticated request
"DEL" "sess:abc123"                                         # logout
```

Press `Ctrl+C` to stop monitoring.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Redis client error` in logs | Redis not running | `docker compose up redis -d` |
| `401 Session expired` immediately after login | `SESSION_SECRET` changed between restarts | Use a stable secret in `.env.development` |
| Logout returns `401` | `sid` cookie not sent | Enable "Automatically follow redirects" and "Send cookies" in Postman settings |
| `403 CSRF token missing` | `X-CSRF-Token` header not set | Add header with value `{{csrf_token}}` |
| `❌ Invalid environment configuration` on startup | Missing or invalid env var | Check the printed error — it lists the exact variable |

---

## Local vs Production Differences

| Setting | Local (Docker) | Production (AWS) |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | `rediss://<elasticache-endpoint>:6379` |
| Protocol | Plain TCP | TLS (`rediss://` prefix) |
| Cookie `secure` flag | `false` (HTTP) | `true` (HTTPS behind ALB) |
| Cookie `sameSite` | `strict` | `strict` |
| Redis instance | Single Docker container | ElastiCache cluster (Multi-AZ) |
| Session sharing | N/A (single process) | Shared across all ECS tasks |

The application code is **identical** in both environments. Only environment variables change.
