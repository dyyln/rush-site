// Mockup only. Rank naming, palettes, splits and the colour maths behind the contrast checks

export const TIER_COUNT = 6;
// Lower bounds of the six current bands, see packages/shared/src/config/tiers.ts
export const TIER_MIN = [null, 1000, 1300, 1600, 1900, 2200] as const;

export type Option = { id: string; label: string; name: string; why: string };

// 1. Naming schemes
export type NameScheme = Option & { names: readonly string[] };
export const NAME_SCHEMES: readonly NameScheme[] = [
  {
    id: "metals",
    label: "A",
    name: "Metals (current)",
    why: "Instantly readable order, but generic and shared with many other ladders.",
    names: ["Iron", "Bronze", "Silver", "Gold", "Platinum", "Elite"],
  },
  {
    id: "tactical",
    label: "B",
    name: "Tactical",
    why: "Fits the dark tactical look. Order reads as a career path from recruit to command.",
    names: ["Recruit", "Scout", "Operator", "Striker", "Marshal", "Warden"],
  },
  {
    id: "geometric",
    label: "C",
    name: "Geometric",
    why: "Each name is a shape with one more side, so the emblem itself tells the order.",
    names: ["Point", "Line", "Trine", "Quad", "Penta", "Hex"],
  },
  {
    id: "duel",
    label: "D",
    name: "Duel path",
    why: "Original and brand-led: works for AimRift or DuelPoint and names the climb, not a metal.",
    names: ["Initiate", "Contender", "Duelist", "Challenger", "Paragon", "Zenith"],
  },
];

// 2. Palettes. Text colours for the six tiers, low to high
export type Palette = Option & { colors: readonly string[] };
export const PALETTES: readonly Palette[] = [
  {
    id: "current",
    label: "A",
    name: "Current tokens",
    why: "What tokens.css ships today. Iron and Silver are both greys, so order leans on the name.",
    colors: ["#a7a9b0", "#d19a6a", "#c9d1dc", "#e0c36a", "#7fd1e0", "#c3b2f0"],
  },
  {
    id: "ramp",
    label: "B",
    name: "Lightness ramp",
    why: "Every step is lighter than the last, so the order survives any colour vision or greyscale.",
    colors: ["#969aa8", "#d39a72", "#a6c1de", "#e3c55c", "#96ecdf", "#fbf4ff"],
  },
  {
    id: "cb",
    label: "C",
    name: "Colour-blind first",
    why: "Okabe-Ito style hues lifted for dark glass. Neighbours differ in hue and lightness.",
    colors: ["#a3a7b0", "#f0a64a", "#6cc3f0", "#f2e56b", "#4fd6a8", "#e39acb"],
  },
];

// 3. Splits
export type Split = Option;
export const SPLITS: readonly Split[] = [
  { id: "none", label: "A", name: "No splits", why: "Six tiers only. The rating number does the fine-grained work." },
  { id: "div", label: "B", name: "Divisions I to III", why: "100-point steps give a promotion every few wins. Elite also splits." },
  {
    id: "divTop",
    label: "C",
    name: "Divisions, Elite ranked",
    why: "Divisions below Elite. Elite shows the leaderboard place, the chase at the top is the ladder.",
  },
  { id: "bar", label: "D", name: "Progress bar", why: "No sub-names. A thin bar shows how far through the tier you are." },
];

// 4. Emblems and 5. cup badges are drawn in Emblems.tsx and CupArt.tsx
export const EMBLEMS: readonly Option[] = [
  { id: "chevron", label: "A", name: "Chevrons", why: "Military stripes. One to three chevrons, a rocker bar from tier four, a star on top." },
  { id: "facet", label: "B", name: "Facets", why: "A polygon with one more side per tier. Pairs with the geometric names." },
  { id: "wings", label: "C", name: "Angular wings", why: "A core diamond that grows wings as you climb. Most expressive at profile size." },
  { id: "bars", label: "D", name: "Signal bars", why: "Six ascending bars filled to your tier. Reads at 12 px, no art needed." },
];

export const CUP_STYLES: readonly Option[] = [
  { id: "medal", label: "A", name: "Medals", why: "Round disc on a ribbon. Placing number in the centre, weekly adds a notched rim." },
  { id: "shield", label: "B", name: "Shields", why: "Heraldic, close to the shipped badges. Outline changes per placing, not only colour." },
  { id: "pennant", label: "C", name: "Pennants", why: "Hanging banners that line up well on a shelf and stay narrow inline." },
  { id: "trophy", label: "D", name: "Trophies", why: "Cup silhouette. Taller for weekly, a purple gem for special events." },
];

export type Placing = "1" | "2" | "4" | "8";
export const PLACINGS: readonly { id: Placing; name: string; color: string }[] = [
  { id: "1", name: "Champion", color: "#e0c36a" },
  { id: "2", name: "Runner-up", color: "#c9d1dc" },
  { id: "4", name: "Top 4", color: "#d19a6a" },
  { id: "8", name: "Top 8", color: "#a7a9b0" },
];
export type CupKind = "daily" | "weekly" | "special";
export const CUP_KINDS: readonly { id: CupKind; name: string }[] = [
  { id: "daily", name: "Daily" },
  { id: "weekly", name: "Weekly" },
  { id: "special", name: "Special" },
];

