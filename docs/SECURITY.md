# Security review

Status: review of the whole platform as of 2026-09-23. It covers `apps/api`, `apps/web`, `packages/shared`, `agent/`, `plugin/`, `infra/` and the compose files. Line numbers match the tree at the time of writing. A simplify agent was editing `apps/api` and `apps/web` at the same time, so a few lines may have moved.

Fixes were tested against the local API (real Postgres and Redis, with a minted dev session that was removed afterwards) and by the API suite. Production was only read: one plain GET each to `https://rushsite.dyyln.dev/` and `https://api.rushsite.dyyln.dev/health` to see which headers it sends today. Neither sends any security headers, and the web sends `x-powered-by: Next.js`.

## Summary

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | High | WebSocket accepts upgrades from any origin, so another site can use a player's session over `/ws` | fixed |
| 2 | High | No HTTP rate limits and no socket message limits anywhere | fixed |
| 3 | High | Production boots with the placeholder `SESSION_SECRET` and the default agent token | fixed |
| 4 | Medium | State-changing routes have no Origin check. SameSite=Lax does not stop sibling subdomains | fixed |
| 5 | Medium | No security headers on the API or the web (no CSP, framing allowed) | fixed |
| 6 | Medium | Banned players can sign straight back in, and open sockets survive a ban or logout | fixed |
| 7 | Medium | Agent API is plain HTTP on `0.0.0.0:8080` with one shared static token. It carries GSLTs and webhook secrets | proposed |
| 8 | Low | `trustProxy: true` trusts any `X-Forwarded-For`. Rate limit keys depend on it | proposed |
| 9 | Low | Match accept and veto routes pass any string to a Postgres uuid column (500s), and veto `mapId` has no length cap | fixed |
| 10 | Low | Redirect path check lets control characters through. The web `safeReturnTo` allows backslashes | fixed |
| 11 | Low | Webhooks have no replay protection (no timestamp or nonce) | proposed |
| 12 | Low | Demo upload URL lives 6 hours. Demo download links go to every viewer, signed in or not | proposed |
| 13 | Low | Expensive public reads (leaderboard count, profile, distribution) have no cache | proposed (now rate limited) |
| 14 | Low | A kicked player who still holds a pending in-site invite can rejoin through the invite fallback | proposed |
| 15 | Low | Any member of a cup entry can withdraw the whole team | proposed |
| 16 | Low | `GET /health` is public and shows socket and loop metrics | proposed |
| 17 | Low | Compose defaults: Postgres password `rushsite`, Redis without auth, Caddy runs as root, no HSTS on the web | proposed |
| 18 | Low | Sessions last 30 days with no idle expiry or rotation. The `sess:u:<steamId>` sets keep expired ids | proposed |
| 19 | Info | `pnpm audit`: one moderate advisory (esbuild via drizzle-kit, dev only). No high or critical | noted |
| 20 | Info | Web CSP needs `'unsafe-inline'` for scripts because Next inlines its bootstrap | noted |

Checked and found sound: Steam OpenID verification, webhook HMAC, the admin gate, authorization on every resource route, invite and challenge code entropy, what gets logged, S3 key names, the OG card route, and XSS sinks in the web. Details are at the end.

---

## Fixed

### 1. Cross-site WebSocket hijacking (High, fixed)
- **Where:** `apps/api/src/modules/ws/routes.ts`, `registerWsRoutes` (was lines 170-183).
- **Problem:** `/ws` authenticated the upgrade with the session cookie and never looked at `Origin`. The cookie is `SameSite=Lax`. Browsers send Lax cookies on WebSocket handshakes from the same *site*, and `rushsite.dyyln.dev` shares the site `dyyln.dev` with every other `*.dyyln.dev` host.
- **Exploit:** a page on any other `dyyln.dev` subdomain (or an XSS on one), or any origin in a browser that does not enforce SameSite, opens `wss://api.rushsite.dyyln.dev/ws` as the visitor. It can then queue the player, accept or decline matches (the decline sets a cooldown), cast veto votes, and read `server_ready`, which contains the server IP and password.
- **Fix:** the upgrade is refused with 403 when `Origin` is not `PUBLIC_URL` or `API_PUBLIC_URL`, or when `Sec-Fetch-Site` says cross-site or same-site and no Origin is sent. The check is `originAllowed` in `apps/api/src/lib/security.ts`.

