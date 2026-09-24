"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TEAM_NAME_MAX, TeamNameSchema, trustAtLeast } from "@rushsite/shared";
import { DockButton, DockLink } from "@/components/layout/Dock";
import { useDockAction, type DockAction } from "@/components/layout/dockStore";
import { BadgeEmblem } from "@/components/profile/BadgeEmblem";
import { AvatarStack } from "@/components/tournaments/AvatarStack";
import { bracketPath } from "@/components/tournaments/bracketPath";
import { EntrantList } from "@/components/tournaments/EntrantList";
import { LiveBadge } from "@/components/tournaments/LiveBadge";
import { LocalTime } from "@/components/tournaments/LocalTime";
import { VerifiedNote } from "@/components/tournaments/VerifiedNote";
import { WithdrawDialog } from "@/components/tournaments/WithdrawDialog";
import { registeredToast } from "@/components/tournaments/toasts";
import { useLiveScores } from "@/components/tournaments/useLiveScores";
import { Badge } from "@/components/ui/Badge";
import { BracketView, entryName, roundName } from "@/components/ui/BracketView";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { PageTabs, type PageTab } from "@/components/ui/PageTabs";
import { useToast } from "@/components/ui/Toast";
import { StepClock } from "@/components/ui/VetoHead";
import { ApiError, api } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { MODE_ART, MODE_COPY } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { TRUST_NAMES, trustProgressLine } from "@/lib/trust";
import { STATUS_LABEL, formatLabel } from "@/lib/tournaments";
import type { EntryView, TournamentBracket, TournamentDetail } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { useBackdrop } from "@/lib/useBackdrop";
import { useVisibleInterval } from "@/lib/useVisibleInterval";
import { getRealtime } from "@/lib/ws";
import styles from "./detail.module.css";

// Team entries show the captain's Steam avatar. Initials are the fallback
function captainAvatar(e: EntryView): string | null {
  return e.players?.find((p) => p.steamId === e.captainSteamId)?.avatarUrl ?? e.players?.[0]?.avatarUrl ?? null;
}

// The header ring drains over the last hours before the start. Earlier the start time tile is enough
const COUNTDOWN_WINDOW_MS = 3 * 3_600_000;
// A cup still open this long after its start time is stale data, not a countdown
const COUNTDOWN_STALE_MS = 15 * 60_000;

