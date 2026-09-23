import { ServerMessageSchema, WsEnvelopeSchema, type ClientMessageType } from "@rushsite/shared";
import { isMock, wsUrl } from "./env";
import { Emitter, type ClientPayload, type ConnectionState, type Realtime } from "./ws-core";
import { MockRealtime } from "./ws-mock";

export type { AdminEvent, ConnectionState, Realtime } from "./ws-core";

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;

export class RealtimeClient extends Emitter implements Realtime {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  state: ConnectionState = "closed";

  constructor(private readonly url: string) {
    super();
  }

  connect() {
    this.wanted = true;
    if (this.ws || typeof window === "undefined") return;
    this.setState("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setState("open");
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onclose = () => {
      this.ws = null;
      this.setState("closed");
      if (this.wanted) this.scheduleReconnect();
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
    return this.sendRaw(type, payload);
  }

  sendRaw(type: string, payload: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type, payload, ts: Date.now() }));
    return true;
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

  // Exponential backoff with full jitter
  private scheduleReconnect() {
    const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** this.attempt);
    this.attempt++;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connect();
    }, Math.random() * cap);
  }

  private setState(s: ConnectionState) {
    this.state = s;
    this.emitState(s);
  }
}

const KNOWN = new Set(ServerMessageSchema.options.map((o) => o.shape.type.value as string));
function isKnownType(type: string): boolean {
  return KNOWN.has(type);
}

let singleton: Realtime | null = null;

export function getRealtime(): Realtime {
  singleton ??= isMock ? new MockRealtime() : new RealtimeClient(wsUrl);
  return singleton;
}
