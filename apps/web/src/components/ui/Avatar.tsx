import { cx } from "./cx";
import styles from "./Avatar.module.css";

type AvatarProps = {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  status?: "online" | "ready" | "away";
};

export function Avatar({ name, src, size = "md", status }: AvatarProps) {
  // Cup team names start with "Team", so the initials skip it
  const initials = name.replace(/^team\s+/i, "").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span className={cx(styles.avatar, styles[size])}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className={styles.img} />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initials}
        </span>
      )}
      {status && (
        <span className={cx(styles.dot, styles[status])}>
          <span className="visually-hidden">{status}</span>
        </span>
      )}
    </span>
  );
}
