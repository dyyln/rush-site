"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CHAT_GLOBAL_CHANNEL, CHAT_MAX_LENGTH, TIERS, type ChatMessage, type ChatMuteStatus } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { SignInLink } from "@/components/ui/SignInLink";
import { useSession } from "@/lib/session";
import { useVisibleInterval } from "@/lib/useVisibleInterval";
import { getRealtime } from "@/lib/ws";
import { chatApi, chatError, mutedFrom } from "./chatApi";
import { ModerateDialog } from "./ModerateDialog";
import styles from "./ChatSidebar.module.css";

const OPEN_KEY = "rushsite:chat-open";
const DESKTOP_QUERY = "(min-width: 1024px)";
// Guests have no socket, so an open sidebar polls
const GUEST_POLL_MS = 15_000;
// Keeps memory flat on a tab left open all day
const KEEP_MESSAGES = 200;
const COUNTER_FROM = CHAT_MAX_LENGTH - 40;

function readOpen(): boolean | null {
  try {
    const v = window.localStorage.getItem(OPEN_KEY);
    return v === null ? null : v === "1";
  } catch {
    return null;
  }
}

function writeOpen(open: boolean) {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage blocked. The choice lasts for this page only
  }
}

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

function ChatIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 4h14v9H8l-4 3v-3H3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
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
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M5 0l5 5-5 5-5-5z" fill="currentColor" />
              </svg>
              <span className="visually-hidden">{tier} tier</span>
            </span>
          )}
          {m.author.trustLevel !== "new" && (
            <span className={styles.trust} title={`${m.author.trustLevel === "trusted" ? "Trusted" : "Verified"} player`}>
              {m.author.trustLevel === "trusted" ? "Trusted" : "Verified"}
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

// Global chat in a sidebar on every page. Open by default on desktop, closed on mobile
export function ChatSidebar() {
  const pathname = usePathname();
  const { user, loading: sessionLoading } = useSession();
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [olderDone, setOlderDone] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [muted, setMuted] = useState<ChatMuteStatus | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [moderating, setModerating] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const atBottom = useRef(true);
  const openRef = useRef(open);
  openRef.current = open;
  const panelId = useId();
  const headingId = useId();
  const counterId = useId();
  const signedIn = !!user;
  const hidden = pathname?.startsWith("/banned") ?? false;

  // Desktop remembers the last choice. Mobile always starts closed
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    const apply = () => {
      setDesktop(mq.matches);
      setOpen(mq.matches ? (readOpen() ?? true) : false);
    };
    apply();
    setReady(true);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Lets global CSS make room for the panel on desktop
  useEffect(() => {
    const html = document.documentElement;
    if (!ready || hidden) delete html.dataset.chat;
    else html.dataset.chat = open ? "open" : "rail";
    return () => {
      delete html.dataset.chat;
    };
  }, [open, ready, hidden]);

  const load = useCallback(async () => {
    try {
      const res = await chatApi.history();
      setMessages((cur) => merge(cur, res.messages));
      setMuted(res.me?.muted ?? null);
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
    if (sessionLoading || hidden) return;
    if (!open && !signedIn) return;
    void load();
  }, [sessionLoading, signedIn, open, hidden, load]);

  useVisibleInterval(() => void load(), GUEST_POLL_MS, open && !signedIn && !sessionLoading && !hidden);

  // Live messages for signed in users. A reconnect refetches to fill the gap
  useEffect(() => {
    if (!signedIn || hidden) return;
    const rt = getRealtime();
    rt.connect();
    let wasClosed = false;
    const offMsg = rt.on("chat_message", (m) => {
      if (m.channel !== CHAT_GLOBAL_CHANNEL) return;
      setMessages((cur) => merge(cur, [m]));
      if (!openRef.current && m.author.steamId !== user?.steamId) setUnread((n) => n + 1);
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
  }, [signedIn, hidden, user?.steamId, load]);

  // Sticks to the newest message unless the reader scrolled up
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  const setOpenAndSave = (next: boolean) => {
    setOpen(next);
    if (desktop) writeOpen(next);
    if (next) {
      atBottom.current = true;
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      requestAnimationFrame(() => toggleRef.current?.focus());
    }
  };

  // Escape closes the full screen panel on mobile
  useEffect(() => {
    if (!open || desktop) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !moderating) setOpenAndSave(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, desktop, moderating]);

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

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
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
      else setSendError(chatError(err));
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

  if (hidden || !ready) return null;

  const canModerate = !!user?.isAdmin;
  const left = CHAT_MAX_LENGTH - draft.length;

  return (
    <>
      {!open && (
        <button
          ref={toggleRef}
          type="button"
          className={styles.toggle}
          aria-expanded={false}
          aria-controls={panelId}
          onClick={() => setOpenAndSave(true)}
        >
          <ChatIcon />
          <span className={styles.toggleLabel}>Chat</span>
          {unread > 0 && (
            <span className={styles.unread}>
              {unread > 99 ? "99+" : unread}
              <span className="visually-hidden"> new messages</span>
            </span>
          )}
        </button>
      )}
      <aside id={panelId} className={styles.panel} aria-labelledby={headingId} hidden={!open}>
        <header className={styles.header}>
          <h2 id={headingId} className={styles.title}>
            Global chat
          </h2>
          <button type="button" className={styles.close} onClick={() => setOpenAndSave(false)} aria-expanded={true} aria-controls={panelId}>
            <CloseIcon />
            <span className="visually-hidden">Close chat</span>
          </button>
        </header>

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
              <label htmlFor={`${panelId}-input`} className="visually-hidden">
                Message
              </label>
              <textarea
                id={`${panelId}-input`}
                ref={inputRef}
                className={styles.input}
                rows={2}
                maxLength={CHAT_MAX_LENGTH}
                placeholder="Message global chat"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (sendError) setSendError(null);
                }}
                onKeyDown={onKeyDown}
                aria-describedby={draft.length >= COUNTER_FROM ? counterId : undefined}
                aria-invalid={sendError ? true : undefined}
              />
              <button type="submit" className={styles.send} disabled={sending || draft.trim().length === 0}>
                Send
              </button>
              {draft.length >= COUNTER_FROM && (
                <span id={counterId} className={styles.counter} data-low={left <= 10 || undefined}>
                  {left} characters left
                </span>
              )}
              {sendError && (
                <p className={styles.sendError} role="alert">
                  {sendError}
                </p>
              )}
            </form>
          )}
        </div>
      </aside>
      {canModerate && (
        <ModerateDialog
          message={moderating}
          onClose={() => setModerating(null)}
          onDeleted={(id) => setMessages((cur) => cur.filter((m) => m.id !== id))}
        />
      )}
    </>
  );
}
