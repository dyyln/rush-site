import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { AIM_MAPS, BRAND_NAME, isRushMode, type ChallengePreview } from "@rushsite/shared";
import { challengeWhat } from "@/components/challenges/copy";
import { MODE_COPY } from "@/lib/modes";
import { SITE_URL } from "@/lib/seo";
import { challengePreview } from "./preview";

export const alt = `A CS2 challenge on ${BRAND_NAME}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// JPEG copies of the map art under public/og. The image renderer cannot read webp
const ART = new Set([...AIM_MAPS.map((m) => m.id), "rush_001"]);

function artId(p: ChallengePreview | null): string {
  if (p?.map && ART.has(p.map.id)) return p.map.id;
  if (p && isRushMode(p.mode)) return "rush_001";
  return p?.mode === "aim2v2" ? "aim_deagle7k" : "aim_redline";
}

async function dataUri(path: string, type: string): Promise<string | null> {
  try {
    return `data:${type};base64,${(await readFile(join(process.cwd(), "public", path))).toString("base64")}`;
  } catch {
    return null;
  }
}

// Steam avatars only. A slow or missing avatar falls back to the initial
async function avatar(url: string | null): Promise<string | null> {
  if (!url || !/^https:\/\/[a-z0-9.-]+\.(steamstatic\.com|akamaihd\.net)\//.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500), next: { revalidate: 3600 } });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\/(jpeg|png)/.test(type)) return null;
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

// Chakra Petch for the name and brand. The image falls back to the built in font when Google Fonts is out of reach
let display: Promise<ArrayBuffer | null> | null = null;

function displayFont(): Promise<ArrayBuffer | null> {
  display ??= (async () => {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@700", { signal: AbortSignal.timeout(2500) })).text();
    const url = css.match(/src: url\((https:[^)]+\.ttf)\)/)?.[1];
    if (!url) throw new Error("no font url");
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) throw new Error(String(res.status));
    return res.arrayBuffer();
  })().catch(() => {
    display = null;
    return null;
  });
  return display;
}

const C = { bg: "#0F0E13", text: "#ECEDEF", muted: "#9AA0AB", accent: "#9B8AC4", glass: "rgba(23, 21, 31, 0.72)" };

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const p = await challengePreview(code);
  const [art, face, font] = await Promise.all([dataUri(`og/${artId(p)}.jpg`, "image/jpeg"), avatar(p?.createdBy.avatarUrl ?? null), displayFont()]);
  const heading = font ? "Chakra Petch" : undefined;
  const name = p?.createdBy.displayName ?? "A player";
  const open = p?.status === "open";
  const kicker = p ? `${p.rematch ? "Rematch" : "Challenge"} · ${MODE_COPY[p.mode].label}` : "Challenge";
  const line = p ? `challenges you to a ${challengeWhat(p.mode, p.map)}` : "challenges you to a duel";
  const footer = !p || open ? "Sign in with Steam to accept" : `Challenge ${p.status === "accepted" ? "taken" : p.status}`;
  const host = SITE_URL.replace(/^https?:\/\//, "");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", position: "relative", background: C.bg, color: C.text }}>
        {art && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={art} alt="" width={1200} height={675} style={{ position: "absolute", top: -22, left: 0, width: 1200, height: 675, objectFit: "cover" }} />
        )}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: "flex",
            background: "linear-gradient(90deg, rgba(15,14,19,0.94) 0%, rgba(15,14,19,0.8) 55%, rgba(15,14,19,0.45) 100%)",
          }}
        />
        <div style={{ position: "relative", display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", padding: "56px 64px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", fontFamily: heading, fontSize: 32, fontWeight: 700, letterSpacing: 4, color: C.accent }}>{BRAND_NAME.toUpperCase()}</div>
            <div
              style={{
                display: "flex",
                fontSize: 24,
                color: C.text,
                padding: "6px 14px",
                border: "1px solid rgba(255,255,255,0.18)",
                background: C.glass,
                borderRadius: 4,
              }}
            >
              {kicker}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
            {face ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={face} alt="" width={184} height={184} style={{ borderRadius: 6, border: `3px solid ${C.accent}` }} />
            ) : (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 184,
                  height: 184,
                  borderRadius: 6,
                  border: `3px solid ${C.accent}`,
                  background: "#1F1C2A",
                  fontFamily: heading,
                  fontSize: 96,
                  fontWeight: 700,
                }}
              >
                {name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 820 }}>
              <div style={{ display: "flex", fontFamily: heading, fontSize: 80, fontWeight: 700, lineHeight: 1.05 }}>{name.length > 18 ? `${name.slice(0, 17)}…` : name}</div>
              <div style={{ display: "flex", fontSize: 44, color: C.text, opacity: 0.9 }}>{line}</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div
              style={{
                display: "flex",
                fontSize: 30,
                fontWeight: 600,
                padding: "14px 28px",
                borderRadius: 4,
                background: open || !p ? C.accent : C.glass,
                color: open || !p ? C.bg : C.muted,
              }}
            >
              {footer}
            </div>
            <div style={{ display: "flex", fontSize: 28, color: C.muted }}>{host}</div>
          </div>
        </div>
      </div>
    ),
    { ...size, ...(font ? { fonts: [{ name: "Chakra Petch", data: font, weight: 700 as const, style: "normal" as const }] } : {}) },
  );
}
