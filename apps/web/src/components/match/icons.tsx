// Small inline icons for the match page. Colour comes from currentColor

type IconProps = { label?: string; className?: string };

function a11y(label?: string) {
  return label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true as const };
}

export function HeadshotIcon({ label, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" className={className} focusable="false" {...a11y(label)}>
      <circle cx="8" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 15c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="8" cy="6" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function WallbangIcon({ label, className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" className={className} focusable="false" {...a11y(label)}>
      <path d="M6 1.5h4v13H6z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6 5.5h4M6 10h4M8 1.5v4M8 10v4.5" stroke="currentColor" strokeWidth="1" />
      <path d="M1 8h14M12.5 5.5L15 8l-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type WeaponKind = "rifle" | "sniper" | "smg" | "pistol" | "knife" | "grenade";

const KIND: Record<string, WeaponKind> = {
  awp: "sniper",
  ssg08: "sniper",
  scar20: "sniper",
  g3sg1: "sniper",
  mp9: "smg",
  mac10: "smg",
  mp7: "smg",
  mp5sd: "smg",
  ump45: "smg",
  p90: "smg",
  bizon: "smg",
  glock: "pistol",
  usp_silencer: "pistol",
  hkp2000: "pistol",
  p250: "pistol",
  deagle: "pistol",
  fiveseven: "pistol",
  tec9: "pistol",
  cz75a: "pistol",
  elite: "pistol",
  revolver: "pistol",
  knife: "knife",
  bayonet: "knife",
  hegrenade: "grenade",
  molotov: "grenade",
  incgrenade: "grenade",
  inferno: "grenade",
};

const LABELS: Record<string, string> = {
  ak47: "AK-47",
  m4a1_silencer: "M4A1-S",
  m4a1: "M4A4",
  m4a4: "M4A4",
  awp: "AWP",
  ssg08: "SSG 08",
  deagle: "Desert Eagle",
  usp_silencer: "USP-S",
  hkp2000: "P2000",
  glock: "Glock-18",
  p250: "P250",
  mp9: "MP9",
  mac10: "MAC-10",
  famas: "FAMAS",
  galilar: "Galil AR",
  aug: "AUG",
  sg556: "SG 553",
  hegrenade: "HE Grenade",
  inferno: "Fire",
  knife: "Knife",
};

function weaponId(weapon: string): string {
  return weapon.replace(/^weapon_/, "").toLowerCase();
}

export function weaponLabel(weapon: string): string {
  const id = weaponId(weapon);
  return LABELS[id] ?? (id.startsWith("knife") ? "Knife" : id.toUpperCase());
}

function weaponKind(weapon: string): WeaponKind {
  const id = weaponId(weapon);
  if (id.startsWith("knife")) return "knife";
  return KIND[id] ?? "rifle";
}

const WEAPON_PATHS: Record<WeaponKind, string> = {
  rifle: "M1 5h15l1.5-1H23v2h-3v1.5h-6.5L12 9.5h-1.6l-.6 3H7l.7-3H5.5L4.5 12H2l1-4.5H1z",
  sniper: "M1 6h22v1.4h-9l-1.3 1.6H9.5l-.6 3.4H6l.8-3.4H4L1 7.6zM8 3.2h7v1.9H8z",
  smg: "M3 5h13l1-1h3v2h-3v1.5h-5.5l-.8 4.5H8l.6-4.5H6.2L5 11H3l.8-4H3z",
  pistol: "M5 4h14v2.6h-8.2l-1 5.4H6.6l1-5.4H5z",
  knife: "M2 7.5L14 4.5h2.5v4H14zM16.5 5h6v3h-6z",
  grenade: "M12 5.5a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4zM10.5 3h3v2.2h-3zM13.5 3.5l3.5-2 .8 1.2-3.3 2z",
};

export function WeaponIcon({ weapon, className }: { weapon: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 14" width="28" height="16" className={className} aria-hidden="true" focusable="false">
      <path d={WEAPON_PATHS[weaponKind(weapon)]} fill="currentColor" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M8 1.5v9M4.5 5L8 1.5 11.5 5M3 9v5h10V9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M8 1.5v9M4.5 7L8 10.5 11.5 7M3 14h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M4.5 2.5l9 5.5-9 5.5z" fill="currentColor" />
    </svg>
  );
}

export function FlagIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d="M3.5 14.5V2M3.5 2.5h8.5l-2 3 2 3H3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <rect x="5" y="5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 3V2.5A1.5 1.5 0 0 0 9.5 1h-6A1.5 1.5 0 0 0 2 2.5v6A1.5 1.5 0 0 0 3.5 10H4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function ChevronIcon({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={dir === "left" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
