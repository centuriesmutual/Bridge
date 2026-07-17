import { describe, expect, it } from 'vitest';
import { parseApiKeys } from '../../src/config/env.js';
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
