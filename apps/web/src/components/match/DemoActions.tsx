"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { CheckIcon, useCopyFeedback } from "@/components/ui/CopyButton";
import { cx } from "@/components/ui/cx";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { MatchDemo } from "@/lib/types";
import { CopyIcon, DownloadIcon, PlayIcon } from "./icons";
import styles from "./MatchActions.module.css";

// The file name CS2 expects after playdemo, taken from the presigned url path
export function demoFileName(url: string | undefined, matchId: string): string {
  let base = "";
  try {
    if (url) base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    base = "";
  }
  return (base || `${matchId}.dem`).replace(/\.dem$/i, "");
}

const EXPIRY_MARGIN_MS = 15_000;

// mapNumber picks one map of a series. Its link is refreshed from maps[] instead of the top level demo
export function DemoActions({ matchId, demo, mapNumber, label }: { matchId: string; demo?: MatchDemo; mapNumber?: number; label?: string }) {
  const toast = useToast();
  const [fetching, setFetching] = useState(false);
  const hintId = useId();
  const available = !!demo?.available && !!demo.url;
  const file = demoFileName(demo?.url, matchId);

  // Presigned links last ten minutes. A stale one is refreshed before download
  const download = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (fetching) {
      e.preventDefault();
      return;
    }
    if (!demo?.expiresAt || new Date(demo.expiresAt).getTime() - EXPIRY_MARGIN_MS > Date.now()) return;
    e.preventDefault();
    setFetching(true);
    try {
      const got = await api.match(matchId);
      const fresh = mapNumber === undefined ? got.demo : got.maps?.find((m) => m.mapNumber === mapNumber)?.demo;
      if (fresh?.available && fresh.url) window.location.assign(fresh.url);
      else toast.push({ title: "Demo is no longer available", tone: "error" });
    } catch {
      toast.push({ title: "Could not refresh the demo link", tone: "error" });
    } finally {
      setFetching(false);
    }
  };

  return (
    <>
      {available ? (
        <a
          href={demo!.url}
          download={`${file}.dem`}
          rel="noopener"
          onClick={download}
          aria-busy={fetching || undefined}
          className={cx(buttonStyles.button, buttonStyles.secondary)}
        >
          <DownloadIcon />
          <span>{fetching ? "Preparing" : (label ?? "Download demo")}</span>
        </a>
      ) : (
        <Button variant="secondary" icon={<DownloadIcon />} disabled aria-describedby={hintId}>
          {label ?? "Download demo"}
        </Button>
      )}
      <WatchPopover file={file} disabled={!available} hintId={available ? undefined : hintId} />
      {!available && (
        <p id={hintId} className={styles.hint}>
          Demo not available yet. It uploads a few minutes after the match ends.
        </p>
      )}
    </>
  );
}

function WatchPopover({ file, disabled, hintId }: { file: string; disabled: boolean; hintId?: string }) {
  const toast = useToast();
  const copyFeedback = useCopyFeedback();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const command = `playdemo ${file}`;

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    const p = panelRef.current;
    if (!b || !p) return;
    const vw = document.documentElement.clientWidth;
    const width = Math.min(360, vw - 32);
    const left = Math.max(16, Math.min(b.left, vw - width - 16));
    setPos({ top: b.bottom + 8, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // The panel is portalled out of the page flow, so focus moves into it on open
  const placed = pos !== null;
  useEffect(() => {
    if (open && placed) panelRef.current?.focus({ preventScroll: true });
  }, [open, placed]);

  // Tabbing off either end closes the panel and resumes from the button, as if it sat right after it
  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !panelRef.current || !btnRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])");
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey ? active === panelRef.current || active === first : active === last || !last) {
      if (e.shiftKey) e.preventDefault();
      btnRef.current.focus();
      setOpen(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        btnRef.current?.focus();
      }
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  const copy = async () => {
    if (!(await copyFeedback.copy(command))) toast.push({ title: "Could not copy", body: "Select the command and copy it by hand.", tone: "error" });
  };

  return (
    <span className={styles.popWrap}>
      <button
        ref={btnRef}
        type="button"
        className={cx(buttonStyles.button, buttonStyles.secondary)}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={hintId}
        onClick={() => setOpen((v) => !v)}
      >
        <PlayIcon />
        <span>Watch in CS2</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cx("glass", styles.popover)}
            style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
            onKeyDown={onPanelKey}
          >
            <h3 id={titleId} className={styles.popTitle}>
              Watch in CS2
            </h3>
            <ol className={styles.steps}>
              <li>Download the demo.</li>
              <li>
                Move <code className="mono">{file}.dem</code> into <code className="mono">game/csgo</code> inside your CS2
                install folder.
              </li>
              <li>Open the console in CS2 and run:</li>
            </ol>
            <div className={styles.command}>
              <code className="mono">{command}</code>
              <Button
                variant="ghost"
                className={cx(styles.copyBtn, copyFeedback.copied && buttonStyles.copied)}
                icon={copyFeedback.copied ? <CheckIcon /> : <CopyIcon />}
                onClick={copy}
              >
                <span aria-live="polite">{copyFeedback.copied ? "Copied" : <span className="visually-hidden">Copy command</span>}</span>
              </Button>
            </div>
            <p className={styles.note}>Enable the developer console in CS2 settings under Game if it does not open.</p>
          </div>,
          document.body,
        )}
    </span>
  );
}
