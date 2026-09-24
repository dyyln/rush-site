import { ImageResponse } from "next/og";
import { BRAND_NAME, isMatchSlug } from "@rushsite/shared";
import { apiUrl, isMock } from "@/lib/env";
import { mockMatchDetail } from "@/lib/mock";
import { mvpReason } from "@/components/match/roster";
import { mapName, modeLabel } from "@/lib/modes";
import type { MatchDetail } from "@/lib/types";

// Score card for sharing. 1200x630 in the site palette

const C = {
  bg: "#0F0E13",
  surface1: "#17151F",
  surface2: "#1F1C2A",
  border: "#2C2838",
  text: "#ECEDEF",
  muted: "#9AA0AB",
  accent: "#9B8AC4",
  own: "#9B8AC4",
  enemy: "#E0C36A",
  win: "#3DD68C",
  loss: "#FF7A7A",
  credits: "#E0C36A",
};

const UUID = /^[0-9a-f-]{36}$/i;

async function loadMatch(id: string): Promise<MatchDetail | null> {
  if (!UUID.test(id) && !isMatchSlug(id)) return null;
  if (isMock) return mockMatchDetail(id);
  // Server side may reach the api on an internal address
  const base = (process.env.API_INTERNAL_URL ?? apiUrl).replace(/\/$/, "");
  const res = await fetch(`${base}/matches/${id}`, { cache: "no-store", headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`api ${res.status}`);
  return ((await res.json()) as { match: MatchDetail }).match;
}

type Font = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700; style: "normal" };