// Minute steps for screen readers. role="timer" is not live, so this is read on demand only
function spokenLeft(sec: number): string {
  if (sec <= 0) return "The cup is starting.";
  if (sec < 60) return "The cup starts in less than a minute.";
  const mins = Math.ceil(sec / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const parts = [h > 0 && `${h} ${h === 1 ? "hour" : "hours"}`, m > 0 && `${m} ${m === 1 ? "minute" : "minutes"}`];
  return `The cup starts in ${parts.filter(Boolean).join(" ")}.`;
}

function useNowEverySecond(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// Big countdown on the hero while sign ups are open and the start is close. Renders nothing
// before mount so the server and client markup agree
function StartCountdown({ startsAt, onStart }: { startsAt: string; onStart: () => void }) {
  const now = useNowEverySecond();
  const start = Date.parse(startsAt);
  const diff = now === null || Number.isNaN(start) ? null : start - now;
  // Reload once when the countdown runs out on this page, so the live state takes over
  const counting = useRef(false);
  useEffect(() => {
    if (diff === null) return;
    if (diff > 0) counting.current = true;
    else if (counting.current) {
      counting.current = false;
      onStart();
    }
  }, [diff, onStart]);

  if (diff === null || diff > COUNTDOWN_WINDOW_MS || diff < -COUNTDOWN_STALE_MS) return null;
  const sec = Math.ceil(Math.max(0, diff) / 1000);
  return (
    <div className={styles.countdown}>
      <StepClock until={start} totalSec={COUNTDOWN_WINDOW_MS / 1000} mine label={sec > 0 ? "to start" : "starting"} />
      <p className="visually-hidden" role="timer">
        {spokenLeft(sec)}
      </p>
    </div>
  );
}

// Signed out viewers have no socket, so the bracket is polled by version instead
const BRACKET_POLL_MS = 5000;

// Bracket changes only refetch the bracket, by version. Other changes reload the page data
function useLiveBracket(id: string, detail: TournamentDetail | undefined, reload: () => void): TournamentBracket | null {
  const { user, loading } = useSession();
  const signedIn = !!user;
  const [live, setLive] = useState<TournamentBracket | null>(null);
  const version = useRef<number | undefined>(undefined);
  const inFlight = useRef(false);
  const again = useRef(false);

  useEffect(() => {
    setLive(null);
    version.current = undefined;
  }, [id]);

  useEffect(() => {
    if (detail && (version.current === undefined || detail.bracketVersion > version.current)) {
      version.current = detail.bracketVersion;
    }
  }, [detail]);

  // Round scores do not move the version, so a bracket with a live game is fetched in full
  const hasLive = useRef(false);
  const current = live && detail && live.version >= detail.bracketVersion ? live.bracket : detail?.bracket;
  useEffect(() => {
    hasLive.current = !!current?.matches.some((m) => m.status === "live");
  }, [current]);

  const refresh = useCallback(
    async (full = false) => {
      if (inFlight.current) {
        again.current = true;
        return;
      }
      inFlight.current = true;
      try {
        do {
          again.current = false;
          const next = await api.tournaments.bracket(id, full ? undefined : version.current).catch(() => null);
          const newer = version.current === undefined || (next && (next.version > version.current || (full && next.version === version.current)));
          if (next && next.tournamentId === id && newer) {
            version.current = next.version;
            setLive(next);
          }
        } while (again.current);
      } finally {
        inFlight.current = false;
      }
    },
    [id],
  );

  useVisibleInterval(() => void refresh(hasLive.current), BRACKET_POLL_MS, !loading && !signedIn);

  useEffect(() => {
    if (!signedIn) return;
    const rt = getRealtime();
    rt.connect();
    const subscribe = () => rt.send("subscribe_tournament", { tournamentId: id });
    subscribe();
    const offs = [
      // Resubscribe after a reconnect and catch up on anything missed
      rt.onState((s) => {
        if (s !== "open") return;
        subscribe();
        void refresh();
      }),
      rt.on("tournament_update", (p) => {
        if (p.tournament.id !== id) return;
        if (p.kind === "match_live" || p.kind === "match_updated") {
          if (p.bracketVersion !== version.current) void refresh();
        } else {
          reload();
        }
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      rt.send("unsubscribe_tournament", { tournamentId: id });
    };
  }, [id, reload, refresh, signedIn]);

  return live && detail && live.version >= detail.bracketVersion ? live : null;
}

export function TournamentDetailView({ id }: { id: string }) {
  const data = useAsync(() => api.tournaments.detail(id), [id]);
  useBackdrop(data.data?.mode);
  const { reload } = data;
  const live = useLiveBracket(id, data.data, reload);

  if (data.status === "loading") {
    return (
      <div className="container page" aria-busy="true">
        <p className="muted">Loading tournament</p>
      </div>
    );
  }
  if (data.status === "error") {
    const notFound = data.error instanceof ApiError && data.error.status === 404;
    return (
      <div className="container page">
        <Card title={notFound ? "Cup not found" : "Could not load cup"}>
          <p className="muted">
            <Link href="/tournaments">Back to cups</Link>
          </p>
        </Card>
      </div>
    );
  }
  const t = live ? { ...data.data, bracket: live.bracket, bracketVersion: live.version } : data.data;
  return <Detail t={t} reload={reload} />;
}

type CupTab = "bracket" | "entrants" | "info";

const startFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });

function Detail({ t, reload }: { t: TournamentDetail; reload: () => void }) {
  const { user } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [entered, setEntered] = useState(!!t.myEntryId);
  const status = STATUS_LABEL[t.status];
  const winner = t.winnerEntryId ? t.entries.find((e) => e.id === t.winnerEntryId) : undefined;
  const eligible = user ? trustAtLeast(user.trustLevel, t.minTrust) : false;
  const full = t.entrantCount >= t.maxEntrants;
  const teamMode = t.mode !== "aim1v1";
  const [teamName, setTeamName] = useState("");
  const [teamNameError, setTeamNameError] = useState<string>();
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const bracket = useLiveScores(t.bracket, !!user) ?? t.bracket;

  const params = useSearchParams();
  const tabs: PageTab[] = [
    ...(bracket ? [{ key: "bracket", label: "Bracket", href: "?tab=bracket" }] : []),
    { key: "entrants", label: bracket ? "Standings" : "Entrants", href: "?tab=entrants", count: t.entrantCount },
    { key: "info", label: "Info", href: "?tab=info" },
  ];
  const raw = params.get("tab");
  const tab = (tabs.some((x) => x.key === raw) ? raw : bracket ? "bracket" : "entrants") as CupTab;
  // An entrant picked on the Standings tab, whose route the bracket traces
  const traced = params.get("trace");
  const tracedEntry = traced ? t.entries.find((e) => e.id === traced) : undefined;

  async function toggleEntry() {
    let name: string | undefined;
    if (!entered && teamMode && teamName.trim()) {
      const parsed = TeamNameSchema.safeParse(teamName);
      if (!parsed.success) {
        setTeamNameError(parsed.error.issues[0]?.message ?? "Invalid team name");
        return;
      }
      name = parsed.data;
    }
    setTeamNameError(undefined);
    setBusy(true);
    try {
      if (entered) await api.tournaments.withdraw(t.id);
      else await api.tournaments.enter(t.id, name);
      setEntered(!entered);
      setConfirmWithdraw(false);
      toast.push(entered ? { title: "Withdrawn", tone: "success" } : registeredToast(t));
      reload();
    } catch (e) {
      const copy = describeError(e, { title: "Could not update entry", body: "Try again in a moment." });
      toast.push({ ...copy, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  // Signed out viewers get the dock's own Sign in
  useDockAction(
    user
      ? cupDock({
          t,
          bracket,
          entered,
          eligible,
          full,
          busy,
          trustLine: user.trust ? trustProgressLine(user.trust) : null,
          onEnter: toggleEntry,
          onWithdraw: () => setConfirmWithdraw(true),
        })
      : null,
  );

  return (
    <div className={cx("container", styles.page)}>
      <Link href="/tournaments" className={styles.back}>
        Cups
      </Link>
      <header className={styles.hero}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.heroArt} src={MODE_ART[t.mode]} alt="" />
        <div className={styles.heroShade} />
        <div className={styles.heroMain}>
          <div className={styles.heroText}>
            <div className={styles.chips}>
              {t.status === "running" ? <LiveBadge /> : <Badge tone={status.tone}>{status.label}</Badge>}
              <Badge tone="info">{t.minTrust} required</Badge>
            </div>
            <p className={styles.kicker}>
              {t.cadence} cup · {MODE_COPY[t.mode].label}
            </p>
            <h1 className={styles.name}>{t.name}</h1>
            <div className={styles.metaRow}>
              <dl className={styles.facts}>
                <div>
                  <dt>{t.status === "open" ? "Starts" : "Started"}</dt>
                  <dd>
                    <LocalTime iso={t.startsAt} />
                  </dd>
                </div>
                <div>
                  <dt>Entrants</dt>
                  <dd>
                    {t.entrantCount}/{t.maxEntrants}
                  </dd>
                </div>
                <div>
                  <dt>Format</dt>
                  <dd>{formatLabel(t)}</dd>
                </div>
              </dl>
              {t.entries.length > 0 && (
                <Link href="?tab=entrants" scroll={false} replace className={styles.stackLink}>
                  <AvatarStack
                    people={t.entries.map((e) => ({ steamId: e.id, displayName: entryName(e), avatarUrl: captainAvatar(e) }))}
                    total={t.entrantCount}
                    size="md"
                  />
                  <span>See all entrants</span>
                </Link>
              )}
            </div>
          </div>
          <div className={styles.heroSide}>
            {t.status === "open" && <StartCountdown startsAt={t.startsAt} onStart={reload} />}
            {winner && (
              <div className={styles.champion}>
                <BadgeEmblem kind="cup_champion" cadence={t.cadence} size={64} />
                <div>
                  <p className={styles.championLabel}>Champion</p>
                  <p className={styles.championName}>{entryName(winner)}</p>
                </div>
              </div>
            )}
            {t.status === "open" && user && !eligible && (
              <p className={styles.note}>
                You need a {TRUST_NAMES[t.minTrust]} account to enter. {user.trust ? `You are ${trustProgressLine(user.trust)}. ` : null}
                <Link href="/play">Play ladder matches to get there</Link>
              </p>
            )}
            {t.status === "open" && !user && <VerifiedNote minTrust={t.minTrust} />}
            {t.status === "open" && user && teamMode && eligible && !entered && !full && (
              <div className={styles.teamName}>
                <Input
                  label="Team name (optional)"
                  value={teamName}
                  maxLength={TEAM_NAME_MAX}
                  placeholder="3 to 24 characters"
                  error={teamNameError}
                  onChange={(e) => {
                    setTeamName(e.target.value);
                    setTeamNameError(undefined);
                  }}
                />
                <p className={styles.note}>The leader enters for the party, with Enter cup in the bar below.</p>
              </div>
            )}
          </div>
        </div>
        <PageTabs label="Cup" items={tabs} current={tab} className={styles.heroTabs} />
      </header>
      <WithdrawDialog
        open={confirmWithdraw}
        cupName={t.name}
        startsAt={t.startsAt}
        bracketBuilt={!!t.bracket}
        teamCup={teamMode}
        busy={busy}
        onConfirm={toggleEntry}
        onClose={() => setConfirmWithdraw(false)}
      />

      {t.status === "cancelled" && (
        <Card>
          <p className="muted">This cup was cancelled.</p>
        </Card>
      )}

      {tab === "bracket" && bracket && (
        <section aria-labelledby="bracket-heading" className="stack">
          <div className={styles.sectionHead}>
            {/* The tab above already names the section */}
            <h2 id="bracket-heading" className="visually-hidden">
              Bracket
            </h2>
            {tracedEntry && (
              <p className={cx("glass", styles.tracing)}>
                <span>
                  Route of <strong>{entryName(tracedEntry)}</strong>
                </span>
                <Link href="?tab=bracket" scroll={false} replace className={styles.clear}>
                  Clear
                </Link>
              </p>
            )}
          </div>
          <BracketView bracket={bracket} entries={t.entries} highlightEntryId={t.myEntryId} mode={t.mode} cadence={t.cadence} traceEntryId={tracedEntry?.id} />
        </section>
      )}

      {tab === "entrants" && (
        <section aria-labelledby="entrants-heading" className="stack">
          <h2 id="entrants-heading" className="visually-hidden">
            {bracket ? "Standings" : "Entrants"}
          </h2>
          {t.entries.length === 0 && t.status !== "open" ? (
            <Card>
              <p className="muted">No sign ups.</p>
            </Card>
          ) : (
            <EntrantList
              entries={t.entries}
              bracket={bracket}
              maxEntrants={t.maxEntrants}
              signups={t.status === "open"}
              myEntryId={t.myEntryId}
              routeHref={bracket ? (id) => `?tab=bracket&trace=${encodeURIComponent(id)}` : undefined}
            />
          )}
        </section>
      )}

      {tab === "info" && <CupInfo t={t} />}
    </div>
  );
}

const PRIZES = [
  ["cup_champion", "Champion"],
  ["cup_runner_up", "Runner-up"],
  ["cup_semifinalist", "Semifinalists"],
] as const;

// Format, rules and prizes
function CupInfo({ t }: { t: TournamentDetail }) {
  const { default: d, semis, final } = t.format.bestOf;
  return (
    <div className={styles.info}>
      <Card title="Format">
        <ul className={styles.points}>
          <li>Single elimination, up to {t.maxEntrants} entrants</li>
          <li>{d === semis ? `Bo${d} until the final, Bo${final} final` : `Bo${d} until the semifinals, Bo${semis} semifinals, Bo${final} final`}</li>
          <li>{MODE_COPY[t.mode].label}. Ladder rating in the mode seeds the bracket</li>
        </ul>
      </Card>
      <Card title="Rules">
        <ul className={styles.points}>
          <li>A {TRUST_NAMES[t.minTrust]} account is needed to enter</li>
          <li>No check-in. The bracket is built from the sign ups at the start time</li>
          <li>Entrants who do not show up forfeit their first match</li>
          <li>Every match records a demo for review</li>
        </ul>
      </Card>
      <Card title="Prizes">
        <ul className={styles.prizes}>
          {PRIZES.map(([kind, label]) => (
            <li key={kind}>
              <BadgeEmblem kind={kind} cadence={t.cadence} size={48} />
              <span>
                <strong>{label}</strong>
                <span className="muted"> · trophy badge on the profile</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

type DockInput = {
  t: TournamentDetail;
  bracket: TournamentDetail["bracket"];
  entered: boolean;
  eligible: boolean;
  full: boolean;
  busy: boolean;
  trustLine: string | null;
  onEnter: () => void;
  onWithdraw: () => void;
};

// The cup's one action in the dock: enter or withdraw during sign ups, the viewer's match once it runs
function cupDock({ t, bracket, entered, eligible, full, busy, trustLine, onEnter, onWithdraw }: DockInput): DockAction | null {
  const starts = Date.parse(t.startsAt);
  const when = Number.isNaN(starts) ? "" : `Starts ${startFmt.format(starts)}`;
  if (t.status === "open") {
    if (entered) {
      return {
        label: "You're in",
        value: when,
        action: (
          <DockButton tone="quiet" onClick={onWithdraw} disabled={busy}>
            Withdraw
          </DockButton>
        ),
      };
    }
    if (!eligible) {
      return {
        label: `${TRUST_NAMES[t.minTrust]} required`,
        value: trustLine ? `You are ${trustLine}` : "Play ladder matches to get there",
        action: <DockButton disabled>Enter cup</DockButton>,
      };
    }
    return {
      label: full ? "Cup full" : "Sign ups open",
      value: `${t.entrantCount} of ${t.maxEntrants} in${when ? ` · ${when}` : ""}`,
      action: (
        <DockButton onClick={onEnter} disabled={busy || full}>
          {busy ? "Entering" : full ? "Full" : "Enter cup"}
        </DockButton>
      ),
    };
  }
  if (t.status === "running" && bracket && t.myEntryId) {
    const path = bracketPath(bracket, t.myEntryId);
    const next = path?.nextId ? bracket.matches.find((m) => m.id === path.nextId) : undefined;
    if (!next) return null;
    const round = roundName(next.round, bracket.rounds);
    const room = next.room ?? next.liveMatchId;
    if (room) {
      return {
        label: next.status === "live" ? `${round} · live` : `${round} · ready`,
        value: "Your match",
        action: (
          <DockLink href={`/matches/${encodeURIComponent(room)}`} tone="win">
            {next.status === "live" ? "Open match" : "Join match"}
          </DockLink>
        ),
      };
    }
    return { label: `Next: ${round.toLowerCase()}`, value: "Waiting for your opponent", action: null };
  }
  return null;
}
