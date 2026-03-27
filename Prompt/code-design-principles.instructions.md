---
description: "Use when creating, refactoring, or splitting any source file. Covers Single Responsibility Principle, configurable values, and file organisation rules that apply to every language and module type (JS, TS, config, routes, services, etc.)."
applyTo: "**/*.{js,ts,mjs,cjs}"
---

# Code Design Principles

## Single Responsibility Principle (non-negotiable)

Every file must do **exactly one job**. If you can describe a file's purpose with the word "and", split it.

| File is responsible for | Must NOT contain |
|------------------------|-----------------|
| HTTP route definitions | Business logic, DB calls |
| Business / service logic | SQL queries, HTTP response writing |
| Data access (repository) | Business rules, SNS/SQS calls |
| External client setup (SNS, SQS, DB pool) | Query logic, business rules |
| Entry point / startup | Inline business logic; only wires modules together |
| Configuration loading | Application logic |

### Required module structure for any new feature
When adding a feature, always split into dedicated files — never combine concerns in one file:
```
<feature>/
  <feature>.model.{js,ts}        — types / interfaces / builder functions
  <feature>.repository.{js,ts}   — data access (SQL / ORM) only
  <feature>.service.{js,ts}      — business rules only; throws typed errors
  <feature>.controller.{js,ts}   — reads req, calls service, sends response
  <feature>.schema.{js,ts}       — validation schemas (Zod / Joi)
  <feature>.routes.{js,ts}       — route + middleware wiring only
```

### External client modules
Clients (database pool, SNS, SQS, S3, Redis, etc.) must each live in their own file:
```
src/
  db.{js,ts}          — pg Pool (or ORM instance)
  snsClient.{js,ts}   — SNSClient instance
  sqsClient.{js,ts}   — SQSClient instance
```
Create the client once, export the singleton — never create a new client inside a function.

---

## Configurable values (no hardcoded constants)

**Never hardcode** values that differ between environments. Every configurable value must come from `process.env`.

### What must always be an env var
- Connection strings, hostnames, ports (DB, Redis, external APIs)
- Credentials, API keys, secrets, tokens
- ARNs, queue URLs, bucket names
- Timeout, batch size, retry counts, poll intervals
- Feature flags and limits

### Required pattern
```js
// ✅ correct — env var with a safe default where appropriate
const BATCH_SIZE       = parseInt(process.env.BATCH_SIZE       || '10',   10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const SNS_TOPIC_ARN    = process.env.SNS_TOPIC_ARN; // no default — required

// ❌ wrong — hardcoded values
const BATCH_SIZE    = 10;
const SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:my-topic';
```

### Required vs optional env vars
- **Required** (credentials, ARNs, hostnames): validate at startup, crash with a clear message if missing.
- **Optional** (timeouts, batch sizes, log level): provide a sensible default in code.

```js
// Validation pattern for required vars
const REQUIRED = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'SNS_TOPIC_ARN'];
const missing  = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`[startup] Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
```

### Config loading order
Config and env vars must be loaded **before** any module that reads `process.env` at require-time (DB pools, SDK clients). Use a dedicated `config.{js,ts}` module and dynamic `require()` / `import()` after it resolves:

```js
// ✅ correct — SSM/env loaded first, then dependent modules
await loadConfig();
const { publishEvents } = require('./publisher'); // DB pool + SNS client init here

// ❌ wrong — client modules required before env is populated
const { publishEvents } = require('./publisher');
await loadConfig();
```

---

## File readability rules

- **One export per file** is the ideal; never exceed three closely-related exports.
- Put all `require` / `import` statements at the top of the file, grouped: built-ins → third-party → internal.
- Constants derived from `process.env` go immediately after imports, before any functions.
- Every exported function must have a JSDoc / TSDoc comment describing its single responsibility.
- File length guideline: if a file exceeds ~120 lines of logic (excluding comments), it is doing too much — split it.
