"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ALL_RUSH_ROOMS, MODE_CONFIGS, type Mode } from "@rushsite/shared";
import { rushRoomImage } from "@/lib/rushRooms";
import { MapThumb } from "./MapThumb";
import styles from "./ModeMapPool.module.css";

// Rush plays one map whose rooms the map script draws at load
function poolNote(mode: Mode): string | null {
  return MODE_CONFIGS[mode].winCondition === "valve_rush" ? "Rooms drawn at load" : null;
}

// Cards on show at once. With more maps or rooms than this the fan cycles through them
const FAN_VISIBLE = 5;
// How long the front card stays before the next one comes in
const FAN_STEP_MS = 800;

export function mapPoolId(mode: Mode) {
  return `mode-${mode}-maps`;
}

/*
  Lower area of a mode card. On hover or keyboard focus the card body swaps for a strip of the
  mode's maps, fanned out diagonally. Both share one grid cell, so the card is always as tall as the taller of the
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
  // Rush shows the rooms of its one map, aim modes their map previews
  const fan = note
    ? ALL_RUSH_ROOMS.map((room) => ({ key: String(room.id), mapId: maps[0]?.id ?? "rush_001", src: rushRoomImage(String(room.id)) }))
    : maps.map((m) => ({ key: m.id, mapId: m.id, src: undefined }));
  const visible = Math.min(FAN_VISIBLE, fan.length);
  const rootRef = useRef<HTMLSpanElement>(null);
  const offset = useFanRotation(rootRef, reveal && fan.length > visible);

  return (
    <span ref={rootRef} className={`${styles.stack} ${reveal ? styles.reveal : ""}`}>
      <span className={styles.body}>
        {children}
        <span id={mapPoolId(mode)} className={`${styles.poolText} mono`} aria-hidden="true">
          {text}
        </span>
      </span>
      {reveal && (
        <span className={styles.strip} aria-hidden="true">
          <span className={styles.fan} style={{ "--fan-count": visible } as CSSProperties}>
            {fan.map((card, k) => {
              // Place in the fan, 0 at the back. The front card leaves, the rest step forward and the next comes in behind
              const place = (k + offset) % fan.length;
              const shown = place < visible;
              return (
                <span
                  key={card.key}
                  className={styles.fanCard}
                  data-hidden={shown ? undefined : true}
                  style={{ "--i": shown ? place : 0, zIndex: shown ? place + 1 : 0 } as CSSProperties}
                >
                  <MapThumb mapId={card.mapId} src={card.src} className={styles.fanImg} />
                </span>
              );
            })}
          </span>
          <span className={styles.caption}>
            <span className={styles.note}>{note ? "Rush across a range of rooms" : names}</span>
          </span>
        </span>
      )}
    </span>
  );
}

// Counts up while the pointer is on the card, or it has keyboard focus, so the fan cycles.
// Still under reduced motion
function useFanRotation(rootRef: RefObject<HTMLSpanElement | null>, enabled: boolean): number {
  const [offset, setOffset] = useState(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const card = rootRef.current?.closest("label");
    if (!card || !enabled) return;
    const on = () => setActive(true);
    const off = () => setActive(false);
    const onFocus = () => setActive(!!card.querySelector("input:focus-visible"));
    card.addEventListener("mouseenter", on);
    card.addEventListener("mouseleave", off);
    card.addEventListener("focusin", onFocus);
    card.addEventListener("focusout", off);
    return () => {
      card.removeEventListener("mouseenter", on);
      card.removeEventListener("mouseleave", off);
      card.removeEventListener("focusin", onFocus);
      card.removeEventListener("focusout", off);
    };
  }, [rootRef, enabled]);

  useEffect(() => {
    if (!active || !enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setOffset((o) => o + 1), FAN_STEP_MS);
    return () => clearInterval(t);
  }, [active, enabled]);

  return offset;
}
