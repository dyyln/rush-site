import { FALLBACK_GLYPH, MODIFIER_GLYPHS, WEAPON_GLYPHS, type Glyph } from "./glyphs";
import { weaponLabel, weaponName } from "./weapons";

type BaseProps = {
  size?: number;
  // Accessible name. Without one the icon is hidden from screen readers
  label?: string;
  className?: string;
};

function GlyphSvg({ glyph, size = 24, label, className }: BaseProps & { glyph: Glyph }) {
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} focusable="false" {...a11y}>
      {glyph.fill && <path d={glyph.fill} fill="currentColor" />}
      {glyph.stroke && (
        <path d={glyph.stroke} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

// name is a game weapon id with or without the weapon_ prefix
// labelled uses the weapon's display name as the accessible name
export function WeaponIcon({ name, labelled, label, ...rest }: BaseProps & { name: string; labelled?: boolean }) {
  const id = weaponName(name);
  const glyph = id ? WEAPON_GLYPHS[id] : FALLBACK_GLYPH;
  return <GlyphSvg glyph={glyph} label={label ?? (labelled ? weaponLabel(name) : undefined)} {...rest} />;
}

export type KillModifierName = keyof typeof MODIFIER_GLYPHS;

export const KILL_MODIFIERS: Record<KillModifierName, string> = {
  headshot: "Headshot",
  wallbang: "Wallbang",
  blind: "Attacker blind",
  smoke: "Through smoke",
  noscope: "No scope",
  assist: "Assist",
  teamkill: "Team kill",
};

// Shows its default label to screen readers unless decorative is set
export function KillModifier({ name, decorative, label, ...rest }: BaseProps & { name: KillModifierName; decorative?: boolean }) {
  return <GlyphSvg glyph={MODIFIER_GLYPHS[name]} label={decorative ? undefined : (label ?? KILL_MODIFIERS[name])} {...rest} />;
}
