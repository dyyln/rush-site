"use client";

import { useEffect, useMemo, useState } from "react";
import { MODE_CONFIGS, MODES, type Mode, type ServerReadyPayload } from "@rushsite/shared";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { PartyPanel } from "@/components/ui/PartyPanel";
import { InvitePopover } from "@/components/party/InvitePopover";
import { FriendsCard } from "@/components/friends/FriendsCard";
import { RematchButton } from "@/components/challenges/RematchButton";
import { PartySize } from "@/components/ui/PartySize";
import { QueueStatus } from "@/components/ui/QueueStatus";
import { ModeAvailabilityHint } from "@/components/stats/ModeAvailabilityHint";
import { ModeCardWarning } from "@/components/stats/ModeCardWarning";
import { modeUnavailable, useServiceStatus } from "@/components/stats/useServiceStatus";
import { Throbber } from "@/components/ui/Throbber";
import { SignInLink } from "@/components/ui/SignInLink";
import { StatTile } from "@/components/ui/StatTile";
import { TierChip } from "@/components/ui/TierChip";
import { Timer } from "@/components/ui/Timer";
import { useToast } from "@/components/ui/Toast";
import { VetoBoard } from "@/components/ui/VetoBoard";
import { api } from "@/lib/api";
import { formatStat, signed } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { MODE_COPY, mapName, modeLabel } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { usePlay } from "@/lib/usePlay";
import styles from "./play.module.css";

const MAX_PARTY = Math.max(...MODES.map((m) => MODE_CONFIGS[m].teamSize));

