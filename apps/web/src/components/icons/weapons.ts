import { WEAPON_GLYPHS } from "./glyphs";

export type WeaponName = keyof typeof WEAPON_GLYPHS;
export type WeaponGroup = "Pistols" | "SMGs" | "Rifles" | "Heavy" | "Melee and utility";

export const WEAPON_GROUPS: Record<WeaponGroup, WeaponName[]> = {
  Pistols: ["glock", "usp_silencer", "hkp2000", "p250", "fiveseven", "tec9", "cz75a", "deagle", "revolver", "elite"],
  SMGs: ["mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon"],
  Rifles: ["galilar", "famas", "ak47", "m4a1", "m4a1_silencer", "aug", "sg556", "ssg08", "awp", "scar20", "g3sg1"],
  Heavy: ["nova", "xm1014", "mag7", "sawedoff", "m249", "negev"],
  "Melee and utility": ["knife", "taser", "hegrenade", "flashbang", "molotov", "incgrenade", "smokegrenade", "decoy", "world"],
};

const LABELS: Record<WeaponName, string> = {
  glock: "Glock-18",
  usp_silencer: "USP-S",
  hkp2000: "P2000",
  p250: "P250",
  fiveseven: "Five-SeveN",
  tec9: "Tec-9",
  cz75a: "CZ75-Auto",
  deagle: "Desert Eagle",
  revolver: "R8 Revolver",
  elite: "Dual Berettas",
  mac10: "MAC-10",
  mp9: "MP9",
  mp7: "MP7",
  mp5sd: "MP5-SD",
  ump45: "UMP-45",
  p90: "P90",
  bizon: "PP-Bizon",
  galilar: "Galil AR",
  famas: "FAMAS",
  ak47: "AK-47",
  m4a1: "M4A4",
  m4a1_silencer: "M4A1-S",
  aug: "AUG",
  sg556: "SG 553",
  ssg08: "SSG 08",
  awp: "AWP",
  scar20: "SCAR-20",
  g3sg1: "G3SG1",
  nova: "Nova",
  xm1014: "XM1014",
  mag7: "MAG-7",
  sawedoff: "Sawed-Off",
  m249: "M249",
  negev: "Negev",
  knife: "Knife",
  taser: "Zeus x27",
  hegrenade: "HE Grenade",
  flashbang: "Flashbang",
  molotov: "Molotov",
  incgrenade: "Incendiary",
  smokegrenade: "Smoke Grenade",
  decoy: "Decoy",
  world: "World",
};

// Other names the game event can use for the same weapon
const ALIASES: Record<string, WeaponName> = {
  m4a4: "m4a1",
  m4a1s: "m4a1_silencer",
  usp: "usp_silencer",
  usps: "usp_silencer",
  p2000: "hkp2000",
  cz75: "cz75a",
  mp5: "mp5sd",
  sg553: "sg556",
  galil: "galilar",
  zeus: "taser",
  bayonet: "knife",
  inferno: "molotov",
  he: "hegrenade",
  flash: "flashbang",
  smoke: "smokegrenade",
  decoy_projectile: "decoy",
  hegrenade_projectile: "hegrenade",
  smokegrenade_projectile: "smokegrenade",
  flashbang_projectile: "flashbang",
  worldspawn: "world",
  trigger_hurt: "world",
};

function rawId(weapon: string): string {
  return weapon.trim().toLowerCase().replace(/^weapon_/, "");
}

export function weaponName(weapon: string): WeaponName | undefined {
  const id = rawId(weapon);
  if (id in WEAPON_GLYPHS) return id as WeaponName;
  if (ALIASES[id]) return ALIASES[id];
  if (id.startsWith("knife")) return "knife";
  return undefined;
}

export function weaponLabel(weapon: string): string {
  const id = rawId(weapon);
  if (id === "inferno") return "Fire";
  const name = weaponName(weapon);
  return name ? LABELS[name] : id.replace(/_/g, " ").toUpperCase() || "Unknown";
}
