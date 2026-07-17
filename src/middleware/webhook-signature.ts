import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';
import { verifyHmac } from '../lib/hmac.js';
import { AuthError } from '../lib/errors.js';
import type { PropertyId } from '../config/origins.js';
import type { AuthContext } from '../types/auth.js';

/**
 * Generic HMAC signature verifier for inbound webhooks.
 *
 * Each webhook source has its OWN secret. We NEVER trust an inbound payload
 * before verifying its signature over the RAW request body (re-serializing the
 * parsed JSON could change bytes and invalidate the HMAC — so server.ts
 * captures `req.rawBody`).
 */

export type WebhookSource = 'wearable' | 'ad-network' | 'usdc';

interface SourceConfig {
  property: PropertyId;
  secretKey: 'WEBHOOK_SECRET_WEARABLE' | 'WEBHOOK_SECRET_AD_NETWORK' | 'WEBHOOK_SECRET_USDC';
}

const SOURCES: Record<WebhookSource, SourceConfig> = {
  wearable: { property: 'mybrotherskeeper', secretKey: 'WEBHOOK_SECRET_WEARABLE' },
  'ad-network': { property: 'medicare-reviews', secretKey: 'WEBHOOK_SECRET_AD_NETWORK' },
  usdc: { property: 'wintergarden', secretKey: 'WEBHOOK_SECRET_USDC' },
};

export interface WebhookSignatureOptions {
  /** Header carrying the signature. Defaults to `x-webhook-signature`. */
  signatureHeader?: string;
}

export function webhookSignature(source: WebhookSource, opts: WebhookSignatureOptions = {}) {
  const headerName = (opts.signatureHeader ?? 'x-webhook-signature').toLowerCase();
  const cfg = SOURCES[source];

  return async function (req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const env = loadEnv();
    const secret = env[cfg.secretKey];
    const signature = req.headers[headerName];
    if (typeof signature !== 'string' || signature.length === 0) {
      throw new AuthError(`Missing ${headerName} header.`, 'MISSING_SIGNATURE');
    }
    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      throw new AuthError('Cannot verify signature: empty request body.', 'EMPTY_BODY');
    }
    if (!verifyHmac(secret, raw, signature)) {
      throw new AuthError('Webhook signature verification failed.', 'BAD_SIGNATURE');
    }
    const auth: AuthContext = {
      property: cfg.property,
      subjectType: 'webhook',
      webhookSource: source,
      scopes: [],
    };
    req.auth = auth;
  };
}
