import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, parseApiKeys, resetEnvCache } from '../../src/config/env.js';
import {
  PROPERTIES,
  isPropertyId,
  propertyForOrigin,
  scopedMemberId,
} from '../../src/config/origins.js';

describe('parseApiKeys', () => {
  it('parses scopes that themselves contain colons', () => {
    const [rec] = parseApiKeys('partnerA:abcDEF123:rewards:read|wellness:read');
    expect(rec!.keyId).toBe('partnerA');
    expect(rec!.sha256).toBe('abcdef123');
    expect(rec!.scopes).toEqual(['rewards:read', 'wellness:read']);
  });

  it('ignores blank entries', () => {
    expect(parseApiKeys('')).toEqual([]);
  });

  it('throws on a malformed entry', () => {
    expect(() => parseApiKeys('justonefield')).toThrow();
  });
});

describe('origins', () => {
  it('resolves an allowlisted origin to its property', () => {
    expect(propertyForOrigin('https://centuriesmutual.com')).toBe('centuries-mutual');
    expect(propertyForOrigin('https://wintergarden.software')).toBe('wintergarden');
    expect(propertyForOrigin('https://unknown.example')).toBeNull();
  });

  it('scopes member ids per property', () => {
    expect(scopedMemberId('mybrotherskeeper', '123')).toBe('mbk:123');
    expect(scopedMemberId('centuries-mutual', 'abc')).toBe('cm:abc');
  });

  it('validates property ids', () => {
    expect(isPropertyId('wintergarden')).toBe(true);
    expect(isPropertyId('nope')).toBe(false);
    expect(PROPERTIES).toContain('medicare-reviews');
  });
});

describe('TLS_ENABLED env coercion (Railway)', () => {
  afterEach(() => {
    resetEnvCache();
  });

  it('treats the string "false" as boolean false and does NOT require certs', () => {
    resetEnvCache();
    const env = loadEnv({
      NODE_ENV: 'production',
      TLS_ENABLED: 'false',
      REDIS_URL: 'redis://localhost:6379',
    } as NodeJS.ProcessEnv);
    expect(env.TLS_ENABLED).toBe(false);
    expect(typeof env.TLS_ENABLED).toBe('boolean');
  });

  it('treats TLS_ENABLED=true without certs as invalid', () => {
    resetEnvCache();
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        TLS_ENABLED: 'true',
        REDIS_URL: 'redis://localhost:6379',
      } as NodeJS.ProcessEnv),
    ).toThrow(/TLS_CERT_PATH/);
  });

  it('accepts TLS_ENABLED=true when cert paths are set', () => {
    resetEnvCache();
    const env = loadEnv({
      NODE_ENV: 'production',
      TLS_ENABLED: 'true',
      TLS_CERT_PATH: '/certs/cert.pem',
      TLS_KEY_PATH: '/certs/key.pem',
      REDIS_URL: 'redis://localhost:6379',
    } as NodeJS.ProcessEnv);
    expect(env.TLS_ENABLED).toBe(true);
  });
});
