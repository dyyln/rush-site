"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
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

export function DemoActions({ matchId, demo }: { matchId: string; demo?: MatchDemo }) {
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
      const fresh = await api.match(matchId);
      if (fresh.demo?.available && fresh.demo.url) window.location.assign(fresh.demo.url);
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
          <span>{fetching ? "Preparing" : "Download demo"}</span>
        </a>
      ) : (
        <Button variant="secondary" icon={<DownloadIcon />} disabled aria-describedby={hintId}>
          Download demo
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
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-labelledby={titleId}
          className={styles.popover}
          style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
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
        </div>
      )}
    </span>
  );
}
