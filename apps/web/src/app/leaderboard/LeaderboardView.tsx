"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LEADERBOARD_MIN_MATCHES, MODES, type Mode } from "@rushsite/shared";
import { TierDistributionBar } from "@/components/stats/TierDistributionBar";
import { statsApi, type FriendRow, type FriendsLeaderboard } from "@/components/stats/statsApi";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Table, type Column } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { TierChip } from "@/components/ui/TierChip";
import { api } from "@/lib/api";
import { pct, winRate } from "@/lib/format";
import { MODE_COPY, isMode } from "@/lib/modes";
import { useSession } from "@/lib/session";
import type { Leaderboard, LeaderboardRow } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import styles from "./leaderboard.module.css";

const PAGE = 50;

type Board = "global" | "friends";
type BoardRow = LeaderboardRow | FriendRow;
const unplaced = (r: BoardRow) => "placed" in r && !r.placed;

const columns: Column<BoardRow>[] = [
  { key: "rank", header: "#", cell: (r) => r.rank ?? <span className="muted">-</span>, numeric: true, width: "56px" },
  {
    key: "player",
    header: "Player",
    cell: (r) => (
      <Link href={`/profile/${r.steamId}`} className={styles.player}>
        <Avatar name={r.displayName} src={r.avatarUrl} size="sm" />
        <span className={styles.name}>{r.displayName}</span>
      </Link>
    ),
  },
  {
    key: "rating",
    header: "Rating",
    cell: (r) =>
      unplaced(r) ? (
        <span className={styles.unranked} title={`${LEADERBOARD_MIN_MATCHES} matches to place`}>
          <TierChip unranked size="sm" />
          <span className="mono muted">{r.rating}</span>
        </span>
      ) : (
        <TierChip tier={r.tier} rating={r.rating} size="sm" />
      ),
    align: "right",
  },
  { key: "winrate", header: "Win %", cell: (r) => pct(winRate(r.wins, r.matches)), numeric: true, hideOnMobile: true },
  { key: "matches", header: "Matches", cell: (r) => r.matches, numeric: true, hideOnMobile: true },
];

export function LeaderboardView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: sessionLoading } = useSession();
  const raw = params.get("mode");
  const mode: Mode = isMode(raw) ? raw : "rush3v3";
  const board: Board = params.get("board") === "friends" ? "friends" : "global";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const friends = board === "friends";
  const data = useAsync<Leaderboard | FriendsLeaderboard | null>(
    () => (friends ? (user ? statsApi.friendsLeaderboard(mode) : Promise.resolve(null)) : api.leaderboard(mode, { offset: page * PAGE, limit: PAGE })),
    [mode, page, friends, user?.steamId],
  );
  const dist = useAsync(() => statsApi.distribution(mode), [mode, user?.steamId]);
  const totalPages = data.data && !friends ? Math.ceil(data.data.total / PAGE) : 1;
  const fb = friends ? (data.data as FriendsLeaderboard | null | undefined) : null;
  const friendsNote =
    fb && !fb.friendsAvailable
      ? fb.reason === "friends_private"
        ? "Your Steam friends list is private, so only you are shown. Make it public on Steam to compare."
        : "Steam friends are unavailable right now, so only you are shown."
      : null;

  function go(next: { mode?: Mode; page?: number; board?: Board }) {
    const q = new URLSearchParams(params);
    if (next.mode) q.set("mode", next.mode);
    if (next.board) q.set("board", next.board);
    if (q.get("board") === "global") q.delete("board");
    q.set("page", String(next.page ?? 0));
    if (q.get("page") === "0") q.delete("page");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Leaderboard</h1>
          <p>{LEADERBOARD_MIN_MATCHES} matches to place.</p>
        </div>
      </header>

      <Tabs
        label="Mode"
        value={mode}
        onChange={(m) => go({ mode: m })}
        items={MODES.map((m) => ({ key: m, label: MODE_COPY[m].label }))}
      >
        <div className="stack">
          <TierDistributionBar data={dist.data ?? null} loading={dist.status === "loading"} />
          <Tabs
            label="Board"
            idPrefix="board"
            value={board}
            onChange={(b) => go({ board: b })}
            items={[
              { key: "global", label: "Global" },
              { key: "friends", label: "Friends" },
            ]}
          >
            {friends && !user && !sessionLoading ? (
              <div className={styles.notice}>
                <p>Sign in to see where you stand against your Steam friends.</p>
                <ButtonLink href="/login">Sign in with Steam</ButtonLink>
              </div>
            ) : data.status === "error" ? (
              <div className={styles.error} role="alert">
                <p>Could not load the leaderboard.</p>
                <Button variant="secondary" onClick={data.reload}>
                  Retry
                </Button>
              </div>
            ) : (
              <>
                {friendsNote && (
                  <p className={styles.note} role="status">
                    {friendsNote}
                  </p>
                )}
                <Table
                  caption={`${MODE_COPY[mode].label} ${friends ? "friends " : ""}leaderboard`}
                  columns={columns}
                  rows={(data.data?.rows ?? []) as BoardRow[]}
                  rowKey={(r) => r.steamId}
                  loading={data.status === "loading"}
                  highlight={(r) => r.steamId === user?.steamId}
                  empty={friends ? `No placed friends yet. ${LEADERBOARD_MIN_MATCHES} matches to place.` : "No placed players yet."}
                />
              </>
            )}
          </Tabs>
        </div>
      </Tabs>

      {totalPages > 1 && (
        <nav className={styles.pager} aria-label="Pages">
          <Button variant="secondary" onClick={() => go({ page: page - 1 })} disabled={page === 0}>
            Previous
          </Button>
          <span className="mono muted">
            {page + 1} / {totalPages}
          </span>
          <Button variant="secondary" onClick={() => go({ page: page + 1 })} disabled={page + 1 >= totalPages}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}
