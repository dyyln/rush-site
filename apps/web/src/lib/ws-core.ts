import type { ClientMessage, ClientMessageType, ServerMessage, ServerMessageType } from "@rushsite/shared";

export type ConnectionState = "connecting" | "open" | "closed";

export type Handler<T extends ServerMessageType> = (payload: Extract<ServerMessage, { type: T }>["payload"], msg: Extract<ServerMessage, { type: T }>) => void;
type AnyHandler = (msg: ServerMessage) => void;
export type ClientPayload<T extends ClientMessageType> = Extract<ClientMessage, { type: T }>["payload"];

// Admin events are not in the shared schema yet. Shape agreed with the admin agent
export type AdminEvent = { kind: string; payload: unknown };

export function isAdminEvent(v: unknown): v is AdminEvent {
  return typeof v === "object" && v !== null && typeof (v as { kind?: unknown }).kind === "string";
}

export interface Realtime {
  readonly state: ConnectionState;
  connect(): void;
  close(): void;
  send<T extends ClientMessageType>(type: T, payload: ClientPayload<T>): boolean;
  on<T extends ServerMessageType>(type: T, handler: Handler<T>): () => void;
  onAny(handler: AnyHandler): () => void;
  onAdmin(handler: (e: AdminEvent) => void): () => void;
  // Message types outside the shared schema, delivered unvalidated
  onRaw(type: string, handler: (payload: unknown) => void): () => void;
  onState(handler: (s: ConnectionState) => void): () => void;
}

// Shared listener plumbing for the real and mock clients
export class Emitter {
  private handlers = new Map<string, Set<(p: unknown, m: ServerMessage) => void>>();
  private any = new Set<AnyHandler>();
  private stateHandlers = new Set<(s: ConnectionState) => void>();
  private raw = new Map<string, Set<(p: unknown) => void>>();
  private admin = new Set<(e: AdminEvent) => void>();

  on<T extends ServerMessageType>(type: T, handler: Handler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set();
    const h = handler as (p: unknown, m: ServerMessage) => void;
    set.add(h);
    this.handlers.set(type, set);
    return () => set.delete(h);
  }

  onAny(handler: AnyHandler): () => void {
    this.any.add(handler);
    return () => this.any.delete(handler);
  }

  onAdmin(handler: (e: AdminEvent) => void): () => void {
    this.admin.add(handler);
    return () => this.admin.delete(handler);
  }

  onRaw(type: string, handler: (payload: unknown) => void): () => void {
    const set = this.raw.get(type) ?? new Set();
    set.add(handler);
    this.raw.set(type, set);
    return () => set.delete(handler);
  }

  protected dispatchRaw(type: string, payload: unknown) {
    this.raw.get(type)?.forEach((h) => h(payload));
    if (type === "admin_event" && isAdminEvent(payload)) this.admin.forEach((h) => h(payload));
  }

  onState(handler: (s: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  protected dispatch(msg: ServerMessage) {
    this.handlers.get(msg.type)?.forEach((h) => h(msg.payload, msg));
    this.any.forEach((h) => h(msg));
  }

  protected emitState(s: ConnectionState) {
    this.stateHandlers.forEach((h) => h(s));
  }
}

