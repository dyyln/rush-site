"use client";

import Link from "next/link";
import { useState } from "react";
import { RANKED_MODES as MODES, trustAtLeast, type Mode } from "@rushsite/shared";
import { AvatarStack } from "@/components/tournaments/AvatarStack";
import { LocalTime } from "@/components/tournaments/LocalTime";
import { useNow } from "@/components/play/useNow";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { api } from "@/lib/api";
import { MODE_ART, MODE_COPY } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { formatLabel } from "@/lib/tournaments";
import { TRUST_NAMES, trustProgressLine } from "@/lib/trust";
import type { TournamentSummary } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import { useBackdrop } from "@/lib/useBackdrop";
import styles from "./tournaments.module.css";

const byStart = (a: TournamentSummary, b: TournamentSummary) => Date.parse(a.startsAt) - Date.parse(b.startsAt);

// Cups: the next cup as a banner, cups being played now, the schedule and recent winners
export function TournamentsView() {
  const [mode, setMode] = useState<Mode | "all">("all");
  const filter = mode === "all" ? undefined : mode;
  const open = useAsync(() => api.tournaments.list({ status: ["open"], mode: filter }), [mode]);
  const live = useAsync(() => api.tournaments.list({ status: ["running"] }), []);
  const past = useAsync(() => api.tournaments.list({ status: ["completed"], mode: filter }), [mode]);

  const upcoming = open.status === "success" ? [...open.data].sort(byStart) : [];
  const next = upcoming[0] ?? null;
  const rest = upcoming.slice(1);
  const winners =
    past.status === "success"
      ? past.data
          .filter((t) => t.winner)
          .sort((a, b) => byStart(b, a))
          .slice(0, 6)
      : [];
  useBackdrop(next?.mode ?? null);

  return (
    <div className={cx("container", styles.page)}>
      <h1 className="visually-hidden">Cups</h1>

      {open.status === "error" ? (
        <div className={cx("glass", styles.error)} role="alert">
          <p>Could not load cups.</p>
          <Button variant="secondary" onClick={open.reload}>
            Retry
          </Button>
        </div>
      ) : open.status === "loading" ? (
        <div className={cx(styles.hero, styles.heroLoading)} aria-busy="true">
          <p className={styles.kicker}>Loading cups</p>
        </div>
      ) : next ? (
        <NextCup t={next} />
      ) : (
        <div className={cx("glass", styles.emptyHero)}>
          <p className={styles.kicker}>Cups</p>
          <p>No cup open for sign ups{mode === "all" ? "" : ` in ${MODE_COPY[mode].label}`} right now. Daily and weekly cups open ahead of time.</p>
        </div>
      )}

      {live.status === "success" &&
        live.data.map((t) => (
          <Link key={t.id} href={`/tournaments/${t.id}`} className={cx("glass", styles.liveBar)}>
            <span className={styles.liveTag}>
              <span className={styles.liveDot} aria-hidden="true" />
              Live
            </span>
            <span className={styles.liveName}>
              {t.name} <span className={styles.muted}>· {MODE_COPY[t.mode].label}</span>
            </span>
            <span className={styles.liveLink}>Watch bracket</span>
          </Link>
        ))}

      <section aria-labelledby="schedule" className={cx("glass", styles.panel)}>
        <div className={styles.panelHead}>
          <h2 id="schedule" className={styles.panelTitle}>
            Schedule
          </h2>
          <div className={styles.filters} role="group" aria-label="Filter by mode">
            {(["all", ...MODES] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === "all" ? "All" : MODE_COPY[m].label}
              </button>
            ))}
          </div>
        </div>
        {open.status === "success" && rest.length === 0 ? (
          <p className={styles.panelEmpty}>{next ? "Nothing else scheduled yet." : "Nothing scheduled yet."}</p>
        ) : (
          <ul className={styles.rows}>
            {rest.map((t) => (
              <ScheduleRow key={t.id} t={t} />
            ))}
          </ul>
        )}
      </section>

      {winners.length > 0 && (
        <section aria-labelledby="winners" className={cx("glass", styles.panel)}>
          <div className={styles.panelHead}>
            <h2 id="winners" className={styles.panelTitle}>
              Recent winners
            </h2>
          </div>
          <ul className={styles.winners}>
            {winners.map((t) => (
              <li key={t.id}>
                <Link href={`/tournaments/${t.id}`} className={styles.winnerRow}>
                  <Trophy />
                  <Avatar name={t.winner!.name} src={t.winner!.avatarUrl} size="sm" />
                  <span className={styles.winText}>
                    <strong>{t.winner!.name}</strong>
                    <span className={styles.muted}>
                      {t.name} · {MODE_COPY[t.mode].label} · <LocalTime iso={t.completedAt ?? t.startsAt} />
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Sign up state of one cup for the viewer
function useEntryState(t: TournamentSummary) {
  const { user } = useSession();
  const level = user?.trust?.level ?? user?.trustLevel ?? "new";
  const eligible = !!user && trustAtLeast(level, t.minTrust);
  return {
    user,
    entered: !!t.myEntryId,
    full: t.entrantCount >= t.maxEntrants,
    eligible,
    needs: TRUST_NAMES[t.minTrust],
  };
}

function NextCup({ t }: { t: TournamentSummary }) {
  const s = useEntryState(t);
  const now = useNow(true, 1000);
  const left = now === null ? null : Math.max(0, Math.floor((Date.parse(t.startsAt) - now) / 1000));
  return (
    <section className={styles.hero} aria-labelledby="next-cup">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={MODE_ART[t.mode]} alt="" className={styles.heroArt} />
      <span className={styles.heroShade} aria-hidden="true" />
      <div className={styles.heroBody}>
        <p className={styles.kicker}>Next cup · {t.cadence === "special" ? "Special" : t.cadence === "daily" ? "Daily" : "Weekly"}</p>
        <h2 id="next-cup" className={styles.heroName}>
          <Link href={`/tournaments/${t.id}`}>{t.name}</Link>
        </h2>
        <ul className={styles.facts}>
          <li>{MODE_COPY[t.mode].label}</li>
          <li>{formatLabel(t)}</li>
          <li>
            <span className="mono">
              {t.entrantCount} / {t.maxEntrants}
            </span>{" "}
            {t.mode === "aim1v1" ? "players" : "teams"}
          </li>
        </ul>
        <div className={styles.heroFoot}>
          <p className={styles.prize}>
            <Trophy />
            <span>
              <strong>Prize</strong> a trophy badge on your profile
            </span>
          </p>
          <AvatarStack people={t.entrantPreview ?? []} total={t.entrantCount} />
        </div>
      </div>
      <div className={styles.heroSide}>
        <span className={styles.countLabel}>Starts in</span>
        <span className={cx(styles.count, "mono")} aria-hidden="true">
          {left === null ? "--:--:--" : clock(left)}
        </span>
        <span className="visually-hidden">
          <LocalTime iso={t.startsAt} />
        </span>
        <span className={styles.startsAt}>
          <LocalTime iso={t.startsAt} align="end" />
        </span>
        <EntryAction t={t} s={s} big />
      </div>
    </section>
  );
}

function ScheduleRow({ t }: { t: TournamentSummary }) {
  const s = useEntryState(t);
  const pct = Math.min(100, Math.round((t.entrantCount / t.maxEntrants) * 100));
  return (
    <li className={styles.row}>
      <span className={styles.when}>
        <span className={styles.day}>{dayLabel(t.startsAt)}</span>
        <span className={cx(styles.time, "mono")}>{timeLabel(t.startsAt)}</span>
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={MODE_ART[t.mode]} alt="" className={styles.thumb} />
      <span className={styles.rowMain}>
        <Link href={`/tournaments/${t.id}`} className={styles.rowName}>
          {t.name}
        </Link>
        <span className={styles.rowMeta}>
          {MODE_COPY[t.mode].label} · {t.cadence}
        </span>
      </span>
      <span className={styles.fill}>
        <span className={cx(styles.fillText, "mono")}>
          {t.entrantCount} / {t.maxEntrants}
        </span>
        <span className={styles.bar} data-full={s.full || undefined} aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
      <span className={styles.rowAction}>
        <EntryAction t={t} s={s} />
      </span>
    </li>
  );
}

// Sign up goes through the cup page, which asks for a team name where the mode has teams
function EntryAction({ t, s, big }: { t: TournamentSummary; s: ReturnType<typeof useEntryState>; big?: boolean }) {
  const cls = big ? styles.signUp : styles.rowBtn;
  if (s.entered)
    return (
      <Link href={`/tournaments/${t.id}`} className={cx(cls, styles.entered)}>
        Signed up
      </Link>
    );
  if (s.full) return <span className={styles.state}>Full</span>;
  if (!s.user)
    return (
      <Link href={`/tournaments/${t.id}`} className={cls}>
        View cup
      </Link>
    );
  if (!s.eligible) {
    return big ? (
      <>
        <span className={cx(cls, styles.lockedBtn)}>
          <LockIcon />
          {s.needs} required
        </span>
        {s.user.trust && <span className={styles.sideNote}>{trustProgressLine(s.user.trust)}</span>}
      </>
    ) : (
      <span className={styles.state}>{s.needs} only</span>
    );
  }
  return (
    <Link href={`/tournaments/${t.id}`} className={cls}>
      Sign up
    </Link>
  );
}

function clock(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const hms = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return d > 0 ? `${d}d ${hms}` : hms;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return dayFmt.format(d);
}

function timeLabel(iso: string): string {
  return hourFmt.format(new Date(iso));
}

function Trophy() {
  return (
    <svg className={styles.trophy} viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M7 3h10v5a5 5 0 0 1-10 0z" fill="currentColor" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 13h2v4h3v3H8v-3h3z" fill="currentColor" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
