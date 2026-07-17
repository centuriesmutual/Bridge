import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';
import { AuthError, ForbiddenError } from '../lib/errors.js';
import type { AuthContext } from '../types/auth.js';

/**
 * OAuth 2.0 bearer validation for centuriesmutual.com Developer Portal
 * partners. Partner tokens are scoped (rewards:read, wellness:read,
 * enrollment:read, ...). Partner access is ONLY relevant to centuries-mutual.
 *
 * TODO: confirm the Developer Portal authorization server issuer + JWKS.
 */

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  const env = loadEnv();
  if (!env.DEVELOPER_OAUTH_JWKS_URL) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(env.DEVELOPER_OAUTH_JWKS_URL));
  return jwks;
}

type PartnerTokenVerifier = (token: string) => Promise<JWTPayload>;
let verifierOverride: PartnerTokenVerifier | null = null;
export function setPartnerTokenVerifier(fn: PartnerTokenVerifier | null): void {
  verifierOverride = fn;
}

function extractScopes(payload: JWTPayload): string[] {
  const raw = (payload as Record<string, unknown>).scope ?? (payload as Record<string, unknown>).scp;
  if (typeof raw === 'string') return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

async function verifyPartnerToken(token: string): Promise<JWTPayload> {
  if (verifierOverride) return verifierOverride(token);
  const env = loadEnv();
  const keySet = getJwks();
  if (!keySet) {
    throw new AuthError(
      'Partner OAuth is not configured (DEVELOPER_OAUTH_JWKS_URL missing).',
      'PARTNER_AUTH_UNCONFIGURED',
    );
  }
  const { payload } = await jwtVerify(token, keySet, {
    audience: env.DEVELOPER_OAUTH_AUDIENCE,
    ...(env.DEVELOPER_OAUTH_ISSUER ? { issuer: env.DEVELOPER_OAUTH_ISSUER } : {}),
  });
  return payload;
}

/**
 * preHandler enforcing an OAuth partner token carrying ALL of `requiredScopes`.
 * Attaches a partner AuthContext scoped to centuries-mutual.
 */
export function oauthScopes(requiredScopes: string[]) {
  return async function (req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
      ? header.slice(7)
      : null;
    if (!token) throw new AuthError('Missing partner OAuth bearer token.');

    let payload: JWTPayload;
    try {
      payload = await verifyPartnerToken(token);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('Invalid partner OAuth token.', 'INVALID_TOKEN');
    }

    const scopes = extractScopes(payload);
    const missing = requiredScopes.filter((s) => !scopes.includes(s));
    if (missing.length > 0) {
      throw new ForbiddenError('Token is missing required scope(s).', { missing });
    }

    const auth: AuthContext = {
      // Partner access is only defined for centuries-mutual's Developer Portal.
      property: 'centuries-mutual',
      subjectType: 'partner',
      rawSubject: typeof payload.sub === 'string' ? payload.sub : undefined,
      scopes,
    };
    req.auth = auth;
  };
}
