"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LEADERBOARD_MIN_MATCHES, MODES, type Mode } from "@rushsite/shared";
import { useFriends } from "@/components/friends/store";
import { TierDistributionBar } from "@/components/stats/TierDistributionBar";
import { statsApi, type FriendRow, type FriendsLeaderboard } from "@/components/stats/statsApi";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { Table, type Column } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { RatingText } from "@/components/ui/RatingText";
import { TierChip } from "@/components/ui/TierChip";
import { formatStat, winRate } from "@/lib/format";
import { MODE_COPY, isMode } from "@/lib/modes";
import { useBackdrop } from "@/lib/useBackdrop";
import { useSession } from "@/lib/session";
import type { Leaderboard, LeaderboardRow } from "@/lib/types";

// Says "1 match" or "N matches" depending on the count
function matchCountLabel(count: number) {
  return `${count} ${count === 1 ? "match" : "matches"}`;
}
import { useAsync } from "@/lib/useAsync";
import { CONTAINS_MIN_LEN, leaderboardApi } from "./leaderboardApi";
import { Medal } from "./Medal";
import styles from "./leaderboard.module.css";

const PAGE = 50;
const SEARCH_DEBOUNCE_MS = 300;

type Board = "global" | "friends";
type BoardRow = LeaderboardRow | FriendRow;
type Nav = { mode?: Mode; page?: number; board?: Board; q?: string };
type Jump = { state: "idle" } | { state: "loading" } | { state: "unplaced"; needed: number } | { state: "error" };

const unplaced = (r: BoardRow) => "placed" in r && !r.placed;
const rowId = (steamId: string) => `lb-${steamId}`;

function FriendMark() {
  return (
    <span className={styles.friendMark} title="Friend">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
        <circle cx="5" cy="4.5" r="2.3" fill="currentColor" />
        <path d="M1 12.5c0-2.4 1.8-4 4-4s4 1.6 4 4z" fill="currentColor" />
        <circle cx="10.3" cy="5.2" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M9.8 8.6c1.9.1 3.2 1.5 3.2 3.9h-2.4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <span className="visually-hidden">Friend</span>
    </span>
  );
}

function buildColumns(opts: { podium: boolean; friendIds: Set<string>; jumpedId: string | null }): Column<BoardRow>[] {
  const top = (r: BoardRow) => opts.podium && !unplaced(r) && r.rank !== null && r.rank <= 3;
  return [
    {
      key: "rank",
      header: "#",
      cell: (r) =>
        r.rank === null ? (
          <span className="muted">-</span>
        ) : top(r) ? (
          <Medal rank={r.rank as 1 | 2 | 3} />
        ) : (
          r.rank
        ),
      numeric: true,
      width: "56px",
    },
    {
      key: "player",
      header: "Player",
      skeleton: "avatar",
      cell: (r) => (
        <Link
          href={`/profile/${r.steamId}`}
          id={rowId(r.steamId)}
          className={cx(styles.player, top(r) && styles.podium, opts.jumpedId === r.steamId && styles.jumped)}
        >
          <Avatar name={r.displayName} src={r.avatarUrl} size={top(r) ? "md" : "sm"} />
          <span className={styles.name}>{r.displayName}</span>
          {opts.friendIds.has(r.steamId) && <FriendMark />}
        </Link>
      ),
    },
    {
      key: "rating",
      header: "Rating",
      cell: (r) =>
        unplaced(r) ? (
          <span className={styles.unranked} title={`${matchCountLabel(LEADERBOARD_MIN_MATCHES)} to place`}>
            <TierChip unranked size="sm" />
            <RatingText value={r.rating} className="mono muted" />
          </span>
        ) : (
          <TierChip tier={r.tier} rating={r.rating} size="sm" />
        ),
      align: "right",
      skeleton: "chip",
    },
    { key: "winrate", header: "Win %", cell: (r) => formatStat(winRate(r.wins, r.matches), "pct", r.matches), numeric: true, hideOnMobile: true },
    { key: "matches", header: "Matches", cell: (r) => r.matches, numeric: true, hideOnMobile: true },
  ];
}

