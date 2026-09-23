export type FaceitUnavailableReason = "rate_limited" | "server_error" | "network" | "timeout" | "auth" | "bad_response"

// Thrown when FACEIT cannot give an answer. Callers should treat the signal as unknown, not negative.
export class FaceitUnavailableError extends Error {
  override readonly name = "FaceitUnavailableError"
  readonly reason: FaceitUnavailableReason
  readonly status?: number
  readonly retryAfterSeconds?: number

  constructor(
    message: string,
    opts: { reason: FaceitUnavailableReason; status?: number; retryAfterSeconds?: number; cause?: unknown },
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause })
    this.reason = opts.reason
    if (opts.status !== undefined) this.status = opts.status
    if (opts.retryAfterSeconds !== undefined) this.retryAfterSeconds = opts.retryAfterSeconds
  }
}

export function isFaceitUnavailableError(err: unknown): err is FaceitUnavailableError {
  return err instanceof FaceitUnavailableError
}
