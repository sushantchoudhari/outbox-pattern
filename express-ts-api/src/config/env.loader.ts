/**
 * config/env.loader.ts — Step 1: .env File Loader
 * ──────────────────────────────────────────────────
 * Sole responsibility: determine which .env file to load based on NODE_ENV
 * and call dotenv.config() to populate process.env.
 *
 * Must be executed before anything else reads process.env at module-load time.
 * Called once by config/index.ts before the schema validation step.
 *
 * File resolution order:
 *   .env.development  (NODE_ENV=development)
 *   .env.testing      (NODE_ENV=testing)
 *   .env.preprod      (NODE_ENV=preprod)
 *   .env.production   (NODE_ENV=production)
 *   .env              (fallback — file not found for current NODE_ENV)
 *
 * Returns the resolved path so the validation step can include it in error
 * messages without having to re-derive it.
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Loads the environment-specific .env file into process.env.
 * @returns The absolute path that was loaded (for use in error messages).
 */
export function loadEnvFile(): string {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';
  const envFile = path.resolve(__dirname, '../..', `.env.${nodeEnv}`);

  if (fs.existsSync(envFile)) {
    dotenv.config({ path: envFile });
    return envFile;
  }

  // Fall back to a generic .env if the environment-specific file is absent.
  dotenv.config();
  return path.resolve(__dirname, '../..', '.env');
}
