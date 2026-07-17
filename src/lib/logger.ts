import pino, { type LoggerOptions } from 'pino';
import { loadEnv } from '../config/env.js';

/**
 * Central logger with aggressive redaction.
 *
 * SECURITY: we must never emit Fabric identity certs/keys, webhook secrets,
 * or USDC provider keys. The redact paths below cover the common request and
 * config shapes; when adding new fields that may carry secrets, add them here.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-webhook-signature"]',
  'req.headers.cookie',
  '*.privateKey',
  '*.private_key',
  '*.apiKey',
  '*.api_key',
  '*.secret',
  '*.webhookSecret',
  '*.cert',
  '*.certificate',
  '*.credentials',
  'headers.authorization',
  'apiKey',
  'privateKey',
  'secret',
];

export function createLogger() {
  const env = loadEnv();
  const options: LoggerOptions = {
    level: env.LOG_LEVEL,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
    base: { service: 'ledger-bridge' },
  };
  return pino(options);
}

export const logger = createLogger();
