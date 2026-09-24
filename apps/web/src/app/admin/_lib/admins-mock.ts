// Fake admin list for NEXT_PUBLIC_MOCK=1
import { MOCK_ME, mockSteamId, mockUserBySteamId } from "@/lib/mock";
import { ApiError } from "@/lib/api";
import type { AdminCandidateView, AdminListView, AdminView, AuditEntry } from "./types";

const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;

const SUPERS = [MOCK_ME.steamId, mockSteamId(40)];
const rows: AdminView[] = [
  {
    steamId: mockSteamId(3),
    signedIn: true,
    super: false,
    source: "db",
    addedBy: MOCK_ME.steamId,
    note: "Weekend cups",
    createdAt: iso(Date.now() - 12 * 86_400_000),
  },
];

function named(v: AdminView): AdminView {
  const u = mockUserBySteamId(v.steamId);
  const by = v.addedBy ? mockUserBySteamId(v.addedBy) : null;
  return {
    ...v,
    ...(v.signedIn ? { displayName: u.displayName } : {}),
    ...(by ? { addedByName: by.displayName } : {}),
  };
}

function audit(action: "admin.grant" | "admin.revoke", target: string, payload: unknown): AuditEntry {
  seq++;
  return {
    id: `00000000-0000-4000-9000-${String(seq).padStart(12, "0")}`,
    adminSteamId: MOCK_ME.steamId,
    action,
    target,
    payload,
    createdAt: iso(Date.now()),
  };
}

function parse(q: string): string {
  const s = q.trim();
  const m = s.match(/^(\d{17})$/) ?? s.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  if (m) return m[1]!;
  if (/steamcommunity\.com\/id\//i.test(s)) throw new ApiError(404, "not_found", "Custom URLs do not resolve in mock mode");
  throw new ApiError(400, "invalid_request", "Enter a SteamID64 or a steamcommunity.com profile URL");
}

export const mockAdmins = {
  list(): AdminListView {
    return {
      admins: [
        ...SUPERS.map((steamId, i) => named({ steamId, signedIn: i === 0, super: true, source: "config" })),
        ...rows.map(named),
      ],
      viewer: { steamId: MOCK_ME.steamId, super: true, canManage: true },
    };
  },
  lookup(q: string): AdminCandidateView {
    const steamId = parse(q);
    if (!/^7656119\d{10}$/.test(steamId)) throw new ApiError(400, "invalid_request", "That is not a SteamID64 of a player account");
    const signedIn = !steamId.endsWith("9");
    return {
      steamId,
      ...(signedIn ? { displayName: mockUserBySteamId(steamId).displayName } : {}),
      profileUrl: `https://steamcommunity.com/profiles/${steamId}`,
      signedIn,
      admin: SUPERS.includes(steamId) ? "super" : rows.some((r) => r.steamId === steamId) ? "admin" : null,
    };
  },
  grant(steamId: string, note?: string): { admin: AdminView; audit: AuditEntry } {
    if (SUPERS.includes(steamId) || rows.some((r) => r.steamId === steamId)) throw new ApiError(409, "already_admin", "Already an admin");
    const row: AdminView = {
      steamId,
      signedIn: !steamId.endsWith("9"),
      super: false,
      source: "db",
      addedBy: MOCK_ME.steamId,
      ...(note ? { note } : {}),
      createdAt: iso(Date.now()),
    };
    rows.push(row);
    return { admin: named(row), audit: audit("admin.grant", steamId, { note: note ?? null }) };
  },
  revoke(steamId: string): { ok: true; audit: AuditEntry } {
    if (SUPERS.includes(steamId)) throw new ApiError(403, "super_admin", "Super admins can only be removed in config");
    if (steamId === MOCK_ME.steamId) throw new ApiError(400, "cannot_remove_self", "You cannot remove yourself");
    const i = rows.findIndex((r) => r.steamId === steamId);
    if (i < 0) throw new ApiError(404, "not_found", "Admin not found");
    const [row] = rows.splice(i, 1);
    return { ok: true, audit: audit("admin.revoke", steamId, { addedBy: row!.addedBy, note: row!.note ?? null }) };
  },
};
