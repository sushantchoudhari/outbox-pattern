# Copilot Instruction Files — Team Guide

This document explains the shared coding rules that GitHub Copilot and AI agents follow
when generating or editing code on this team. Every team member should install these files
so that AI-generated code matches the same style, architecture, and package choices.

---

## What are instruction files?

They are Markdown files with a YAML header that VS Code reads automatically.
When Copilot or an agent generates code, it reads these files first and follows the rules inside.

There are two scopes:

| Scope | Location | Who it applies to |
|-------|----------|-------------------|
| **User-level** | `~/Library/Application Support/Code/User/prompts/` (macOS) | You only — not committed to git |
| **Repo-level** | `.github/instructions/` inside the project | Everyone who clones the repo |

The 4 files below are **user-level**. They are personal, not in git, but every team member
should copy them so everyone gets the same Copilot behaviour across all projects.

---

## Installation — do this once per machine

Copy the 4 files from this section into your VS Code user prompts folder.

**macOS:**
```
~/Library/Application Support/Code/User/prompts/
```

**Windows:**
```
%APPDATA%\Code\User\prompts\
```

**Linux:**
```
~/.config/Code/User/prompts/
```

You can also open the folder directly from VS Code:
**Command Palette → "Open User Prompts Folder"**

---

## The 4 instruction files

### 1. `typescript-standards.instructions.md`
**Auto-applied to:** every `*.ts` file you open or edit.

Covers:
- `strict: true` is always on — never disable it
- No `any` types — use `unknown` + type guards
- `const` over `let`, never `var`
- Prefix unused params with `_` (e.g. `_req`, `_next`)
- Always declare return types on exported functions
- Named imports only, grouped in order: Node built-ins → third-party → internal
- Typed `ApiError` for HTTP errors, never raw `new Error()`
- Security: never log passwords/tokens, always hash passwords with bcrypt

```yaml
---
description: "Use when writing or editing TypeScript files..."
applyTo: "**/*.ts"
---
```

---

### 2. `node-package-preferences.instructions.md`
**Auto-applied to:** every `package.json` file.

Covers the approved library list:

| Concern | Use | Avoid |
|---------|-----|-------|
| Validation | `zod` | joi, yup |
| Logging | `pino` + `pino-pretty` | winston, morgan, console.log |
| Testing | `jest` + `ts-jest` + `supertest` | mocha, vitest |
| Dev server | `tsx watch` | nodemon, ts-node-dev |
| Formatting | `prettier` | biome |

Also enforces:
- Required `npm` script names (`dev`, `build`, `start`, `test`, `lint`, `format`, etc.)
- `"engines": { "node": ">=20.0.0" }` in every project
- Dev tools (`typescript`, `jest`, `eslint`) always in `devDependencies`, never `dependencies`
- Two tsconfig files: `tsconfig.json` (IDE) + `tsconfig.build.json` (production build)

```yaml
---
description: "Use when creating or editing package.json or choosing libraries..."
applyTo: "**/package.json"
---
```

---

### 3. `express-api-architecture.instructions.md`
**On-demand:** loaded when you ask Copilot to create routes, controllers, services, or middleware.

Enforces strict 4-layer architecture:
```
Route → Controller → Service → Repository
```

Rules:
- Never skip a layer (e.g. `Controller → Repository` without a service is forbidden)
- All errors: throw `ApiError` from services, never `res.status()` inside a service
- All success responses: use `response.helper.ts` (`ok()`, `created()`, `noContent()`)
- All user input: Zod schema + `validate()` middleware, never manual validation in controllers
- New modules always get 6 files: `model`, `repository`, `service`, `controller`, `schema`, `routes`
- Middleware registration order in `express.loader.ts` must be: `helmet → cors → rateLimit → compression → bodyParser → requestId → routes → notFound → errorHandler`
- Logging: always use the shared Pino logger, never `console.log` in production

```yaml
---
description: "Use when creating Express.js routes, controllers, services, repositories..."
---
```

---

### 4. `jest-testing-patterns.instructions.md`
**Auto-applied to:** every `*.test.ts` file.

Covers:
- `jest` + `ts-jest` transformer, test files named `*.test.ts`
- Unit tests go in `tests/unit/`, route tests in `tests/integration/`
- Always use `repository.clear()` in `beforeEach` for test isolation
- Integration tests use `supertest` — never bind a real port
- Build the Express app with `loadExpress(express())` directly, no `server.ts`
- Mock external services (SNS, SQS, HTTP) with `jest.mock()`
- Coverage: every service needs a happy-path + error-case unit test; every route needs a 2xx + 4xx test

```yaml
---
description: "Use when writing unit tests, integration tests, or test configuration..."
applyTo: "**/*.test.ts"
---
```

---

## How to add or modify a rule

1. Open the file you want to change (see installation path above).
2. Edit the body — it is plain Markdown, no special syntax needed.
3. Save. VS Code picks up the change immediately — no restart required.

**To add a new rule to an existing file:**
Just add a bullet point or section under the relevant heading.

**To create a new instruction file:**
Copy any existing file as a template, change the `description` and `applyTo` fields in the YAML header, and save it in the same prompts folder.

**YAML header fields explained:**

```yaml
---
description: "Keyword-rich sentence describing WHEN this applies.
              Copilot reads this to decide whether to load the file."
applyTo: "**/*.ts"   # Optional — auto-loads when these files are in context.
                     # Remove this line to make the file on-demand only.
---
```

---

## How Copilot loads these files

| File | Trigger |
|------|---------|
| `typescript-standards` | Auto — whenever a `.ts` file is open |
| `node-package-preferences` | Auto — whenever `package.json` is open |
| `express-api-architecture` | On-demand — when the task description matches keywords like "route", "controller", "service", "middleware" |
| `jest-testing-patterns` | Auto — whenever a `.test.ts` file is open |

If Copilot does not seem to follow a rule, check:
1. The file is in the correct prompts folder (see Installation).
2. The YAML frontmatter has no typos (colons inside values must be quoted).
3. The `description` contains the keywords relevant to your task.

---

## Reference: full file contents

The source-of-truth files live at:
```
~/Library/Application Support/Code/User/prompts/typescript-standards.instructions.md
~/Library/Application Support/Code/User/prompts/node-package-preferences.instructions.md
~/Library/Application Support/Code/User/prompts/express-api-architecture.instructions.md
~/Library/Application Support/Code/User/prompts/jest-testing-patterns.instructions.md
```

Project-level Copilot rules (for this specific repo) are in:
```
express-ts-api/.github/copilot-instructions.md
```