// Google serves truetype to clients without a browser user agent, which is what satori needs
async function googleFont(family: string, weight: Font["weight"]): Promise<Font> {
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`, {
    signal: AbortSignal.timeout(3000),
  }).then((r) => r.text());
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error(`no ttf for ${family}`);
  const data = await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.arrayBuffer());
  return { name: family, data, weight, style: "normal" };
}

let fontsPromise: Promise<Font[]> | null = null;

// Falls back to the built in font when Google Fonts is unreachable
function loadFonts(): Promise<Font[]> {
  fontsPromise ??= Promise.all([
    googleFont("Chakra Petch", 700),
    googleFont("IBM Plex Sans", 500),
    googleFont("IBM Plex Mono", 500),
  ]).catch(() => {
    fontsPromise = null;
    return [];
  });
  return fontsPromise;
}

const DISPLAY = "Chakra Petch";
const BODY = "IBM Plex Sans";
const MONO = "IBM Plex Mono";

function LogoMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill={C.accent}>
      <path
        fillRule="evenodd"
        d="M10 4h44a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6zM32 10a22 22 0 1 0 0 44 22 22 0 1 0 0-44z"
      />
      <path d="M40 14.1A19 19 0 0 1 40 49.9z" />
      <path d="M36 25.4A6 6 0 1 0 36 32.6z" />
      <path d="M36 37h-7c-5 0-7 3-7 7v6.2a19 19 0 0 0 14 1.3z" />
    </svg>
  );
}

function Marker({ own }: { own: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 10 10">
      {own ? <rect x="1" y="1" width="8" height="8" fill={C.own} /> : <path d="M5 0l5 5-5 5-5-5z" fill={C.enemy} />}
    </svg>
  );
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function Team({ name, score, own, won }: { name: string; score: number; own: boolean; won: boolean }) {
  const colour = own ? C.own : C.enemy;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 420 }}>
      <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 200, lineHeight: 1, color: colour, fontWeight: 700 }}>{score}</div>
      <div style={{ display: "flex", alignItems: "center", marginTop: 16 }}>
        <Marker own={own} />
        <div style={{ display: "flex", marginLeft: 14, fontFamily: DISPLAY, fontSize: 40, fontWeight: 700, color: C.text }}>{clip(name, 18)}</div>
      </div>
      <div style={{ display: "flex", height: 30, marginTop: 8, fontFamily: DISPLAY, fontSize: 22, letterSpacing: 4, color: C.win }}>
        {won ? "WINNER" : ""}
      </div>
    </div>
  );
}

function Card({ m }: { m: MatchDetail }) {
  const [a, b] = m.teams;
  const finished = m.status === "finished";
  const live = m.status === "live";
  const statusText = finished ? "FINAL" : live ? "LIVE" : m.status.toUpperCase();
  const statusColour = finished ? C.muted : live ? C.win : C.loss;
  const mvp = m.mvp ? m.teams.flatMap((t) => t.players).find((p) => p.steamId === m.mvp!.steamId) : undefined;
  const mvpOwn = mvp ? a?.players.some((p) => p.steamId === mvp.steamId) : false;
  const lastRound = m.rounds.at(-1);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        padding: 48,
        fontFamily: BODY,
        color: C.text,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <LogoMark size={52} />
          <div style={{ display: "flex", marginLeft: 16, fontFamily: DISPLAY, fontSize: 36, fontWeight: 700, color: C.text }}>{BRAND_NAME}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 24, letterSpacing: 3, color: C.muted }}>{modeLabel(m.mode).toUpperCase()}</div>
          {m.mapId && (
            <div style={{ display: "flex", marginLeft: 20, fontFamily: MONO, fontSize: 24, color: C.text }}>{mapName(m.mode, m.mapId)}</div>
          )}
          <div
            style={{
              display: "flex",
              marginLeft: 24,
              padding: "6px 16px",
              border: `2px solid ${statusColour}`,
              borderRadius: 6,
              fontFamily: DISPLAY,
              fontSize: 22,
              letterSpacing: 3,
              color: statusColour,
            }}
          >
            {statusText}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          marginTop: 28,
          background: C.surface2,
          border: `2px solid ${C.border}`,
          borderRadius: 16,
        }}
      >
        {a && b ? (
          <>
            <Team name={a.displayName ?? a.name} score={a.score} own won={finished && a.score > b.score} />
            <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 120, color: C.muted, marginBottom: 70 }}>:</div>
            <Team name={b.displayName ?? b.name} score={b.score} own={false} won={finished && b.score > a.score} />
          </>
        ) : (
          <div style={{ display: "flex", fontSize: 40, color: C.muted }}>Match</div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 90, marginTop: 24 }}>
        {mvp && m.mvp ? (
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", fontFamily: DISPLAY, fontSize: 26, letterSpacing: 5, color: C.credits }}>MVP</div>
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 22 }}>
              <div style={{ display: "flex", alignItems: "center" }}>
                <Marker own={!!mvpOwn} />
                <div style={{ display: "flex", marginLeft: 12, fontFamily: DISPLAY, fontSize: 36, fontWeight: 700 }}>{clip(mvp.displayName, 24)}</div>
              </div>
              <div style={{ display: "flex", fontSize: 22, color: C.muted, marginTop: 4 }}>{clip(mvpReason(m.mvp.reason, mvp), 70)}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 26, color: C.muted }}>
            {live && lastRound ? `Round ${lastRound.round} played` : live ? "Warming up" : ""}
          </div>
        )}
        {m.tournament && <div style={{ display: "flex", fontSize: 24, color: C.muted }}>{clip(m.tournament.name, 32)}</div>}
      </div>
    </div>
  );
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let m: MatchDetail | null;
  try {
    m = await loadMatch(id);
  } catch {
    return new Response("Could not load the match", { status: 502 });
  }
  if (!m) return new Response("Match not found", { status: 404 });
  const fonts = await loadFonts();
  const done = m.status === "finished" || m.status === "cancelled" || m.status === "abandoned";
  return new ImageResponse(<Card m={m} />, {
    width: 1200,
    height: 630,
    fonts,
    headers: { "cache-control": done ? "public, max-age=3600, s-maxage=86400" : "public, max-age=30, s-maxage=30" },
  });
}
