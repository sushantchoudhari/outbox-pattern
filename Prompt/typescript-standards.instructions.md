---
description: "Use when writing or editing TypeScript files. Covers strict mode rules, naming conventions, type safety, async patterns, and import style."
applyTo: "**/*.ts"
---

# TypeScript Coding Standards

## Compiler settings (non-negotiable)
- `strict: true` is always on. Never disable it or any of its sub-flags.
- `noImplicitOverride: true` — always mark overrides with `override`.
- Target: `ES2020` minimum. Module: `NodeNext` or `CommonJS` depending on project setup.

## Type safety
- No `any`. Use `unknown` and narrow with type guards or Zod `.parse()`.
- No type assertions (`as Foo`) unless you add a comment explaining why it is safe.
- Exception: known Express/Node gaps — cast with the narrowest type: `(err as Error & { type?: string })`.
- Prefer interfaces for object shapes that may be extended; use `type` for unions and computed types.

## Variables and functions
- Always `const`; use `let` only when reassignment is required. Never `var`.
- Prefix intentionally unused parameters with `_` (e.g. `_req`, `_next`).
- Always declare return types on exported functions and class methods.
- Async functions: always return `Promise<void>` or `Promise<T>`, never `Promise<any>`.

## Naming conventions
| Kind | Convention | Example |
|------|-----------|---------|
| Class / Interface | PascalCase | `UserService`, `ApiError` |
| Function / variable | camelCase | `createUser`, `isValid` |
| Constant / enum value | UPPER_SNAKE or PascalCase | `HttpStatus.OK` |
| File | kebab-case or `module.role.ts` | `user.service.ts` |
| Generic parameter | Single uppercase letter or descriptive PascalCase | `T`, `TData` |

## Imports
- Use named imports. Avoid `import *`.
- Group imports: (1) Node built-ins, (2) third-party, (3) internal — blank line between groups.
- Use path aliases (`@/`) when configured in tsconfig. Avoid deep relative paths (`../../../`).

## Error handling
- Throw typed errors, not raw `new Error(msg)` for HTTP/business errors.
- Use a shared `ApiError` class (or equivalent) with a `statusCode` field.
- In Express controllers: always `try/catch` → `next(err)`. Never swallow errors silently.

## Security
- Never log passwords, tokens, or secret keys — even at debug level.
- Never store plaintext passwords. Always hash with bcrypt (10+ rounds).
- Never return password fields in API responses. Use a `sanitize*` helper to strip them.
- Validate all env variables with Zod at startup; crash with a clear message on failure.
