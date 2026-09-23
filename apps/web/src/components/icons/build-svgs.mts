// Writes public/icons/*.svg from glyphs.ts
// Run with node --experimental-strip-types apps/web/src/components/icons/build-svgs.mts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FALLBACK_GLYPH, MODIFIER_GLYPHS, WEAPON_GLYPHS, type Glyph } from "./glyphs.ts";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../public/icons");

function svg(g: Glyph): string {
  let body = "";
  if (g.fill) body += `<path d="${g.fill}" fill="currentColor"/>`;
  if (g.stroke) body += `<path d="${g.stroke}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${body}</svg>\n`;
}

function write(dir: string, set: Record<string, Glyph>) {
  mkdirSync(path.join(out, dir), { recursive: true });
  for (const [name, g] of Object.entries(set)) {
    const text = svg(g);
    if (text.length > 1024) throw new Error(`${dir}/${name}.svg is ${text.length} bytes`);
    writeFileSync(path.join(out, dir, `${name}.svg`), text);
  }
}

write("weapons", { ...WEAPON_GLYPHS, unknown: FALLBACK_GLYPH });
write("modifiers", MODIFIER_GLYPHS);
