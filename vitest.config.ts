import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // Runs before any module loads so env (secrets, API keys) is deterministic.
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // CI enforces an 80% coverage floor (see .gitlab-ci.yml).
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
      exclude: [
        'test/**',
        'dist/**',
        '**/*.config.ts',
        // Type-only modules (no runtime code to cover).
        'src/types/**',
        'src/services/usdc/provider.interface.ts',
        // Thin I/O adapters requiring live infra (Redis/BullMQ/Fabric gRPC/TLS).
        'src/server.ts',
        'src/lib/redis.ts',
        'src/queue/worker.ts',
        'src/queue/queues.ts',
        'src/fabric/gateway.ts',
        'src/fabric/identity.ts',
      ],
    },
  },
});
