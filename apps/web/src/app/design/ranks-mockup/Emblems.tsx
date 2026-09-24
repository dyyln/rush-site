// Mockup only. Original rank emblems, drawn in currentColor so the palette decides the colour.
// Every style carries a count or shape cue per tier so no tier depends on colour alone

export type EmblemStyle = "chevron" | "facet" | "wings" | "bars";

type Props = { style: EmblemStyle; tier: number; size?: number; color?: string; className?: string };

export function Emblem({ style, tier, size = 24, color, className }: Props) {
  const tall = style === "chevron";
  const vb = tall ? "0 0 24 28" : "0 0 24 24";
  return (
    <svg
      viewBox={vb}
      width={size}
      height={tall ? Math.round((size * 28) / 24) : size}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ color, flex: "none", overflow: "visible" }}
    >
      {style === "chevron" && <Chevrons tier={tier} />}
      {style === "facet" && <Facet tier={tier} numbered={size >= 40} />}
      {style === "wings" && <Wings tier={tier} />}
      {style === "bars" && <Bars tier={tier} />}
    </svg>
  );
}

// One to three chevrons per group of three tiers. Tier four and up add a rocker, the top tier a star
function Chevrons({ tier }: { tier: number }) {
  const count = (tier % 3) + 1;
  const peaks = [18, 13, 8].slice(0, count);
  return (
    <g fill="none" stroke="currentColor" strokeWidth={3} strokeLinejoin="miter" strokeLinecap="square">
      {peaks.map((y) => (
        <path key={y} d={`M4.5 ${y + 4.5} L12 ${y} L19.5 ${y + 4.5}`} />
      ))}
      {tier >= 3 && <path d="M4 24.5 Q12 28.5 20 24.5" strokeWidth={2.5} />}
      {tier === 5 && (
        <path
          d="m12 0 1.5 3 3.2.4-2.4 2.2.6 3.2L12 7.3 9.1 8.8l.6-3.2-2.4-2.2 3.2-.4Z"
          fill="currentColor"
          stroke="none"
        />
      )}
    </g>
  );
}

function polygon(n: number, r: number, cx = 12, cy = 12): string {
  const pts: string[] = [];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / n + (n % 2 === 0 ? Math.PI / n : 0);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

// Triangle for the first tier up to an octagon for the top one
function Facet({ tier, numbered }: { tier: number; numbered: boolean }) {
  const n = tier + 3;
  return (
    <g>
      <polygon points={polygon(n, 10.5)} fill="currentColor" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="miter" />
      {numbered ? (
        <text
          x="12"
          y="12.4"
          textAnchor="middle"
          dominantBaseline="middle"
          fill="currentColor"
          style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 7 }}
        >
          {tier + 1}
        </text>
      ) : (
        <polygon points={polygon(n, 4.2)} fill="currentColor" />
      )}
    </g>
  );
}

// A core diamond with up to three feathers per side, then a crest, then a base bar
function Wings({ tier }: { tier: number }) {
  const feathers = Math.min(3, tier);
  const right = (k: number): [number, number][] => {
    const y = 8.6 + k * 3.2;
    const x = 23.2 - k * 2.2;
    return [
      [15.2, y + 0.4],
      [x, y - 2.6],
      [x, y - 0.4],
      [15.2, y + 2.6],
    ];
  };
  const pts = (p: [number, number][]) => p.map(([x, y]) => `${x},${y}`).join(" ");
  const mirror = (p: [number, number][]) => p.map(([x, y]): [number, number] => [24 - x, y]);
  return (
    <g fill="currentColor">
      <polygon points="12,5.5 16,12 12,18.5 8,12" />
      <polygon points="12,8.4 13.9,12 12,15.6 10.1,12" fill="var(--color-bg)" fillOpacity={0.55} />
      {Array.from({ length: feathers }, (_, k) => (
        <g key={k}>
          <polygon points={pts(right(k))} />
          <polygon points={pts(mirror(right(k)))} />
        </g>
      ))}
      {tier >= 4 && <polygon points="12,0.5 14.4,4 9.6,4" />}
      {tier === 5 && <polygon points="7.5,20.5 16.5,20.5 15,23 9,23" />}
    </g>
  );
}

// Six ascending bars, filled up to the tier
function Bars({ tier }: { tier: number }) {
  return (
    <g>
      {Array.from({ length: 6 }, (_, k) => {
        const h = 5 + k * 3.2;
        const on = k <= tier;
        return (
          <rect
            key={k}
            x={1.5 + k * 3.7}
            y={22 - h}
            width={2.6}
            height={h}
            fill={on ? "currentColor" : "none"}
            stroke="currentColor"
            strokeOpacity={on ? 1 : 0.45}
            strokeWidth={on ? 0 : 0.8}
          />
        );
      })}
    </g>
  );
}
