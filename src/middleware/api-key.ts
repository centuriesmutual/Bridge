import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';
import { AuthError, ForbiddenError } from '../lib/errors.js';
import type { AuthContext } from '../types/auth.js';

/**
 * Server-to-server API key auth for centuriesmutual.com Developer Portal
 * partners that use static keys rather than the OAuth code flow.
 *
 * SECURITY: only SHA-256 hashes of keys are stored (API_KEYS env). The raw key
 * arrives in `x-api-key` and is hashed for a constant-time comparison. Raw
 * keys are never logged (see logger redaction).
 */

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * preHandler enforcing a valid API key with ALL of `requiredScopes`.
 * Attaches a partner AuthContext scoped to centuries-mutual.
 */
export function apiKeyScopes(requiredScopes: string[]) {
  return async function (req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const provided = req.headers['x-api-key'];
    if (typeof provided !== 'string' || provided.length === 0) {
      throw new AuthError('Missing API key.', 'MISSING_API_KEY');
    }
    const providedHash = sha256Hex(provided);
    const record = loadEnv().apiKeys.find((k) => constantTimeEqualHex(k.sha256, providedHash));
    if (!record) {
      throw new AuthError('Invalid API key.', 'INVALID_API_KEY');
    }
    const missing = requiredScopes.filter((s) => !record.scopes.includes(s));
    if (missing.length > 0) {
      throw new ForbiddenError('API key is missing required scope(s).', { missing });
    }
    const auth: AuthContext = {
      property: 'centuries-mutual',
      subjectType: 'partner',
      rawSubject: record.keyId,
      scopes: record.scopes,
    };
    req.auth = auth;
  };
}
