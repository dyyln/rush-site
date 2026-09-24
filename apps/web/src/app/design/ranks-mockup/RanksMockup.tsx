"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { cx } from "@/components/ui/cx";
import { CupBadgeArt, type CupStyle } from "./CupArt";
import { Emblem, type EmblemStyle } from "./Emblems";
import {
  CONFUSABLE_DELTA,
  CUP_KINDS,
  CUP_STYLES,
  EMBLEMS,
  NAME_SCHEMES,
  PALETTES,
  PLACINGS,
  ROMAN,
  SPLITS,
  SURFACES,
  TIER_COUNT,
  VISIONS,
  bandLabel,
  closestPair,
  contrastReport,
  division,
  rgbToHex,
  simulate,
  tierIndex,
  tierProgress,
  type CupKind,
  type Option,
  type Placing,
} from "./data";
import styles from "./ranks-mockup.module.css";

// Mockup only. Fake players and ratings, nothing reads the real ladder

const TIERS = Array.from({ length: TIER_COUNT }, (_, i) => i);
const CURRENT = PALETTES[0]!;
const METALS = NAME_SCHEMES[0]!;

// Chip used across the page. Colour, emblem and names come from the option being shown
type ChipProps = {
  tier: number;
  names: readonly string[];
  colors: readonly string[];
  emblem?: EmblemStyle;
  size?: "sm" | "md";
  rating?: number;
  suffix?: ReactNode;
  progress?: number;
};
function RankChip({ tier, names, colors, emblem = "chevron", size = "md", rating, suffix, progress }: ChipProps) {
  const px = size === "sm" ? 12 : 15;
  return (
    <span className={cx(styles.chip, size === "sm" && styles.chipSm)} style={{ "--tc": colors[tier] } as CSSProperties}>
      <Emblem style={emblem} tier={tier} size={px} />
      <span>{names[tier]}</span>
      {suffix && <span className={styles.chipSuffix}>{suffix}</span>}
      {rating !== undefined && <span className={cx(styles.chipRating, "mono")}>{rating}</span>}
      {progress !== undefined && (
        <span className={styles.chipBar} role="img" aria-label={`${Math.round(progress * 100)}% through the tier`}>
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      )}
    </span>
  );
}

function Section({ n, title, lede, children }: { n: number; title: string; lede: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={`s${n}`}>
      <div className="title-band">
        <p className="eyebrow">Section {n}</p>
        <h2 id={`s${n}`} className={styles.h2}>
          {title}
        </h2>
        <p className={styles.lede}>{lede}</p>
      </div>
      {children}
    </section>
  );
}

function OptionCard({ opt, children, wide }: { opt: Option; children: ReactNode; wide?: boolean }) {
  return (
    <article className={cx("glass", styles.card, wide && styles.cardWide)}>
      <header className={styles.cardHead}>
        <span className={styles.letter} aria-hidden="true">
          {opt.label}
        </span>
        <div>
          <h3 className={styles.h3}>
            <span className="visually-hidden">Option {opt.label}: </span>
            {opt.name}
          </h3>
          <p className={styles.why}>{opt.why}</p>
        </div>
      </header>
      {children}
    </article>
  );
}

// 1. Names
function NamesSection() {
  return (
    <Section n={1} title="Rank names" lede="Four name sets over the same six rating bands. Shown with the current colours and chevrons.">
      <div className={styles.grid}>
        {NAME_SCHEMES.map((s) => (
          <OptionCard key={s.id} opt={s}>
            <ol className={styles.ladder} reversed>
              {[...TIERS].reverse().map((i) => (
                <li key={i} style={{ "--tc": CURRENT.colors[i] } as CSSProperties}>
                  <Emblem style="chevron" tier={i} size={18} />
                  <span className={styles.ladderName}>{s.names[i]}</span>
                  <span className={cx(styles.ladderBand, "mono")}>{bandLabel(i)}</span>
                </li>
              ))}
            </ol>
          </OptionCard>
        ))}
      </div>
    </Section>
  );
}

