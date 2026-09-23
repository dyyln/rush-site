// Plain copy for API error codes and match cancel reasons.
// Raw API messages are never shown to players. Unknown codes get the generic line.

export type ErrorCopy = { title: string; body: string };

const GENERIC: ErrorCopy = { title: "Something went wrong", body: "Try again in a moment. If it keeps happening, check server status." };

// Why a match was cancelled, and what happens to the player next
const CANCEL_COPY: Record<string, ErrorCopy> = {
  declined: { title: "Match cancelled", body: "Someone declined. If you accepted, you are back in the queue." },
  timeout: { title: "Match cancelled", body: "Someone did not accept in time. If you accepted, you are back in the queue." },
  no_server: { title: "No server free", body: "Every server is busy. You are back in the queue and will get the next free one." },
  server_start_failed: { title: "Server did not start", body: "We could not start your server. You are back in the queue." },
  unknown_map: { title: "Match cancelled", body: "The map could not be loaded. You are back in the queue." },
  server_never_ready: { title: "Server did not start", body: "The server never came up. Nobody loses rating. Start the queue again." },
  server_crashed: { title: "Server crashed", body: "The match was stopped and nobody loses rating. Start the queue again." },
  never_started: { title: "Match cancelled", body: "Not everyone joined in time. Nobody loses rating. Start the queue again." },
  mode_unavailable: { title: "Mode not open", body: "This mode stopped taking matches. Pick another mode or check server status." },
  mode_closed: { title: "Queue closed", body: "This mode was closed for now. Pick another mode or check server status." },
  admin: { title: "Match cancelled", body: "An admin cancelled this match. Nobody loses rating." },
  admin_cancelled: { title: "Match cancelled", body: "An admin cancelled this match. Nobody loses rating." },
};

const GENERIC_CANCEL: ErrorCopy = { title: "Match cancelled", body: "The match did not go ahead. Start the queue again when you are ready." };

export function cancelCopy(reason: string | null | undefined): ErrorCopy {
  return (reason && CANCEL_COPY[reason]) || GENERIC_CANCEL;
}

// Rejected requests. Values are functions so time based codes can fill in a countdown
const ERROR_COPY: Record<string, (ctx: ErrorContext) => ErrorCopy> = {
  cooldown: (c) => ({
    title: "On queue cooldown",
    body: c.until ? `You can queue again in ${formatWait(c.until - Date.now())}.` : "You can queue again when the cooldown ends.",
  }),
  rate_limited: (c) => ({
    title: "Slow down",
    body: c.retrySec ? `Too many actions at once. Try again in ${formatWait(c.retrySec * 1000)}.` : "Too many actions at once. Wait a few seconds and try again.",
  }),
  too_many_requests: () => ({ title: "Slow down", body: "Too many actions at once. Wait a few seconds and try again." }),
  no_server: () => CANCEL_COPY.no_server!,
  timeout: () => CANCEL_COPY.timeout!,
  server_crashed: () => CANCEL_COPY.server_crashed!,
  mode_unavailable: () => ({ title: "Mode not open yet", body: "That mode cannot queue right now. Pick another mode or check server status." }),
  mode_closed: () => ({ title: "Queue closed", body: "That mode is closed for now. Pick another mode or check server status." }),
  party_locked: () => ({ title: "Party is in a match", body: "Party changes open again when the match ends." }),
  party_full: () => ({ title: "Party is full", body: "Someone has to leave before another player can join." }),
  party_too_big: () => ({ title: "Party too big", body: "Pick a mode with room for your whole party." }),
  party_size: () => ({ title: "Party too big", body: "Pick a mode with room for your whole party." }),
  not_leader: () => ({ title: "Leader only", body: "Only your party leader can do that." }),
  in_match: () => ({ title: "Already in a match", body: "Finish or leave your current match first." }),
  already_queued: () => ({ title: "Already queued", body: "You are already searching. Stop the queue to change modes." }),
  not_queued: () => ({ title: "Not queued", body: "The queue had already stopped." }),
  banned: () => ({ title: "Account banned", body: "This account cannot play right now." }),
  unauthorized: () => ({ title: "Signed out", body: "Sign in again to keep playing." }),
  not_found: () => ({ title: "Not found", body: "It may have ended or been removed." }),
  bad_origin: () => ({ title: "Request blocked", body: "Reload the page and try again." }),
  internal: () => GENERIC,
  http_error: () => GENERIC,
};

export type ErrorContext = { until?: number; retrySec?: number };

export function errorCopy(code: string | null | undefined, ctx: ErrorContext = {}): ErrorCopy {
  const f = code ? ERROR_COPY[code] : undefined;
  return f ? f(ctx) : GENERIC;
}

// Pulls the code and any time hints out of a REST ApiError, a socket error payload or anything else
export function describeError(e: unknown, fallback?: Partial<ErrorCopy>): ErrorCopy {
  const o = (e && typeof e === "object" ? e : {}) as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof o.code === "string" ? o.code : null;
  const ctx = contextFrom(o.message, o.details);
  if (code && ERROR_COPY[code]) return errorCopy(code, ctx);
  return { title: fallback?.title ?? GENERIC.title, body: fallback?.body ?? GENERIC.body };
}

// True when the code has its own copy in this file
export function knownError(code: string | null | undefined): boolean {
  return !!code && !!ERROR_COPY[code];
}

function contextFrom(message: unknown, details: unknown): ErrorContext {
  const ctx: ErrorContext = {};
  const d = (details && typeof details === "object" ? details : {}) as { until?: unknown; retryAfter?: unknown };
  if (typeof d.until === "string" || typeof d.until === "number") {
    const t = typeof d.until === "number" ? d.until : Date.parse(d.until);
    if (Number.isFinite(t)) ctx.until = t;
  }
  if (typeof d.retryAfter === "number") ctx.retrySec = d.retryAfter;
  if (typeof message === "string") {
    // Only timestamps and numbers are read from the message. The text itself is never shown
    const iso = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/.exec(message)?.[0];
    if (iso && ctx.until === undefined && Number.isFinite(Date.parse(iso))) ctx.until = Date.parse(iso);
    const retry = /retry in (\d+)/.exec(message)?.[1];
    if (retry && ctx.retrySec === undefined) ctx.retrySec = Number(retry);
  }
  return ctx;
}

// "45 seconds", "3 minutes", "1 hour 20 minutes"
export function formatWait(ms: number): string {
  const sec = Math.max(1, Math.ceil(ms / 1000));
  if (sec < 60) return `${sec} second${sec === 1 ? "" : "s"}`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} minute${m === 1 ? "" : "s"}` : ""}`;
}
