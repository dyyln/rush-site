"use client";

import { useState } from "react";
import styles from "./MapThumb.module.css";

// Only maps with a drawn tile under public/maps
const TILES = new Set(["aim_map", "aim_redline", "aim_ag_texture2", "aim_usp", "aim_deagle7k", "awp_india", "rush_001"]);

// Decorative map tile. The name is shown next to it, so it is hidden from screen readers
export function MapThumb({ mapId, dim, className }: { mapId: string; dim?: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!TILES.has(mapId) || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/maps/${mapId}.svg`}
      alt=""
      aria-hidden="true"
      width={320}
      height={180}
      loading="lazy"
      className={`${styles.thumb} ${dim ? styles.dim : ""} ${className ?? ""}`}
      onError={() => setFailed(true)}
    />
  );
}
