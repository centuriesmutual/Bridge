import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC helpers shared by webhook signature verification.
 *
 * Uses a constant-time comparison to avoid timing side channels. Supports
 * hex- and base64-encoded signatures, with an optional `sha256=` prefix
 * (common in GitHub/Stripe-style signatures).
 */

export function computeHmac(
  secret: string,
  payload: string | Buffer,
  algorithm = 'sha256',
): string {
  return createHmac(algorithm, secret).update(payload).digest('hex');
}

function stripPrefix(sig: string): string {
  const idx = sig.indexOf('=');
  if (idx > 0 && /^[a-z0-9]+$/i.test(sig.slice(0, idx))) {
    return sig.slice(idx + 1);
  }
  return sig;
}

function toBuffer(sig: string): Buffer | null {
  const cleaned = stripPrefix(sig.trim());
  if (/^[0-9a-f]+$/i.test(cleaned) && cleaned.length % 2 === 0) {
    return Buffer.from(cleaned, 'hex');
  }
  try {
    return Buffer.from(cleaned, 'base64');
  } catch {
    return null;
  }
}

/** Constant-time verification of an HMAC signature over the raw payload. */
export function verifyHmac(
  secret: string,
  payload: string | Buffer,
  providedSignature: string,
  algorithm = 'sha256',
): boolean {
  if (!providedSignature) return false;
  const expectedHex = computeHmac(secret, payload, algorithm);
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = toBuffer(providedSignature);
  if (!provided || provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}
