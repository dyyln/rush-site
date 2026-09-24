"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MODES, type Mode } from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { api } from "@/lib/api";
import { shortDate, signed } from "@/lib/format";
import { MODE_COPY, mapName, modeLabel } from "@/lib/modes";
import type { MatchSummary } from "@/lib/types";
import styles from "./profile.module.css";

type Filter = Mode | "all";

const PAGE = 20;

const RESULT_LABEL: Record<MatchSummary["result"], string> = { win: "Win", loss: "Loss", abandoned: "Forfeit" };

export function matchHref(m: Pick<MatchSummary, "matchId" | "slug">): string {
  return `/matches/${m.slug ?? m.matchId}`;
}

function isSeries(m: MatchSummary): boolean {
  return (m.bestOf ?? 1) > 1;
}

function scoreText(m: MatchSummary): string {
  return m.result === "abandoned" ? "--" : `${m.scoreFor}:${m.scoreAgainst}`;
}

function mapsText(m: MatchSummary): string {
  if (isSeries(m) && m.maps && m.maps.length > 0) return m.maps.map((id) => mapName(m.mode, id)).join(", ");
  return m.mapId ? mapName(m.mode, m.mapId) : "";
}

// One sentence so the link reads well on its own
function rowLabel(m: MatchSummary): string {
  const series = isSeries(m) ? `Best of ${m.bestOf}, ` : "";
  const score =
    m.result === "abandoned" ? "" : isSeries(m) ? `, maps ${m.scoreFor} to ${m.scoreAgainst}` : `, ${m.scoreFor} to ${m.scoreAgainst}`;
  const maps = mapsText(m);
  return `${RESULT_LABEL[m.result]}${score}. ${series}${modeLabel(m.mode)}${maps ? ` on ${maps}` : ""}. ${m.kills} kills, ${m.deaths} deaths. Rating ${signed(m.ratingDelta)}. ${shortDate(m.playedAt)}`;
}

type State = { rows: MatchSummary[]; cursor: string | null; status: "idle" | "loading" | "more" | "error" };

export function MatchHistory({ steamId, first, firstCursor }: { steamId: string; first: MatchSummary[]; firstCursor: string | null }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [state, setState] = useState<State>({ rows: first, cursor: firstCursor, status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const listRef = useRef<HTMLOListElement>(null);
  const focusIndex = useRef<number | null>(null);
  // Bumped on every filter change so a late Load more does not land in the wrong list
  const gen = useRef(0);

  // A new filter starts from the first page. "all" reuses what the profile sent
  useEffect(() => {
    gen.current += 1;
    if (filter === "all" && attempt === 0) {
      setState({ rows: first, cursor: firstCursor, status: "idle" });
      return;
    }
    let live = true;
    setState({ rows: [], cursor: null, status: "loading" });
    api
      .userMatches(steamId, { mode: filter === "all" ? undefined : filter, limit: PAGE })
      .then((p) => live && setState({ rows: p.matches, cursor: p.nextCursor, status: "idle" }))
      .catch(() => live && setState({ rows: [], cursor: null, status: "error" }));
    return () => {
      live = false;
    };
  }, [steamId, filter, first, firstCursor, attempt]);

  // After Load more, focus moves to the first new row so keyboard users keep their place
  useEffect(() => {
    if (focusIndex.current === null) return;
    const link = listRef.current?.querySelectorAll("a")[focusIndex.current];
    focusIndex.current = null;
    link?.focus();
  }, [state.rows]);

  async function loadMore() {
    if (!state.cursor) return;
    const mine = gen.current;
    setState((s) => ({ ...s, status: "more" }));
    try {
      const p = await api.userMatches(steamId, { mode: filter === "all" ? undefined : filter, cursor: state.cursor, limit: PAGE });
      if (mine !== gen.current) return;
      focusIndex.current = state.rows.length;
      setState((s) => ({ rows: [...s.rows, ...p.matches], cursor: p.nextCursor, status: "idle" }));
    } catch {
      if (mine === gen.current) setState((s) => ({ ...s, status: "error" }));
    }
  }

  const loading = state.status === "loading";
  const filterName = filter === "all" ? "" : ` in ${modeLabel(filter)}`;

  return (
    <section aria-labelledby="history-heading" className="stack">
      <div className={styles.historyHead}>
        <h2 id="history-heading">Match history</h2>
        <SegmentedControl
          label="Mode"
          showLabel={false}
          value={filter}
          onChange={(v) => {
            setAttempt(0);
            setFilter(v);
          }}
          options={[{ value: "all" as Filter, label: "All" }, ...MODES.map((m) => ({ value: m as Filter, label: MODE_COPY[m].short }))]}
        />
      </div>

      <div className={styles.history} aria-busy={loading || undefined}>
        <div className={styles.historyCols} aria-hidden="true">
          <span>Result</span>
          <span>Mode</span>
          <span className={styles.num}>Score</span>
          <span className={`${styles.num} ${styles.hideMobile}`}>K/D</span>
          <span className={styles.num}>Rating</span>
          <span className={`${styles.num} ${styles.hideMobile}`}>Date</span>
        </div>
        {loading ? (
          <p className={styles.historyEmpty}>Loading matches</p>
        ) : state.rows.length === 0 && state.status !== "error" ? (
          <p className={styles.historyEmpty}>{filter === "all" ? "No matches yet." : `No matches${filterName} yet.`}</p>
        ) : (
          <ol ref={listRef} className={styles.historyList} aria-label={`Matches${filterName}, newest first`}>
            {state.rows.map((m) => (
              <li key={m.matchId}>
                <Link href={matchHref(m)} className={styles.historyRow} aria-label={rowLabel(m)}>
                  <span>
                    <Badge tone={m.result === "win" ? "win" : m.result === "loss" ? "loss" : "warn"}>{RESULT_LABEL[m.result]}</Badge>
                  </span>
                  <span className={styles.historyMode}>
                    <span>
                      {MODE_COPY[m.mode].short}
                      {isSeries(m) && <span className={styles.seriesTag}>Bo{m.bestOf}</span>}
                    </span>
                    <span className={`${styles.historyMaps} mono`}>{mapsText(m)}</span>
                  </span>
                  <span className={`${styles.num} mono`}>{scoreText(m)}</span>
                  <span className={`${styles.num} ${styles.hideMobile} mono`}>
                    {m.kills}/{m.deaths}
                  </span>
                  <span className={`${styles.num} mono ${m.ratingDelta >= 0 ? styles.up : styles.down}`}>{signed(m.ratingDelta)}</span>
                  <span className={`${styles.num} ${styles.hideMobile} ${styles.historyDate}`}>{shortDate(m.playedAt)}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>

      {state.status === "error" && (
        <p role="alert" className="row">
          <span className={styles.down}>Could not load matches.</span>
          <Button
            variant="secondary"
            onClick={() => (state.cursor ? loadMore() : setAttempt((n) => n + 1))}
          >
            Retry
          </Button>
        </p>
      )}
      {state.cursor && state.status !== "error" && !loading && (
        <div>
          <Button variant="secondary" onClick={loadMore} loading={state.status === "more"}>
            Load more
          </Button>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {loading ? "" : `Showing ${state.rows.length} matches${filterName}${state.cursor ? "" : ", all loaded"}`}
      </p>
    </section>
  );
}
