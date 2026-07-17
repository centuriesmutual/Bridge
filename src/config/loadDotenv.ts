/**
 * Side-effect module: loads `.env` into process.env for local/dev runs.
 *
 * Import this FIRST from process entrypoints (server.ts, worker.ts) so env
 * vars are populated before any module reads them. It is intentionally NOT
 * imported by config/env.ts, so tests stay hermetic (they set process.env in
 * test/setup.ts and never read a developer's local .env).
 *
 * In production (Railway / GitLab / etc.) env vars are injected by the
 * platform — there is no `.env` file, so we skip dotenv entirely. A missing
 * `.env` must never crash the process.
 */
import { config } from 'dotenv';

if (process.env.NODE_ENV !== 'production') {
  try {
    // override: false so already-set vars (CI, shell) always win.
    config({ path: '.env', override: false });
  } catch {
    // .env missing or unreadable — fine for local runs that set env another way.
  }
}
