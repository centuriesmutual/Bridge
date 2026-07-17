import { Redis, type RedisOptions } from 'ioredis';
import { loadEnv } from '../config/env.js';

/**
 * Shared Redis connection factory.
 *
 * Used by the idempotency middleware and BullMQ. BullMQ requires
 * `maxRetriesPerRequest: null`, so we expose a dedicated factory for it.
 */

let client: Redis | null = null;

export function getRedis(): Redis {
  if (client) return client;
  const env = loadEnv();
  client = new Redis(env.REDIS_URL, { lazyConnect: false });
  return client;
}

/** BullMQ-compatible connection options. */
export function bullConnection(): RedisOptions {
  const env = loadEnv();
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
