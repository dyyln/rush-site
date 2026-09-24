"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { roomPath, type ServiceStatus } from "@rushsite/shared";
import { etaRange } from "@/components/play/eta";
import { queuedSince, useGlobalPlay, type GlobalMatch } from "@/components/play/playStore";
import { eligibleModes, modesLabel, partySizeOf, useSelectedModes } from "@/components/play/selectionStore";
import { useNow } from "@/components/play/useNow";
import { useTabTitle } from "@/components/play/useTabTitle";
import { useServiceStatus } from "@/components/stats/useServiceStatus";
import { SignInLink } from "@/components/ui/SignInLink";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { describeError } from "@/lib/errors";
import { mmss } from "@/lib/format";
import { useSession } from "@/lib/session";
import { getRealtime } from "@/lib/ws";
import styles from "./Dock.module.css";

const MATCH_LABEL: Record<NonNullable<GlobalMatch>["phase"], string> = {
  found: "Match found",
  veto: "Map veto",
  ready: "Server ready",
  live: "In match",
};

// Bottom of every page: server status on the left, what you are doing in the middle, and the one big action on the right.
// GO starts the queue for the modes picked on Play, the timer stops it, and a running match links back to its room
export function Dock() {
  const { user } = useSession();
  const pathname = usePathname();
  const play = useGlobalPlay();
  const selected = useSelectedModes();
  const service = useServiceStatus();
  const toast = useToast();
  const rt = getRealtime();

  useTabTitle(user ? play : { queue: null, match: null, party: null });

  // Play shows its own error toasts. Elsewhere the dock does, since it sent the queue request
  const onPlay = pathname === "/play";
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  useEffect(() => {
    if (!user) return;
    return rt.on("error", (e) => {
      if (onPlayRef.current) return;
      const copy = describeError(e);
      toast.push({ title: copy.title, body: copy.body, tone: "error" });
    });
  }, [rt, user?.steamId]);

  const since = queuedSince(play.queue);
  const match = play.match;
  const now = useNow(since !== null || match?.phase === "found" || play.queue?.state === "cooldown", 1000);

  if (pathname === "/banned") return null;

  const partySize = partySizeOf(play.party);
  const eligible = eligibleModes(selected, partySize, service);
  const isLeader = !play.party?.partyId || play.party.leaderSteamId === user?.steamId;
  const cooldownUntil = play.queue?.state === "cooldown" ? play.queue.cooldownUntil : null;
  const cooling = cooldownUntil !== null && (now === null || cooldownUntil > now);
  const matchOpen = match && (match.phase !== "found" || now === null || match.deadline > now);
  const room = matchOpen ? roomPath(match) : null;
  const inRoom = room !== null && (pathname === room || pathname === `/matches/${match!.matchId}`);

  function go() {
    if (eligible.length === 0) return;
    // Opponent filter is hidden for now, so every queue accepts any trust level
    if (!rt.send("queue_join", { modes: eligible, minTrust: "new" })) toast.push({ title: "Not connected", body: "Try again in a moment.", tone: "error" });
  }

  let label: string;
  let value: ReactNode;
  let action: ReactNode;

  if (!user) {
    label = "Free for CS2";
    value = "Sign in to queue";
    action = (
      <SignInLink plain className={styles.go}>
        Sign in
      </SignInLink>
    );
  } else if (matchOpen && room) {
    label = MATCH_LABEL[match.phase];
    value =
      match.phase === "found" && now !== null ? (
        <>
          Accept within <span className="mono">{mmss(Math.max(0, Math.ceil((match.deadline - now) / 1000)))}</span>
        </>
      ) : (
        "Your match is waiting"
      );
    action = inRoom ? null : (
      <Link href={room} className={cx(styles.go, styles.goMatch)}>
        {match.phase === "found" ? "Accept match" : "Return to match"}
      </Link>
    );
  } else if (since !== null) {
    const est = Math.max(0, ...(play.queue?.modes.map((m) => m.estimatedSec ?? 0) ?? []));
    const searching = play.queue?.modes.reduce((n, m) => n + (m.playersInQueue ?? 0), 0) ?? 0;
    label = "Searching";
    value = modesLabel(play.queue?.modes.map((m) => m.mode) ?? []);
    action = (
      <span className={styles.searching}>
        <span className={styles.timer}>
          <span className={cx(styles.timerValue, "mono")}>{now === null ? "--:--" : mmss((now - since) / 1000)}</span>
          <span className={styles.timerSub}>
            {est > 0 ? `Est. ${etaRange(est)}` : "Finding players"}
            {searching > 0 ? ` · ${searching} searching` : ""}
          </span>
        </span>
        <button type="button" className={styles.cancel} onClick={() => rt.send("queue_leave", {})}>
          Cancel
        </button>
      </span>
    );
  } else {
    label = cooling ? "Cooldown" : "Selected";
    value = eligible.length ? (
      modesLabel(eligible)
    ) : (
      <Link href="/play" className={styles.pick}>
        Pick a mode
      </Link>
    );
    action = cooling ? (
      <button type="button" className={styles.go} disabled>
        <span className={styles.goSmall}>
          Start in <span className="mono">{now === null ? "--:--" : mmss(Math.ceil((cooldownUntil - now) / 1000))}</span>
        </span>
      </button>
    ) : !isLeader ? (
      <button type="button" className={styles.go} disabled>
        <span className={styles.goSmall}>Leader starts</span>
      </button>
    ) : (
      <button type="button" className={styles.go} disabled={eligible.length === 0} onClick={go}>
        Go
      </button>
    );
  }

  return (
    <div className={styles.dock} role="region" aria-label="Queue">
      <div className={cx("container", styles.inner)}>
        <div className={styles.left}>
          <StatusPill status={service} />
          <span className={styles.state}>
            {/* Only the state word is announced. The value holds ticking countdowns */}
            <span className={styles.label} aria-live="polite">
              {label}
            </span>
            <span className={styles.value}>{value}</span>
          </span>
        </div>
        {action}
      </div>
    </div>
  );
}

// Server status in one word, linking to the status page. Was a footer link
function StatusPill({ status }: { status: ServiceStatus | null }) {
  const down = status?.modes.filter((m) => !m.available && m.reason !== "not_configured" && m.reason !== "disabled") ?? [];
  const updating = status?.regions.some((r) => r.updating) || down.some((m) => m.reason === "servers_updating");
  const tone = !status ? "unknown" : updating ? "warn" : down.length > 0 ? "down" : "up";
  const text = !status ? "Checking servers" : updating ? "Servers updating" : down.length > 0 ? "Servers limited" : "All servers up";
  return (
    <Link href="/status" className={styles.status} data-tone={tone}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.statusText}>{text}</span>
    </Link>
  );
}
