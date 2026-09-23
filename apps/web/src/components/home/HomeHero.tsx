"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { useServiceStatus } from "@/components/stats/useServiceStatus";
import { MODE_COPY } from "@/lib/modes";
import styles from "./home.module.css";

// Hero copy and the main button follow GET /status so home never promises a queue that is closed
export function HomeHero() {
  const status = useServiceStatus();
  const open = status?.modes.filter((m) => m.available) ?? [];
  const closed = status !== null && open.length === 0;
  const partly = status !== null && open.length > 0 && open.length < status.modes.length;

  return (
    <div className={styles.hero}>
      <p className="eyebrow">For CS2</p>
      <h1 className={styles.heroTitle}>Short matches. Real ladder.</h1>
      <p className={styles.lede}>1v1 Aim, 2v2 Aim and 3v3 Rush. Rated ladders and free cups.</p>
      {closed && (
        <p className={styles.notice} role="status">
          Servers are not open yet. Queues open as soon as servers come online.{" "}
          <Link href="/status">See server status</Link>
        </p>
      )}
      {partly && (
        <p className={styles.notice} role="status">
          Open now: {open.map((m) => MODE_COPY[m.mode].label).join(" and ")}.{" "}
          <Link href="/status">Server status</Link>
        </p>
      )}
      <div className="row">
        {closed ? (
          <ButtonLink href="/status" size="lg">
            Servers are not open yet
          </ButtonLink>
        ) : (
          <ButtonLink href="/play" size="lg">
            Play now
          </ButtonLink>
        )}
        <ButtonLink href={closed ? "/play" : "/leaderboard"} size="lg" variant="secondary">
          {closed ? "See the modes" : "Leaderboard"}
        </ButtonLink>
      </div>
    </div>
  );
}
