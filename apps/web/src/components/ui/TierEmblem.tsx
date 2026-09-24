import { TIERS, type TierId } from "@rushsite/shared";

// Rank emblem: a core diamond that grows angular wings as the tier rises. One feather a side
// per tier up to three, then a crest, then a base bar for the top tier. The count carries the
// order, so a tier never depends on colour alone. Drawn in currentColor, decorative only:
// the tier name is always written next to it
export function TierEmblem({ tier, size = 16, className }: { tier: TierId; size?: number; className?: string }) {
  const level = Math.max(0, TIERS.findIndex((t) => t.id === tier));
  const top = TIERS.length - 1;
  const feathers = Math.min(3, level);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className={className} data-level={level}>
      <g fill="currentColor">
        <polygon points="12,5.5 16,12 12,18.5 8,12" />
        <polygon points="12,8.4 13.9,12 12,15.6 10.1,12" fill="var(--color-bg)" fillOpacity={0.55} />
        {Array.from({ length: feathers }, (_, k) => {
          const y = 8.6 + k * 3.2;
          const x = 23.2 - k * 2.2;
          const f = (n: number) => n.toFixed(1);
          return (
            <g key={k}>
              <polygon points={`15.2,${f(y + 0.4)} ${f(x)},${f(y - 2.6)} ${f(x)},${f(y - 0.4)} 15.2,${f(y + 2.6)}`} />
              <polygon points={`8.8,${f(y + 0.4)} ${f(24 - x)},${f(y - 2.6)} ${f(24 - x)},${f(y - 0.4)} 8.8,${f(y + 2.6)}`} />
            </g>
          );
        })}
        {level >= 4 && <polygon points="12,0.5 14.4,4 9.6,4" />}
        {level === top && <polygon points="7.5,20.5 16.5,20.5 15,23 9,23" />}
      </g>
    </svg>
  );
}
