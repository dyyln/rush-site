"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { LocalTime } from "@/components/tournaments/LocalTime";
import { MODE_COPY } from "@/lib/modes";
import { useSession } from "@/lib/session";
import { useAsync } from "@/lib/useAsync";
import { Countdown } from "./Countdown";
import { fetchNextCups, type NextCup } from "./data";
import styles from "./home.module.css";

export function NextCups() {
  const { user, loading } = useSession();
  const signedIn = !!user;
  const data = useAsync(() => (loading ? new Promise<NextCup[]>(() => {}) : fetchNextCups(signedIn)), [signedIn, loading]);

  return (
    <section className={styles.section} aria-labelledby="next-cups">
      <div className={styles.sectionHead}>
        <h2 id="next-cups" className={styles.sectionTitle}>
          Next cups
        </h2>
        <Link href="/tournaments" className={styles.more}>
          All tournaments
        </Link>
      </div>
      {data.status === "error" && (
        <div className={styles.error} role="alert">
          <p>Could not load cups.</p>
          <Button variant="secondary" onClick={data.reload}>
            Retry
          </Button>
        </div>
      )}
      {data.status === "loading" && <p className="muted">Loading</p>}
      {data.status === "success" && (
        <ul className={styles.cups}>
          {data.data.map((c) => (
            <li key={c.mode}>
              <CupCard next={c} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CupCard({ next }: { next: NextCup }) {
  const { mode, cup, entered } = next;
  if (!cup) {
    return (
      <Card as="article" tone="flat" padded={false} className={`${styles.cup} ${styles.cupEmpty}`}>
        <p className={styles.cupMode}>{MODE_COPY[mode].label}</p>
        <p className="muted">No cup open for sign ups right now.</p>
      </Card>
    );
  }
  return (
    <Card as="article" tone="flat" padded={false} className={styles.cup}>
      <div className={styles.cupTop}>
        <p className={styles.cupMode}>{MODE_COPY[mode].label}</p>
        {entered ? <Badge tone="win">Entered</Badge> : <Badge>{cup.cadence}</Badge>}
      </div>
      <h3 className={styles.cupName}>
        <Link href={`/tournaments/${cup.id}`} className={styles.cupLink}>
          {cup.name}
        </Link>
      </h3>
      <p className={styles.countdownLabel}>Starts in</p>
      <Countdown until={Date.parse(cup.startsAt)} className={styles.countdown} />
      <p className={styles.cupMeta}>
        <LocalTime iso={cup.startsAt} className="mono" />
        <span className="mono">
          {cup.entrantCount} / {cup.maxEntrants}
        </span>
      </p>
    </Card>
  );
}