export function PlayView() {
  const { user, loading } = useSession();
  const toast = useToast();
  const play = usePlay({
    onCancelled: (c) => toast.push({ title: "Match cancelled", body: c.reason, tone: "error" }),
    onError: (e) => toast.push({ title: "Something went wrong", body: e.message, tone: "error" }),
  });
  const [selected, setSelected] = useState<Mode[]>([]);
  const [origin, setOrigin] = useState("");
  const profile = useAsync(() => (user ? api.profile(user.steamId) : Promise.resolve(null)), [user?.steamId]);
  const me = profile.data ?? null;

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
  const partySize = Math.max(1, play.party?.members.length ?? 1);
  const isLeader = !play.party?.partyId || play.party.leaderSteamId === user?.steamId;
  const inMatch = play.match.phase !== "none" && play.match.phase !== "result";

  // Mirror the live queue into the picker so it shows what is actually queued
  useEffect(() => {
    if (queued) setSelected(queuedModes);
  }, [queued, queuedModes]);

  useEffect(() => {
    if (play.match.phase === "result") {
      const r = play.match.result;
      const change = r.ratingChanges.find((c) => c.steamId === user?.steamId);
      toast.push({
        title: r.status === "abandoned" ? "Match abandoned" : `${modeLabel(r.mode)} match finished`,
        body: (
          <>
            {change && (
              <span className={styles.change}>
                <TierChip tier={change.tierAfter} rating={change.after} size="sm" />
                <span className={`mono ${change.after >= change.before ? styles.up : styles.down}`}>{signed(change.after - change.before)}</span>
              </span>
            )}
            {r.status === "completed" && <RematchButton matchId={r.matchId} mode={r.mode} />}
          </>
        ),
        tone: r.status === "abandoned" ? "error" : "success",
        durationMs: r.status === "completed" ? 20_000 : undefined,
      });
    }
  }, [play.match, toast, user?.steamId]);

  function disabledReason(mode: Mode): string | null {
    const size = MODE_CONFIGS[mode].teamSize;
    if (partySize > size) return `Party of ${partySize} is too big for ${MODE_COPY[mode].players}`;
    const down = modeUnavailable(service, mode);
    if (down) return `${MODE_COPY[mode].label} unavailable: ${down}`;
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
    if (!play.joinQueue(eligible)) toast.push({ title: "Not connected", body: "Try again in a moment.", tone: "error" });
  }

  async function createParty() {
    try {
      play.setParty(await api.party.create());
    } catch {
      toast.push({ title: "Could not create a party", tone: "error" });
    }
  }

  async function leaveParty() {
    try {
      await api.party.leave();
      play.setParty(null);
    } catch {
      toast.push({ title: "Could not leave the party", tone: "error" });
    }
  }

  if (!loading && !user) {
    return (
      <div className="container page">
        <Card title="Sign in to play" tone="raised">
          <p className="muted">Sign in with Steam to queue.</p>
          <div className={styles.signIn}>
            <SignInLink />
          </div>
        </Card>
      </div>
    );
  }

  const found = play.match.phase === "found" ? play.match : null;
  const inviteUrl = play.party?.inviteCode && origin ? `${origin}/invite/${play.party.inviteCode}` : null;
  async function ensureInvite(): Promise<string | null> {
    const p = await api.party.create();
    play.setParty(p);
    return p.inviteCode ? `${window.location.origin}/invite/${p.inviteCode}` : null;
  }

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Play</h1>
          <p>Pick your modes.</p>
        </div>
      </header>

      <div className="grid-2">
        <div className="stack">
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

          {play.match.phase === "ready" && <ServerReady server={play.match.server} mode={play.match.veto?.mode ?? null} />}
          {play.match.phase === "starting" && <ServerReady server={null} mode={play.match.mode} />}

          {!inMatch && (
            <>
              <fieldset className={styles.picker} disabled={locked}>
                <legend className={styles.legend}>Modes</legend>
                <ul className={styles.modes}>
                  {MODES.map((mode) => {
                    const reason = disabledReason(mode);
                    const checked = selected.includes(mode) && !reason;
                    const q = play.queue.modes.find((m) => m.mode === mode);
                    const st = play.stats?.modes.find((m) => m.mode === mode);
                    const copy = MODE_COPY[mode];
                    return (
                      <li key={mode}>
                        <label
                          className={`${styles.mode} ${checked ? styles.checked : ""} ${reason ? styles.disabled : ""} ${locked ? styles.locked : ""}`}
                          title={reason ?? undefined}
                        >
                          <input
                            type="checkbox"
                            className="visually-hidden"
                            checked={checked}
                            disabled={!!reason || !isLeader || locked}
                            onChange={() => toggle(mode)}
                            aria-describedby={`mode-${mode}-desc mode-${mode}-stats`}
                          />
                          <span className={styles.modeTop}>
                            <span className={styles.modeName}>
                              {copy.name}{" "}
                              <span className={styles.format}>
                                <PartySize
                                  count={Math.min(partySize, MODE_CONFIGS[mode].teamSize)}
                                  capacity={MODE_CONFIGS[mode].teamSize}
                                  overflow={Math.max(0, partySize - MODE_CONFIGS[mode].teamSize)}
                                  label={reason ? `${copy.players}. ${reason}` : copy.players}
                                />
                              </span>
                            </span>
                            {modeUnavailable(service, mode) && !q ? (
                              <ModeCardWarning />
                            ) : (
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
                          <Standing profile={me} mode={mode} />
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
              <ModeAvailabilityHint status={service} />

              {me && <YourStats profile={me} />}

              <div className={styles.queueBar}>
                {isLeader ? (
                  <Button
                    size="lg"
                    variant={queued ? "danger" : "primary"}
                    className={styles.queueButton}
                    onClick={queued ? () => play.leaveQueue() : start}
                    disabled={!queued && (eligible.length === 0 || cooldown)}
                    aria-describedby="queue-hint"
                  >
                    {queued ? "Stop queue" : "Start queue"}
                  </Button>
                ) : null}
                <QueueStatus status={play.queue} connection={play.connection} />
              </div>
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
            </>
          )}
        </div>

        <aside className="stack" aria-label="Party">
          {user && (
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
                } catch {
                  toast.push({ title: "Could not remove player", tone: "error" });
                }
              }}
              onMakeLeader={async (id) => {
                try {
                  await api.party.setLeader(id);
                  play.setParty((p) => p && { ...p, leaderSteamId: id });
                } catch {
                  toast.push({ title: "Could not change the leader", tone: "error" });
                }
              }}
              onRotateInvite={async () => {
                try {
                  const next = await api.party.rotateInvite();
                  play.setParty((p) => p && { ...p, inviteCode: next.inviteCode });
                } catch {
                  toast.push({ title: "Could not make a new link", tone: "error" });
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
          )}
          {user && <FriendsCard inviteUrl={inviteUrl} ensureInvite={ensureInvite} onParty={play.setParty} />}
        </aside>
      </div>

      <Modal
        open={!!found}
        blocking
        title="Match found"
        footer={
          found && !found.responded ? (
            <>
              <Button variant="ghost" onClick={() => play.respond(false)}>
                Decline
              </Button>
              <Button onClick={() => play.respond(true)} autoFocus>
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
                return mine && mine.matches > 0 ? <TierChip tier={mine.tier} rating={mine.rating} size="sm" /> : null;
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

function ServerReady({ server, mode }: { server: ServerReadyPayload | null; mode: Mode | null }) {
  const [copied, setCopied] = useState(false);
  if (!server) {
    return (
      <Card tone="accent" eyebrow="Starting server" title={mode ? modeLabel(mode) : "Your match"}>
        <p className="muted" aria-live="polite">
          <Throbber /> Starting your server. Connect details appear here when it is ready.
        </p>
      </Card>
    );
  }
  // Older payloads only had the connect string
  const password = server.password || /password\s+(\S+)/.exec(server.connect)?.[1];
  const steamUrl = `steam://connect/${server.ip}:${server.port}${password ? `/${encodeURIComponent(password)}` : ""}`;
  const map = mode ? mapName(mode, server.mapId) : server.mapId;

  return (
    <Card tone="accent" eyebrow="Server ready" title={`Connect now, ${map}`}>
      <div className="stack">
        <p className="muted">
          Join now or forfeit.
        </p>
        <label htmlFor="connect-string" className="visually-hidden">
          Console connect command
        </label>
        <input id="connect-string" className={`${styles.connect} mono`} value={server.connect} readOnly onFocus={(e) => e.currentTarget.select()} />
        <div className="row">
          <a className={styles.steamLink} href={steamUrl}>
            Launch CS2 and connect
          </a>
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(server.connect);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? "Copied" : "Copy command"}
          </Button>
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
        <ol className={styles.dots}>
          {last.map((m) => (
            <li key={m.matchId} className={m.result === "win" ? styles.dotWin : styles.dotLoss}>
              <span className="visually-hidden">{m.result === "win" ? "Win" : m.result === "loss" ? "Loss" : "Forfeit"}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
