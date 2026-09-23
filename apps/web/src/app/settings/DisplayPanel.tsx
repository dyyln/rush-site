"use client";

import { Toggle } from "@/components/notify/NotifyPanel";
import { TeamMarker } from "@/components/ui/TeamMarker";
import { TierChip } from "@/components/ui/TierChip";
import { usePrefs } from "@/lib/prefs";
import styles from "./settings.module.css";

export function DisplayPanel() {
  const [prefs, update] = usePrefs();
  return (
    <div className={styles.panel}>
      <Toggle
        label="Show tiers only"
        hint="Hides rating numbers across the site. Tiers stay visible."
        checked={prefs.tiersOnly}
        onChange={(tiersOnly) => update({ tiersOnly })}
      />
      <div className={styles.preview} aria-hidden="true">
        <TierChip rating={1742} link={false} />
      </div>
      <Toggle
        label="Colourblind team colours"
        hint="Blue for your team and orange for the enemy on match pages."
        checked={prefs.cbPalette}
        onChange={(cbPalette) => update({ cbPalette })}
      />
      <div className={styles.preview} aria-hidden="true">
        <span className={styles.swatch} data-side="own">
          <TeamMarker side="own" />
          Your team
        </span>
        <span className={styles.swatch} data-side="enemy">
          <TeamMarker side="enemy" />
          Enemy
        </span>
      </div>
    </div>
  );
}
