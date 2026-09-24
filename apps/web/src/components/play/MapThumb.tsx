"use client";

import { useState } from "react";
import { useMapPool } from "@/lib/mapPool";
import styles from "./MapThumb.module.css";

// Workshop previews saved under public/maps. See public/maps/README.md
const PREVIEWS = new Set(["aim_map", "aim_redline", "aim_ag_texture2", "aim_usp", "aim_deagle7k", "awp_india"]);
// Drawn tiles under public/maps. The neutral fallback
const TILES = new Set([...PREVIEWS, "rush_001"]);

// Local preview first, then the Steam preview of an admin added map, then the drawn tile
function sources(mapId: string, previewUrl: string | null | undefined): string[] {
  const out: string[] = [];
  if (PREVIEWS.has(mapId)) out.push(`/maps/${mapId}.webp`);
  else if (previewUrl) out.push(previewUrl);
  if (TILES.has(mapId)) out.push(`/maps/${mapId}.svg`);
  return out;
}

// Decorative map tile. The name is shown next to it, so it is hidden from screen readers
export function MapThumb({ mapId, dim, className }: { mapId: string; dim?: boolean; className?: string }) {
  const pool = useMapPool();
  const list = sources(mapId, pool.get(mapId)?.previewUrl);
  const [failed, setFailed] = useState(0);
  const src = list[failed];
  if (!src) return <span aria-hidden="true" className={`${styles.thumb} ${styles.blank} ${className ?? ""}`} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt=""
      aria-hidden="true"
      width={320}
      height={180}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={`${styles.thumb} ${dim ? styles.dim : ""} ${className ?? ""}`}
      onError={() => setFailed((n) => n + 1)}
    />
  );
}
