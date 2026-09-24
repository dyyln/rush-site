import { PLACINGS, type CupKind, type Placing } from "./data";

// Mockup only. Original cup badge art. Placing is written on the badge (1, 2, T4, T8) and the
// cup kind changes the outline (weekly adds a second rim or tier, special adds a purple gem),
// so neither depends on colour. Decorative, the placing is always written next to it too

export type CupStyle = "medal" | "shield" | "pennant" | "trophy";
const SPECIAL = "#b3a4d6";
// Vertical centre of the badge body per style, where the placing mark sits
const CENTER: Record<CupStyle, number> = { medal: 31, shield: 23, pennant: 20, trophy: 15 };

type Props = { style: CupStyle; placing: Placing; kind: CupKind; size?: number };

export function CupBadgeArt({ style, placing, kind, size = 48 }: Props) {
  const color = PLACINGS.find((p) => p.id === placing)!.color;
  const mark = placing === "1" || placing === "2" ? placing : `T${placing}`;
  return (
    <svg
      viewBox="0 0 40 48"
      width={Math.round((size * 40) / 48)}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ color, flex: "none" }}
    >
      {style === "medal" && <Medal kind={kind} />}
      {style === "shield" && <Shield kind={kind} />}
      {style === "pennant" && <Pennant kind={kind} />}
      {style === "trophy" && <Trophy kind={kind} />}
      {size >= 28 && (
        <text
          x="20"
          y={CENTER[style]}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="currentColor"
          style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: mark.length > 1 ? 9 : 12 }}
        >
          {mark}
        </text>
      )}
      {size < 28 && (
        <g fill="currentColor" transform={`translate(0 ${CENTER[style] - 31})`}>
          {placing === "1" && <path d="m20 24.5 2 4 4.4.5-3.2 3 .8 4.4-4-2.2-4 2.2.8-4.4-3.2-3 4.4-.5Z" />}
          {placing === "2" && <path d="M13 27h14v3H13Z M13 32h14v3H13Z" />}
          {placing === "4" && <path d="M13 29.5h14v3H13Z" />}
        </g>
      )}
    </svg>
  );
}

const body = { fill: "currentColor", fillOpacity: 0.16, stroke: "currentColor", strokeWidth: 2 } as const;

function Medal({ kind }: { kind: CupKind }) {
  const strap = kind === "special" ? SPECIAL : "currentColor";
  const teeth: string[] = [];
  for (let k = 0; k < 24; k++) {
    const a = (k * Math.PI) / 12;
    const r = k % 2 === 0 ? 16.5 : 14.2;
    teeth.push(`${(20 + r * Math.cos(a)).toFixed(2)},${(31 + r * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <g>
      <path d="M9 0h7l6 14h-7Z" fill={strap} fillOpacity={0.55} />
      <path d="M31 0h-7l-6 14h7Z" fill={strap} fillOpacity={0.8} />
      {kind === "weekly" && <polygon points={teeth.join(" ")} fill="currentColor" fillOpacity={0.35} />}
      <circle cx="20" cy="31" r="13" {...body} />
      {kind === "special" && <path d="M20 14.5l3 3-3 3-3-3Z" fill={SPECIAL} stroke="var(--color-bg)" strokeWidth={1} />}
    </g>
  );
}

function Shield({ kind }: { kind: CupKind }) {
  return (
    <g>
      {kind === "weekly" && (
        <path d="M20 1 38 6.5v16C38 35 30 42 20 47 10 42 2 35 2 22.5V6.5Z" fill="none" stroke="currentColor" strokeWidth={1.2} />
      )}
      <path d="M20 4.5 34.5 9v13.5c0 10-6.5 16-14.5 20.5C12 38.5 5.5 32.5 5.5 22.5V9Z" {...body} />
      {kind === "special" && <path d="M5.5 12 20 8l14.5 4v3.5L20 11.5 5.5 15.5Z" fill={SPECIAL} />}
      {kind === "weekly" && <path d="M14 1.5h12l-2 3h-8Z" fill="currentColor" />}
    </g>
  );
}

function Pennant({ kind }: { kind: CupKind }) {
  return (
    <g>
      <rect x="3" y="1" width="34" height="3" fill="currentColor" />
      <path d="M7 4h26v40l-13-8-13 8Z" {...body} />
      {kind === "weekly" && (
        <g fill="currentColor">
          <rect x="7" y="29" width="26" height="2" />
          <rect x="7" y="33" width="26" height="1.5" fillOpacity={0.7} />
        </g>
      )}
      {kind === "special" && <path d="M7 4h26v4H7Z M7 4v40l3-1.8V4Z M33 4v40l-3-1.8V4Z" fill={SPECIAL} />}
    </g>
  );
}

function Trophy({ kind }: { kind: CupKind }) {
  const weekly = kind === "weekly";
  return (
    <g>
      <path d="M8 6H3v5c0 5 3.5 8 7 8.5M32 6h5v5c0 5-3.5 8-7 8.5" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M8 3h24v10c0 8-5 13-12 13S8 21 8 13Z" {...body} />
      <path d="M18 26h4v6h-4Z" fill="currentColor" />
      {weekly ? (
        <g fill="currentColor">
          <rect x="12" y="32" width="16" height="4" />
          <rect x="9" y="37" width="22" height="4" fillOpacity={0.8} />
          <rect x="6" y="42" width="28" height="4" fillOpacity={0.6} />
        </g>
      ) : (
        <rect x="11" y="32" width="18" height="5" fill="currentColor" />
      )}
      {kind === "special" && <path d="M20 0l3 3-3 3-3-3Z" fill={SPECIAL} stroke="var(--color-bg)" strokeWidth={1} />}
    </g>
  );
}
