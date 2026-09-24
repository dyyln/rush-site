import type { CSSProperties, ReactNode } from "react";
import { MODE_CONFIGS, RUSH_ROOMS, type Mode } from "@rushsite/shared";
import { rushRoomImage } from "@/lib/rushRooms";
import { MapThumb } from "./MapThumb";
import styles from "./ModeMapPool.module.css";

// Rush plays one map whose rooms the map script draws at load
function poolNote(mode: Mode): string | null {
  return MODE_CONFIGS[mode].winCondition === "valve_rush" ? "Rooms drawn at load" : null;
}

// A taste of the Complex for the Rush card, one room of each kind from castle to castle
const RUSH_FAN = [RUSH_ROOMS.castles.t, RUSH_ROOMS.midRooms[2], RUSH_ROOMS.startRooms[0], RUSH_ROOMS.midRooms[6], RUSH_ROOMS.castles.ct].filter(
  (r): r is NonNullable<typeof r> => r !== undefined,
);

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
      {reveal && note && (
        <span className={`${styles.strip} ${styles.single}`} aria-hidden="true">
          <span className={styles.fan}>
            {RUSH_FAN.map((room, i) => {
              const src = rushRoomImage(String(room.id));
              return src ? <img key={room.id} className={styles.fanCard} style={{ "--i": i } as CSSProperties} src={src} alt="" loading="lazy" decoding="async" /> : null;
            })}
          </span>
          <span className={styles.caption}>
            <span className={`${styles.name} mono`}>{maps.map((m) => m.displayName).join(", ")}</span>
            <span className={styles.note}>{note}</span>
          </span>
        </span>
      )}
      {reveal && !note && (
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
