import styles from "./PartySize.module.css";

export function PersonIcon({ className, outline }: { className?: string; outline?: boolean }) {
  const paint = outline
    ? { fill: "none", stroke: "currentColor", strokeWidth: 1.2 }
    : { fill: "currentColor" };
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="5" r="2.8" {...paint} />
      <path d="M2.2 14.6c0-3.2 2.6-5.2 5.8-5.2s5.8 2 5.8 5.2z" {...paint} />
    </svg>
  );
}

type PartySizeProps = {
  // Icons in the text colour
  count: number;
  // Grey icons after count, up to this total
  capacity?: number;
  // Loss coloured icons after the rest, for members over the limit
  overflow?: number;
  // Screen reader text. Also used as the tooltip
  label: string;
};

export function PartySize({ count, capacity = count, overflow = 0, label }: PartySizeProps) {
  const empty = Math.max(0, capacity - count);
  return (
    <span className={styles.row} title={label}>
      {Array.from({ length: count }, (_, i) => (
        <PersonIcon key={`c${i}`} />
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <PersonIcon key={`e${i}`} className={styles.empty} />
      ))}
      {Array.from({ length: overflow }, (_, i) => (
        <PersonIcon key={`o${i}`} className={styles.over} />
      ))}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
