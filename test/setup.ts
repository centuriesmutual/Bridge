/**
 * Global test setup: provide deterministic env before any module loads.
 * Runs before each test file (see vitest.config.ts setupFiles).
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.TLS_ENABLED = 'false';

// Known webhook secrets so tests can compute matching HMAC signatures.
process.env.WEBHOOK_SECRET_WEARABLE = 'test-wearable-secret';
process.env.WEBHOOK_SECRET_AD_NETWORK = 'test-adnetwork-secret';
process.env.WEBHOOK_SECRET_USDC = 'test-usdc-secret';

// A single API key: raw "test-key" -> sha256, scoped for CM reads/writes.
import { createHash } from 'node:crypto';
export const TEST_API_KEY = 'test-key';
const testKeyHash = createHash('sha256').update(TEST_API_KEY).digest('hex');
process.env.API_KEYS = `partnerA:${testKeyHash}:rewards:read|rewards:write|rewards:admin|wellness:write|enrollment:write`;
