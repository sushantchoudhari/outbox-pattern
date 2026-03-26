# express-api

A production-ready Express.js REST API starter with a clean, layered architecture.  
Runs out of the box with **no database required** — uses an in-memory store by default.

---

## Quick start

```bash
# 1. Install dependencies
cd express-api
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env — set JWT_SECRET to a long random string before deploying

# 3. Start the development server (auto-restarts on file changes)
npm run dev

# 4. Or start in production mode
npm start
```

The server starts on `http://localhost:3000` by default.

---

## API endpoints

All routes are prefixed with `/api`.

### Health check

| Method | Path         | Auth | Description                  |
|--------|--------------|------|------------------------------|
| GET    | /api/health  | No   | Returns server status/uptime |

### Users

| Method | Path              | Auth    | Role  | Description            |
|--------|-------------------|---------|-------|------------------------|
| GET    | /api/v1/users     | Bearer  | any   | List all users         |
| GET    | /api/v1/users/:id | Bearer  | any   | Get a single user      |
| POST   | /api/v1/users     | No      | —     | Register (create user) |
| PATCH  | /api/v1/users/:id | Bearer  | any   | Update user fields     |
| DELETE | /api/v1/users/:id | Bearer  | admin | Delete a user          |

#### Create a user (no auth)

```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"secret123"}'
```

#### Get all users (requires JWT)

```bash
curl http://localhost:3000/api/v1/users \
  -H "Authorization: Bearer <your-token>"
```

---

## Authentication

This starter ships with **JWT verification middleware** but does not include a
`POST /auth/login` endpoint — add one that calls `jwt.sign` with the user's id and
role, then returns the token.

```js
// Example: create a token after verifying credentials
const token = jwt.sign(
  { id: user.id, role: user.role },
  config.auth.jwtSecret,
  { expiresIn: config.auth.jwtExpiresIn }   // default "1d"
);
```

---

## Project structure

```
src/
├── server.js               Entry point — binds the HTTP port, handles SIGTERM/SIGINT
├── app.js                  Express setup — middleware stack, routes, error handlers
│
├── config/
│   └── index.js            Single source of truth for all environment variables
│
├── database/
│   └── connection.js       pg Pool template — swap in here to use PostgreSQL
│
├── models/
│   └── user.model.js       User shape — buildUser(), sanitize() (strips password)
│
├── repositories/
│   └── user.repository.js  Data access — in-memory Map, with pg migration guide
│
├── services/
│   └── user.service.js     Business logic — hashing, uniqueness, 404/409 errors
│
├── controllers/
│   └── user.controller.js  HTTP layer — reads req, calls service, sends response
│
├── validators/
│   └── user.validator.js   express-validator rules + validate() middleware
│
├── middlewares/
│   ├── auth.middleware.js       authenticate (JWT) + authorize (role check)
│   ├── error.middleware.js      Central error handler — converts AppError → HTTP
│   └── notFound.middleware.js   404 catch-all for unmatched routes
│
├── routes/
│   ├── index.js            Root router — health check, mounts /v1/users
│   └── user.routes.js      User routes with middleware chains
│
└── utils/
    ├── errors.js           AppError class (shared by services + error middleware)
    ├── logger.js           JSON structured logging (CloudWatch-friendly)
    └── response.js         ok(), created(), noContent() HTTP helpers
```

---

## Architecture overview

The code follows a **layered architecture** where each layer has one responsibility:

```
HTTP Request
    ↓
Validator   — "Is the input shaped correctly?"
    ↓
Controller  — "Read req, call service, send response"
    ↓
Service     — "Apply business rules" (hashing, uniqueness, etc.)
    ↓
Repository  — "Talk to the data store" (Map or pg)
    ↓
HTTP Response
```

Errors travel back up via `throw new AppError(message, statusCode)`.  
The central error handler in `middlewares/error.middleware.js` catches everything.

---

## Switching from in-memory to PostgreSQL

1. Install pg: `npm install pg`  
2. Open `src/repositories/user.repository.js`  
3. The file includes complete pg examples in the comments — replace each Map
   operation with the corresponding `pool.query(...)` snippet shown.

---

## Environment variables

| Variable        | Default                          | Description                        |
|-----------------|----------------------------------|------------------------------------|
| PORT            | 3000                             | HTTP port                          |
| NODE_ENV        | development                      | development / production / test    |
| JWT_SECRET      | change-me-in-production          | Secret for signing JWT tokens      |
| JWT_EXPIRES_IN  | 1d                               | Token lifetime (e.g. 1d, 2h)       |
| DB_HOST         | localhost                        | PostgreSQL host                    |
| DB_PORT         | 5432                             | PostgreSQL port                    |
| DB_NAME         | appdb                            | Database name                      |
| DB_USER         | postgres                         | Database user                      |
| DB_PASSWORD     | postgres                         | Database password                  |
| CORS_ORIGIN     | *                                | Allowed CORS origin(s)             |
