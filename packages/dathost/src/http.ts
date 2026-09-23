import { DathostError } from "./errors.js"
import type { FetchLike, FetchResponseLike } from "./types.js"

export const DATHOST_DEFAULT_BASE_URL = "https://dathost.com/api/0.1"

export type HttpOptions = {
  email: string
  password: string
  baseUrl?: string
  fetch?: FetchLike
  maxRetries?: number
  retryBaseMs?: number
  retryMaxMs?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>
  form?: Record<string, string | number | boolean | Blob | undefined>
  // Statuses that count as success besides 2xx
  okStatuses?: number[]
  // Non idempotent calls only retry on 429 so we never create two clones
  idempotent?: boolean
}

export type HttpClient = {
  request(method: string, path: string, opts?: RequestOptions): Promise<FetchResponseLike>
  json<T>(method: string, path: string, opts?: RequestOptions): Promise<T>
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// DatHost uses HTTP Basic auth with the account email and password.
export function basicAuthHeader(email: string, password: string): string {
  if (!email || !password) throw new Error("DatHost email and password are required")
  if (email.includes(":")) throw new Error("DatHost email must not contain a colon")
  return "Basic " + Buffer.from(`${email}:${password}`, "utf8").toString("base64")
}

function retryAfterMs(res: FetchResponseLike): number | undefined {
  const raw = res.headers.get("retry-after")
  if (!raw) return undefined
  const secs = Number(raw)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(raw)
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now())
}

export function createHttpClient(opts: HttpOptions): HttpClient {
  const auth = basicAuthHeader(opts.email, opts.password)
  const baseUrl = (opts.baseUrl ?? DATHOST_DEFAULT_BASE_URL).replace(/\/+$/, "")
  const doFetch: FetchLike = opts.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const maxRetries = opts.maxRetries ?? 4
  const retryBaseMs = opts.retryBaseMs ?? 500
  const retryMaxMs = opts.retryMaxMs ?? 15_000
  const timeoutMs = opts.timeoutMs ?? 60_000
  const sleep = opts.sleep ?? defaultSleep

  function buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(baseUrl + path)
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    return url.toString()
  }

  function buildForm(form: NonNullable<RequestOptions["form"]>, filename: string): FormData {
    const fd = new FormData()
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined) continue
      if (v instanceof Blob) fd.set(k, v, filename)
      else fd.set(k, String(v))
    }
    return fd
  }

  async function request(method: string, path: string, ro: RequestOptions = {}): Promise<FetchResponseLike> {
    const url = buildUrl(path, ro.query)
    const idempotent = ro.idempotent ?? true
    const filename = path.split("/").pop() || "file"
    for (let attempt = 0; ; attempt++) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      let res: FetchResponseLike
      try {
        res = await doFetch(url, {
          method,
          headers: { Authorization: auth, Accept: "application/json" },
          ...(ro.form ? { body: buildForm(ro.form, filename) } : {}),
          signal: ac.signal,
        })
      } catch (err) {
        clearTimeout(timer)
        if (idempotent && attempt < maxRetries) {
          await sleep(backoff(attempt))
          continue
        }
        throw new DathostError(`DatHost ${method} ${path} failed: ${(err as Error)?.message ?? err}`, {
          status: 0,
          method,
          path,
          cause: err,
        })
      }
      clearTimeout(timer)
      if (res.ok || ro.okStatuses?.includes(res.status)) return res

      const retryable = res.status === 429 || (idempotent && res.status >= 500)
      if (retryable && attempt < maxRetries) {
        const wait = res.status === 429 ? (retryAfterMs(res) ?? backoff(attempt)) : backoff(attempt)
        await sleep(Math.min(wait, retryMaxMs))
        continue
      }
      const body = await res.text().catch(() => "")
      throw new DathostError(`DatHost ${method} ${path} returned ${res.status}`, {
        status: res.status,
        body,
        method,
        path,
      })
    }
  }

  function backoff(attempt: number): number {
    const exp = retryBaseMs * 2 ** attempt
    const jitter = Math.random() * retryBaseMs
    return Math.min(exp + jitter, retryMaxMs)
  }

  return {
    request,
    async json<T>(method: string, path: string, ro?: RequestOptions): Promise<T> {
      const res = await request(method, path, ro)
      const text = await res.text()
      if (!text) return undefined as T
      try {
        return JSON.parse(text) as T
      } catch (err) {
        throw new DathostError(`DatHost ${method} ${path} returned invalid JSON`, {
          status: res.status,
          body: text,
          method,
          path,
          cause: err,
        })
      }
    },
  }
}
