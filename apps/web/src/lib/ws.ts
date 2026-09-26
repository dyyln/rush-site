import { ServerMessageSchema, WsEnvelopeSchema, type ClientMessageType } from "@rushsite/shared";
import { isMock, wsUrl } from "./env";
import { Emitter, type ClientPayload, type ConnectionState, type Realtime } from "./ws-core";
import { MockRealtime } from "./ws-mock";

export type { AdminEvent, ConnectionState, Realtime } from "./ws-core";

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;
// Spreads a mass reconnect after a deploy over a few seconds
const RECONNECT_JITTER_MS = 3_000;

// Close code the api uses when logout or a ban ends the session
export const CLOSE_SESSION_ENDED = 4001;

// Replayed after every reconnect because the server forgets them with the socket
type Subscription = { type: ClientMessageType; payload: unknown };

export class RealtimeClient extends Emitter implements Realtime {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  // Only a signed in session may open the socket
  private allowed = false;
  // Called when the api closes the socket because the session ended
  onSessionEnded: (() => void) | null = null;
  private readonly subscriptions = new Map<string, Subscription>();
  // The current page, sent again after every reconnect
  private page: ClientPayload<"page_view"> | null = null;
  state: ConnectionState = "closed";

  constructor(private readonly url: string) {
    super();
  }

  // Opens or drops the socket as the session comes and goes. Wanted connects wait for it
  setAllowed(on: boolean) {
    this.allowed = on;
    if (!on) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.ws?.close();
      this.ws = null;
    } else if (this.wanted) {
      this.connect();
    }
  }

  connect() {
    this.wanted = true;
    if (!this.allowed || this.ws || typeof window === "undefined") return;
    this.setState("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      for (const sub of this.subscriptions.values()) this.write(sub.type, sub.payload);
      if (this.page) this.write("page_view", this.page);
      this.setState("open");
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = (ev) => {
      if (this.ws === ws) this.ws = null;
      this.setState("closed");
      if (ev.code === CLOSE_SESSION_ENDED) {
        // No blind reconnect. The session decides whether to allow the socket again
        this.allowed = false;
        this.onSessionEnded?.();
        return;
      }
      if (this.wanted && this.allowed) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  close() {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }

  send<T extends ClientMessageType>(type: T, payload: ClientPayload<T>): boolean {
    this.track(type, payload);
    return this.write(type, payload);
  }

  private write(type: string, payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
    return true;
  }

  // Remembers subscribe_* messages so they survive a reconnect. unsubscribe_* forgets them
  private track(type: string, payload: unknown) {
    if (type === "page_view") {
      this.page = payload as ClientPayload<"page_view">;
      return;
    }
    const m = /^(un)?subscribe_(.+)$/.exec(type);
    if (!m) return;
    const key = `${m[2]}:${JSON.stringify(payload)}`;
    if (m[1]) this.subscriptions.delete(key);
    else this.subscriptions.set(key, { type: type as ClientMessageType, payload });
  }

  private handleMessage(raw: unknown) {
    if (typeof raw !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const env = WsEnvelopeSchema.safeParse(json);
    if (!env.success) return;
    this.dispatchRaw(env.data.type, env.data.payload);
    const parsed = ServerMessageSchema.safeParse(json);
    if (parsed.success) this.dispatch(parsed.data);
    else if (process.env.NODE_ENV !== "production" && isKnownType(env.data.type)) {
      console.warn("ws: invalid payload", json, parsed.error);
    }
  }

  // Exponential backoff with full jitter, plus up to 3 s more so a restarted server is not hit all at once
  private scheduleReconnect() {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, reconnectDelay(this.attempt));
    this.attempt++;
  }

  private setState(s: ConnectionState) {
    this.state = s;
    this.emitState(s);
  }
}

export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return random() * cap + random() * RECONNECT_JITTER_MS;
}

const KNOWN = new Set(ServerMessageSchema.options.map((o) => o.shape.type.value as string));
function isKnownType(type: string): boolean {
  return KNOWN.has(type);
}

let singleton: Realtime | null = null;
let allowed = false;
let sessionEnded: (() => void) | null = null;

// Drops the socket so the next connect uses the new session cookie
export function resetRealtime() {
  singleton?.close();
  singleton = null;
}

// Set by the session once GET /me succeeds, cleared when it fails or the user signs out
export function setRealtimeAllowed(on: boolean, onEnded?: () => void) {
  allowed = on;
  if (onEnded) sessionEnded = onEnded;
  if (singleton instanceof RealtimeClient) singleton.setAllowed(on);
}

export function getRealtime(): Realtime {
  if (!singleton) {
    if (isMock) singleton = new MockRealtime();
    else {
      const client = new RealtimeClient(wsUrl);
      client.onSessionEnded = () => sessionEnded?.();
      client.setAllowed(allowed);
      singleton = client;
    }
  }
  return singleton;
}

// The mock realtime client, or null outside mock mode
export function mockRealtime(): MockRealtime | null {
  const rt = getRealtime();
  return rt instanceof MockRealtime ? rt : null;
}
