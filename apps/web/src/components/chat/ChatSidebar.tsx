"use client";

import { useSession } from "@/lib/session";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChatBody } from "./ChatBody";
import styles from "./ChatSidebar.module.css";

const OPEN_KEY = "rushsite:chat-open";
const DESKTOP_QUERY = "(min-width: 1024px)";

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

// Global chat in a sidebar on every page, so every page keeps the same width. Open by default on desktop, closed on mobile
export function ChatSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [ready, setReady] = useState(false);
  const [unread, setUnread] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const headingId = useId();
  const { user } = useSession();
  // Chat is for signed in players only
  const hidden = !user || (pathname?.startsWith("/banned") ?? false);

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

  const setOpenAndSave = (next: boolean) => {
    setOpen(next);
    if (desktop) writeOpen(next);
    requestAnimationFrame(() => (next ? inputRef.current?.focus() : toggleRef.current?.focus()));
  };

  // Escape closes the full screen panel on mobile
  useEffect(() => {
    if (!open || desktop) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog inside chat handles its own Escape
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setOpenAndSave(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, desktop]);

  if (hidden || !ready) return null;

  return (
    <>
      {!open && (
        <button ref={toggleRef} type="button" className={styles.toggle} aria-expanded={false} aria-controls={panelId} onClick={() => setOpenAndSave(true)}>
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
        <ChatBody open={open} onUnread={setUnread} inputRef={inputRef} />
      </aside>
    </>
  );
}
