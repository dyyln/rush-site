"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TEAM_NAME_MAX, TeamNameSchema, trustAtLeast } from "@rushsite/shared";
import { AvatarStack } from "@/components/tournaments/AvatarStack";
import { LiveBadge } from "@/components/tournaments/LiveBadge";
import { LocalTime } from "@/components/tournaments/LocalTime";
import { VerifiedNote } from "@/components/tournaments/VerifiedNote";
import { WithdrawDialog } from "@/components/tournaments/WithdrawDialog";
import { registeredToast } from "@/components/tournaments/toasts";
import { useLiveScores } from "@/components/tournaments/useLiveScores";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { BracketView, entryName, entryPlayers } from "@/components/ui/BracketView";
import { TeamCard } from "@/components/ui/TeamCard";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SignInLink } from "@/components/ui/SignInLink";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { MODE_COPY } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { TRUST_NAMES, trustProgressLine } from "@/lib/trust";
import { STATUS_LABEL, formatLabel } from "@/lib/tournaments";
import type { EntryView, TournamentBracket, TournamentDetail } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { useVisibleInterval } from "@/lib/useVisibleInterval";
import { getRealtime } from "@/lib/ws";
import styles from "./detail.module.css";

// Team entries show the captain's Steam avatar. Initials are the fallback
function captainAvatar(e: EntryView): string | null {
  return e.players?.find((p) => p.steamId === e.captainSteamId)?.avatarUrl ?? e.players?.[0]?.avatarUrl ?? null;
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

  const refresh = useCallback(async (full = false) => {
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
  }, [id]);

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
        <Card title={notFound ? "Tournament not found" : "Could not load tournament"}>
          <p className="muted">
            <Link href="/tournaments">Back to tournaments</Link>
          </p>
        </Card>
      </div>
    );
  }
  const t = live ? { ...data.data, bracket: live.bracket, bracketVersion: live.version } : data.data;
  return <Detail t={t} reload={reload} />;
}

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
  const bracket = useLiveScores(t.bracket, !!user);

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

  return (
    <div className="container page">
      <nav aria-label="Breadcrumb">
        <Link href="/tournaments" className={styles.back}>
          Tournaments
        </Link>
      </nav>
      <header className="page-header">
        <div>
          <div className="row">
            {t.status === "running" ? <LiveBadge /> : <Badge tone={status.tone}>{status.label}</Badge>}
            <Badge>{t.cadence}</Badge>
            <Badge tone="info">{t.minTrust} required</Badge>
          </div>
          <h1 className={styles.title}>{t.name}</h1>
          <p>
            {MODE_COPY[t.mode].label}. {formatLabel(t)}.
          </p>
          {t.entries.length > 0 && (
            <a href="#entrants-heading" className={styles.stackLink}>
              <AvatarStack
                people={t.entries.map((e) => ({ steamId: e.id, displayName: entryName(e), avatarUrl: captainAvatar(e) }))}
                total={t.entrantCount}
                size="md"
              />
              <span>See all entrants</span>
            </a>
          )}
        </div>
        {t.status === "open" &&
          (user ? (
            <div className={styles.cta}>
              {teamMode && eligible && !entered && !full && (
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
              )}
              <Button
                size="lg"
                variant={entered ? "danger" : "primary"}
                onClick={entered ? () => setConfirmWithdraw(true) : toggleEntry}
                loading={busy && !confirmWithdraw}
                disabled={!eligible || (!entered && full)}
                aria-describedby={!eligible ? "enter-why" : undefined}
              >
                {entered ? "Withdraw" : !eligible ? `Needs ${TRUST_NAMES[t.minTrust]}` : full ? "Full" : "Enter cup"}
              </Button>
              {!eligible && (
                <p className={styles.note} id="enter-why">
                  You need a {TRUST_NAMES[t.minTrust]} account to enter.{" "}
                  {user.trust ? `You are ${trustProgressLine(user.trust)}. ` : null}
                  <Link href="/play">Play ladder matches to get there</Link>
                </p>
              )}
              {eligible && t.mode !== "aim1v1" && !entered && <p className={styles.note}>Leader enters the party.</p>}
            </div>
          ) : (
            <div className={styles.cta}>
              <SignInLink size="lg">Sign in to enter</SignInLink>
              <VerifiedNote minTrust={t.minTrust} />
            </div>
          ))}
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

      <div className={styles.facts}>
        <StatTile label="Starts" value={<LocalTime iso={t.startsAt} className={styles.small} />} />
        <StatTile label="Entrants" value={`${t.entrantCount}/${t.maxEntrants}`} />
        <StatTile label="Prize" value={<span className={styles.small}>Profile badges</span>} />
        {winner && <StatTile label="Champion" value={<span className={styles.small}>{entryName(winner)}</span>} />}
      </div>

      {t.bracket && (
        <section aria-labelledby="bracket-heading" className="stack">
          <h2 id="bracket-heading">Bracket</h2>
          <BracketView bracket={bracket ?? t.bracket} entries={t.entries} highlightEntryId={t.myEntryId} mode={t.mode} />
        </section>
      )}
      <section aria-labelledby="entrants-heading" className="stack">
        <h2 id="entrants-heading">Entrants</h2>
        {t.status === "cancelled" && <p className="muted">This cup was cancelled.</p>}
        {t.entries.length === 0 ? (
          <p className="muted">No sign ups yet.</p>
        ) : (
          <ol className={styles.entrants}>
            {t.entries.map((e) => (
              <li key={e.id} className={styles.entrant}>
                <TeamCard title={entryName(e)} players={entryPlayers(e)} meanRating={e.rating} className={styles.entrantTrigger}>
                  <Avatar name={entryName(e)} src={captainAvatar(e)} size="sm" />
                  <span className={styles.entrantName}>{entryName(e)}</span>
                </TeamCard>
                {e.disqualified && <Badge tone="loss">DQ</Badge>}
                {e.rating !== null && <span className="mono muted rating-num">{e.rating}</span>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
