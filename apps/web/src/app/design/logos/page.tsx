import { readFileSync } from "node:fs";
import path from "node:path";
import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Logo options" };

type Family = "Crosshair" | "Silhouette" | "Mixture";

const OPTIONS: { family: Family; concept: string }[] = [
  { family: "Crosshair", concept: "Classic gap crosshair with four bold square bars and an open centre." },
  { family: "Crosshair", concept: "Four inward chevrons closing on a diamond centre dot." },
  { family: "Crosshair", concept: "Ring and dot scope with four ticks crossing the ring." },
  { family: "Silhouette", concept: "Head and shoulders peeking out from behind a wall edge." },
  { family: "Silhouette", concept: "Full lean out of cover with a rifle held level." },
  { family: "Silhouette", concept: "Kneeling low at the base of a wall, rifle out." },
  { family: "Mixture", concept: "Head and shoulders sitting in the centre of a gap crosshair." },
  { family: "Mixture", concept: "Crosshair whose right arm is a wall, a head peeking into the centre." },
  { family: "Mixture", concept: "Square reticle whose right side is a wall, a figure peeking into the corner brackets." },
  { family: "Mixture", concept: "Solid badge with the crosshair and a head-and-shoulders cut out as negative space." },
];

const SIZES = [24, 48, 200];

function loadSvg(n: string) {
  return readFileSync(path.join(process.cwd(), "public", "logo", `option-${n}.svg`), "utf8");
}

const panel = (dark: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "flex-end",
  gap: "var(--space-5)",
  flexWrap: "wrap",
  padding: "var(--space-5)",
  borderRadius: "var(--radius-md)",
  background: dark ? "var(--color-bg)" : "#ffffff",
  color: dark ? "var(--color-accent)" : "#000000",
  border: "1px solid var(--color-border)",
});

function Mark({ svg, size, dark }: { svg: string; size: number; dark: boolean }) {
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)" }}>
      <span
        aria-hidden="true"
        style={{ display: "block", width: size, height: size, lineHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", `<svg width="${size}" height="${size}" `) }}
      />
      <figcaption className="mono" style={{ fontSize: "var(--text-xs)", color: dark ? "var(--color-text-muted)" : "#4b505a" }}>
        {size}px
      </figcaption>
    </figure>
  );
}

export default function LogoOptionsPage() {
  return (
    <div className="container page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Design</p>
          <h1>Logo options</h1>
          <p>Ten single-colour marks. Each is shown at 24, 48 and 200 px, in accent on dark and in black on white.</p>
        </div>
      </header>
      <div className="stack">
        {OPTIONS.map((opt, i) => {
          const n = String(i + 1).padStart(2, "0");
          const svg = loadSvg(n);
          return (
            <Card
              key={n}
              as="article"
              id={`option-${n}`}
              eyebrow={opt.family}
              title={`Option ${n}`}
              actions={<Badge tone="accent">{`/logo/option-${n}.svg`}</Badge>}
            >
              <p className="muted" style={{ marginBottom: "var(--space-4)" }}>
                {opt.concept}
              </p>
              <div style={{ display: "grid", gap: "var(--space-4)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
                {[true, false].map((dark) => (
                  <div key={String(dark)} style={panel(dark)} aria-label={dark ? "Accent on dark" : "Black on white"} role="img">
                    {SIZES.map((s) => (
                      <Mark key={s} svg={svg} size={s} dark={dark} />
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
