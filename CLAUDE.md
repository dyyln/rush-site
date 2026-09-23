# Project brief: rushsite

> Codename: **rushsite**. Used for the repo, packages and env prefixes.
> The public brand (AimRift vs DuelPoint) is undecided. It lives in one config value and nowhere else.

## What we're building

A competitive platform for Counter-Strike 2 in the spirit of the old PvPRO (CS:GO). Players sign in with Steam, queue for short matches on servers we host, climb a rating ladder per mode, and enter tournaments.

**Initial scope is matchmaking, ranking and tournaments only.** Credits, wagers, payout holds and the rewards store are deferred. See "Later" at the end.

## Deliverables, in build order

1. **CS2 server handling**: Go host agent on one Hetzner AX box, allocator in the API, GSLT pool, automatic CS2 updates. Week one goal is to prove Valve's Rush runs on a community server.
2. **CS2 plugin**: custom CounterStrikeSharp plugin. Whitelist, password, mode config, ready-up, demo recording, result webhooks.
3. **Matchmaking**: three queues, Glicko-2 per mode, party-size buckets, tiers from config, live status over WebSocket.
4. **Lobby**: parties via invite links and Steam friends, accept step, Bo3-style team-vote veto on the website.
5. **Website**: design system first, then Play, Tournaments, Leaderboard and Profile pages.
6. **Tournaments**: free daily and weekly single-elimination cups, Verified required, badges for placings, servers allocated per bracket match.
7. **Fair play, minimal**: Steam and FACEIT checks feeding trust levels, demo upload, rating rollback and bans. Heuristics and overwatch come after tournaments.
8. **Shared config and schema**: mode, map and tier config in one package, Postgres schema, Docker Compose.

## Game modes (only these three)

| Mode | Players | Maps | Rules |
|---|---|---|---|
| **1v1 Aim** | 1 vs 1 | Workshop aim maps (`aim_map`, `aim_redline`, `aim_ag_texture2`, `aim_usp`, `aim_deagle7k`, `awp_india`) | First to 16 rounds |
| **2v2 Aim** | 2 vs 2 (duo or solo + auto-filled teammate) | Same aim-map pool | First to 16 rounds |
| **3v3 Rush** | 3 vs 3 (party of 1 to 3, filled from solo queue) | Valve's single Rush map `rush_001` ("Complex"), rooms drawn at map load | Valve's Rush rules, no tweaks |

- **Rush is the headline mode and a hard requirement.** Valve released Rush on 22 September 2026. Server settings are `+game_type 0 +game_mode 6 +map rush_001`, and dedicated servers receive the map in their depot. The rules live in the map script: seven room slots per match (T castle, 2 mid, start, 2 mid, CT castle) drawn from 4 start rooms and 12 mid rooms, tower control decides rounds, a round win moves play one room toward the loser's castle, the match ends on a win in the enemy castle or 8 round wins, max 15 rounds. The room draw is random and not server-controllable. See docs/RUSH-RESEARCH.md. Running it on a community server is inferred, not yet proven, and is the first experiment.
- **First end-to-end match is Rush.**
- **Map selection is a veto, not a preference list.** Bo3-style pick-ban run on the website before server allocation. Every team member votes on each ban, majority wins, ties are random. Rush has no veto until the room draw can be controlled. There is no permanent map avoid.
- Each mode has its **own rating** and its own leaderboard.
- Map lists, arena ids and rules belong in config, not in code.

## Core features

