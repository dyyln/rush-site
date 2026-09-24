"use client";

import { isRushMode } from "@rushsite/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/tournaments/LocalTime";
import { MODE_ART, MODE_COPY } from "@/lib/modes";
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
      </div>
      {data.status === "error" && (
        <div className={styles.error} role="alert">
          <p>Could not load cups.</p>
          <Button variant="secondary" onClick={data.reload}>
            Retry
          </Button>
        </div>
      )}
      {data.status === "loading" && <p className={`glass ${styles.empty}`}>Loading cups.</p>}
      {data.status === "success" && (
        <ul className={styles.cups}>
          {[...data.data]
            .sort((a, b) => Number(isRushMode(b.mode)) - Number(isRushMode(a.mode)))
            .map((c) => (
              <li key={c.mode}>
                <CupCard next={signedIn ? c : { ...c, entered: false }} />
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
      <article className={`glass ${styles.cup} ${styles.cupEmpty}`}>
        <p className={styles.cupMode}>{MODE_COPY[mode].label}</p>
        <p className="muted">No cup open for sign ups right now.</p>
      </article>
    );
  }
  return (
    <article className={styles.cup}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.cupArt} src={MODE_ART[mode]} alt="" />
      <span className={styles.cupShade} />
      <div className={styles.cupTop}>
        <p className={styles.cupMode}>{MODE_COPY[mode].label}</p>
        {entered ? <Badge tone="win">Entered</Badge> : <Badge>{cup.cadence}</Badge>}
      </div>
      <h3 className={styles.cupName}>{cup.name}</h3>
      <p className={styles.countdownLabel}>Starts in</p>
      <Countdown until={Date.parse(cup.startsAt)} className={styles.countdown} />
      <p className={styles.cupMeta}>
        <LocalTime iso={cup.startsAt} className="mono" />
        <span className="mono">
          {cup.entrantCount} / {cup.maxEntrants}
        </span>
      </p>
    </article>
  );
}
