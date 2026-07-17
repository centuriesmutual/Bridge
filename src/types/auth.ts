import type { PropertyId } from '../config/origins.js';

/**
 * Resolved authentication context attached to every authenticated request.
 * Exactly one property is resolved before any chaincode is touched.
 */
export type SubjectType = 'member' | 'partner' | 'webhook';

export interface AuthContext {
  property: PropertyId;
  subjectType: SubjectType;
  /** Property-scoped member id (e.g. `cm:123`) for member requests. */
  memberId?: string;
  /** Raw subject from the token before scoping. */
  rawSubject?: string;
  /** OAuth/API-key scopes for partner requests. */
  scopes: string[];
  /** For webhook requests: which webhook source was verified. */
  webhookSource?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    /** Raw request body bytes, captured for HMAC signature verification. */
    rawBody?: Buffer;
  }
}