1. **Steam sign-in** (OpenID). A player's identity is their SteamID64.
2. **Parties**: invite links plus the Steam friends list. No separate friends system.
3. **Matchmaking queues** for the three modes. Rating-based matching that widens over time. Party-size buckets: parties prefer parties and solos prefer solos, mixed only when queue time grows. EU first, region stored on users and matches but the leaderboard shows global only.
4. **Match flow**: match found, accept within 20 seconds, veto, server allocated, connect info shown. Declining or timing out gives a short queue cooldown. A player who never connects or leaves mid-match forfeits, takes the rating loss, and gets an escalating queue cooldown.
5. **Ratings and tiers**: Glicko-2 per mode. Rating is visible from the first match, no placement phase. Tiers are Iron <1000, Bronze 1000 to 1299, Silver 1300 to 1599, Gold 1600 to 1899, Platinum 1900 to 2199, Elite 2200+. Bands live in config and will be tuned once the distribution is visible. No seasons at launch.
6. **Profiles**: rating per mode, win rate, headshot %, rating history, best maps, match history, cup badges.
7. **Leaderboards**: per mode, global. Minimum of 20 matches to place.
8. **Tournaments**: free daily and weekly cups per mode. Single elimination, Bo1 until the semis and a Bo3 final. Verified trust level required for every cup. No check-in. Bracket built from sign-ups, absent players forfeit round one. Server slots are first come first served with the ladder. Prizes are cosmetic profile badges. Leagues (round robin) are a later milestone.
9. **Fair play**: trust levels, demo capture, rating rollback and bans. Details below.

## Trust

Trust levels are New, Verified and Trusted. They gate cup entry and overwatch eligibility now, and will set payout holds later.

Trust is calculated from:
- Steam bans (VAC, game and community bans, days since last ban)
- Steam account age and CS2 playtime
- FACEIT lookup by Steam ID: banned there or not, and how much they've played. **No FACEIT account counts as neutral, not negative.** Check FACEIT's API terms before relying on it.
- History on our platform (reports received, review outcomes)

New to Verified: clean signup checks plus a small number of completed matches without flags. Verified to Trusted: long clean history. A client-side anti-cheat may later be offered as an optional route to Trusted.

## Anti-cheat plan

Server-side detection only at the start. Rating updates immediately and can be rolled back when cheating is confirmed. When confirmed: ban, roll back rating for opponents they beat within a set window.

1. **Signup gate**: Steam ban API plus the FACEIT Data API, feeding the trust score.
2. **Demo capture from day one**: every match records a demo, uploaded to object storage when the match ends. Keep flagged demos until review is done, delete clean ones after a set time.
3. **Heuristics** (after tournaments): parse demos with `demoparser2` in Python. Aim features: time-to-kill after an enemy becomes visible, flick speed and accuracy, headshot rate against the player's own history. Rush features: pre-aim through walls, crosshair tracking of occluded enemies, reaction to unseen players. Needs visibility checks that demoparser2 does not do out of the box.
4. **Community overwatch** (after tournaments): flagged cases are per player. Five reviewers watch that player's POV, 4 of 5 to confirm, admins can override. Reviewers must be Trusted and above a rating floor. Reviewers download the demo and play it in CS2, the web shows the timeline of flagged ticks and kills. Verdict is binary, cheat or clean. **Every ruling is saved as a labelled training example.**
5. **ML model later**: train on those labels. The model ranks cases for review and never bans automatically.
6. **Win-trading**: flag the same accounts playing each other repeatedly, shared IPs or devices, and suspicious throws.

## Infrastructure (game servers)

Provider: **Hetzner**. Start with **one dedicated AX box** running everything: Postgres, Redis, API, web via Docker Compose, plus the CS2 instances. Cloud CCX servers for peak times and a second machine are a later milestone.

- **Don't create a VM per match.** One machine hosts many CS2 processes on different ports, sharing one install of the game (about 60 GB). Raw processes, no containers per slot.
- **Allocator** (inside the API): picks a free slot, reserves a port and a GSLT, asks the host agent to start a server with the match config, and returns the connect info.
- **Host agent** (Go, one binary per machine): starts and stops CS2 processes, reports health and capacity, handles game updates.
- **Match plugin**: custom CounterStrikeSharp plugin on Metamod:Source. Only the match's Steam IDs can join, each match gets a random password, loads the mode config, handles warmup and ready-up, records the demo, sends match events and the final result to the backend by webhook.
- **GSLT pool**: one Game Server Login Token per running server, max 1,000 per Steam account. Use a dedicated Steam account. Reuse tokens between matches.
- **CS2 updates**: once Valve patches, players can't join old servers. The agent stops new matches, lets running ones finish, runs SteamCMD, then reopens, automatically.
- **Networking**: static IPv4, a UDP port range, a firewall, Hetzner's DDoS protection.
- **Orchestration**: agent plus a database table of free slots. Consider Nomad or Agones only with many machines.

## Stack

