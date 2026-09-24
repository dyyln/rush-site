"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MODE_CONFIGS, MODES, roomPath, trustAtLeast, type Mode, type TrustLevel } from "@rushsite/shared";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PlaySkeleton } from "@/components/skeletons/PlaySkeleton";
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
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";
import { formatStat } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { TRUST_NAMES } from "@/lib/trust";
import { MODE_COPY, modeLabel } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { activeMatch, usePlay } from "@/lib/usePlay";
import { StartCountdown } from "@/components/play/StartCountdown";
import { cancelCopy, describeError, knownError } from "@/lib/errors";
import { loadLastModes, saveLastModes } from "@/components/play/lastModes";
import { COOLDOWN_EXPLAINER_FLAG, CooldownNote } from "./CooldownNote";
import { CooldownLine } from "./CooldownLine";
import styles from "./play.module.css";

const TRUST_OPTIONS: { value: TrustLevel; label: string }[] = [
  { value: "new", label: "Any" },
  { value: "verified", label: "Verified" },
  { value: "trusted", label: "Trusted" },
];

const MAX_PARTY = Math.max(...MODES.map((m) => MODE_CONFIGS[m].teamSize));

// Matches this tab already sent to their room. Coming back to Play then shows a link instead of bouncing
const routedToRoom = new Set<string>();

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
  const active = activeMatch(play.match);
  const inMatch = !!active;

  // The match room holds accept, veto, connect and the result. Play only sends the player there
  useEffect(() => {
    if (!active || !user || routedToRoom.has(active.matchId)) return;
    routedToRoom.add(active.matchId);
    router.push(roomPath(active));
  }, [active?.matchId, active?.slug, user?.steamId]);

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
          {active && user && (
            <Card tone="accent" eyebrow="You are in a match" title={modeLabelFor(play.match) ?? "Your match"}>
              <div className="stack">
                <p className="muted">Accept, veto, connect info and the result are all in the match room.</p>
                <p>
                  <ButtonLink href={roomPath(active)}>Open match room</ButtonLink>
                </p>
              </div>
            </Card>
          )}

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
                          className={`glass ${styles.mode} ${checked ? styles.checked : ""} ${reason ? styles.disabled : ""} ${locked ? styles.locked : ""} ${readOnly ? styles.readOnly : ""}`}
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

              <Card as="div" tone="flat" padded={false} className={styles.actionBar}>
                {user ? (
                  <>
                    {isLeader || queued ? (
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
                    {cooldown && play.queue.cooldownUntil && (
                      <CooldownLine until={play.queue.cooldownUntil} cooldown={play.queue.cooldown} />
                    )}
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
              </Card>
              {user && (
                <p id="queue-hint" className={styles.hint}>
                  {queued
                    ? isLeader
                      ? "Stop queue to change modes."
                      : "Any member can stop the queue. The leader starts it."
                    : !isLeader
                      ? "Leader starts the queue."
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
                modes={partySize < 2 ? [] : queued ? queuedModes : isLeader ? eligible : MODES.filter((m) => !disabledReason(m))}
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

    </div>
  );
}

// Mode of the active match when a message carried it
function modeLabelFor(m: ReturnType<typeof usePlay>["match"]): string | null {
  if (m.phase === "found") return modeLabel(m.found.mode);
  if (m.phase === "veto") return modeLabel(m.veto.mode);
  if (m.phase === "starting") return modeLabel(m.mode);
  if (m.phase === "ready") return m.veto ? modeLabel(m.veto.mode) : null;
  return null;
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
      <Card as="div" tone="flat" padded={false} className={styles.form}>
        <p className={styles.formLabel}>Last 5</p>
        <FormDots results={last.map((m) => ({ id: m.matchId, result: m.result }))} label="Last 5" />
      </Card>
    </section>
  );
}
