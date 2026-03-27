---
description: "Use when creating or editing package.json, installing packages, or choosing libraries for a Node.js project. Covers preferred packages, script naming, and project setup conventions."
applyTo: "**/package.json"
---

# Node.js Package Conventions

## Preferred libraries (use these; avoid alternatives listed)

| Concern | Use | Avoid |
|---------|-----|-------|
| HTTP framework | `express` | koa, fastify (unless project already uses them) |
| Validation | `zod` | joi, yup, express-validator |
| Logging | `pino` + `pino-pretty` (devDep) | winston, morgan, console.log in production |
| Password hashing | `bcryptjs` | bcrypt (native), argon2 (unless explicitly required) |
| JWT | `jsonwebtoken` | passport-jwt (unless session auth is needed) |
| UUID generation | `uuid` | nanoid, crypto.randomUUID (acceptable alternative) |
| HTTP security | `helmet` + `cors` + `express-rate-limit` + `compression` | custom middleware replacements |
| Env loading | `dotenv` | dotenv-safe, custom loaders |
| Dev server | `tsx watch` | ts-node-dev, nodemon |
| Testing | `jest` + `ts-jest` + `supertest` | mocha, vitest, ava |
| TypeScript runner | `tsx` | ts-node (only in jest config via ts-node) |
| Linting | `eslint` + `@typescript-eslint/*` + `eslint-config-prettier` | tslint |
| Formatting | `prettier` | biome (unless project-wide decision) |

## Required script names
Every Node.js/TypeScript project must have these scripts with exactly these names:

```json
{
  "scripts": {
    "dev":            "tsx watch src/server.ts",
    "build":          "tsc --project tsconfig.build.json",
    "start":          "node dist/server.js",
    "lint":           "eslint src tests --ext .ts",
    "lint:fix":       "eslint src tests --ext .ts --fix",
    "format":         "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\"",
    "test":           "jest",
    "test:coverage":  "jest --coverage",
    "test:watch":     "jest --watch"
  }
}
```

## Engine field (always include)
```json
{
  "engines": { "node": ">=20.0.0" }
}
```

## Dependency placement rules
- Runtime packages → `dependencies`
- Type definitions (`@types/*`), build tools, test tools → `devDependencies`
- Never put `typescript`, `ts-jest`, `jest`, `eslint`, `prettier`, or `tsx` in `dependencies`

## Version pinning
- Use `^` (caret) for all non-critical deps to allow minor/patch updates.
- Pin major versions explicitly only when breaking changes are frequent (e.g. `"express": "^4.18.3"` not `"^5"`).

## tsconfig convention
- Two tsconfig files: `tsconfig.json` (includes tests, used by IDEs) and `tsconfig.build.json` (excludes tests, used for `npm run build`).