// 2. Palettes
function PaletteSection() {
  return (
    <Section
      n={2}
      title="Tier colours"
      lede="Contrast is worked out live against glass on a dark scene and on a pure white scene, the worst the blur can leave behind a chip. Pass means 4.5:1 or better on both."
    >
      <div className={styles.grid3}>
        {PALETTES.map((p) => {
          const normal = closestPair(p.colors);
          return (
            <OptionCard key={p.id} opt={p}>
              <table className={styles.swatchTable}>
                <caption className="visually-hidden">Contrast of each tier colour in palette {p.label}</caption>
                <thead>
                  <tr>
                    <th scope="col">Tier</th>
                    <th scope="col">Dark</th>
                    <th scope="col">Worst</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {TIERS.map((i) => {
                    const c = p.colors[i]!;
                    const r = contrastReport(c);
                    return (
                      <tr key={i}>
                        <th scope="row">
                          <RankChip tier={i} names={METALS.names} colors={p.colors} emblem="bars" size="sm" />
                          <span className={cx(styles.hex, "mono")}>{c}</span>
                        </th>
                        <td className="mono">{r.ratios[0]!.toFixed(2)}</td>
                        <td className="mono">{r.ratios[1]!.toFixed(2)}</td>
                        <td>
                          <span className={r.pass ? styles.pass : styles.fail}>{r.pass ? "Pass" : "Fail"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className={styles.sims}>
                <SimRow label="Normal vision" colors={p.colors} pair={normal} />
                {VISIONS.map((v) => (
                  <SimRow key={v.id} label={v.name} colors={p.colors.map((c) => simulate(c, v.id))} pair={closestPair(p.colors, v.id)} />
                ))}
              </div>
            </OptionCard>
          );
        })}
      </div>
      <p className={cx("glass", styles.note)}>
        Surfaces used: {SURFACES.map((s) => `${s.name} ${rgbToHex(s.rgb)}`).join(", ")}.
        Pairs closer than ΔE {CONFUSABLE_DELTA} are flagged: they need the bar count or name to tell apart, which every chip carries.
      </p>
    </Section>
  );
}

function SimRow({ label, colors, pair }: { label: string; colors: readonly string[]; pair: { a: number; b: number; d: number } }) {
  const close = pair.d < CONFUSABLE_DELTA;
  return (
    <div className={styles.simRow}>
      <span className={styles.simLabel}>{label}</span>
      <span className={styles.simSwatches} aria-hidden="true">
        {colors.map((c, i) => (
          <span key={i} className={styles.simSwatch} style={{ color: c }}>
            <Emblem style="bars" tier={i} size={14} />
          </span>
        ))}
      </span>
      <span className={cx(styles.simNote, close && styles.simWarn)}>
        {close ? "Close: " : "Closest: "}
        {METALS.names[pair.a]} / {METALS.names[pair.b]} <span className="mono">ΔE {pair.d.toFixed(1)}</span>
      </span>
    </div>
  );
}

// 3. Splits
function splitChip(split: string, rating: number, colors: readonly string[], names: readonly string[], emblem: EmblemStyle, rank: number, size: "sm" | "md" = "md") {
  const t = tierIndex(rating);
  const common = { tier: t, names, colors, emblem, size, rating };
  if (split === "div") return <RankChip {...common} suffix={ROMAN[division(rating) - 1]} />;
  if (split === "divTop")
    return <RankChip {...common} suffix={t === TIER_COUNT - 1 ? <span className="mono">#{rank}</span> : ROMAN[division(rating) - 1]} />;
  if (split === "bar") return <RankChip {...common} progress={tierProgress(rating)} />;
  return <RankChip {...common} />;
}

function SplitsSection() {
  const samples = [
    { rating: 1712, rank: 214, note: "Mid Gold" },
    { rating: 942, rank: 5120, note: "Top of Iron" },
    { rating: 2486, rank: 3, note: "Elite, 3rd on ladder" },
  ];
  return (
    <Section n={3} title="Splits and divisions" lede="How a 1712 rating reads in each option, with a low and an Elite example for contrast.">
      <div className={styles.grid}>
        {SPLITS.map((s) => (
          <OptionCard key={s.id} opt={s}>
            <ul className={styles.sampleList}>
              {samples.map((x) => (
                <li key={x.rating}>
                  <span className={styles.sampleNote}>{x.note}</span>
                  {splitChip(s.id, x.rating, CURRENT.colors, METALS.names, "chevron", x.rank)}
                </li>
              ))}
            </ul>
            <table className={styles.bandTable}>
              <caption className="visually-hidden">Rating bands implied by option {s.label}</caption>
              <tbody>
                {[...TIERS].reverse().map((i) => (
                  <tr key={i}>
                    <th scope="row" style={{ color: CURRENT.colors[i] }}>
                      {METALS.names[i]}
                    </th>
                    {s.id === "none" || s.id === "bar" || (s.id === "divTop" && i === TIER_COUNT - 1) ? (
                      <td colSpan={3} className="mono">
                        {bandLabel(i)}
                        {s.id === "divTop" && i === TIER_COUNT - 1 && <span className={styles.muted}> · shows #place</span>}
                      </td>
                    ) : (
                      [3, 2, 1].map((d) => (
                        <td key={d} className="mono">
                          <span className={styles.divName}>{ROMAN[d - 1]}</span> {bandLabel(i, d)}
                        </td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </OptionCard>
        ))}
      </div>
    </Section>
  );
}

// 4. Emblems
function EmblemSection() {
  return (
    <Section n={4} title="Rank emblems" lede="Original marks only. Each carries a count or shape per tier, so colour is never the only cue.">
      <div className={styles.stack}>
        {EMBLEMS.map((e) => (
          <OptionCard key={e.id} opt={e} wide>
            <div className={styles.emblemRow}>
              {TIERS.map((i) => (
                <figure key={i} className={styles.emblemCell} style={{ color: CURRENT.colors[i] }}>
                  <span className={styles.emblemLarge}>
                    <Emblem style={e.id as EmblemStyle} tier={i} size={64} />
                  </span>
                  <figcaption>{METALS.names[i]}</figcaption>
                </figure>
              ))}
            </div>
            <div className={styles.chipRows}>
              <div className={styles.chipLine}>
                <span className={styles.lineLabel}>sm</span>
                {TIERS.map((i) => (
                  <RankChip key={i} tier={i} names={METALS.names} colors={CURRENT.colors} emblem={e.id as EmblemStyle} size="sm" />
                ))}
              </div>
              <div className={styles.chipLine}>
                <span className={styles.lineLabel}>md</span>
                {TIERS.map((i) => (
                  <RankChip key={i} tier={i} names={METALS.names} colors={CURRENT.colors} emblem={e.id as EmblemStyle} />
                ))}
              </div>
              <div className={styles.chipLine}>
                <span className={styles.lineLabel}>rating</span>
                {[870, 1150, 1455, 1712, 2034, 2486].map((r) => (
                  <RankChip key={r} tier={tierIndex(r)} names={METALS.names} colors={CURRENT.colors} emblem={e.id as EmblemStyle} rating={r} />
                ))}
              </div>
            </div>
          </OptionCard>
        ))}
      </div>
    </Section>
  );
}

// 5. Cup badges
const SHELF: { placing: Placing; kind: CupKind; name: string; date: string }[] = [
  { placing: "1", kind: "weekly", name: "Weekly Rush Cup", date: "14 Sep" },
  { placing: "1", kind: "daily", name: "Daily Aim Cup", date: "20 Sep" },
  { placing: "2", kind: "special", name: "Rush Launch Cup", date: "22 Sep" },
  { placing: "2", kind: "daily", name: "Daily Rush Cup", date: "18 Sep" },
  { placing: "4", kind: "weekly", name: "Weekly Aim Cup", date: "7 Sep" },
  { placing: "8", kind: "daily", name: "Daily 2v2 Cup", date: "3 Sep" },
];

function CupSection() {
  return (
    <Section
      n={5}
      title="Cup badges"
      lede="Single elimination has no third place match, so the four placings are Champion, Runner-up, Top 4 (semi-finalists) and Top 8. A 3rd needs a bronze decider."
    >
      <div className={styles.grid}>
        {CUP_STYLES.map((c) => (
          <OptionCard key={c.id} opt={c}>
            <table className={styles.cupGrid}>
              <caption className="visually-hidden">Every placing and cup kind in style {c.label}</caption>
              <thead>
                <tr>
                  <td />
                  {PLACINGS.map((p) => (
                    <th key={p.id} scope="col">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CUP_KINDS.map((k) => (
                  <tr key={k.id}>
                    <th scope="row">{k.name}</th>
                    {PLACINGS.map((p) => (
                      <td key={p.id}>
                        <CupBadgeArt style={c.id as CupStyle} placing={p.id} kind={k.id} size={44} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.subhead}>Profile shelf</p>
            <ul className={styles.shelf}>
              {SHELF.slice(0, 4).map((b, n) => (
                <li key={n}>
                  <CupBadgeArt style={c.id as CupStyle} placing={b.placing} kind={b.kind} size={52} />
                  <span className={styles.shelfName}>{b.name}</span>
                  <span className={styles.shelfMeta}>
                    {PLACINGS.find((p) => p.id === b.placing)!.name} · {b.date}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.subhead}>Inline, 18 px</p>
            <p className={styles.inlineDemo}>
              <span className={styles.inlineName}>kestrel</span>
              {SHELF.map((b, n) => (
                <CupBadgeArt key={n} style={c.id as CupStyle} placing={b.placing} kind={b.kind} size={18} />
              ))}
              <span className="visually-hidden">2 cup wins, 2 runner-up, 1 top 4, 1 top 8</span>
            </p>
          </OptionCard>
        ))}
      </div>
    </Section>
  );
}

// 6. Put together
type Combo = { names: string; palette: string; emblem: string; split: string; cup: string };

function Picker({ label, options, value, onChange }: { label: string; options: readonly Option[]; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset className={styles.picker}>
      <legend>{label}</legend>
      <div className={styles.pickerRow}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={styles.pick}
            aria-pressed={value === o.id}
            onClick={() => onChange(o.id)}
            title={o.why}
          >
            <span className={styles.pickLetter}>{o.label}</span> {o.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const BOARD = [
  { place: 3, name: "vanta", rating: 2486, w: 212, l: 118, cups: ["1", "2"] as Placing[] },
  { place: 214, name: "kestrel", rating: 1712, w: 96, l: 81, cups: ["1", "4"] as Placing[] },
  { place: 215, name: "oxbow", rating: 1709, w: 140, l: 133, cups: [] as Placing[] },
  { place: 1488, name: "lune", rating: 1288, w: 31, l: 36, cups: ["8"] as Placing[] },
];

function Combined() {
  const [c, setC] = useState<Combo>({ names: "metals", palette: "current", emblem: "chevron", split: "none", cup: "shield" });
  const set = (k: keyof Combo) => (v: string) => setC((prev) => ({ ...prev, [k]: v }));
  const names = NAME_SCHEMES.find((s) => s.id === c.names)!.names;
  const colors = PALETTES.find((p) => p.id === c.palette)!.colors;
  const emblem = c.emblem as EmblemStyle;
  const cup = c.cup as CupStyle;
  const me = BOARD[1]!;
  const t = tierIndex(me.rating);
  const modes = [
    { name: "3v3 Rush", rating: 1712, rank: 214 },
    { name: "1v1 Aim", rating: 1455, rank: 902 },
    { name: "2v2 Aim", rating: 2231, rank: 41 },
  ];

  return (
    <Section n={6} title="Put together" lede="Pick one option per row to see the combination on a profile header, a leaderboard row and a Play tile.">
      <div className={cx("glass", styles.pickers)}>
        <Picker label="Names" options={NAME_SCHEMES} value={c.names} onChange={set("names")} />
        <Picker label="Colours" options={PALETTES} value={c.palette} onChange={set("palette")} />
        <Picker label="Emblem" options={EMBLEMS} value={c.emblem} onChange={set("emblem")} />
        <Picker label="Splits" options={SPLITS} value={c.split} onChange={set("split")} />
        <Picker label="Cup badges" options={CUP_STYLES} value={c.cup} onChange={set("cup")} />
      </div>

      <div className={styles.preview} aria-live="polite">
        <div className={cx("glass", styles.profile)} style={{ "--tc": colors[t] } as CSSProperties}>
          <div className={styles.profileEmblem}>
            <Emblem style={emblem} tier={t} size={88} />
          </div>
          <div className={styles.profileMain}>
            <div className={styles.profileName}>
              <Avatar name={me.name} size="md" />
              <span>{me.name}</span>
            </div>
            <p className={styles.profileTier}>
              {names[t]}
              {(c.split === "div" || c.split === "divTop") && ` ${ROMAN[division(me.rating) - 1]}`}
              <span className={cx(styles.profileRating, "mono")}>{me.rating}</span>
            </p>
            <div className={styles.profileModes}>
              {modes.map((m) => (
                <span key={m.name} className={styles.modeChip}>
                  <span className={styles.modeName}>{m.name}</span>
                  {splitChip(c.split, m.rating, colors, names, emblem, m.rank, "sm")}
                </span>
              ))}
            </div>
          </div>
          <ul className={styles.profileCups} aria-label="Cup badges">
            {SHELF.slice(0, 4).map((b, n) => (
              <li key={n} title={`${b.name}, ${PLACINGS.find((p) => p.id === b.placing)!.name}`}>
                <CupBadgeArt style={cup} placing={b.placing} kind={b.kind} size={40} />
                <span className="visually-hidden">
                  {b.name}, {PLACINGS.find((p) => p.id === b.placing)!.name}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.previewSplit}>
          <div className={cx("glass", styles.board)}>
            <p className="eyebrow">Leaderboard · 3v3 Rush</p>
            <table className={styles.boardTable}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">Rank</th>
                  <th scope="col" className={styles.hideNarrow}>
                    W-L
                  </th>
                </tr>
              </thead>
              <tbody>
                {BOARD.map((r) => (
                  <tr key={r.name} className={r === me ? styles.meRow : undefined}>
                    <td className="mono">{r.place}</td>
                    <td>
                      <span className={styles.boardPlayer}>
                        <Avatar name={r.name} size="sm" />
                        <span>{r.name}</span>
                        {r.cups.map((p, n) => (
                          <CupBadgeArt key={n} style={cup} placing={p} kind={n === 0 ? "weekly" : "daily"} size={18} />
                        ))}
                      </span>
                    </td>
                    <td>{splitChip(c.split, r.rating, colors, names, emblem, r.place, "sm")}</td>
                    <td className={cx("mono", styles.hideNarrow)}>
                      {r.w}-{r.l}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={cx("glass", styles.tile)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/backdrops/rush_001_1.webp" alt="" className={styles.tileArt} />
            <div className={styles.tileShade} />
            <div className={styles.tileTop}>{splitChip(c.split, me.rating, colors, names, emblem, me.place)}</div>
            <div className={styles.tileBottom}>
              <span className={styles.tileMode}>Rush</span>
              <span className={styles.tileFormat}>3v3 · 43 in queue</span>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

export function RanksMockup() {
  return (
    <div className={cx("container", "page", styles.root)}>
      <header className="page-header">
        <div>
          <p className="eyebrow">Design exploration · fake data</p>
          <h1 className={styles.h1}>Ranks mockup</h1>
          <p>Compare rank names, tier colours, splits, emblems and cup badges side by side, then try combinations at the bottom.</p>
        </div>
      </header>
      <NamesSection />
      <PaletteSection />
      <SplitsSection />
      <EmblemSection />
      <CupSection />
      <Combined />
    </div>
  );
}
