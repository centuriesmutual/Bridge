import { describe, expect, it } from 'vitest';
import { computeHmac, verifyHmac } from '../../src/lib/hmac.js';

describe('hmac', () => {
  const secret = 'top-secret';
  const payload = JSON.stringify({ a: 1, b: 'two' });

  it('verifies a correct hex signature', () => {
    const sig = computeHmac(secret, payload);
    expect(verifyHmac(secret, payload, sig)).toBe(true);
  });

  it('verifies a prefixed signature (sha256=...)', () => {
    const sig = `sha256=${computeHmac(secret, payload)}`;
    expect(verifyHmac(secret, payload, sig)).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const sig = computeHmac(secret, payload);
    expect(verifyHmac(secret, payload + 'x', sig)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const sig = computeHmac(secret, payload);
    expect(verifyHmac('other', payload, sig)).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verifyHmac(secret, payload, '')).toBe(false);
  });
});
