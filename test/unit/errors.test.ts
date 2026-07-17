import { describe, expect, it } from 'vitest';
import {
  AuthError,
  ConflictError,
  ForbiddenError,
  LedgerError,
  NotFoundError,
  NotImplementedError,
  UpstreamError,
  ValidationError,
} from '../../src/lib/errors.js';

describe('errors', () => {
  it('maps each error to its status/category/retryable', () => {
    expect(new ValidationError('bad').statusCode).toBe(400);
    expect(new AuthError().statusCode).toBe(401);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new ConflictError().statusCode).toBe(409);
    expect(new NotImplementedError('x').statusCode).toBe(501);

    const ledger = new LedgerError('nope', { txId: 't' });
    expect(ledger.statusCode).toBe(502);
    expect(ledger.retryable).toBe(true);
    expect(ledger.category).toBe('ledger');

    const up = new UpstreamError('down');
    expect(up.retryable).toBe(true);
  });

  it('serializes a body envelope with details', () => {
    const body = new ValidationError('bad', { field: 'x' }).toBody();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details).toEqual({ field: 'x' });
    expect(body.error.retryable).toBe(false);
  });

  it('omits details when absent', () => {
    const body = new NotFoundError().toBody();
    expect('details' in body.error).toBe(false);
  });
});
