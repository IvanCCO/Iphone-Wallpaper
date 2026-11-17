interface Entry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Cache em memória com TTL e "single-flight": chamadas concorrentes à mesma chave
 * compartilham uma única carga. Em serverless é best-effort (vive enquanto a instância viver).
 * Falhas não são cacheadas.
 */
export class TtlCache<T> {
  private entries = new Map<string, Entry<T>>();
  private inflight = new Map<string, Promise<T>>();

  constructor(private now: () => number = Date.now) {}

  async getOrLoad(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<{ value: T; hit: "hit" | "miss" | "coalesced" }> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) return { value: cached.value, hit: "hit" };

    const pending = this.inflight.get(key);
    if (pending) return { value: await pending, hit: "coalesced" };

    const promise = loader()
      .then((value) => {
        if (ttlMs > 0) this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return { value: await promise, hit: "miss" };
  }

  clear(): void {
    this.entries.clear();
  }
}
