import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import styles from "./InviteBanner.module.css";

// Hero for invite and challenge links: art, a scrim, a kicker line, the headline, then people and chips
export function InviteBanner({
  art,
  kicker,
  title,
  chips,
  children,
}: {
  art: string;
  kicker: string;
  title: ReactNode;
  chips?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className={styles.hero}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.art} src={art} alt="" />
      <span className={styles.shade} aria-hidden="true" />
      <div className={styles.head}>
        <p className={styles.kicker}>{kicker}</p>
        <h1 className={styles.title}>{title}</h1>
      </div>
      {children && <div className={styles.people}>{children}</div>}
      {chips && <div className={styles.chips}>{chips}</div>}
    </header>
  );
}

export function BannerChip({ children, tone }: { children: ReactNode; tone?: "accent" | "win" | "loss" }) {
  return (
    <span className={styles.chip} data-tone={tone}>
      {children}
    </span>
  );
}

type Person = { steamId: string; displayName: string; avatarUrl: string | null };

export function BannerPerson({ person, role }: { person: Person; role?: string }) {
  return (
    <Link href={`/profile/${person.steamId}`} className={styles.person}>
      <Avatar name={person.displayName} src={person.avatarUrl} size="lg" />
      <span className={styles.personText}>
        {role && <span className={styles.personRole}>{role}</span>}
        <span className={styles.personName}>{person.displayName}</span>
      </span>
    </Link>
  );
}

// The open side of a challenge anyone with the link can take
export function BannerSeat({ label, role }: { label: string; role?: string }) {
  return (
    <span className={styles.person}>
      <span className={styles.seat} aria-hidden="true">
        ?
      </span>
      <span className={styles.personText}>
        {role && <span className={styles.personRole}>{role}</span>}
        <span className={styles.personName}>{label}</span>
      </span>
    </span>
  );
}

export function BannerVs() {
  return <span className={styles.vs}>vs</span>;
}
