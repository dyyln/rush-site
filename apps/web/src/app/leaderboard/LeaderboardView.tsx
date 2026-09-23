"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LEADERBOARD_MIN_MATCHES, MODES, type Mode } from "@rushsite/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Table, type Column } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { TierChip } from "@/components/ui/TierChip";
import { api } from "@/lib/api";
import { pct, winRate } from "@/lib/format";
import { MODE_COPY, isMode } from "@/lib/modes";
import { useSession } from "@/lib/session";
import type { LeaderboardRow } from "@/lib/types";
import { useAsync } from "@/lib/useAsync";
import styles from "./leaderboard.module.css";

const PAGE = 50;

const columns: Column<LeaderboardRow>[] = [
  { key: "rank", header: "#", cell: (r) => r.rank, numeric: true, width: "56px" },
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
  { key: "tier", header: "Tier", cell: (r) => <TierChip tier={r.tier} size="sm" />, hideOnMobile: true },
  { key: "rating", header: "Rating", cell: (r) => r.rating, numeric: true },
  { key: "winrate", header: "Win %", cell: (r) => pct(winRate(r.wins, r.matches)), numeric: true, hideOnMobile: true },
  { key: "matches", header: "Matches", cell: (r) => r.matches, numeric: true, hideOnMobile: true },
];

export function LeaderboardView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useSession();
  const raw = params.get("mode");
  const mode: Mode = isMode(raw) ? raw : "rush3v3";
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const data = useAsync(() => api.leaderboard(mode, { offset: page * PAGE, limit: PAGE }), [mode, page]);
  const totalPages = data.data ? Math.ceil(data.data.total / PAGE) : 1;

  function go(next: { mode?: Mode; page?: number }) {
    const q = new URLSearchParams(params);
    if (next.mode) q.set("mode", next.mode);
    q.set("page", String(next.page ?? 0));
    if (q.get("page") === "0") q.delete("page");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <h1>Leaderboard</h1>
          <p>Global, one ladder per mode. Players need {LEADERBOARD_MIN_MATCHES} matches in a mode to place.</p>
        </div>
      </header>

      <Tabs
        label="Mode"
        value={mode}
        onChange={(m) => go({ mode: m })}
        items={MODES.map((m) => ({ key: m, label: MODE_COPY[m].label }))}
      >
        {data.status === "error" ? (
          <div className={styles.error} role="alert">
            <p>Could not load the leaderboard.</p>
            <Button variant="secondary" onClick={data.reload}>
              Retry
            </Button>
          </div>
        ) : (
          <Table
            caption={`${MODE_COPY[mode].label} leaderboard`}
            columns={columns}
            rows={data.data?.rows ?? []}
            rowKey={(r) => r.steamId}
            loading={data.status === "loading"}
            highlight={(r) => r.steamId === user?.steamId}
            empty="No placed players yet."
          />
        )}
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
