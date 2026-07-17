/**
 * Side-effect module: loads `.env` into process.env for local/dev runs.
 *
 * Import this FIRST from process entrypoints (server.ts, worker.ts) so env
 * vars are populated before any module reads them. It is intentionally NOT
 * imported by config/env.ts, so tests stay hermetic (they set process.env in
 * test/setup.ts and never read a developer's local .env).
 *
 * `dotenv` does not override variables that are already set, so real
 * environment configuration (e.g. in production/CI) always wins.
 */
import { config } from 'dotenv';

config();
