"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MODE_CONFIGS, MODES, trustAtLeast, type Mode, type ServerReadyPayload, type TrustLevel, type VetoStatePayload } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CopyButton } from "@/components/ui/CopyButton";
import { PlaySkeleton } from "@/components/skeletons/PlaySkeleton";
import { ConnectSteps, type ConnectStep } from "@/components/match/ConnectSteps";
import { Modal } from "@/components/ui/Modal";
import { PartyPanel } from "@/components/ui/PartyPanel";
import { GetVerifiedCard } from "@/components/trust/GetVerifiedCard";
import { ProfileNudge } from "@/components/profile/ProfileNudge";
import { readFlag, writeFlag } from "@/components/profile/flags";
import { InvitePopover } from "@/components/party/InvitePopover";
import { FriendsCard } from "@/components/friends/FriendsCard";
import { PartySize } from "@/components/ui/PartySize";
import { QueueStatus } from "@/components/ui/QueueStatus";
import { ModeAvailabilityHint } from "@/components/stats/ModeAvailabilityHint";
import { ModeCardWarning } from "@/components/stats/ModeCardWarning";
import { modeUnavailable, useServiceStatus } from "@/components/stats/useServiceStatus";
import { Throbber } from "@/components/ui/Throbber";
import { SignInLink } from "@/components/ui/SignInLink";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StatTile } from "@/components/ui/StatTile";
import { FormDots } from "@/components/ui/FormDots";
import { TierChip } from "@/components/ui/TierChip";
import { Timer } from "@/components/ui/Timer";
import { useToast } from "@/components/ui/Toast";
import { VetoBoard } from "@/components/ui/VetoBoard";
import { ApiError, api } from "@/lib/api";
import { formatStat } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { TRUST_NAMES } from "@/lib/trust";
import { MODE_COPY, mapName, modeLabel } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { usePlay, type Warmup } from "@/lib/usePlay";
import { StartCountdown } from "@/components/play/StartCountdown";
import { VetoSummary } from "@/components/play/VetoSummary";
import { ResultCard } from "@/components/play/ResultCard";
import { cancelCopy, describeError, knownError } from "@/lib/errors";
import { loadLastModes, saveLastModes } from "@/components/play/lastModes";
import { COOLDOWN_EXPLAINER_FLAG, CooldownNote } from "./CooldownNote";
import styles from "./play.module.css";

const TRUST_OPTIONS: { value: TrustLevel; label: string }[] = [
  { value: "new", label: "Any" },
  { value: "verified", label: "Verified" },
  { value: "trusted", label: "Trusted" },
];

const MAX_PARTY = Math.max(...MODES.map((m) => MODE_CONFIGS[m].teamSize));