### 2. No rate limiting (High, fixed)
- **Where:** everywhere. The Fastify app had no limiter, and `attachSocket` handled every inbound message.
- **Exploit:** one client can:
  - flood `queue_join` over the socket (about 15 queries each) and drain the 10-connection Postgres pool for every player;
  - spam friend requests (each one pushes to the target), reports, challenges and `/friends/sync` (a Steam API call);
  - hammer `/auth/steam/callback`, which makes an outbound call to Steam;
  - open unlimited signed-out sockets (signed-out sockets are now gone, see 6);
  - scan `GET /parties/join/:code` and `GET /challenges/:code` without limit. The codes are strong (see the end), so this is DoS rather than enumeration.
- **Fix:** `@fastify/rate-limit` with the Redis store (`apps/api/src/lib/security.ts`):
  - **Keys:** per session for signed-in callers (a hash of the session id), per IP otherwise, per IP always for the login routes.
  - **Global limit:** 600 per minute. `/health` is exempt.
  - **Per route, per minute:**
    - login start and callback: 20;
    - `GET /ws` handshakes: 30;
    - queue join and leave: 30;
    - party invite, join and preview: 20 to 30;
    - friend requests: 20; friend sync: 6;
    - challenge create: 10; view: 60; accept: 20; decline: 30;
    - reports: 10;
    - cup enter and withdraw: 20;
    - leaderboard, friends board, distribution, profile and match history: 60;
    - webhooks: 1200 per match id, because every game server on a box shares one IP.
  - **Sockets:**
    - a token bucket per socket: a burst of 30, then 3 messages per second;
    - excess messages get `error { code: "rate_limited" }`, and 100 strikes close the socket with 1008;
    - at most 8 sockets per user per instance, with 429 above that. `/ws` needs a session (see 6).
  - **Redis errors:** they skip the limiter instead of failing requests.
  - **Switch:** `RATE_LIMIT_ENABLED` (default on, off in `testEnv`, refused off in production).
- **Verified locally:**
  - the 21st friend request in a minute got 429;
  - a flood of 60 socket messages got 30 `rate_limited` errors;
  - the 9th socket for one user got 429.

### 3. Unsafe production defaults accepted (High, fixed)
- **Where:** `apps/api/src/env.ts:38` and `:46`, `.env.example`.
- **Problem:**
  - `RUSHSITE_AGENT_TOKEN` defaults to `change-me-dev-agent-token`, which passes the agent's 16-character minimum.
  - `SESSION_SECRET` accepted the `.env.example` value `change-me-dev-session-secret-at-least-32-chars`.
- **Exploit:**
  - With the default agent token and a firewall slip on 8080, anyone can start and stop CS2 servers on the box. That burns GSLTs, fills slots and kills live matches.
  - With the example session secret, anyone can sign cookies. Sessions are random server-side ids, so this does not forge a session by itself, but it does forge the signed login-state cookie (login CSRF) and any signed cookie added later.
- **Fix:** `productionProblems` in `env.ts`. It refuses to boot with `NODE_ENV=production` when:
  - either secret contains a placeholder word (`change-me`, `example`, `placeholder`);
  - the session secret is trivially repetitive;
  - the agent token is under 16 characters;
  - rate limits are switched off.
  `.env.example` says so.
- **Deploy note:** if production still runs with either placeholder, the next deploy will refuse to start until real values are set. That is intended.

