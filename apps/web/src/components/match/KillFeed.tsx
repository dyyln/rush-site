import { TeamMarker, type TeamSide } from "@/components/ui/TeamMarker";
import type { MatchKill } from "@/lib/types";
import { KillModifier, WeaponIcon, weaponLabel } from "@/components/icons";
import type { Roster } from "./roster";
import styles from "./KillFeed.module.css";

function Name({ steamId, roster, highlight }: { steamId: string; roster: Roster; highlight?: string }) {
  const who = roster.get(steamId);
  const side: TeamSide = who?.side ?? "enemy";
  return (
    <span className={styles.name} data-side={side} data-highlight={steamId === highlight || undefined}>
      <TeamMarker side={side} />
      <span className={styles.nameText}>{who?.player.displayName ?? `player_${steamId.slice(-4)}`}</span>
      {steamId === highlight && <span className="visually-hidden"> (marked)</span>}
    </span>
  );
}

// highlight marks one player, such as the subject of a review
export function KillFeed({ kills, roster, highlight }: { kills: MatchKill[]; roster: Roster; highlight?: string }) {
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
              <Name steamId={k.attacker} roster={roster} highlight={highlight} />
              {assist && (
                <span className={styles.assist}>
                  <KillModifier name="assist" size={14} decorative className={styles.assistIcon} />
                  <span className="visually-hidden">assisted by </span>
                  <span className={styles.assistName}>{assist}</span>
                </span>
              )}
            </span>
            <span className={styles.how}>
              <WeaponIcon name={k.weapon} size={24} className={styles.weapon} />
              <span className={`${styles.weaponName} mono`}>{weaponLabel(k.weapon)}</span>
              {k.wallbang && <KillModifier name="wallbang" size={16} decorative className={styles.flag} />}
              {k.headshot && <KillModifier name="headshot" size={16} decorative className={styles.flag} />}
              {tk && <KillModifier name="teamkill" size={16} decorative className={styles.tk} />}
            </span>
            <span className={styles.victim}>
              <span className="visually-hidden">killed </span>
              <Name steamId={k.victim} roster={roster} highlight={highlight} />
              {extras && <span className="visually-hidden">, {extras}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
