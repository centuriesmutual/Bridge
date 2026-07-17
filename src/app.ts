import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { loadEnv } from './config/env.js';
import { PROPERTY_CONFIG } from './config/origins.js';
import { AppError, ValidationError } from './lib/errors.js';
import { registerRoutes } from './routes/index.js';
import './types/auth.js';

export interface BuildAppOptions {
  /** TLS materials. When provided, Fastify serves HTTPS (TLS at app level). */
  https?: { key: Buffer; cert: Buffer };
}

/**
 * Builds the Fastify app WITHOUT binding a socket, so tests can drive it via
 * `app.inject()`. Pass `https` to enforce TLS at the Fastify level.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-api-key"]',
          'req.headers["x-webhook-signature"]',
          'req.headers.cookie',
        ],
        censor: '[REDACTED]',
      },
    },
    ...(opts.https ? { https: opts.https } : {}),
    // Trust the ingress proxy so `req.ip`/origin resolution is accurate.
    trustProxy: true,
  });

  // Capture the raw body (bytes) for HMAC signature verification, then parse
  // JSON. Re-serializing parsed JSON would change bytes and break the HMAC.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      const buf = body as Buffer;
      req.rawBody = buf;
      if (buf.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(buf.toString('utf8')));
      } catch (err) {
        // Malformed JSON is a client error (400), not a server error (500).
        done(
          new ValidationError('Request body is not valid JSON.', {
            reason: err instanceof Error ? err.message : String(err),
          }),
          undefined,
        );
      }
    },
  );

  await app.register(helmet, { global: true });

  // CORS: only the allowlisted per-property origins may call the browser API.
  const allowedOrigins = new Set(
    Object.values(PROPERTY_CONFIG).flatMap((p) => p.allowedOrigins.map((o) => o.toLowerCase())),
  );
  await app.register(cors, {
    origin(origin, cb) {
      // Non-browser (no Origin) requests: allowed here, still auth-gated later.
      if (!origin) return cb(null, true);
      cb(null, allowedOrigins.has(origin.toLowerCase()));
    },
    credentials: true,
  });

  // Rate limit per API key, else per resolved origin, else per IP.
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator(req) {
      const apiKey = req.headers['x-api-key'];
      if (typeof apiKey === 'string') return `key:${apiKey.slice(0, 12)}`;
      const origin = req.headers.origin;
      if (typeof origin === 'string') return `origin:${origin}`;
      return `ip:${req.ip}`;
    },
  });

  app.get('/healthz', async () => ({ status: 'ok', service: 'ledger-bridge' }));

  // Central error handler: distinct shapes for validation vs ledger failures.
  // MUST be registered before routes so encapsulated route contexts inherit it.
  app.setErrorHandler((error: FastifyError, req, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send(error.toBody());
      return;
    }
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          category: 'validation',
          message: 'Request payload failed validation.',
          retryable: false,
          details: error.flatten(),
        },
      });
      return;
    }
    // Fastify's own schema validation.
    if ((error as { validation?: unknown }).validation) {
      reply.code(400).send({
        error: {
          code: 'VALIDATION_FAILED',
          category: 'validation',
          message: error.message,
          retryable: false,
        },
      });
      return;
    }
    if (error.statusCode === 429) {
      reply.code(429).send({
        error: {
          code: 'RATE_LIMITED',
          category: 'upstream',
          message: 'Too many requests.',
          retryable: true,
        },
      });
      return;
    }
    req.log.error({ err: error.message }, 'Unhandled error');
    reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        category: 'internal',
        message: 'An unexpected error occurred.',
        retryable: false,
      },
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        category: 'not_found',
        message: 'Route not found.',
        retryable: false,
      },
    });
  });

  await registerRoutes(app);

  return app;
}
