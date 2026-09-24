"use client";

import Link from "next/link";
import { SignInLink } from "@/components/ui/SignInLink";
import { useServiceStatus } from "@/components/stats/useServiceStatus";
import { MODE_COPY } from "@/lib/modes";
import { RUSH_SCENES } from "@/lib/scenes";
import styles from "./home.module.css";

// Full width banner over a Rush scene. Copy follows GET /status so home never promises a queue that is closed.
// Sign in is the way in for guests. The dock has it too, this one sits where the eye lands first
export function HomeHero() {
  const status = useServiceStatus();
  const open = status?.modes.filter((m) => m.available) ?? [];
  const closed = status !== null && open.length === 0;
  const partly = status !== null && open.length > 0 && open.length < status.modes.length;

  return (
    <section className={styles.hero} aria-labelledby="home-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.heroArt} src={RUSH_SCENES[1]?.src ?? RUSH_SCENES[0]!.src} alt="" />
      <div className={styles.heroShade} />
      <p className={styles.kicker}>For CS2</p>
      <h1 id="home-title" className={styles.heroTitle}>
        Challenge your aim.
        <br />
        Prove your skill.
      </h1>
      <p className={styles.lede}>3v3 Rush, 1v1 Aim and 2v2 Aim on our own servers. A rating per mode and free cups every day.</p>
      {closed && (
        <p className={styles.notice} role="status">
          Servers are not open yet. Queues open as soon as servers come online. <Link href="/status">Server status</Link>
        </p>
      )}
      {partly && (
        <p className={styles.notice} role="status">
          Open now: {open.map((m) => MODE_COPY[m.mode].label).join(" and ")}. <Link href="/status">Server status</Link>
        </p>
      )}
      <div className={styles.heroActions}>
        <SignInLink returnTo="/play" size="lg">
          Sign in with Steam
        </SignInLink>
      </div>
    </section>
  );
}
