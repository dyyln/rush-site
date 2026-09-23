// Thrown for any failed DatHost call. status is 0 for network errors and timeouts.
export class DathostError extends Error {
  override readonly name = "DathostError"
  readonly status: number
  readonly body: string
  readonly method: string
  readonly path: string

  constructor(message: string, opts: { status: number; body?: string; method: string; path: string; cause?: unknown }) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.status = opts.status
    this.body = opts.body ?? ""
    this.method = opts.method
    this.path = opts.path
  }
}

export function isDathostError(err: unknown): err is DathostError {
  return err instanceof DathostError
}
