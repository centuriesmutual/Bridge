import { z } from 'zod';
import { ValidationError } from '../lib/errors.js';

/** Reusable primitives shared across route schemas. */
export const MemberId = z.string().min(1).max(128);
export const EventId = z.string().min(1).max(200);
export const PositiveAmount = z.number().positive().finite();

/**
 * Parse `data` with `schema`, throwing a ValidationError (distinct error shape
 * from ledger failures) on failure.
 */
export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Request payload failed validation.', result.error.flatten());
  }
  return result.data;
}
