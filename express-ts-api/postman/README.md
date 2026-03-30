# Postman Collection — Express TS API

This folder contains the Postman collection for the Express TypeScript API.

| File | Description |
|---|---|
| `express-ts-api.postman_collection.json` | Postman Collection v2.1 — all 10 endpoints |

---

## Endpoint Summary

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Service liveness check |
| `POST` | `/api/v1/auth/register` | Public | Create account + receive JWT |
| `POST` | `/api/v1/auth/login` | Public | Log in + receive JWT |
| `GET` | `/api/v1/auth/me` | JWT | Get current user profile |
| `POST` | `/api/v1/auth/logout` | Session cookie | Destroy Redis session |
| `POST` | `/api/v1/users` | Public | Create a user |
| `GET` | `/api/v1/users` | JWT | List all users |
| `GET` | `/api/v1/users/:id` | JWT | Get user by UUID |
| `PATCH` | `/api/v1/users/:id` | JWT | Partial update a user |
| `DELETE` | `/api/v1/users/:id` | JWT (admin) | Delete a user |

---

## Importing into Postman

### Desktop app (Postman v10+)

1. Open Postman.
2. Click **Import** (top-left, next to the workspace name).
3. Select **Files** and choose `express-ts-api.postman_collection.json`  
   — or drag the file directly onto the Import dialog.
4. Click **Import**. The collection **Express TS API** appears in your sidebar.

### Postman Web

1. Go to [web.postman.co](https://web.postman.co) and open your workspace.
2. Click **Import** → **Upload Files** → select the JSON file.
3. Click **Import**.

---

## Setting the Base URL

After importing, update the `base_url` collection variable to match your running server:

1. Click the collection name **Express TS API** in the sidebar.
2. Open the **Variables** tab.
3. Set the **Current value** of `base_url`:

| Environment | Value |
|---|---|
| Local dev | `http://localhost:3000` |
| Docker Compose | `http://localhost:3000` (or whichever port is mapped) |
| Staging / prod | `https://api.yourdomain.com` |

4. Click **Save** (Ctrl+S / Cmd+S).

---

## Automatic Token Capture

The **Register** and **Login** requests have built-in test scripts that capture response values into collection variables automatically — no copy/pasting required.

After a successful login or register:

| Variable | Value captured |
|---|---|
| `token` | JWT — used as Bearer token on all protected endpoints |
| `csrf_token` | CSRF token returned by the server |
| `user_id` | UUID of the logged-in / registered user |

All subsequent protected requests reference `{{token}}` in their Bearer Auth header, so they just work.

---

## Typical Workflow

```
1. (optional) POST /api/v1/users         — create a second test user
2. POST /api/v1/auth/register            — creates account + captures token/user_id
   OR
   POST /api/v1/auth/login               — logs in + captures token/user_id
3. GET  /api/v1/auth/me                  — verify the token works
4. GET  /api/v1/users                    — list all users
5. GET  /api/v1/users/{{user_id}}        — get the logged-in user
6. PATCH /api/v1/users/{{user_id}}       — update a field
7. POST /api/v1/auth/logout              — destroy the session
8. DELETE /api/v1/users/{{user_id}}      — admin token required
```

---

## Exporting from Postman

Use this when you have made changes inside Postman and want to commit the updated collection back to the repo.

1. Right-click the collection **Express TS API** in the sidebar.
2. Select **Export**.
3. Choose **Collection v2.1** (recommended — widely compatible).
4. Click **Export** and save the file, replacing  
   `postman/express-ts-api.postman_collection.json` in this repository.
5. Commit the updated file.

> **Tip:** Never export as v1 — that format is deprecated and not supported by Newman or the current Postman app.

---

## Running with Newman (CI / command line)

[Newman](https://www.npmjs.com/package/newman) is the official Postman CLI runner.

### Install

```bash
npm install -g newman
```

### Run the full collection

```bash
newman run postman/express-ts-api.postman_collection.json \
  --env-var "base_url=http://localhost:3000"
```

### Run with an environment file

Create `postman/local.postman_environment.json`:

```json
{
  "name": "Local",
  "values": [
    { "key": "base_url", "value": "http://localhost:3000", "enabled": true }
  ]
}
```

Then:

```bash
newman run postman/express-ts-api.postman_collection.json \
  --environment postman/local.postman_environment.json
```

### HTML report

```bash
npm install -g newman-reporter-htmlextra

newman run postman/express-ts-api.postman_collection.json \
  --env-var "base_url=http://localhost:3000" \
  --reporters cli,htmlextra \
  --reporter-htmlextra-export postman/report.html
```
