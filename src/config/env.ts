import { z } from 'zod';

/**
 * Typed, validated environment loading.
 *
 * Fail fast: if a required variable is missing or malformed the process
 * refuses to boot rather than failing later mid-request. Secrets are read
 * here but never logged (see src/lib/logger.ts redaction).
 */

/**
 * Accept common boolean env spellings from platforms (Railway, etc.):
 * true/false, 1/0, yes/no — case-insensitive, trimmed.
 */
const booleanish = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((v, ctx) => {
    if (typeof v === 'boolean') return v;
    const raw = String(v).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(raw)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(raw)) return false;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Must be a boolean-ish value (true/false, 1/0, yes/no).',
    });
    return z.NEVER;
  });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(8443),

    // TLS at the Node process. On Railway / most PaaS, TLS terminates at the
    // edge — leave TLS_ENABLED=false and do NOT require app-level certs.
    TLS_ENABLED: booleanish.default(false),
    TLS_CERT_PATH: z.string().optional(),
    TLS_KEY_PATH: z.string().optional(),

    // Redis / idempotency
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

    // Rate limiting
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_WINDOW: z.string().default('1 minute'),

    // Supabase member JWT — TODO: confirm issuer/JWKS.
    SUPABASE_JWKS_URL: z.string().url().optional(),
    SUPABASE_JWT_ISSUER: z.string().optional(),
    SUPABASE_JWT_AUDIENCE: z.string().default('authenticated'),

    // Developer Portal OAuth — TODO: confirm issuer/JWKS.
    DEVELOPER_OAUTH_ISSUER: z.string().optional(),
    DEVELOPER_OAUTH_JWKS_URL: z.string().url().optional(),
    DEVELOPER_OAUTH_AUDIENCE: z.string().default('ledger-bridge'),

    // Server-to-server API keys (see parseApiKeys()).
    API_KEYS: z.string().default(''),

    // Inbound webhook HMAC secrets (one per source).
    WEBHOOK_SECRET_WEARABLE: z.string().min(1).default('dev-wearable-secret'),
    WEBHOOK_SECRET_AD_NETWORK: z.string().min(1).default('dev-adnetwork-secret'),
    WEBHOOK_SECRET_USDC: z.string().min(1).default('dev-usdc-secret'),

    // Fabric gateway client connection.
    FABRIC_GATEWAY_ENDPOINT: z.string().default('localhost:7051'),
    FABRIC_GATEWAY_HOST_ALIAS: z.string().optional(),
    FABRIC_MSP_ID: z.string().default('Org1MSP'),
    FABRIC_CHANNEL: z.string().default('centuries-channel'),
    FABRIC_CHAINCODE_NAME: z.string().default('centuries'),
    FABRIC_TLS_CERT_PATH: z.string().optional(),
    FABRIC_CERT_PATH: z.string().optional(),
    FABRIC_PRIVATE_KEY_PATH: z.string().optional(),

    // USDC settlement provider — CONFIRMED Circle Internet Group; swappable.
    // Do not hardcode real keys (provisioned in production).
    USDC_PROVIDER: z.enum(['circle', 'mock']).default('mock'),
    USDC_PROVIDER_API_BASE: z.string().default('https://api-sandbox.circle.com'),
    USDC_PROVIDER_API_KEY: z.string().optional(),
    // Circle wallet id holding USDC to disburse (source of transfers).
    USDC_SOURCE_WALLET_ID: z.string().optional(),
    USDC_SETTLEMENT_CHAIN: z.string().default('base-sepolia'),

    // Wearable aggregator — TODO: confirm vendor.
    WEARABLE_AGGREGATOR_API_BASE: z.string().optional(),
    WEARABLE_AGGREGATOR_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Production may terminate TLS at the edge (Railway, ingress, etc.).
    // Do NOT require TLS_ENABLED=true at the Node process. Only require cert
    // paths when the app itself is configured to serve HTTPS.
    if (env.TLS_ENABLED && (!env.TLS_CERT_PATH || !env.TLS_KEY_PATH)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TLS_CERT_PATH'],
        message: 'TLS_CERT_PATH and TLS_KEY_PATH are required when TLS_ENABLED=true.',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export interface ApiKeyRecord {
  keyId: string;
  /** SHA-256 hex digest of the raw key. Raw keys are never stored. */
  sha256: string;
  scopes: string[];
}

/**
 * Parse the API_KEYS env var into structured records.
 * Format: comma-separated `keyId:sha256hex:scopeA|scopeB` entries.
 */
export function parseApiKeys(raw: string): ApiKeyRecord[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      // Split only on the first two colons: scope names (e.g. "rewards:read")
      // themselves contain colons, so we can't naively split(':').
      const firstColon = entry.indexOf(':');
      const secondColon = entry.indexOf(':', firstColon + 1);
      if (firstColon < 0 || secondColon < 0) {
        throw new Error(`Malformed API_KEYS entry: "${entry}"`);
      }
      const keyId = entry.slice(0, firstColon);
      const sha256 = entry.slice(firstColon + 1, secondColon);
      const scopesRaw = entry.slice(secondColon + 1);
      if (!keyId || !sha256) {
        throw new Error(`Malformed API_KEYS entry: "${entry}"`);
      }
      return {
        keyId,
        sha256: sha256.toLowerCase(),
        scopes: scopesRaw.split('|').map((s) => s.trim()).filter(Boolean),
      };
    });
}

let cached: (Env & { apiKeys: ApiKeyRecord[] }) | null = null;

/** Load and validate environment once, then cache it. */
export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
): Env & { apiKeys: ApiKeyRecord[] } {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  cached = { ...parsed.data, apiKeys: parseApiKeys(parsed.data.API_KEYS) };
  return cached;
}

/** Test-only: clear the cached env so a fresh set can be loaded. */
export function resetEnvCache(): void {
  cached = null;
}
