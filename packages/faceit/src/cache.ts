type Entry<V> = { value: V; expiresAt: number }

export class TtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number,
  ) {}

  get(key: string): { hit: true; value: V } | { hit: false } {
    const entry = this.entries.get(key)
    if (!entry) return { hit: false }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return { hit: false }
    }
    return { hit: true, value: entry.value }
  }

  set(key: string, value: V): void {
    if (this.ttlMs <= 0) return
    this.entries.delete(key)
    if (this.entries.size >= this.maxEntries) {
      // Map keeps insertion order so the first key is the oldest.
      const oldest = this.entries.keys().next()
      if (!oldest.done) this.entries.delete(oldest.value)
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
