import type { Metadata } from "next";
import type { ReactNode } from "react";
import { KILL_MODIFIERS, KillModifier, WEAPON_GROUPS, WeaponIcon, weaponLabel, type KillModifierName } from "@/components/icons";
import styles from "./icons.module.css";

export const metadata: Metadata = { title: "Icons" };

const SIZES = [16, 24];

function Tile({ id, label, render }: { id: string; label: string; render: (size: number) => ReactNode }) {
  return (
    <li className={styles.tile}>
      <div className={styles.samples}>
        {SIZES.map((s) => (
          <span key={s} className={styles.sample}>
            {render(s)}
          </span>
        ))}
        {SIZES.map((s) => (
          <span key={`m${s}`} className={`${styles.sample} muted`}>
            {render(s)}
          </span>
        ))}
      </div>
      <p className={styles.name}>{label}</p>
      <p className={`${styles.id} mono`}>{id}</p>
    </li>
  );
}

export default function IconsPage() {
  const modifiers = Object.keys(KILL_MODIFIERS) as KillModifierName[];
  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Design</p>
          <h1>Icons</h1>
          <p>
            Kill feed icons on a 24 px grid, flat, in currentColor. Each shows 16 and 24 px in text colour, then the same in
            muted. Files live in <span className="mono">/icons/weapons</span> and <span className="mono">/icons/modifiers</span>.
          </p>
        </div>
      </header>
      {Object.entries(WEAPON_GROUPS).map(([group, names]) => (
        <section key={group} className={styles.section} aria-labelledby={`g-${group}`}>
          <h2 id={`g-${group}`}>{group}</h2>
          <ul className={styles.grid}>
            {names.map((n) => (
              <Tile key={n} id={n} label={weaponLabel(n)} render={(s) => <WeaponIcon name={n} size={s} />} />
            ))}
          </ul>
        </section>
      ))}
      <section className={styles.section} aria-labelledby="g-fallback">
        <h2 id="g-fallback">Unknown weapon</h2>
        <ul className={styles.grid}>
          <Tile id="unknown" label="Fallback" render={(s) => <WeaponIcon name="prop_exploding_barrel" size={s} />} />
        </ul>
      </section>
      <section className={styles.section} aria-labelledby="g-mods">
        <h2 id="g-mods">Kill modifiers</h2>
        <ul className={styles.grid}>
          {modifiers.map((m) => (
            <Tile key={m} id={m} label={KILL_MODIFIERS[m]} render={(s) => <KillModifier name={m} size={s} decorative />} />
          ))}
        </ul>
      </section>
    </div>
  );
}
