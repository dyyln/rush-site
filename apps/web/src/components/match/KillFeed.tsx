import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import type { MatchKill } from "@/lib/types";
import { HeadshotIcon, WallbangIcon, WeaponIcon, weaponLabel } from "./icons";
import type { Roster } from "./roster";
import styles from "./KillFeed.module.css";

function Name({ steamId, roster }: { steamId: string; roster: Roster }) {
  const who = roster.get(steamId);
  const side: TeamSide = who?.side ?? "enemy";
  return (
    <span className={styles.name} data-side={side}>
      <TeamMarker side={side} />
      <span className={styles.nameText}>{who?.player.displayName ?? `player_${steamId.slice(-4)}`}</span>
    </span>
  );
}

export function KillFeed({ kills, roster }: { kills: MatchKill[]; roster: Roster }) {
  if (kills.length === 0) return <p className="muted">No kills recorded this round.</p>;
  const sorted = [...kills].sort((a, b) => a.tick - b.tick);
  return (
    <ol className={styles.feed}>
      {sorted.map((k, i) => {
        const assist = k.assister ? roster.get(k.assister)?.player.displayName : undefined;
        const tk = roster.get(k.attacker)?.team !== undefined && roster.get(k.attacker)?.team === roster.get(k.victim)?.team;
        const extras = [k.headshot && "headshot", k.wallbang && "through a wall", tk && "team kill"].filter(Boolean).join(", ");
        return (
          <li key={`${k.tick}-${i}`} className={styles.kill} data-tk={tk || undefined}>
            <span className={styles.attacker}>
              <Name steamId={k.attacker} roster={roster} />
              {assist && <span className={styles.assist}>+ {assist}</span>}
            </span>
            <span className={styles.how}>
              <WeaponIcon weapon={k.weapon} className={styles.weapon} />
              <span className={`${styles.weaponName} mono`}>{weaponLabel(k.weapon)}</span>
              {k.wallbang && <WallbangIcon label="Wallbang" className={styles.flag} />}
              {k.headshot && <HeadshotIcon label="Headshot" className={styles.flag} />}
              {tk && (
                <span className={styles.tk} aria-hidden="true">
                  TK
                </span>
              )}
            </span>
            <span className={styles.victim}>
              <span className="visually-hidden">killed </span>
              <Name steamId={k.victim} roster={roster} />
              {extras && <span className="visually-hidden">, {extras}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
