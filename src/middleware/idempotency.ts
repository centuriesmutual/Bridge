import type { FastifyReply, FastifyRequest } from 'fastify';
import { getRedis } from '../lib/redis.js';
import { loadEnv } from '../config/env.js';
import { ConflictError, ValidationError } from '../lib/errors.js';

/**
 * Idempotency for write endpoints and webhook handlers.
 *
 * A client- or source-supplied event id (ad-delivery id, wearable batch id,
 * USDC tx hash, or a client `Idempotency-Key` header) is stored in Redis with
 * a TTL. Duplicate processing is short-circuited BEFORE any Fabric call.
 *
 * Two-phase to avoid caching failures:
 *   - `reserve()`  : atomically claim the key (SET NX). If already claimed and
 *                    completed, replay the stored response; if in-flight,
 *                    reject as duplicate.
 *   - `complete()` : store the successful response body against the key.
 *   - `release()`  : drop the reservation on failure so the caller can retry.
 */

const PREFIX = 'idem:';

interface StoredResult {
  status: 'in_flight' | 'done';
  statusCode?: number;
  body?: unknown;
}

function redisKey(scope: string, key: string): string {
  return `${PREFIX}${scope}:${key}`;
}

export interface IdempotencyHandle {
  key: string;
  scope: string;
  complete(statusCode: number, body: unknown): Promise<void>;
  release(): Promise<void>;
}

/**
 * Extract the idempotency key: prefer an explicit function, then the
 * `Idempotency-Key` header. Throws ValidationError if none is resolvable.
 */
export type KeyExtractor = (req: FastifyRequest) => string | undefined;

export function idempotencyKeyFromHeader(req: FastifyRequest): string | undefined {
  const h = req.headers['idempotency-key'];
  return typeof h === 'string' && h.length > 0 ? h : undefined;
}

/**
 * preHandler factory. `scope` namespaces keys per route group so the same id
 * from two different sources can't collide.
 *
 * On a completed duplicate it replays the stored response and stops the route.
 * Otherwise it reserves the key and attaches `req.idempotency` for the handler
 * to `complete()` on success.
 */
export function idempotency(scope: string, extractor: KeyExtractor = idempotencyKeyFromHeader) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const key = extractor(req);
    if (!key) {
      throw new ValidationError(
        'Missing idempotency key (Idempotency-Key header or event id required).',
      );
    }
    const redis = getRedis();
    const ttl = loadEnv().IDEMPOTENCY_TTL_SECONDS;
    const rkey = redisKey(scope, key);

    const reserved = await redis.set(
      rkey,
      JSON.stringify({ status: 'in_flight' } satisfies StoredResult),
      'EX',
      ttl,
      'NX',
    );

    if (reserved === null) {
      // Key already exists — either completed (replay) or in-flight (dupe).
      const existingRaw = await redis.get(rkey);
      const existing: StoredResult | null = existingRaw ? JSON.parse(existingRaw) : null;
      if (existing?.status === 'done') {
        reply
          .code(existing.statusCode ?? 200)
          .header('idempotent-replay', 'true')
          .send(existing.body);
        return;
      }
      throw new ConflictError('A request with this idempotency key is already being processed.', {
        idempotencyKey: key,
      });
    }

    const handle: IdempotencyHandle = {
      key,
      scope,
      async complete(statusCode, body) {
        await redis.set(
          rkey,
          JSON.stringify({ status: 'done', statusCode, body } satisfies StoredResult),
          'EX',
          ttl,
        );
      },
      async release() {
        await redis.del(rkey);
      },
    };
    req.idempotency = handle;
  };
}

/**
 * Run an idempotent write: executes `producer`, stores + sends its response on
 * success, and releases the reservation on failure so the caller can retry.
 * Must be used on a route guarded by the `idempotency()` preHandler.
 */
export async function runIdempotent<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  producer: () => Promise<T>,
): Promise<void> {
  const handle = req.idempotency;
  try {
    const body = await producer();
    if (handle) await handle.complete(statusCode, body);
    reply.code(statusCode).send(body);
  } catch (err) {
    // Release so a legitimate retry isn't permanently blocked as a duplicate.
    if (handle) await handle.release().catch(() => undefined);
    throw err;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    idempotency?: IdempotencyHandle;
  }
}