// Rating to tier index and division
export function tierIndex(rating: number): number {
  const r = Math.round(rating);
  let i = 0;
  for (let t = 1; t < TIER_COUNT; t++) if (r >= (TIER_MIN[t] as number)) i = t;
  return i;
}

// Divisions are 100 points wide, counted from the top of each 300 point band.
// Iron has no floor, so its bands hang below 1000. Elite's top division is open ended
export function division(rating: number): 1 | 2 | 3 {
  const i = tierIndex(rating);
  const base = i === 0 ? 700 : (TIER_MIN[i] as number);
  const d = Math.floor((Math.round(rating) - base) / 100);
  return (Math.max(0, Math.min(2, d)) + 1) as 1 | 2 | 3;
}

// Share of the way through the tier, 0 to 1. Iron counts from 700, Elite fills at 2500
export function tierProgress(rating: number): number {
  const i = tierIndex(rating);
  const lo = i === 0 ? 700 : (TIER_MIN[i] as number);
  const hi = lo + 300;
  return Math.max(0, Math.min(1, (rating - lo) / (hi - lo)));
}

export const ROMAN = ["I", "II", "III"] as const;

export function bandLabel(i: number, d?: number): string {
  const lo = i === 0 ? null : (TIER_MIN[i] as number);
  const hi = i === TIER_COUNT - 1 ? null : (TIER_MIN[i + 1] as number);
  if (d === undefined) {
    if (lo === null) return `< ${hi}`;
    if (hi === null) return `${lo}+`;
    return `${lo} to ${hi - 1}`;
  }
  const base = i === 0 ? 700 : (lo as number);
  const a = base + (d - 1) * 100;
  if (i === 0 && d === 1) return `< 800`;
  if (i === TIER_COUNT - 1 && d === 3) return `${a}+`;
  return `${a} to ${a + 99}`;
}

// Colour maths

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((o) => parseInt(h.slice(o, o + 2), 16)) as RGB;
}
export function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

// Paints fg at alpha over bg
function over(fg: RGB, alpha: number, bg: RGB): RGB {
  return fg.map((c, k) => c * alpha + bg[k]! * (1 - alpha)) as RGB;
}

const toLin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLin = (l: number) => 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);

function luminance(rgb: RGB): number {
  const [r, g, b] = rgb.map(toLin) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The two surfaces a tier colour sits on. Chips use surface-1 (rgb 18 16 26 at 62%) over the
// scene, which is tinted with rgb 10 9 14 at 66%. A dark scene pixel gives the nominal glass,
// a pure white one is the worst case the blur could ever leave behind the panel
const TINT: RGB = [10, 9, 14];
const SURFACE_1: RGB = [18, 16, 26];
export const SURFACES: readonly { id: string; name: string; rgb: RGB }[] = [
  { id: "dark", name: "Glass on dark scene", rgb: over(SURFACE_1, 0.62, over(TINT, 0.66, [15, 14, 19])) },
  { id: "bright", name: "Glass on white scene (worst)", rgb: over(SURFACE_1, 0.62, over(TINT, 0.66, [255, 255, 255])) },
];

export function contrastReport(hex: string) {
  const fg = hexToRgb(hex);
  const ratios = SURFACES.map((s) => contrast(fg, s.rgb));
  const worst = Math.min(...ratios);
  return { ratios, worst, pass: worst >= 4.5 };
}

// Colour vision simulation, Machado et al. 2009 at full severity, applied in linear RGB
export type Vision = "protan" | "deutan" | "tritan";
const MACHADO: Record<Vision, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
export const VISIONS: readonly { id: Vision; name: string }[] = [
  { id: "protan", name: "Protanopia" },
  { id: "deutan", name: "Deuteranopia" },
  { id: "tritan", name: "Tritanopia" },
];

export function simulate(hex: string, v: Vision): string {
  const lin = hexToRgb(hex).map(toLin);
  const m = MACHADO[v];
  const out = m.map((row) => row[0]! * lin[0]! + row[1]! * lin[1]! + row[2]! * lin[2]!);
  return rgbToHex(out.map((l) => fromLin(Math.max(0, Math.min(1, l)))) as RGB);
}

// CIE76 difference in Lab, good enough to rank which neighbours get confused
function lab(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex).map(toLin) as RGB;
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
export function deltaE(a: string, b: string): number {
  const p = lab(a);
  const q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// Closest pair of tiers as seen with a vision type, or normal vision when v is omitted
export function closestPair(colors: readonly string[], v?: Vision) {
  const seen = colors.map((c) => (v ? simulate(c, v) : c));
  let best = { a: 0, b: 1, d: Infinity };
  for (let i = 0; i < seen.length; i++)
    for (let j = i + 1; j < seen.length; j++) {
      const d = deltaE(seen[i]!, seen[j]!);
      if (d < best.d) best = { a: i, b: j, d };
    }
  return best;
}
// Below this a pair needs the shape and number cues to tell apart
export const CONFUSABLE_DELTA = 15;
