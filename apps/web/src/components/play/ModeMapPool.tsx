import type { ReactNode } from "react";
import { MODE_CONFIGS, type Mode } from "@rushsite/shared";
import { MapThumb } from "./MapThumb";
import styles from "./ModeMapPool.module.css";

// Rush plays one map whose rooms the map script draws at load
function poolNote(mode: Mode): string | null {
  return MODE_CONFIGS[mode].winCondition === "valve_rush" ? "Rooms drawn at load" : null;
}

export function mapPoolId(mode: Mode) {
  return `mode-${mode}-maps`;
}

/*
  Lower area of a mode card. On hover or keyboard focus the card body swaps for a strip of the
  mode's map thumbs. Both share one grid cell, so the card is always as tall as the taller of the
  two and nothing reflows when the strip shows.

  Screen readers get the pool once, from the text line referenced by the checkbox's aria-describedby
  (mapPoolId). The strip and that line are aria-hidden so the label's name does not repeat them.
  On touch screens there is no hover, so the strip is dropped and the text line shows instead.
*/
export function ModeMapPool({ mode, reveal, children }: { mode: Mode; reveal: boolean; children: ReactNode }) {
  const maps = MODE_CONFIGS[mode].maps;
  const note = poolNote(mode);
  const names = maps.map((m) => m.displayName).join(", ");
  const text = maps.length === 1 ? `Map: ${names}${note ? `, ${note.toLowerCase()}` : ""}.` : `Map pool: ${names}.`;
  const single = maps.length === 1;

  return (
    <span className={`${styles.stack} ${reveal ? styles.reveal : ""}`}>
      <span className={styles.body}>
        {children}
        <span id={mapPoolId(mode)} className={`${styles.poolText} mono`} aria-hidden="true">
          {text}
        </span>
      </span>
      {reveal && (
        <span className={`${styles.strip} ${single ? styles.single : ""}`} aria-hidden="true">
          {maps.map((m) => (
            <span key={m.id} className={styles.tile}>
              <MapThumb mapId={m.id} className={styles.thumb} />
              <span className={styles.caption}>
                <span className={`${styles.name} mono`}>{m.displayName}</span>
                {single && note && <span className={styles.note}>{note}</span>}
              </span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
