"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { CHAT_GLOBAL_CHANNEL, CHAT_MAX_LENGTH, TIERS, type ChatMessage, type ChatMuteStatus, type TierId } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { SignInLink } from "@/components/ui/SignInLink";
import { TierEmblem } from "@/components/ui/TierEmblem";
import { useSession } from "@/lib/session";
import { useVisibleInterval } from "@/lib/useVisibleInterval";
import { getRealtime } from "@/lib/ws";
import { chatApi, chatError, mutedFrom, refusalFrom, refusalText, type Refusal } from "./chatApi";
import { ModerateDialog } from "./ModerateDialog";
import styles from "./ChatSidebar.module.css";

// Guests have no socket, so open chat polls
const GUEST_POLL_MS = 15_000;
// Keeps memory flat on a tab left open all day
const KEEP_MESSAGES = 200;
const COUNTER_FROM = CHAT_MAX_LENGTH - 40;

// Adds new messages, drops duplicates and keeps time order
function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  const all = [...byId.values()].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return all.length > KEEP_MESSAGES ? all.slice(all.length - KEEP_MESSAGES) : all;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const fullFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function muteLine(m: ChatMuteStatus): string {
  const until = m.until ? `until ${fullFmt.format(new Date(m.until))}` : "until an admin lifts it";
  return `You are muted in chat ${until}${m.reason ? `. Reason: ${m.reason}` : ""}.`;
}

function tierName(tier: string): string | null {
  return TIERS.find((t) => t.id === tier)?.displayName ?? null;
}

function MessageRow({ message: m, canModerate, onModerate }: { message: ChatMessage; canModerate: boolean; onModerate: () => void }) {
  const tier = m.author.tier === "unranked" ? null : tierName(m.author.tier);
  const at = new Date(m.createdAt);
  return (
    <li className={styles.message}>
      <Avatar name={m.author.displayName} src={m.author.avatarUrl} size="sm" />
      <div className={styles.messageMain}>
        <div className={styles.meta}>
          <Link href={`/profile/${m.author.steamId}`} className={styles.name}>
            {m.author.displayName}
          </Link>
          {m.author.admin && <Badge tone="accent">Admin</Badge>}
          {tier && (
            <span className={styles.tier} data-tier={m.author.tier} title={`${tier} tier`}>
              <TierEmblem tier={m.author.tier as TierId} size={14} />
              <span className="visually-hidden">{tier} tier</span>
            </span>
          )}
          <time className={styles.time} dateTime={m.createdAt} title={fullFmt.format(at)}>
            {timeFmt.format(at)}
          </time>
        </div>
        <p className={styles.body}>{m.body}</p>
      </div>
      {canModerate && (
        <button type="button" className={styles.modButton} onClick={onModerate} aria-label={`Moderate message from ${m.author.displayName}`}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="3" r="1.4" fill="currentColor" />
            <circle cx="8" cy="8" r="1.4" fill="currentColor" />
            <circle cx="8" cy="13" r="1.4" fill="currentColor" />
          </svg>
        </button>
      )}
    </li>
  );
}

type ChatBodyProps = {
  // Messages are on screen. Closed chat still listens so it can count unread
  open: boolean;
  // New messages from others while closed. Reset to 0 on open
  onUnread?: (count: number) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
};

