import { Avatar } from "@/components/ui/Avatar";
import { cx } from "@/components/ui/cx";
import styles from "./AvatarStack.module.css";

export type StackPerson = {
  steamId: string;
  displayName: string;
  avatarUrl: string | null;
};

type AvatarStackProps = {
  people: StackPerson[];
  // Total entrants. The rest beyond the shown avatars becomes +N
  total: number;
  max?: number;
  // What the total counts, used in the accessible label
  noun?: [string, string];
  size?: "sm" | "md";
  className?: string;
};

export function AvatarStack({ people, total, max = 5, noun = ["entrant", "entrants"], size = "sm", className }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const rest = Math.max(0, total - shown.length);
  if (total === 0) return null;
  const label = `${total} ${total === 1 ? noun[0] : noun[1]}${shown.length ? `, including ${shown.map((p) => p.displayName).join(", ")}` : ""}`;
  return (
    <span className={cx(styles.stack, styles[size], className)} role="img" aria-label={label}>
      {shown.map((p) => (
        <span key={p.steamId} className={styles.item} title={p.displayName}>
          <Avatar name={p.displayName} src={p.avatarUrl} size={size} />
        </span>
      ))}
      {rest > 0 && <span className={cx(styles.item, styles.more, "mono")}>+{rest}</span>}
    </span>
  );
}
