// Fake GSLT pool for NEXT_PUBLIC_MOCK=1
import { MOCK_ME } from "@/lib/mock";
import { ApiError } from "@/lib/api";
import type { AuditAction, AuditEntry, GsltAddResult, GsltPoolView, GsltView } from "./types";

const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
const id = () => `00000000-0000-4000-a000-${String(++seq).padStart(12, "0")}`;

type Row = GsltView & { raw: string };

const mask = (t: string) => `${t.slice(0, 4)}…${t.slice(-4)}`;
const row = (raw: string, memo: string | null, extra: Partial<GsltView> = {}): Row => ({
  id: id(),
  raw,
  token: mask(raw),
  memo,
  status: "free",
  matchId: null,
  lastUsedAt: null,
  createdAt: iso(Date.now() - 3 * 86_400_000),
  ...extra,
});

const rows: Row[] = [
  row("0A1B0000000000000000000000000001", "Duelrush1", {
    status: "in_use",
    matchId: "0d000000-0000-4000-8000-000000000001",
    lastUsedAt: iso(Date.now() - 20 * 60_000),
  }),
  row("0A1B0000000000000000000000000002", "Duelrush2", { lastUsedAt: iso(Date.now() - 5 * 3600_000) }),
  row("0A1B0000000000000000000000000003", "Duelrush3"),
  row("0A1B0000000000000000000000000004", null, { status: "invalid" }),
];

function audit(action: AuditAction, target: string, payload: unknown): AuditEntry {
  return { id: id(), adminSteamId: MOCK_ME.steamId, action, target, payload, createdAt: iso(Date.now()) };
}

const view = ({ raw: _raw, ...v }: Row): GsltView => v;

export const mockGslt = {
  list(): GsltPoolView {
    const count = (s: GsltView["status"]) => rows.filter((r) => r.status === s).length;
    return {
      tokens: rows.map(view),
      counts: { total: rows.length, free: count("free"), inUse: count("in_use"), invalid: count("invalid") },
    };
  },
  add(text: string, memo?: string): GsltAddResult {
    const found: { raw: string; memo: string | null }[] = [];
    const invalidLines: number[] = [];
    text.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const m = line.match(/\b[0-9A-Fa-f]{32}\b/);
      if (!m) return void invalidLines.push(i + 1);
      const after = line.slice((m.index ?? 0) + 32).trim().split(/\t+| {2,}/);
      const own = /^\s*\d+\s*$/.test(line.slice(0, m.index)) ? after.slice(1).join(" ") : after.join(" ");
      found.push({ raw: m[0].toUpperCase(), memo: own.trim() || memo?.trim() || null });
    });
    if (found.length === 0) throw new ApiError(400, "invalid_request", "No token found. Paste 32 character hex tokens, one per line");
    const added: Row[] = [];
    for (const f of found) {
      if (rows.some((r) => r.raw === f.raw) || added.some((r) => r.raw === f.raw)) continue;
      added.push(row(f.raw, f.memo, { createdAt: iso(Date.now()) }));
    }
    rows.push(...added);
    return {
      added: added.length,
      skipped: found.length - added.length,
      invalidLines,
      tokens: added.map(view),
      audit: audit("gslt.add", "gslt_pool", { added: added.length }),
    };
  },
  update(tokenId: string, memo: string | null): { token: GsltView; audit: AuditEntry } {
    const r = rows.find((x) => x.id === tokenId);
    if (!r) throw new ApiError(404, "not_found", "Token not found");
    r.memo = memo?.trim() || null;
    return { token: view(r), audit: audit("gslt.update", r.id, { memo: r.memo }) };
  },
  remove(tokenId: string): { ok: true; audit: AuditEntry } {
    const i = rows.findIndex((x) => x.id === tokenId);
    if (i < 0) throw new ApiError(404, "not_found", "Token not found");
    if (rows[i]!.status === "in_use") throw new ApiError(409, "gslt_in_use", "This token is held by a running match. Remove it once the match ends");
    const [r] = rows.splice(i, 1);
    return { ok: true, audit: audit("gslt.remove", r!.id, { token: r!.token }) };
  },
};