export function LeaderboardView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchId = useId();
  const { user, loading: sessionLoading } = useSession();
  const raw = params.get("mode");
  const mode: Mode = isMode(raw) ? raw : "rush3v3";
  useBackdrop(mode);
  const board: Board = params.get("board") === "friends" ? "friends" : "global";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const q = (params.get("q") ?? "").trim();
  const friends = board === "friends";
  const data = useAsync<Leaderboard | FriendsLeaderboard | null>(
    () =>
      friends
        ? user
          ? statsApi.friendsLeaderboard(mode)
          : Promise.resolve(null)
        : leaderboardApi.list(mode, { offset: page * PAGE, limit: PAGE, q: q || undefined }),
    [mode, page, friends, q, user?.steamId],
  );
  const dist = useAsync(() => statsApi.distribution(mode), [mode, user?.steamId]);
  const friendList = useFriends(!!user);
  const friendIds = useMemo(
    () => new Set(user && !friends ? (friendList.data?.friends ?? []).map((f) => f.steamId) : []),
    [user, friends, friendList.data],
  );

  const [text, setText] = useState(q);
  const [jump, setJump] = useState<Jump>({ state: "idle" });
  const [jumpedId, setJumpedId] = useState<string | null>(null);
  const [jumpNonce, setJumpNonce] = useState(0);
  const [landed, setLanded] = useState(0);
  const lastQ = useRef(q);

  // Keep the box in step when the url changes from elsewhere, such as a jump clearing the search
  useEffect(() => {
    if (q !== lastQ.current) {
      lastQ.current = q;
      setText(q);
    }
  }, [q]);

  useEffect(() => {
    const next = text.trim();
    if (next === lastQ.current) return;
    const t = setTimeout(() => {
      lastQ.current = next;
      go({ q: next });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // After a jump, scroll the viewer's row into view once its page has loaded
  useEffect(() => {
    if (!jumpedId || data.status !== "success") return;
    const el = document.getElementById(rowId(jumpedId));
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    el.focus({ preventScroll: true });
    setLanded(jumpNonce);
  }, [jumpedId, jumpNonce, data.status, data.data]);

  // The mark fades on its own once the row is on screen
  useEffect(() => {
    if (!landed) return;
    const t = setTimeout(() => setJumpedId(null), 2400);
    return () => clearTimeout(t);
  }, [landed]);

  useEffect(() => setJump({ state: "idle" }), [mode, user?.steamId]);

  const columns = useMemo(() => buildColumns({ podium: !friends, friendIds, jumpedId }), [friends, friendIds, jumpedId]);
  const totalPages = data.data && !friends ? Math.ceil(data.data.total / PAGE) : 1;
  const fb = friends ? (data.data as FriendsLeaderboard | null | undefined) : null;
  const friendsNote =
    fb && !fb.friendsAvailable
      ? fb.reason === "friends_private"
        ? "Your Steam friends list is private, so only you are shown. Make it public on Steam to compare."
        : "Steam friends are unavailable right now, so only you are shown."
      : null;

  function go(next: Nav) {
    const sp = new URLSearchParams(params);
    if (next.mode) sp.set("mode", next.mode);
    if (next.board) sp.set("board", next.board);
    if (sp.get("board") === "global") sp.delete("board");
    if (next.q !== undefined) {
      if (next.q) sp.set("q", next.q);
      else sp.delete("q");
    }
    sp.set("page", String(next.page ?? 0));
    if (sp.get("page") === "0") sp.delete("page");
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  async function jumpToMe() {
    if (!user) return;
    setJump({ state: "loading" });
    try {
      const me = await leaderboardApi.me(mode, PAGE);
      if (!me.placed || me.offset === null) {
        setJump({ state: "unplaced", needed: me.needed });
        return;
      }
      setJump({ state: "idle" });
      lastQ.current = "";
      setText("");
      go({ page: me.offset / PAGE, q: "" });
      setJumpedId(user.steamId);
      setJumpNonce((n) => n + 1);
    } catch {
      setJump({ state: "error" });
    }
  }

  const searchHint = q.length > 0 && q.length < CONTAINS_MIN_LEN ? "Names starting with" : "Names containing";
  const jumpNote =
    jump.state === "unplaced"
      ? jump.needed > 0
        ? `Play ${jump.needed} more ${jump.needed === 1 ? "match" : "matches"} in ${MODE_COPY[mode].label} to place.`
        : `You are not placed in ${MODE_COPY[mode].label}.`
      : jump.state === "error"
        ? "Could not find your rank. Try again."
        : null;

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Leaderboard</h1>
          <p>{matchCountLabel(LEADERBOARD_MIN_MATCHES)} to place.</p>
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
            {!friends && (
              <div className={styles.toolbar}>
                <div className={styles.search} role="search">
                  <label htmlFor={searchId} className="visually-hidden">
                    Search players by name
                  </label>
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={styles.searchIcon}>
                    <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                    <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                  <input
                    id={searchId}
                    type="search"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={32}
                    placeholder="Search by name"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </div>
                {user && (
                  <Button variant="secondary" onClick={jumpToMe} loading={jump.state === "loading"} className={styles.jump}>
                    Jump to my rank
                  </Button>
                )}
              </div>
            )}
            {!friends && (jumpNote || q) && (
              <p className={cx(styles.status, jumpNote && styles.statusWarn)} role="status">
                {jumpNote ??
                  (data.status === "success" && data.data
                    ? `${searchHint} "${q}": ${data.data.total} ${data.data.total === 1 ? "player" : "players"}. Ranks are global.`
                    : `Searching for "${q}"`)}
              </p>
            )}
            {friends && !user && !sessionLoading ? (
              <Card as="div" tone="flat" padded={false} className={styles.notice}>
                <p>Sign in to see where you stand against your Steam friends.</p>
                <ButtonLink href="/login">Sign in with Steam</ButtonLink>
              </Card>
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
                  empty={
                    friends
                      ? `No placed friends yet. ${matchCountLabel(LEADERBOARD_MIN_MATCHES)} to place.`
                      : q
                        ? `No placed players match "${q}".`
                        : "No placed players yet."
                  }
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
