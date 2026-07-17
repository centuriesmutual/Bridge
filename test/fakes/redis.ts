/**
 * Minimal in-memory Redis fake implementing just what the idempotency
 * middleware uses: SET with EX/NX, GET, DEL, QUIT.
 */
export function createFakeRedis() {
  const store = new Map<string, string>();
  return {
    async set(key: string, value: string, ..._args: unknown[]): Promise<'OK' | null> {
      const nx = _args.includes('NX');
      if (nx && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async get(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async del(key: string): Promise<number> {
      return store.delete(key) ? 1 : 0;
    },
    async quit(): Promise<void> {
      store.clear();
    },
    _store: store,
  };
}
