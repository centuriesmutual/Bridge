/**
 * Typed error hierarchy.
 *
 * The frontend needs to distinguish "your request was invalid" (client can
 * fix and MUST NOT blindly retry) from "the ledger did not confirm this"
 * (transient — retry is appropriate). Each error class maps to a distinct
 * `code` and `category` in the JSON error envelope (see server error handler).
 */

export type ErrorCategory =
  | 'validation' // bad input; do not retry unchanged
  | 'auth' // authentication/authorization failure
  | 'not_found'
  | 'conflict' // idempotency / duplicate
  | 'ledger' // Fabric endorsement/commit failure; retry may help
  | 'upstream' // third-party (USDC/wearable/ad-network) failure
  | 'not_implemented' // blocked on pending chaincode work
  | 'internal';

export interface ErrorBody {
  error: {
    code: string;
    category: ErrorCategory;
    message: string;
    /** True when the caller may safely retry the identical request. */
    retryable: boolean;
    details?: unknown;
  };
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(params: {
    statusCode: number;
    code: string;
    category: ErrorCategory;
    message: string;
    retryable?: boolean;
    details?: unknown;
  }) {
    super(params.message);
    this.name = new.target.name;
    this.statusCode = params.statusCode;
    this.code = params.code;
    this.category = params.category;
    this.retryable = params.retryable ?? false;
    this.details = params.details;
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        category: this.category,
        message: this.message,
        retryable: this.retryable,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      category: 'validation',
      message,
      retryable: false,
      details,
    });
  }
}

export class AuthError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super({ statusCode: 401, code, category: 'auth', message, retryable: false });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super({
      statusCode: 403,
      code: 'FORBIDDEN',
      category: 'auth',
      message,
      retryable: false,
      details,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super({ statusCode: 404, code: 'NOT_FOUND', category: 'not_found', message });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Duplicate request', details?: unknown) {
    super({
      statusCode: 409,
      code: 'DUPLICATE_REQUEST',
      category: 'conflict',
      message,
      retryable: false,
      details,
    });
  }
}

/**
 * Fabric endorsement/commit failure. Distinct shape so the frontend knows the
 * ledger did NOT confirm and a retry is appropriate.
 */
export class LedgerError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      statusCode: 502,
      code: 'LEDGER_NOT_CONFIRMED',
      category: 'ledger',
      message,
      retryable: true,
      details,
    });
  }
}

export class UpstreamError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      statusCode: 502,
      code: 'UPSTREAM_FAILED',
      category: 'upstream',
      message,
      retryable: true,
      details,
    });
  }
}

export class NotImplementedError extends AppError {
  constructor(message: string, details?: unknown) {
    super({
      statusCode: 501,
      code: 'NOT_IMPLEMENTED',
      category: 'not_implemented',
      message,
      retryable: false,
      details,
    });
  }
}
