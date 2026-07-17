import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TEST_API_KEY } from '../setup.js';
import { apiKeyScopes } from '../../src/middleware/api-key.js';
import { oauthScopes, setPartnerTokenVerifier } from '../../src/middleware/oauth.js';
import {
  memberOriginAuth,
  requireProperty,
  resolveProperty,
  setMemberTokenVerifier,
} from '../../src/middleware/origin-auth.js';
import { AuthError, ForbiddenError } from '../../src/lib/errors.js';

const reply = {} as FastifyReply;
function req(headers: Record<string, string>, extra: Record<string, unknown> = {}): FastifyRequest {
  return { headers, ...extra } as unknown as FastifyRequest;
}

afterEach(() => {
  setPartnerTokenVerifier(null);
  setMemberTokenVerifier(null);
});

describe('api-key middleware', () => {
  it('accepts a valid key with the required scope', async () => {
    const r = req({ 'x-api-key': TEST_API_KEY });
    await apiKeyScopes(['rewards:write'])(r, reply);
    expect(r.auth?.subjectType).toBe('partner');
    expect(r.auth?.property).toBe('centuries-mutual');
  });

  it('rejects a missing key', async () => {
    await expect(apiKeyScopes(['rewards:write'])(req({}), reply)).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects an invalid key', async () => {
    await expect(
      apiKeyScopes(['rewards:write'])(req({ 'x-api-key': 'wrong' }), reply),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects a key missing the required scope', async () => {
    await expect(
      apiKeyScopes(['does:not-have'])(req({ 'x-api-key': TEST_API_KEY }), reply),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('oauth middleware', () => {
  it('accepts a token carrying the required scope (string claim)', async () => {
    setPartnerTokenVerifier(async () => ({ sub: 'p1', scope: 'rewards:read wellness:read' }));
    const r = req({ authorization: 'Bearer tok' });
    await oauthScopes(['rewards:read'])(r, reply);
    expect(r.auth?.scopes).toContain('rewards:read');
  });

  it('accepts a token with an array scp claim', async () => {
    setPartnerTokenVerifier(async () => ({ sub: 'p1', scp: ['enrollment:read'] }));
    const r = req({ authorization: 'Bearer tok' });
    await oauthScopes(['enrollment:read'])(r, reply);
    expect(r.auth?.scopes).toContain('enrollment:read');
  });

  it('rejects a missing bearer token', async () => {
    await expect(oauthScopes(['rewards:read'])(req({}), reply)).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects a token missing scope', async () => {
    setPartnerTokenVerifier(async () => ({ sub: 'p1', scope: 'rewards:read' }));
    await expect(
      oauthScopes(['wellness:read'])(req({ authorization: 'Bearer tok' }), reply),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('fails closed when not configured', async () => {
    // No verifier + no DEVELOPER_OAUTH_JWKS_URL in test env.
    await expect(
      oauthScopes(['rewards:read'])(req({ authorization: 'Bearer tok' }), reply),
    ).rejects.toBeInstanceOf(AuthError);
  });
});

describe('origin-auth middleware', () => {
  it('resolves a property from Origin and from Referer', () => {
    expect(resolveProperty(req({ origin: 'https://medicare.reviews' }))).toBe('medicare-reviews');
    expect(resolveProperty(req({ referer: 'https://wintergarden.cc/song/1' }))).toBe('wintergarden');
    expect(resolveProperty(req({ referer: 'not a url' }))).toBeNull();
    expect(resolveProperty(req({}))).toBeNull();
  });

  it('authenticates a member and scopes the id', async () => {
    setMemberTokenVerifier(async () => ({ sub: 'u9' }));
    const r = req({ origin: 'https://centuriesmutual.com', authorization: 'Bearer t' });
    await memberOriginAuth('centuries-mutual')(r, reply);
    expect(r.auth?.memberId).toBe('cm:u9');
  });

  it('rejects a non-allowlisted origin', async () => {
    await expect(
      memberOriginAuth()(req({ origin: 'https://evil.example', authorization: 'Bearer t' }), reply),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects when origin resolves to a different property than expected', async () => {
    setMemberTokenVerifier(async () => ({ sub: 'u9' }));
    await expect(
      memberOriginAuth('wintergarden')(
        req({ origin: 'https://centuriesmutual.com', authorization: 'Bearer t' }),
        reply,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('rejects a missing member token', async () => {
    await expect(
      memberOriginAuth('centuries-mutual')(req({ origin: 'https://centuriesmutual.com' }), reply),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects an invalid member token', async () => {
    setMemberTokenVerifier(async () => {
      throw new Error('bad token');
    });
    await expect(
      memberOriginAuth('centuries-mutual')(
        req({ origin: 'https://centuriesmutual.com', authorization: 'Bearer bad' }),
        reply,
      ),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('requireProperty guards the resolved property', () => {
    const r = req({});
    r.auth = { property: 'centuries-mutual', subjectType: 'member', scopes: [] };
    expect(() => requireProperty(r, 'centuries-mutual')).not.toThrow();
    expect(() => requireProperty(r, 'wintergarden')).toThrow(ForbiddenError);
    expect(() => requireProperty(req({}), 'centuries-mutual')).toThrow(AuthError);
  });
});
