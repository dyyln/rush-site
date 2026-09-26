// Page routes for activity tracking. A path with an id maps to its route and the id
const DYNAMIC: Record<string, string> = {
  matches: "/matches/[id]",
  profile: "/profile/[steamId]",
  tournaments: "/tournaments/[id]",
  invite: "/invite/[code]",
  challenge: "/challenge/[code]",
}

const ADMIN_DYNAMIC: Record<string, string> = {
  matches: "/admin/matches/[id]",
  users: "/admin/users/[steamId]",
  review: "/admin/review/[flagId]",
}

export type PageRoute = { route: string; ref: string | null }

// Null for anything that is not a plain site path
export function pageRoute(path: string): PageRoute | null {
  const clean = path.split(/[?#]/)[0] ?? ""
  if (!clean.startsWith("/") || clean.length > 200) return null
  const parts = clean.split("/").filter(Boolean)
  if (parts.some((p) => !/^[\w.~-]+$/.test(p))) return null
  if (parts.length === 0) return { route: "/", ref: null }
  const [first, second, third] = parts
  if (first === "admin" && second) {
    const route = third ? ADMIN_DYNAMIC[second] : undefined
    if (route) return { route, ref: third!.slice(0, 64) }
    return { route: `/admin/${second}`, ref: null }
  }
  if (second && DYNAMIC[first!]) return { route: DYNAMIC[first!]!, ref: second.slice(0, 64) }
  return { route: `/${first}`, ref: null }
}
