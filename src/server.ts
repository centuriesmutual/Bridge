import './config/loadDotenv.js';
import { readFileSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { logger } from './lib/logger.js';
import { closeGateway } from './fabric/gateway.js';
import { closeRedis } from './lib/redis.js';

/**
 * Server entrypoint. TLS is enforced in production (see env validation).
 * Fastify's HTTPS support is enabled by providing the `https` server options
 * BEFORE the app is built, so we construct with TLS here.
 */
async function main(): Promise<void> {
  const env = loadEnv();

  const httpsOptions =
    env.TLS_ENABLED && env.TLS_CERT_PATH && env.TLS_KEY_PATH
      ? {
          key: readFileSync(env.TLS_KEY_PATH),
          cert: readFileSync(env.TLS_CERT_PATH),
        }
      : undefined;

  const app = await buildApp(httpsOptions ? { https: httpsOptions } : {});

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    try {
      await app.close();
      closeGateway();
      await closeRedis();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
  logger.info({ host: env.HOST, port: env.PORT }, 'ledger-bridge listening');
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Fatal startup error');
  process.exit(1);
});
