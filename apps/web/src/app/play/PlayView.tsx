"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { isRushMode, isTestMode, MODE_CONFIGS, MODES, roomPath, TIERS, trustAtLeast, type Mode } from "@rushsite/shared";
import { PlaySkeleton } from "@/components/skeletons/PlaySkeleton";
import { ProfileNudge } from "@/components/profile/ProfileNudge";
import { readFlag, writeFlag } from "@/components/profile/flags";
import { FriendsCard } from "@/components/friends/FriendsCard";
import { ModeAvailabilityHint } from "@/components/stats/ModeAvailabilityHint";
import { offeredModes, useServiceStatus } from "@/components/stats/useServiceStatus";
import { Card } from "@/components/ui/Card";
import { PartySize } from "@/components/ui/PartySize";
import { Throbber } from "@/components/ui/Throbber";
import { TierChip } from "@/components/ui/TierChip";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/cx";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { trustProgressLine, type TrustStatus } from "@/lib/trust";
import { MODE_ART, MODE_COPY } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { activeMatch, usePlay } from "@/lib/usePlay";
import { mapPoolId } from "@/components/play/ModeMapPool";
import { setGlobalParty, useGlobalPlay } from "@/components/play/playStore";
import { modeBlockReason, partySizeOf, setSelectedModes, toggleSelectedMode, useSelectedModes } from "@/components/play/selectionStore";
import { cancelCopy, describeError } from "@/lib/errors";
import { useBackdrop } from "@/lib/useBackdrop";
import { COOLDOWN_EXPLAINER_FLAG, CooldownNote } from "./CooldownNote";
import { CooldownLine } from "./CooldownLine";
import styles from "./play.module.css";