### 4. CSRF on state-changing routes (Medium, fixed)
- **Where:** every POST and DELETE route. The cookie is set in `apps/api/src/modules/auth/session.ts` `setSessionCookie` with `SameSite=Lax`, and there was no Origin check.
- **Exploit:** Lax blocks cross-*site* POSTs but not same-site ones. A page on another `dyyln.dev` subdomain can auto-submit a form to any route that needs no JSON body, and the cookie is sent. Examples: `POST /parties/leave`, `/parties/invite` (rotates the link), `/parties/join/:code` (pulls the victim into the attacker's party), `/challenges/:code/accept` (starts a match with a cooldown on no-show), `/friends/requests/:id/accept`, `/parties/invites/:id/accept`, `/auth/logout`, and `/queue/leave` with an empty body.
- **Fix:** an `onRequest` guard (`csrfGuard` in `apps/api/src/lib/security.ts`):
  - For POST, PUT, PATCH and DELETE it answers 403 `bad_origin` when `Origin` is present and not allow-listed, or when `Sec-Fetch-Site` is `cross-site` or `same-site` with no Origin.
  - `/webhooks/*` is exempt, because it is HMAC-signed and comes from game servers.
  - Requests without Origin (curl, server-side) still pass. They cannot carry a victim's cookie.
- **Verified locally:** a POST with `Origin: https://evil.dyyln.dev` got 403, and the same POST with the site origin got 200.

### 5. Missing security headers (Medium, fixed)
- **Where:** `apps/api/src/app.ts` and `apps/web/next.config.ts`. Production confirmed that neither sends any.
- **Exploit:** the web can be framed (clickjacking on the queue, accept and report buttons). There is no CSP to limit the damage of any future XSS, and there is no `nosniff`.
- **Fix, API:** `@fastify/helmet` with:
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` (the API only serves JSON);
  - CORP `same-site`, `nosniff`, `Referrer-Policy: no-referrer`, and HSTS.
- **Fix, web:** headers on every path:
  - a CSP:
    - `default-src 'self'`;
    - scripts from `'self' 'unsafe-inline'`, plus `'unsafe-eval'` in dev only;
    - styles from `'self' 'unsafe-inline'` and `fonts.googleapis.com`;
    - fonts from `'self'`, `data:` and `fonts.gstatic.com`;
    - images from `'self'`, `data:`, `blob:`, `*.steamstatic.com` and `steamcdn-a.akamaihd.net` (Steam avatars);
    - `connect-src` limited to the API and WS origins taken from `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` at build time;
    - `object-src 'none'`, `frame-ancestors 'none'`, and `form-action` limited to self plus the API;
  - `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a `Permissions-Policy`;
  - `poweredByHeader: false`.
  The fonts are self-hosted by `next/font`. The Google Fonts hosts are allowed anyway, as asked.
- **Out of scope:** HSTS for the web belongs in Caddy (see 17).

### 6. Bans did not stop sign-in or live sockets (Medium, fixed)
- **Where:**
  - `apps/api/src/modules/auth/routes.ts`: the Steam callback created a session for a banned player;
  - `modules/ws/routes.ts`: open sockets kept the steamId they connected with, and signed-out sockets were allowed;
  - `modules/trust/bans.ts`: the ban deleted sessions but left sockets open.
- **Exploit:** a banned player signed in again at once. They could send friend requests, file reports against the players who reported them, create parties and invite people. On a socket that was already open, they could accept or decline and veto in a match that was running when the ban landed. Logout did not close sockets either.
- **Fix:**
  - **Sign-in:** `BanGate` (`modules/trust/ban-gate.ts`) reads the active ban from Postgres at sign-in. A banned player gets no session and is sent to `${PUBLIC_URL}/banned?until=&reason=`.
  - **Every request:** `BanService.ban` writes a Redis marker `ban:<steamId>` (expiring with the ban, cleared by unban). The authenticator refuses a session on every request when that marker exists: 401 `banned` on routes and on `/ws`, and 403 `banned` with `{ reason, until }` on `GET /me`.
  - **Sockets:** ban and logout publish a `disconnect` audience on `rs:ws`, so every instance closes that player's sockets with code 4001.
  - **Signed-out sockets:** `/ws` now requires a session. The spectator path and the per-IP spectator cap are gone.
- **Web:**
  - the socket opens only after `GET /me` succeeds;
  - after a 4001 close the web re-checks `/me` instead of reconnecting;
  - a 403 `banned` sends the browser to the `/banned` page;
  - signed-out viewers of match and tournament pages poll every 5 s while the tab is visible.
- **Tests:** `auth.test.ts` covers:
  - the refused sign-in redirect;
  - 401 on a stale session and on `/ws`;
  - 403 on `/me` with the details;
  - unban lifting it;
  - the disconnect on ban and on logout.
  `security.test.ts` covers `/ws` without a session and the hub closing only that player's sockets with 4001.
- **Limit:** a ban written straight into Postgres, bypassing `BanService`, is enforced at the next sign-in but not on sessions that already exist.

### 9. Unvalidated match ids and veto map ids (Low, fixed)
- **Where:** `apps/api/src/modules/match/routes.ts`, `POST /matches/:id/accept` and `/veto`. Also `packages/shared/src/ws.ts` `VetoVotePayloadSchema`.
- **Problem:** a non-UUID id reached Postgres, produced a 500, and wrote an `http_500` entry to the admin error log on every call, which spams the admin feed. `mapId` had no length cap. It was already checked against the veto pool by `castVetoVote`.
- **Fix:** a non-UUID id now answers 404 `match_not_found`, and `mapId` is capped at 64 characters in both the REST body and the WS schema.

### 10. Redirect path hardening (Low, fixed)
- **Where:** `apps/api/src/modules/auth/routes.ts` `safeRedirectPath`, and `apps/web/src/lib/api.ts` `safeReturnTo`.
- **Problem:** the API rejected `//` and backslashes but not tabs or newlines. The web accepted backslashes. It was not exploitable as an open redirect, because the API prefixes the path with the web origin and Node refuses CR and LF in headers. A crafted `returnTo` could still cause a 500, and `/\t/evil` style paths are a known bypass shape.
- **Fix:** both reject control characters and backslashes. The API also caps the path at 512 characters. Tests were added to `auth.test.ts`.

---

## Proposed

### 7. Agent transport and token scope (Medium, proposed)
- **Where:** `agent/internal/config/config.go:60` (`RUSHSITE_LISTEN` defaults to `0.0.0.0:8080`), `infra/systemd/rushsite-agent.service`, and `apps/api/src/modules/match/agent.ts`.
- **Problem:** the agent relies on the host firewall. Every agent shares one static bearer token. `POST /servers` carries the GSLT, the server password and the per-match webhook secret in plain HTTP. On one box this stays on the docker bridge. With a second box it crosses the network.
- **Exploit:** anyone who can reach port 8080, or sniff the link between boxes, gets GSLTs and webhook secrets and can start or stop servers. The agent compares the token in constant time, so this is about exposure, not the check itself.
- **Proposal:**
  - Default `RUSHSITE_LISTEN` to the docker bridge address (`172.30.0.1:8080`) or loopback.
  - Put boxes on a WireGuard or Hetzner private network, or give the agent TLS.
  - Issue one token per host (`AGENT_URLS` entries such as `eu=token@http://...`) so a leaked token is scoped to one box.

### 8. `trustProxy: true` (Low, proposed)
- **Where:** `apps/api/src/app.ts:53`.
- **Problem:** Fastify takes the left-most `X-Forwarded-For` hop as `req.ip`. Recent Caddy versions overwrite client XFF unless `trusted_proxies` is set, so behind the shipped Caddyfile this holds. The limits keyed by IP (login and signed-out callers) depend on it.
- **Exploit:** if a CDN or a second proxy that passes XFF through is ever put in front, a client can pick its own IP and dodge per-IP limits.
- **Proposal:** set `trustProxy` to the Caddy hop only, either `1` or the docker subnet `172.30.0.0/24`, through an env var.

### 11. Webhook replay (Low, proposed)
- **Where:** `apps/api/src/modules/match/routes.ts:76`, and `lib/hmac.ts` `verifySignature`.
- **Problem:** the HMAC covers only the body. A captured request can be replayed until the match ends.
- **Mitigations today:**
  - traffic is HTTPS, or loopback on the box;
  - handlers are idempotent (rounds and kills use `onConflictDoNothing`, `finishMatch` is guarded by status and `ratingApplied`);
  - events for a finished match are ignored, except `demo_uploaded`.
- **What a leaked secret allows:** it is scoped to one match. The holder can forge that match's result, rounds, kills and stats, or send `match_abandoned` with players named as missing. That gives those players the forfeit loss and a cooldown. The secret never leaves the API, the agent and `match.json` (mode 0600 in a 0700 dir). Admins see event bodies but not the secret.
- **Proposal (contract change):** add an `X-Rushsite-Timestamp` header, sign `timestamp + "." + body`, reject anything more than 5 minutes off, and keep a short Redis set of seen signatures.

### 12. Demo URL lifetimes and audience (Low, proposed)
- **Where:** `apps/api/src/modules/match/storage.ts` (`PUT_EXPIRY_SEC = 6h`, about line 17), and `extras.ts` `demoView` (about line 83).
- **Problem:** the presigned PUT is valid for 6 hours. Anyone who reads `match.json` or the agent request can overwrite the demo until then. The download URL (10 minutes) goes to every viewer of `GET /matches/:id`, including anonymous ones.
- **Proposal:**
  - Shorten the PUT to the longest realistic match plus the upload, about 2 hours for rush.
  - Or have the plugin ask the API for an upload URL at match end.
  - Decide whether public demo downloads are intended. The contract implies yes, so this is noted only.
  - Keys are `demos/<date>/<uuid>.dem` built server-side from a validated UUID, so there is no path traversal.

### 13. Uncached expensive reads (Low, proposed)
- **Where:** `apps/api/src/modules/stats/routes.ts:58` (leaderboard `count(*)` with the ban subquery on every page), `:97` (profile loads every rating event, and rank is a `count(*)` per mode), and `stats/distribution.ts`.
- **Problem:** these are now limited to 60 per minute per caller. A crowd of callers can still load Postgres.
- **Proposal:** cache the leaderboard total and the distribution in Redis for 30 to 60 seconds, and limit rating history in SQL (already noted in SCALABILITY.md).

### 14. Rejoin through a stale invite after a kick (Low, proposed)
- **Where:** `apps/api/src/modules/friends/service.ts:470`, `acceptInvite`, which falls back to `party.inviteToken`.
- **Problem:** kick rotates the invite code, but pending `party_invites` rows to the kicked player stay valid for up to 10 minutes.
- **Exploit:** a player who had an unanswered in-site invite (they joined by link instead), and is then kicked, can accept that invite and walk back in.
- **Proposal:** in `PartyService.kick`, mark pending invites for that party and target as `expired`. Or drop the fallback when the original code was rotated by a kick.

### 15. Cup withdraw by any member (Low, proposed)
- **Where:** `apps/api/src/modules/tournaments/service.ts:227`.
- **Problem:** `withdraw` deletes the entry for any member, not only the captain. A teammate can pull the team out before start.
- **Proposal:** decide whether this is intended. If not, check `captainSteamId` or require the party leader.

### 16. Public health metrics (Low, proposed)
- **Where:** `apps/api/src/app.ts:86`.
- **Problem:** it shows connected users, drop counters and loop timings. That is minor information disclosure.
- **Proposal:** keep `{ ok }` public and move the metrics under `/admin` or behind a token.

### 17. Compose and edge defaults (Low, proposed)
- **Where:** `docker-compose.yml:11` and `:40`, `docker-compose.prod.yml`, and `infra/caddy/Caddyfile`.
- **Problems:**
  - `POSTGRES_PASSWORD` defaults to `rushsite`, and the prod override does not require it.
  - Redis has no password.
  - Both are only on the internal network in prod (ports reset), so the risk is lateral movement only.
  - The Caddy container runs as root.
  - Neither site block sets HSTS. The API now sends HSTS itself, the web does not.
  - The API and web images already run as `node`.
- **Proposal:**
  - Require `POSTGRES_PASSWORD` with `:?` in the prod override.
  - Add `requirepass` to Redis.
  - Add `header Strict-Transport-Security "max-age=31536000; includeSubDomains"` to the site block in Caddy.
  - Confirm that the live `COOKIE_DOMAIN` is `.rushsite.dyyln.dev` and not `.dyyln.dev`. The broader value would send the session cookie to every `dyyln.dev` host.

### 18. Session lifetime (Low, proposed)
- **Where:** `apps/api/src/env.ts:39`, and `modules/auth/session.ts`.
- **Problem:** a fixed 30-day TTL with no idle timeout and no rotation. `sess:u:<steamId>` sets are never pruned when sessions expire, so they grow slowly and `destroyAll` iterates dead ids.
- **Proposal:**
  - Refresh the TTL on use, with a shorter idle window of 7 days and a hard cap of 30.
  - Give the per-user set the same TTL, or prune it in `destroyAll`.

### 20. Web CSP strength (Info)
- **Problem:** Next inlines bootstrap scripts, so `script-src` includes `'unsafe-inline'`. That weakens CSP as an XSS backstop. `frame-ancestors`, `object-src`, `base-uri`, `form-action` and `connect-src` are still enforced.
- **Proposal:** move to a nonce CSP set in Next middleware. That makes pages dynamic, so weigh it against the static pages.

---

## Checked and sound

- **Steam OpenID** (`modules/auth/steam.ts`, `routes.ts`):
  - **Endpoint, mode and namespace:** `op_endpoint` must equal `https://steamcommunity.com/openid/login`. `mode`, `ns` and the set of signed fields are checked.
  - **Return URL binding:** `return_to` must match the callback plus the `state` from a signed, HttpOnly, 10-minute login cookie. That binds the response to the browser and stops login CSRF.
  - **Realm:** the realm is the API origin.
  - **Identity:** `claimed_id` must equal `identity` and match `^https?://steamcommunity.com/openid/id/(\d{17})/?$`.
  - **Replay:** the nonce must be within 5 minutes and is stored in Redis with `SET NX` for an hour.
  - **Signature:** it is confirmed with `check_authentication` against Steam's fixed endpoint.
  - **Session:** a new random 256-bit session id is minted on every login, so there is no fixation. Logout deletes the server-side session.
- **Session cookie:** HttpOnly, `SameSite=Lax`, `Secure` when `NODE_ENV=production`, and signed. The domain comes from `COOKIE_DOMAIN`.
- **Admin gate** (`modules/admin/index.ts`, `routes.ts` `requireAdmin`):
  - An encapsulated `onRequest` hook covers every `/admin` route and answers the stock 404 to non-admins and signed-out users.
  - `ADMIN_STEAM_IDS` is split on commas and trimmed, so a malformed entry simply matches nobody.
  - Admin WS events go to admin sockets only.
- **Webhook HMAC** (`lib/hmac.ts`): computed over the raw body buffer (the JSON parser is scoped to the webhook route), with a strict `^[0-9a-f]{64}$` check and `timingSafeEqual`. The secret is 256-bit and scoped to one match. Agent crash reports are signed the same way.
- **Authorization:**
  - party leader actions check leadership and membership inside a row-locked transaction;
  - queue actions act on the caller's own party;
  - match accept requires a match player, and veto voting requires a player on the acting team (checked in `castVetoVote`);
  - challenge accept and decline check target, creator and rematch roster;
  - friend request accept and decline require the recipient, and cancel requires the sender;
  - party invites require friendship, and only the target can answer;
  - cup enter requires the party leader and the trust level;
  - a report requires the reporter and target to be match players, once per reporter, target and match, with the note capped at 500 characters;
  - connect info and the server password go only to participants.
- **Codes:** party invite tokens are 96-bit random. Challenge codes are 8 characters from a 31-character alphabet (about 40 bits) and expire after 10 minutes. With rate limits, neither can be enumerated.
- **Input validation:** bodies and params go through zod: SteamID64 is `^\d{17}$`, ids are UUIDs, modes are an enum, pagination is bounded (leaderboard `limit` ≤ 100 and `offset` ≤ 100k, match history ≤ 50, live matches ≤ 24, admin lists ≤ 200 or 500), and challenge codes are `^[A-Za-z0-9]{4,16}$`. Webhook events are validated by `MatchEventSchema`.
- **Logging:** no tokens, GSLTs, passwords or keys are logged. The Steam and FACEIT keys only appear in outbound URLs and are not logged. Agent errors log the agent URL and status.
- **Web XSS:**
  - React escapes every display name and note;
  - the only `dangerouslySetInnerHTML` renders static SVG files from `public/logo` on the design page;
  - the OG card (`/matches/[id]/card`) validates the id as a UUID and renders names as text through satori;
  - `steam://connect` links come from server data with the password URI-encoded;
  - localStorage holds only UI preferences and a fallback list of reported ids, and the API list is the source of truth.
- **Containers:** the API and web images run as the `node` user. Postgres, Redis and MinIO are bound to 127.0.0.1 in dev and unpublished in prod.
- **Game servers:** `rcon_password ""` disables RCON, GOTV has `tv_password` set, and `match.json` is 0600.

## Dependencies

- `pnpm audit`: 0 critical, 0 high, 1 moderate. The moderate one is `esbuild <=0.24.2` (dev server request forgery), reached only through `drizzle-kit`, a dev tool. No action needed for production.
- New API dependencies: `@fastify/rate-limit@^10.3.0` and `@fastify/helmet@^13.1.1`.
- Plugin NuGet: `CounterStrikeSharp.API 1.0.368` (compile-only, `ExcludeAssets=runtime`), plus the test packages `Microsoft.NET.Test.Sdk 17.11.1`, `xunit 2.9.2` and `xunit.runner.visualstudio 2.8.2`. **Not verified.** `dotnet` is not installed here, so `dotnet list package --vulnerable` could not run.
- Go agent: **not verified.** Neither `go` nor `govulncheck` is installed here.

## Could not verify

- Production config: the live `SESSION_SECRET`, agent token, `COOKIE_DOMAIN`, the firewall on 8080, and which Caddy version is deployed (it decides how XFF is handled). Only response headers were read.
- The web CSP in a real browser. The build and a `next start` smoke test pass and the headers are right. I did not browse the site in a browser, so a blocked resource that only loads at runtime (for example an avatar host other than `*.steamstatic.com`) would only show in the browser console.
- NuGet and Go vulnerability scans (no toolchains on this machine).