- **Repo**: monorepo. pnpm workspaces for `apps/web`, `apps/api`, `packages/shared` (types and config). `agent/` (Go), `plugin/` (C#), `worker/` (Python) as top-level dirs.
- **Frontend**: Next.js + TypeScript. Design system built first.
- **Backend API**: Fastify + TypeScript. The matchmaker runs inside the API process for now.
- **Data**: Postgres (source of truth) and Redis (queue state, locks, pub/sub).
- **Realtime**: WebSocket on the API, Redis pub/sub for queue status, match found, veto turns and server ready.
- **Host agent**: Go.
- **Demo analysis and ML**: Python worker with `demoparser2`.
- **Storage**: S3-compatible object storage (Hetzner Object Storage) for demos.
- **Deploy**: Docker Compose on the AX box. Terraform with the hcloud provider when cloud machines arrive.

## Draft data model

`users`, `steam_profiles`, `trust_signals`, `trust_levels`, `parties`, `party_members`, `queue_tickets`, `vetoes`, `matches`, `match_players`, `match_rounds` (optional), `ratings` (per user per mode), `rating_events`, `hosts`, `server_slots`, `gslt_tokens`, `demos`, `flags`, `reviews`, `bans`, `badges`, `tournaments`, `tournament_entries`, `brackets`, `bracket_matches`, `reports`, `cooldowns`.

## Design reference

Mockups exist for Play (mode picker, party, queue), Tournaments, Leaderboard, Profile, and a Credits page kept for later.

- **Look**: dark and tactical, with one muted purple accent. No gradients, no emoji.
- **Colours**:
  - background `#0F0E13`, surfaces `#17151F` / `#1F1C2A`, border `#2C2838`
  - text `#ECEDEF`, muted text `#9AA0AB`
  - accent `#9B8AC4`, accent hover `#B3A4D6`, credits `#E0C36A`
  - win `#3DD68C`, loss `#FF7A7A`, trust/info `#7FD1E0`
- **Fonts**: Chakra Petch (display), IBM Plex Sans (body), IBM Plex Mono (numbers and map names).
- **Accessibility**: real buttons and links, text contrast of at least 4.5:1, touch targets of at least 44 px.
- Design tokens live in one CSS file from the start.

## Constraints and guardrails

- Don't copy PvPRO's branding, assets or copy. It is an inspiration only.
- Keep "CS", "Counter-Strike" and "Valve" out of the product name and logo. "For CS2" in copy is fine.
- Never auto-ban on a model score alone. Humans confirm.
- Secrets (Steam API key, FACEIT key, GSLTs, Hetzner tokens) go in environment variables or a secret store, never in the repo.

## Later: credits, wagers, holds and store

Deferred, but the schema should leave room. Decisions already made:

- Credits live in an **append-only ledger**, never a mutable balance. Every entry carries a **source** (earned, purchased, wager_win, refund, bonus) from day one.
- Earning: win only, flat amount per mode. Cup entry fees in cleared credits only, funding the prize pool.
- Holds: a short pre-emptive hold by trust level (roughly 2 to 6 hours), extended to the full hold (New ~7 days, Verified ~72 h, Trusted ~24 h) on a report, a heuristic flag or a win-trade signal. Players always see why credits are held and when they clear.
- Confirmed cheating: void pending and cleared-but-unredeemed credits. Victims are refunded only from that voided pool. Redeemed rewards are the accepted loss.
- Wagers: fixed stakes per queue bracket, both sides stake the same. Pots follow the same short hold. **Earned credits only.** No paid credits or skin deposits until legal advice and a licensing plan exist. Valve's Subscriber Agreement forbids items as gambling currency and Valve has shut down skin betting sites, which would put Steam sign-in and API access at risk.
- Business model: subscription plus store margin, no rake.
- Real-value rewards need Trusted level and weekly caps. No paid chance mechanics.

## Open questions

- Final name and domain (AimRift vs DuelPoint)
- Proving Rush end to end on a community server, and whether overriding the map script can control the room draw
- CounterStrikeSharp is broken on the current CS2 build (fix PRs #1432, #1433 open). Pin a working build or wait for a release
- demoparser2 cannot yet parse rush_001 demos
- Whether to require phone verification for the Trusted level
- Region expansion beyond the EU