export function PlayView() {
  const { user, loading } = useSession();
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
  });
  const [selected, setSelected] = useState<Mode[]>([]);
  const [minTrust, setMinTrust] = useState<TrustLevel>("new");
  useEffect(() => {
    if (user?.settings?.minTrust) setMinTrust(user.settings.minTrust);
  }, [user?.settings?.minTrust]);

  async function changeMinTrust(v: TrustLevel) {
    const prev = minTrust;
    setMinTrust(v);
    try {
      await api.updateSettings({ minTrust: v });
    } catch {
      setMinTrust(prev);
      toast.push({ title: "Could not save the setting", tone: "error" });
    }
  }
  const [origin, setOrigin] = useState("");
  const profile = useAsync(() => (user ? api.profile(user.steamId) : Promise.resolve(null)), [user?.steamId]);
  const me = profile.data ?? null;
  // Members without a level yet count as new
  const memberTrust = (play.party?.members ?? []).filter((m) => m.steamId !== user?.steamId).map((m) => m.trustLevel ?? "new");
  // The lowest trust in the party caps the opponent filter
  const trustCap = useMemo(() => {
    const own: TrustLevel = user?.trust?.level ?? user?.trustLevel ?? "new";
    let level = own;
    for (const t of memberTrust) if (!trustAtLeast(t, level)) level = t;
    // True when the viewer is the one holding the cap down
    return { level, own: level === own };
  }, [user, memberTrust]);
  // A stored preference above the cap falls back to the highest allowed
  const effectiveMinTrust: TrustLevel = trustAtLeast(trustCap.level, minTrust) ? minTrust : trustCap.level;

  useEffect(() => setOrigin(window.location.origin), []);

  const service = useServiceStatus();

  // Drop modes the status page reports as unavailable from the selection
  useEffect(() => {
    if (!service) return;
    setSelected((sel) => {
      const next = sel.filter((m) => !modeUnavailable(service, m));
      return next.length === sel.length ? sel : next;
    });
  }, [service]);

  const queuedModes = useMemo(() => play.queue.modes.map((m) => m.mode), [play.queue.modes]);
  const queued = play.queue.state === "queued" && queuedModes.length > 0;
  // Signed out viewers see the cards as a solo player
  const partySize = user ? Math.max(1, play.party?.members.length ?? 1) : 1;
  const isLeader = !play.party?.partyId || play.party.leaderSteamId === user?.steamId;
  const inMatch = play.match.phase !== "none" && play.match.phase !== "result";

  // Mirror the live queue into the picker so it shows what is actually queued
  useEffect(() => {
    if (queued) setSelected(queuedModes);
  }, [queued, queuedModes]);

  // Remember the queued modes for Play again, and restore them after a reload
  useEffect(() => {
    if (queued) saveLastModes(queuedModes);
  }, [queued, queuedModes]);
  useEffect(() => {
    const last = loadLastModes();
    if (last.length > 0) setSelected((s) => (s.length === 0 ? last : s));
  }, []);
  const playAgain = useRef<() => void>(() => {});

  // Starting a new queue clears the last result card
  useEffect(() => {
    if (queued && play.match.phase === "result") play.dismissMatch();
  }, [queued, play.match.phase]);

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

  function disabledReason(mode: Mode): string | null {
    const size = MODE_CONFIGS[mode].teamSize;
    if (partySize > size) return `Party too big. ${MODE_COPY[mode].label} fits ${size === 1 ? "1 player" : `${size} players`}`;
    const down = modeUnavailable(service, mode);
    if (down) return `${down}. See server status below`;
    return null;
  }

  function toggle(mode: Mode) {
    setSelected((s) => (s.includes(mode) ? s.filter((m) => m !== mode) : [...s, mode]));
  }

  const eligible = selected.filter((m) => !disabledReason(m));
  const cooldown = play.queue.state === "cooldown";
  const locked = queued || cooldown;

  function start() {
    if (eligible.length === 0) return;
    if (!play.joinQueue(eligible, effectiveMinTrust)) toast.push({ title: "Not connected", body: "Try again in a moment.", tone: "error" });
  }
  playAgain.current = () => {
    if (queued || inMatch) return;
    if (cooldown) toast.push({ title: "On cooldown", body: "Start the queue again when it ends.", tone: "info" });
    else if (eligible.length === 0) toast.push({ title: "Pick a mode", tone: "info" });
    else start();
  };

  // A friend's Join queue link lands here with ?modes=a,b&start=1
  const linked = useRef<{ modes: Mode[]; start: boolean } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const modes = (q.get("modes") ?? "").split(",").filter((m): m is Mode => (MODES as readonly string[]).includes(m));
    if (modes.length === 0) return;
    linked.current = { modes, start: q.get("start") === "1" };
    setSelected(modes);
    window.history.replaceState(null, "", "/play");
  }, []);
  useEffect(() => {
    const l = linked.current;
    if (!l || !play.loaded || play.connection !== "open") return;
    linked.current = null;
    const ok = l.modes.filter((m) => !disabledReason(m));
    if (l.start && isLeader && !locked && !inMatch && ok.length > 0) play.joinQueue(ok, effectiveMinTrust);
  }, [play.loaded, play.connection]);

  async function createParty() {
    try {
      play.setParty(await api.party.create());
    } catch (e) {
      partyError(e, "Could not create a party");
    }
  }

  // Party changes are refused while the party is in a match
  function partyError(e: unknown, title: string) {
    const known = e instanceof ApiError && knownError(e.code);
    const copy = describeError(e, { title, body: "Try again in a moment." });
    toast.push({ title: known ? copy.title : title, body: copy.body, tone: "error" });
  }

  async function leaveParty() {
    try {
      await api.party.leave();
      play.setParty(null);
    } catch (e) {
      partyError(e, "Could not leave the party");
    }
  }

  if (loading) return <PlaySkeleton />;

  const found = play.match.phase === "found" ? play.match : null;
  const result = play.match.phase === "result" ? play.match : null;
  const inviteUrl = play.party?.inviteCode && origin ? `${origin}/invite/${play.party.inviteCode}` : null;
  async function ensureInvite(): Promise<string | null> {
    const p = await api.party.create();
    play.setParty(p);
    return p.inviteCode ? `${window.location.origin}/invite/${p.inviteCode}` : null;
  }
  const readOnly = !user;

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Play</h1>
          <p>{user ? "Pick your modes." : "Sign in with Steam to queue. These are the modes you can play."}</p>
        </div>
      </header>

      <div className="grid-2">
        <div className="stack">
          {result && user && (
            <ResultCard
              result={result.result}
              mapId={result.mapId}
              veto={result.veto}
              mySteamId={user.steamId}
              onQueueAgain={
                isLeader
                  ? () => {
                      play.dismissMatch();
                      playAgain.current();
                    }
                  : undefined
              }
              onDismiss={play.dismissMatch}
            />
          )}

          {play.match.phase === "veto" && user && (
            <Card tone="accent">
              <VetoBoard
                mode={play.match.veto.mode}
                state={play.match.veto.state}
                mySteamId={user.steamId}
                stepDeadline={play.match.veto.stepDeadline}
                onVote={play.vote}
              />
            </Card>
          )}

          {play.match.phase === "ready" && (
            <ServerReady
              server={play.match.server}
              mode={play.match.veto?.mode ?? null}
              veto={play.match.veto}
              mySteamId={user?.steamId ?? ""}
              warmup={play.warmup?.matchId === play.match.server.matchId ? play.warmup : null}
            />
          )}
          {play.match.phase === "starting" && <ServerReady server={null} mode={play.match.mode} step={play.match.status === "starting" ? "starting" : "allocating"} />}

          {!inMatch && (
            <>
              <fieldset className={styles.picker} disabled={locked || readOnly}>
                <legend className={styles.legend}>Modes</legend>
                <ul className={styles.modes}>
                  {MODES.map((mode) => {
                    const reason = disabledReason(mode);
                    const checked = !readOnly && selected.includes(mode) && !reason;
                    const q = play.queue.modes.find((m) => m.mode === mode);
                    const st = play.stats?.modes.find((m) => m.mode === mode);
                    const copy = MODE_COPY[mode];
                    return (
                      <li key={mode}>
                        <label
                          className={`${styles.mode} ${checked ? styles.checked : ""} ${reason ? styles.disabled : ""} ${locked ? styles.locked : ""} ${readOnly ? styles.readOnly : ""}`}
                        >
                          <input
                            type="checkbox"
                            className="visually-hidden"
                            checked={checked}
                            disabled={readOnly || !!reason || !isLeader || locked}
                            onChange={() => toggle(mode)}
                            aria-describedby={`mode-${mode}-desc mode-${mode}-reason mode-${mode}-stats`}
                          />
                          <span className={styles.modeTop}>
                            <span className={styles.modeName}>
                              {copy.label}
                              <span className={styles.format}>
                                <PartySize
                                  count={Math.min(partySize, MODE_CONFIGS[mode].teamSize)}
                                  capacity={MODE_CONFIGS[mode].teamSize}
                                  overflow={Math.max(0, partySize - MODE_CONFIGS[mode].teamSize)}
                                  label={copy.players}
                                />
                              </span>
                            </span>
                            {modeUnavailable(service, mode) && !q ? (
                              <ModeCardWarning />
                            ) : readOnly ? null : (
                              <span className={styles.check} aria-hidden="true">
                                {q ? (
                                  <Throbber />
                                ) : (
                                  <svg viewBox="0 0 16 16" width="14" height="14">
                                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                )}
                              </span>
                            )}
                          </span>
                          <span id={`mode-${mode}-desc`} className={styles.modeBlurb}>
                            {copy.blurb}
                          </span>
                          <span id={`mode-${mode}-reason`} className={styles.reason}>
                            {reason ?? ""}
                          </span>
                          {user && <Standing profile={me} mode={mode} />}
                          <span id={`mode-${mode}-stats`} className={`${styles.stats} mono`}>
                            {st ? `${st.playersInQueue} in queue · ${st.matchesInProgress} in progress` : "\u00a0"}
                            {q && <span className="visually-hidden">, you are searching</span>}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>

              <div className={styles.actionBar}>
                {user ? (
                  <>
                    {isLeader ? (
                      <Button
                        size="lg"
                        variant={queued ? "danger" : "primary"}
                        className={styles.queueButton}
                        onClick={queued ? () => play.leaveQueue() : start}
                        disabled={!queued && (eligible.length === 0 || cooldown)}
                        aria-describedby="queue-hint"
                      >
                        {queued ? "Stop queue" : cooldown && play.queue.cooldownUntil ? <StartCountdown until={play.queue.cooldownUntil} /> : "Start queue"}
                      </Button>
                    ) : null}
                    <QueueStatus status={play.queue} connection={play.connection} minTrust={effectiveMinTrust} />
                    <SegmentedControl
                      label="Opponents"
                      value={effectiveMinTrust}
                      onChange={changeMinTrust}
                      disabled={locked}
                      options={TRUST_OPTIONS.map((o) => {
                        const allowed = trustAtLeast(trustCap.level, o.value);
                        const why = trustCap.own ? `Reach ${TRUST_NAMES[o.value]} to use this` : `A party member needs ${TRUST_NAMES[o.value]} to use this`;
                        return { ...o, disabled: !allowed, title: allowed ? undefined : why };
                      })}
                    />
                  </>
                ) : (
                  <>
                    <SignInLink size="lg" className={styles.queueButton} />
                    <p className={styles.hint}>Free. Sign in with your Steam account, pick modes, and we hand you a server to join.</p>
                  </>
                )}
              </div>
              {user && (
                <p id="queue-hint" className={styles.hint}>
                  {!isLeader
                    ? "Leader starts the queue."
                    : queued
                      ? "Stop queue to change modes."
                      : cooldown
                        ? "On cooldown."
                        : eligible.length === 0
                          ? "Pick a mode."
                          : ""}
                </p>
              )}

              <ModeAvailabilityHint status={service} />

              {user && <ProfileNudge trust={user.trust} enabled variant="line" />}

              {user && <GetVerifiedCard trust={user.trust} />}

              {me && <YourStats profile={me} />}
            </>
          )}
        </div>

        <aside className="stack" aria-label={user ? "Party" : "How it works"}>
          {user ? (
            <>
              <PartyPanel
                party={play.party}
                mySteamId={user.steamId}
                me={{ steamId: user.steamId, displayName: user.displayName, avatarUrl: user.avatarUrl }}
                maxSize={MAX_PARTY}
                inviteUrl={inviteUrl}
                onCreate={createParty}
                onLeave={play.party && play.party.members.length > 1 ? leaveParty : undefined}
                onKick={async (id) => {
                  try {
                    await api.party.kick(id);
                    play.setParty((p) => p && { ...p, members: p.members.filter((m) => m.steamId !== id) });
                  } catch (e) {
                    partyError(e, "Could not remove player");
                  }
                }}
                onMakeLeader={async (id) => {
                  try {
                    await api.party.setLeader(id);
                    play.setParty((p) => p && { ...p, leaderSteamId: id });
                  } catch (e) {
                    partyError(e, "Could not change the leader");
                  }
                }}
                onRotateInvite={async () => {
                  try {
                    const next = await api.party.rotateInvite();
                    play.setParty((p) => p && { ...p, inviteCode: next.inviteCode });
                  } catch (e) {
                    partyError(e, "Could not make a new link");
                  }
                }}
                locked={queued || inMatch}
                renderInvite={(close, anchor) => (
                  <InvitePopover
                    inviteUrl={inviteUrl}
                    ensureInvite={ensureInvite}
                    onParty={play.setParty}
                    onClose={close}
                    returnFocus={anchor}
                  />
                )}
              />
              <FriendsCard inviteUrl={inviteUrl} ensureInvite={ensureInvite} onParty={play.setParty} canJoinQueue={partySize === 1 && !locked && !inMatch} />
            </>
          ) : (
            <Card title="How it works" tone="raised">
              <ol className={styles.howTo}>
                <li>Sign in with Steam.</li>
                <li>Pick one or more modes and start the queue. Friends can join your party.</li>
                <li>Accept the match, ban maps with your team, then join the server we start for you.</li>
              </ol>
            </Card>
          )}
        </aside>
      </div>

      <Modal
        open={!!found && !!user}
        blocking
        title="Match found"
        footer={
          found && !found.responded ? (
            <>
              <Button variant="ghost" onClick={() => play.respond(false)}>
                Decline
              </Button>
              <Button onClick={() => play.respond(true)} data-autofocus>
                Accept
              </Button>
            </>
          ) : undefined
        }
      >
        {found && (
          <div className={styles.found}>
            <Timer until={found.found.acceptDeadline} totalSec={found.found.acceptWindowSec} size="lg" label="Time to accept" />
            <div>
              <p className={styles.foundMode}>{modeLabel(found.found.mode)}</p>
              {(() => {
                const mine = me?.modes.find((m) => m.mode === found.found.mode);
                return mine && mine.matches > 0 ? <TierChip tier={mine.tier} rating={mine.rating} size="sm" link={false} /> : null;
              })()}
              <p className="muted" aria-live="polite">
                {found.found.accepted} of {found.found.required} accepted
              </p>
              <ol className={styles.pips} aria-hidden="true">
                {Array.from({ length: found.found.required }, (_, i) => (
                  <li key={i} className={i < found.found.accepted ? styles.pipOn : undefined} />
                ))}
              </ol>
              {found.responded && <p className={styles.waiting}>Accepted. Waiting for others.</p>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

type ServerReadyProps = {
  server: ServerReadyPayload | null;
  mode: Mode | null;
  veto?: VetoStatePayload | null;
  mySteamId?: string;
  warmup?: Warmup | null;
};

function ServerReady({ server, mode, veto, mySteamId, warmup, step = "allocating" }: ServerReadyProps & { step?: ConnectStep }) {
  if (!server) {
    return (
      <Card tone="accent" eyebrow={step === "starting" ? "Starting server" : "Allocating server"} title={mode ? modeLabel(mode) : "Your match"}>
        <ConnectSteps step={step} />
      </Card>
    );
  }
  // Older payloads only had the connect string
  const password = server.password || /password\s+(\S+)/.exec(server.connect)?.[1];
  const steamUrl = `steam://connect/${server.ip}:${server.port}${password ? `/${encodeURIComponent(password)}` : ""}`;
  const map = mode ? mapName(mode, server.mapId) : server.mapId;

  return (
    <Card tone="accent" eyebrow="Connect now" title={`Server ready on ${map}`}>
      <div className="stack">
        <p className="muted">Join the server now. If you do not connect in time you forfeit the match and lose rating.</p>
        {veto && mySteamId && <VetoSummary mode={veto.mode} state={veto.state} mySteamId={mySteamId} />}
        <ConnectSteps step="waiting" connected={warmup?.connected} expected={warmup?.expected} />
        <label htmlFor="connect-string" className="visually-hidden">
          Console connect command
        </label>
        <input id="connect-string" className={`${styles.connect} mono`} value={server.connect} readOnly onFocus={(e) => e.currentTarget.select()} />
        <div className="row">
          <CopyButton variant="primary" text={server.connect}>
            Copy connect
          </CopyButton>
          <a className={`${styles.steamLink} ${styles.steamLinkSecondary}`} href={steamUrl}>
            Launch CS2
          </a>
        </div>
      </div>
    </Card>
  );
}

function Standing({ profile, mode }: { profile: Profile | null; mode: Mode }) {
  if (!profile) return <span className={styles.standing}>{"\u00a0"}</span>;
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
      <TierChip tier={s.tier} rating={s.rating} size="sm" link={false} />
      {s.leaderboardRank && <span className={`${styles.rank} mono`}>#{s.leaderboardRank}</span>}
    </span>
  );
}

function YourStats({ profile }: { profile: Profile }) {
  const modes = profile.modes.filter((m) => m.matches > 0);
  const matches = modes.reduce((n, m) => n + m.matches, 0);
  const wins = modes.reduce((n, m) => n + m.wins, 0);
  const weighted = (f: (m: Profile["modes"][number]) => number) =>
    matches > 0 ? modes.reduce((n, m) => n + f(m) * m.matches, 0) / matches : 0;
  const last = profile.recentMatches.slice(0, 5);

  return (
    <section aria-labelledby="your-stats" className={styles.yourStats}>
      <h2 id="your-stats" className="visually-hidden">
        Your stats
      </h2>
      <StatTile size="sm" label="Win rate" value={formatStat(matches ? wins / matches : null, "pct", matches)} />
      <StatTile size="sm" label="Headshot" value={formatStat(weighted((m) => m.headshotPct), "pct", matches)} />
      <StatTile size="sm" label="K/D" value={formatStat(weighted((m) => m.kd), "kd", matches)} />
      <StatTile size="sm" label="Matches" value={matches} />
      <div className={styles.form}>
        <p className={styles.formLabel}>Last 5</p>
        <FormDots results={last.map((m) => ({ id: m.matchId, result: m.result }))} label="Last 5" />
      </div>
    </section>
  );
}
