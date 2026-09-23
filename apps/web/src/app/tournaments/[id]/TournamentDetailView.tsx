"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { trustAtLeast } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { BracketView, entryName } from "@/components/ui/BracketView";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatTile } from "@/components/ui/StatTile";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { MODE_COPY } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { STATUS_LABEL, formatLabel } from "@/lib/tournaments";
import type { TournamentDetail } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { getRealtime } from "@/lib/ws";
import styles from "./detail.module.css";

export function TournamentDetailView({ id }: { id: string }) {
  const data = useAsync(() => api.tournaments.detail(id), [id]);
  const { reload } = data;

  useEffect(() => {
    const rt = getRealtime();
    rt.connect();
    return rt.on("tournament_update", (p) => {
      if (p.tournament.id === id) reload();
    });
  }, [id, reload]);

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
  return <Detail t={data.data} reload={reload} />;
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

  async function toggleEntry() {
    setBusy(true);
    try {
      if (entered) await api.tournaments.withdraw(t.id);
      else await api.tournaments.enter(t.id);
      setEntered(!entered);
      toast.push({ title: entered ? "Withdrawn" : "You're in", tone: "success" });
      reload();
    } catch (e) {
      toast.push({ title: "Could not update entry", body: e instanceof Error ? e.message : undefined, tone: "error" });
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
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge>{t.cadence}</Badge>
            <Badge tone="info">{t.minTrust} required</Badge>
          </div>
          <h1 className={styles.title}>{t.name}</h1>
          <p>
            {MODE_COPY[t.mode].label}. {formatLabel(t)}. No check in, absent players forfeit round one.
          </p>
        </div>
        {t.status === "open" &&
          (user ? (
            <div className={styles.cta}>
              <Button size="lg" variant={entered ? "danger" : "primary"} onClick={toggleEntry} loading={busy} disabled={!eligible || (!entered && full)}>
                {entered ? "Withdraw" : full ? "Full" : "Enter cup"}
              </Button>
              {!eligible && <p className={styles.note}>Your account needs {t.minTrust} trust to enter.</p>}
              {eligible && t.mode !== "aim1v1" && !entered && <p className={styles.note}>The party leader enters the whole party.</p>}
            </div>
          ) : (
            <ButtonLink href="/login" size="lg">
              Sign in to enter
            </ButtonLink>
          ))}
      </header>

      <div className={styles.facts}>
        <StatTile label="Starts" value={<span className={styles.small}>{dateTime(t.startsAt)}</span>} />
        <StatTile label="Entrants" value={`${t.entrantCount}/${t.maxEntrants}`} />
        <StatTile label="Prize" value={<span className={styles.small}>Profile badges</span>} />
        {winner && <StatTile label="Champion" value={<span className={styles.small}>{entryName(winner)}</span>} />}
      </div>

      {t.bracket ? (
        <section aria-labelledby="bracket-heading" className="stack">
          <h2 id="bracket-heading">Bracket</h2>
          <BracketView bracket={t.bracket} entries={t.entries} highlightEntryId={t.myEntryId} />
        </section>
      ) : (
        <section aria-labelledby="entrants-heading" className="stack">
          <h2 id="entrants-heading">Entrants</h2>
          {t.status === "cancelled" && <p className="muted">This cup was cancelled.</p>}
          {t.entries.length === 0 ? (
            <p className="muted">No sign ups yet.</p>
          ) : (
            <ol className={styles.entrants}>
              {t.entries.map((e) => (
                <li key={e.id} className={styles.entrant}>
                  <Avatar name={entryName(e)} src={e.players?.[0]?.avatarUrl} size="sm" />
                  <span className={styles.entrantName}>{entryName(e)}</span>
                  {e.rating !== null && <span className="mono muted">{e.rating}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