// Global chat: message list and composer, shown in the chat sidebar
export function ChatBody({ open, onUnread, inputRef: givenInput, className }: ChatBodyProps) {
  const { user, loading: sessionLoading } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [olderDone, setOlderDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [muted, setMuted] = useState<ChatMuteStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<(Refusal & { announce: string }) | null>(null);
  const [slowModeSec, setSlowModeSec] = useState(0);
  // Re-renders the countdown each second
  const [, setTick] = useState(0);
  const [moderating, setModerating] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const ownInput = useRef<HTMLTextAreaElement>(null);
  const inputRef = givenInput ?? ownInput;
  const atBottom = useRef(true);
  const openRef = useRef(open);
  openRef.current = open;
  const unread = useRef(0);
  const onUnreadRef = useRef(onUnread);
  onUnreadRef.current = onUnread;
  const inputId = useId();
  const counterId = useId();
  const signedIn = !!user;

  const load = useCallback(async () => {
    try {
      const res = await chatApi.history();
      setMessages((cur) => merge(cur, res.messages));
      setMuted(res.me?.muted ?? null);
      setSlowModeSec(res.slowModeSec ?? 0);
      setLoadError(null);
      if (res.messages.length === 0) setOlderDone(true);
    } catch (e) {
      setLoadError(chatError(e));
    } finally {
      setLoaded(true);
    }
  }, []);

  // First load waits for the session so mute status comes with it
  useEffect(() => {
    if (sessionLoading) return;
    if (!open && !signedIn) return;
    void load();
  }, [sessionLoading, signedIn, open, load]);

  useVisibleInterval(() => void load(), GUEST_POLL_MS, open && !signedIn && !sessionLoading);

  // Live messages for signed in users. A reconnect refetches to fill the gap
  useEffect(() => {
    if (!signedIn) return;
    const rt = getRealtime();
    rt.connect();
    let wasClosed = false;
    const offMsg = rt.on("chat_message", (m) => {
      if (m.channel !== CHAT_GLOBAL_CHANNEL) return;
      setMessages((cur) => merge(cur, [m]));
      if (!openRef.current && m.author.steamId !== user?.steamId) onUnreadRef.current?.(++unread.current);
    });
    const offDel = rt.on("chat_deleted", (d) => {
      if (d.channel !== CHAT_GLOBAL_CHANNEL) return;
      setMessages((cur) => cur.filter((m) => m.id !== d.id));
    });
    const offState = rt.onState((s) => {
      if (s === "closed") wasClosed = true;
      else if (s === "open" && wasClosed) {
        wasClosed = false;
        void load();
      }
    });
    return () => {
      offMsg();
      offDel();
      offState();
    };
  }, [signedIn, user?.steamId, load]);

  // Opening jumps to the newest message and clears the unread count
  useEffect(() => {
    if (!open) return;
    atBottom.current = true;
    unread.current = 0;
    onUnreadRef.current?.(0);
  }, [open]);

  // Sticks to the newest message unless the reader scrolled up
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  async function loadOlder() {
    const first = messages[0];
    if (!first) return;
    setLoadingOlder(true);
    atBottom.current = false;
    try {
      const res = await chatApi.history(first.createdAt);
      if (res.messages.length === 0) setOlderDone(true);
      setMessages((cur) => merge(res.messages, cur));
    } catch (e) {
      setLoadError(chatError(e));
    } finally {
      setLoadingOlder(false);
    }
  }

  // Counts a timed refusal down and clears it when the wait is over
  const waitUntil = sendError?.until ?? null;
  useEffect(() => {
    if (waitUntil === null) return;
    const timer = setInterval(() => {
      if (Date.now() >= waitUntil) setSendError(null);
      else setTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [waitUntil]);
  const waiting = waitUntil !== null && waitUntil > Date.now();

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending || waiting) return;
    setSending(true);
    setSendError(null);
    try {
      const m = await chatApi.post(body);
      atBottom.current = true;
      setMessages((cur) => merge(cur, [m]));
      setDraft("");
    } catch (err) {
      const mute = mutedFrom(err);
      if (mute) setMuted(mute);
      else {
        const r = refusalFrom(err);
        setSendError({ ...r, announce: refusalText(r) });
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  const canModerate = !!user?.isAdmin;
  const left = CHAT_MAX_LENGTH - draft.length;

  return (
    <div className={`${styles.bodyWrap} ${className ?? ""}`}>
      <ol
        ref={listRef}
        className={styles.list}
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {loaded && messages.length > 0 && !olderDone && (
          <li className={styles.older}>
            <button type="button" className={styles.olderButton} onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? "Loading" : "Load older messages"}
            </button>
          </li>
        )}
        {!loaded && <li className={styles.empty}>Loading chat</li>}
        {loaded && messages.length === 0 && !loadError && <li className={styles.empty}>No messages yet. Say hello.</li>}
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} canModerate={canModerate} onModerate={() => setModerating(m)} />
        ))}
      </ol>
      {loadError && (
        <p className={styles.error} role="alert">
          {loadError}
        </p>
      )}

      <div className={styles.footer}>
        {!signedIn ? (
          <div className={styles.guest}>
            <p className={styles.note}>Sign in to join the conversation.</p>
            <SignInLink variant="secondary" />
          </div>
        ) : muted ? (
          <p className={styles.note} role="status">
            {muteLine(muted)}
          </p>
        ) : (
          <form className={styles.composer} onSubmit={send}>
            <label htmlFor={inputId} className="visually-hidden">
              Message
            </label>
            <textarea
              id={inputId}
              ref={inputRef}
              className={styles.input}
              rows={2}
              maxLength={CHAT_MAX_LENGTH}
              placeholder="Message global chat"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                // Timed refusals stay up so the countdown is not lost while typing
                if (sendError && sendError.until === null) setSendError(null);
              }}
              onKeyDown={onKeyDown}
              aria-describedby={draft.length >= COUNTER_FROM ? counterId : undefined}
              aria-invalid={sendError ? true : undefined}
            />
            <button type="submit" className={styles.send} disabled={sending || waiting || draft.trim().length === 0}>
              Send
            </button>
            {draft.length >= COUNTER_FROM && (
              <span id={counterId} className={styles.counter} data-low={left <= 10 || undefined}>
                {left} characters left
              </span>
            )}
            {sendError && (
              <>
                <p className={styles.sendError} data-wait={sendError.until !== null || undefined} aria-hidden="true">
                  {refusalText(sendError)}
                </p>
                {/* Announced once. The visible line ticks every second */}
                <span className="visually-hidden" role="alert">
                  {sendError.announce}
                </span>
              </>
            )}
            {slowModeSec > 0 && !sendError && <p className={styles.slowNote}>Slow mode is on. One message every {slowModeSec}s.</p>}
          </form>
        )}
      </div>
      {canModerate && (
        <ModerateDialog message={moderating} onClose={() => setModerating(null)} onDeleted={(id) => setMessages((cur) => cur.filter((m) => m.id !== id))} />
      )}
    </div>
  );
}
