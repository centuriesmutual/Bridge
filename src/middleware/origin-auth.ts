import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadEnv } from '../config/env.js';
import {
  isPropertyId,
  propertyForOrigin,
  scopedMemberId,
  type PropertyId,
} from '../config/origins.js';
import { AuthError, ForbiddenError } from '../lib/errors.js';
import type { AuthContext } from '../types/auth.js';

/**
 * origin-auth: resolves EVERY member-facing request to exactly one property
 * before any chaincode is touched.
 *
 * Two checks, both required:
 *   1. Origin/Referer must match a property's allowlist (config/origins.ts).
 *   2. A member session token (Supabase-issued JWT) must verify against the
 *      Supabase JWKS.
 *
 * TODO: confirm the Supabase issuer / JWKS URL / audience. Until confirmed
 * (SUPABASE_JWKS_URL unset), member JWT verification cannot succeed and the
 * request is rejected rather than trusted.
 */

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  const env = loadEnv();
  if (!env.SUPABASE_JWKS_URL) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(env.SUPABASE_JWKS_URL));
  return jwks;
}

/** Test seam: inject a resolver so member auth is testable without network. */
type MemberTokenVerifier = (token: string) => Promise<JWTPayload>;
let verifierOverride: MemberTokenVerifier | null = null;
export function setMemberTokenVerifier(fn: MemberTokenVerifier | null): void {
  verifierOverride = fn;
}

async function verifyMemberToken(token: string): Promise<JWTPayload> {
  if (verifierOverride) return verifierOverride(token);
  const env = loadEnv();
  const keySet = getJwks();
  if (!keySet) {
    throw new AuthError(
      'Member token verification is not configured (SUPABASE_JWKS_URL missing).',
      'MEMBER_AUTH_UNCONFIGURED',
    );
  }
  const { payload } = await jwtVerify(token, keySet, {
    audience: env.SUPABASE_JWT_AUDIENCE,
    ...(env.SUPABASE_JWT_ISSUER ? { issuer: env.SUPABASE_JWT_ISSUER } : {}),
  });
  return payload;
}

/** Resolve the property that owns this request from Origin, then Referer. */
export function resolveProperty(req: FastifyRequest): PropertyId | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    const byOrigin = propertyForOrigin(origin);
    if (byOrigin) return byOrigin;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string') {
    try {
      const url = new URL(referer);
      const byReferer = propertyForOrigin(`${url.protocol}//${url.host}`);
      if (byReferer) return byReferer;
    } catch {
      // ignore malformed referer
    }
  }
  return null;
}

function bearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Fastify preHandler for member-facing routes. On success attaches
 * `req.auth`. Optionally pin the route to an expected property.
 */
export function memberOriginAuth(expected?: PropertyId) {
  return async function (req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const property = resolveProperty(req);
    if (!property) {
      throw new ForbiddenError('Request origin is not on any property allowlist.');
    }
    if (expected && property !== expected) {
      throw new ForbiddenError(
        `Origin resolves to "${property}" but this route serves "${expected}".`,
      );
    }
    const token = bearer(req);
    if (!token) {
      throw new AuthError('Missing member session token.');
    }
    let payload: JWTPayload;
    try {
      payload = await verifyMemberToken(token);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError('Invalid member session token.', 'INVALID_TOKEN');
    }
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!sub) {
      throw new AuthError('Member token is missing a subject.', 'INVALID_TOKEN');
    }
    const auth: AuthContext = {
      property,
      subjectType: 'member',
      rawSubject: sub,
      memberId: scopedMemberId(property, sub),
      scopes: [],
    };
    req.auth = auth;
  };
}

/** Guard for cases where a downstream handler expects an authenticated member. */
export function requireProperty(req: FastifyRequest, property: PropertyId): void {
  if (!req.auth) throw new AuthError();
  if (req.auth.property !== property) {
    throw new ForbiddenError(`Route requires property "${property}".`);
  }
}

export { isPropertyId };
