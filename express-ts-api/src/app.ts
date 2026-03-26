/**
 * app.ts — Express Application Factory
 * ──────────────────────────────────────
 * Creates and exports a bare Express application instance.
 * Middleware and routes are applied by loaders/express.loader.ts.
 *
 * WHY SEPARATE THIS FROM server.ts?
 *   Tests import `app` directly (via `createApp()`) without binding a port.
 *   This means tests start instantly with no port-conflict risk.
 */

import express from 'express';

export function createApp(): express.Application {
  return express();
}
