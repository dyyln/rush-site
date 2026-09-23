import type { FastifyBaseLogger } from "fastify"

export type LoopStat = { lastMs: number | null; maxMs: number | null; runs: number }

// Pass timings per background loop in this process. Only the instance holding a loop's lock records it
export class LoopMetrics {
  private readonly stats = new Map<string, LoopStat>()

  constructor(private readonly log?: FastifyBaseLogger) {}

  record(name: string, ms: number, lockTtlMs: number, extra: Record<string, unknown> = {}): void {
    const cur = this.stats.get(name) ?? { lastMs: null, maxMs: null, runs: 0 }
    const rounded = Math.round(ms)
    this.stats.set(name, { lastMs: rounded, maxMs: Math.max(cur.maxMs ?? 0, rounded), runs: cur.runs + 1 })
    const fields = { loop: name, ms: rounded, lockTtlMs, ...extra }
    if (ms > lockTtlMs / 2) this.log?.warn(fields, "loop pass took more than half its lock ttl")
    else this.log?.debug(fields, "loop pass")
  }

  // Wraps a pass so its duration is recorded
  async time<T>(name: string, lockTtlMs: number, fn: () => Promise<T>, extra?: (r: T) => Record<string, unknown>): Promise<T> {
    const t0 = performance.now()
    const out = await fn()
    this.record(name, performance.now() - t0, lockTtlMs, extra?.(out))
    return out
  }

  snapshot(names: string[]): Record<string, { lastMs: number | null; maxMs: number | null }> {
    return Object.fromEntries(
      names.map((n) => {
        const s = this.stats.get(n)
        return [n, { lastMs: s?.lastMs ?? null, maxMs: s?.maxMs ?? null }]
      }),
    )
  }
}