// Play: the modes as picture tiles and friends on the right. The dock at the bottom of every page starts the queue
// for the picked ones, and the party sits in the top bar
export function PlayView() {
  const { user, loading } = useSession();
  const router = useRouter();
  const toast = useToast();
  const play = usePlay({
    onCancelled: (c) => {
      const copy = cancelCopy(c.reason);
      toast.push({ title: copy.title, body: copy.body, tone: "error", durationMs: 8000 });
    },
    onError: (e) => {
      const copy = describeError(e);
      toast.push({ title: copy.title, body: copy.body, tone: "error" });
    },
    onRemoved: (r) => {
      const names = r.modes.map((m) => MODE_COPY[m].label).join(" and ");
      toast.push({ title: `${names} queue closed`, body: `You were taken out of the ${names} queue.`, tone: "info", durationMs: 8000 });
    },
  });
  const global = useGlobalPlay();
  const selected = useSelectedModes();
  useBackdrop(selected);
  const profile = useAsync(() => (user ? api.profile(user.steamId) : Promise.resolve(null)), [user?.steamId]);
  const me = profile.data ?? null;
  const service = useServiceStatus();
  const offered = offeredModes(service);

  const queuedModes = play.queue.modes.map((m) => m.mode);
  const queued = play.queue.state === "queued" && queuedModes.length > 0;
  const party = global.party ?? play.party;
  const partySize = user ? partySizeOf(party) : 1;
  const isLeader = !party?.partyId || party.leaderSteamId === user?.steamId;
  const active = activeMatch(play.match);

  // The match room holds accept, veto, connect and the result. Play always sends the player there
  // Replace keeps Play out of the history so Back does not bounce into the room again
  useEffect(() => {
    if (!active || !user) return;
    router.replace(roomPath(active));
  }, [active?.matchId, active?.slug, user?.steamId]);

  // Mirror the live queue into the picker so it shows what is actually queued
  const queuedKey = queuedModes.join(",");
  useEffect(() => {
    if (queued) setSelectedModes(queuedModes);
  }, [queued, queuedKey]);

  // A result belongs to the match room. Play forgets it
  useEffect(() => {
    if (play.match.phase === "result") play.dismissMatch();
  }, [play.match.phase]);

  // A cooldown right after a match found means this player declined or let the window lapse
  const lastFound = useRef(0);
  const prevQueueState = useRef(play.queue.state);
  useEffect(() => {
    if (play.match.phase === "found") lastFound.current = Date.now();
  }, [play.match]);
  useEffect(() => {
    const prev = prevQueueState.current;
    prevQueueState.current = play.queue.state;
    const until = play.queue.cooldownUntil;
    if (play.queue.state !== "cooldown" || prev === "cooldown" || !until) return;
    if (Date.now() - lastFound.current > 120_000) return;
    if (play.match.phase === "found") play.dismissMatch();
    const explain = !readFlag(COOLDOWN_EXPLAINER_FLAG);
    if (explain) writeFlag(COOLDOWN_EXPLAINER_FLAG);
    const ref = { id: 0 };
    ref.id = toast.push({
      title: "Queue cooldown",
      body: <CooldownNote until={until} explain={explain} onDone={() => toast.dismiss(ref.id)} />,
      tone: "info",
      durationMs: explain ? 0 : 8000,
    });
    // Only queue transitions matter here
  }, [play.queue.state, play.queue.cooldownUntil]);

  // A friend's Join queue link lands here with ?modes=a,b&start=1
  const linked = useRef<{ modes: Mode[]; start: boolean } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const modes = (q.get("modes") ?? "").split(",").filter((m): m is Mode => (MODES as readonly string[]).includes(m));
    if (modes.length === 0) return;
    linked.current = { modes, start: q.get("start") === "1" };
    setSelectedModes(modes);
    window.history.replaceState(null, "", "/play");
  }, []);
  useEffect(() => {
    const l = linked.current;
    if (!l || !play.loaded || play.connection !== "open") return;
    linked.current = null;
    const ok = l.modes.filter((m) => !modeBlockReason(m, partySize, service));
    // Opponent filter is hidden for now, so every queue accepts any trust level
    if (l.start && isLeader && !queued && play.queue.state !== "cooldown" && !active && ok.length > 0) play.joinQueue(ok, "new");
  }, [play.loaded, play.connection]);

  if (loading) return <PlaySkeleton />;

  const readOnly = !user;
  const cooldown = play.queue.state === "cooldown";
  const locked = readOnly || queued || cooldown || !isLeader;
  // Rush is the headline mode, so it leads
  const ranked = offered.filter((m) => !isTestMode(m)).sort((a, b) => Number(isRushMode(b)) - Number(isRushMode(a)));
  const tests = offered.filter(isTestMode);

  const tile = (mode: Mode) => (
    <ModeTile
      key={mode}
      mode={mode}
      checked={!readOnly && selected.includes(mode)}
      reason={readOnly ? null : modeBlockReason(mode, partySize, service)}
      searching={queuedModes.includes(mode)}
      locked={locked}
      partySize={partySize}
      stats={play.stats?.modes.find((m) => m.mode === mode)}
      profile={user ? me : undefined}
    />
  );

  return (
    <div className={cx("container", styles.page)}>
      <h1 className="visually-hidden">Play</h1>
      <div className={styles.main}>
        <div className={styles.center}>
          {user && <VerifyLine trust={user.trust} />}

          <fieldset className={styles.picker} disabled={readOnly}>
            <legend className="visually-hidden">Modes</legend>
            <ul className={styles.tiles}>{ranked.map(tile)}</ul>
          </fieldset>

          {tests.length > 0 && (
            <details className={cx("glass", styles.tests)}>
              <summary className={styles.testsSummary}>
                <span className={styles.testsTitle}>Test queues</span>
                <span className={styles.testsNote}>Unrated, for trying new modes</span>
              </summary>
              <fieldset className={styles.picker} disabled={readOnly}>
                <legend className="visually-hidden">Test modes</legend>
                <ul className={styles.tiles}>{tests.map(tile)}</ul>
              </fieldset>
            </details>
          )}

          {cooldown && play.queue.cooldownUntil && <CooldownLine until={play.queue.cooldownUntil} cooldown={play.queue.cooldown} />}
          {user && !isLeader && (
            <p className={styles.hint}>
              {queued ? "Any member can cancel the queue. The leader starts it." : "The party leader picks the modes and starts the queue."}
            </p>
          )}
          <ModeAvailabilityHint status={service} />
          {user && <ProfileNudge trust={user.trust} enabled variant="line" />}
        </div>

        <aside className={cx("glass", styles.rail)} aria-label={user ? "Friends" : "How it works"}>
          {user ? (
            <FriendsCard onParty={setGlobalParty} canJoinQueue={partySize === 1 && !queued && !active} />
          ) : (
            <Card title="How it works" tone="flat">
              <ol className={styles.howTo}>
                <li>Sign in with Steam.</li>
                <li>Pick one or more modes and press Go. Friends can join your party.</li>
                <li>Accept the match, ban maps with your team, then join the server we start for you.</li>
              </ol>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

type TileProps = {
  mode: Mode;
  checked: boolean;
  reason: string | null;
  searching: boolean;
  locked: boolean;
  partySize: number;
  stats?: { playersInQueue: number; matchesInProgress: number };
  // undefined when signed out, null while loading
  profile?: Profile | null;
};

// One mode as a picture tile. A mode the party can't queue for is tinted, locked and says why
function ModeTile({ mode, checked, reason, searching, locked, partySize, stats, profile }: TileProps) {
  const copy = MODE_COPY[mode];
  const cfg = MODE_CONFIGS[mode];
  const size = cfg.teamSize;
  const off = !!reason;
  const on = checked && !off;
  const pool = cfg.maps.length === 1 ? `Map: ${cfg.maps[0]!.displayName}.` : `Map pool: ${cfg.maps.map((m) => m.displayName).join(", ")}.`;
  return (
    <li>
      <label className={cx(styles.tile, on && styles.on, off && styles.off, (locked || off) && styles.locked)}>
        <input
          type="checkbox"
          className="visually-hidden"
          checked={on}
          disabled={locked || off}
          onChange={() => toggleSelectedMode(mode)}
          aria-describedby={`mode-${mode}-reason mode-${mode}-stats ${mapPoolId(mode)}`}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={MODE_ART[mode]} alt="" className={styles.art} />
        <span className={styles.shade} aria-hidden="true" />
        <span className={styles.tileTop}>
          <span className={cx(styles.chip, off && partySize > size && styles.chipOver)}>
            <PartySize count={Math.min(partySize, size)} capacity={size} overflow={Math.max(0, partySize - size)} label={copy.players} />
            <span className={styles.format}>{copy.format}</span>
          </span>
          <span className={styles.tick} aria-hidden="true">
            {off ? <LockIcon /> : searching ? <Throbber /> : <TickIcon />}
          </span>
        </span>
        <span className={styles.tileBottom}>
          <span id={`mode-${mode}-reason`} className={reason ? styles.reason : "visually-hidden"}>
            {reason ?? ""}
          </span>
          <span className={styles.tileName}>
            <span className={styles.tileFormat}>{copy.format}</span> {copy.name}
          </span>
          <span id={mapPoolId(mode)} className="visually-hidden">
            {pool}
          </span>
          <span className={styles.tileFoot}>
            {profile !== undefined && <Standing profile={profile} mode={mode} />}
            <span id={`mode-${mode}-stats`} className={cx(styles.tileMeta, "mono")}>
              {stats ? (
                <>
                  <span className={styles.liveDot} aria-hidden="true" />
                  {stats.playersInQueue} searching · {stats.matchesInProgress} live
                </>
              ) : (
                " "
              )}
              {searching && <span className="visually-hidden">, you are searching</span>}
            </span>
          </span>
        </span>
      </label>
    </li>
  );
}

function TickIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16">
      <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function Standing({ profile, mode }: { profile: Profile | null; mode: Mode }) {
  if (!profile) return <span className={styles.standing}>{" "}</span>;
  if (isTestMode(mode)) return <span className={styles.standing}>Unrated</span>;
  const s = profile.modes.find((m) => m.mode === mode);
  if (!s || s.matches === 0) {
    return (
      <span className={styles.standing}>
        <TierChip unranked size="sm" link={false} />
      </span>
    );
  }
  return (
    <span className={styles.standing}>
      <TierChip tier={s.tier} rating={s.rating} rank={s.leaderboardRank} size="sm" link={false} />
      {/* The top tier's chip already shows the place */}
      {s.leaderboardRank && s.tier !== TIERS[TIERS.length - 1]!.id && <span className="mono">#{s.leaderboardRank}</span>}
    </span>
  );
}

// Get Verified as one line with a progress bar, until the player is Verified
function VerifyLine({ trust }: { trust: TrustStatus | undefined }) {
  if (!trust || trustAtLeast(trust.level, "verified")) return null;
  const counted = trust.requirements.find((r) => !r.met && r.progress)?.progress;
  const total = counted ? counted.required : trust.requirements.length;
  const current = counted ? counted.current : trust.requirements.filter((r) => r.met).length;
  return (
    <p className={cx("glass", styles.notice)}>
      <span className={styles.noticeTag}>Get Verified</span>
      <span>{trust.blockedBy ?? `${trustProgressLine(trust)}. Verified unlocks cups.`}</span>
      <span className={styles.progress} role="img" aria-label={`${current} of ${total}`}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} data-on={i < current || undefined} />
        ))}
      </span>
    </p>
  );
}
