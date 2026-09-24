"use client";

import { useId, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/Button";
import buttonStyles from "@/components/ui/Button.module.css";
import { cx } from "@/components/ui/cx";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import type { MatchDemo } from "@/lib/types";
import { DownloadIcon } from "./icons";
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
        // Focusable, so the reason shows on keyboard focus as well as hover
        <span className={styles.tipWrap}>
          <Button variant="secondary" icon={<DownloadIcon />} aria-disabled="true" aria-describedby={hintId} onClick={(e) => e.preventDefault()}>
            {label ?? "Download demo"}
          </Button>
          <span id={hintId} role="tooltip" className={styles.tip}>
            Not available yet. The demo uploads a few minutes after the match ends.
          </span>
        </span>
      )}
    </>
  );
}
