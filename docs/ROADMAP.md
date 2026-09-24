# rushsite roadmap: prototype, market, monetisation

Status as of 23 Sept 2026, HEAD `5cd9ea0`. Sources: `CLAUDE.md`, `docs/REVIEW-TECH.md`, `docs/REVIEW-BIZ.md`, `docs/REVIEW-UX.md`, `docs/SCALABILITY.md`, `docs/SECURITY.md`, `docs/RUSH-RESEARCH.md`, `agent/RUSH.md`, `agent/README.md`, `plugin/README.md`, `packages/dathost/README.md`, `packages/faceit/README.md`, `infra/`.

Effort: **S** is under a day, **M** is 1 to 3 days, **L** is 1 to 2 weeks. "Dep" names the step that has to come first.

**Where things stand.** `5cd9ea0` fixed tech review criticals 1 to 3: one launch table exported from `MODE_CONFIGS` into `agent/testdata/modes.json`, Rush sides enforced with a warmup hold, and a liveness watchdog in `apps/api/src/modules/match/watchdog.ts`. The same commit also claims fixes for:
- High #4: the DatHost connect-info race, fixed with a renewed lease
- High #5: late Steam authorization (`AuthTests.cs`)
- Part of High #6: `server_unreachable` with no cooldown when no one connected
- Plugin state kept across a hot reload (`match_state.json`)
- Idempotent rollback
- UX top 15

Migration `0013_review_reopen.sql` no longer casts the enum to text in the index predicate.

Nothing has run on a real CS2 server yet. Every fix above has only passed against fakes. Production (`rushsite.dyyln.dev`) runs on a shared VPS and is behind HEAD (REVIEW-TECH 7.6).

---

## Part 1. Functional prototype

Goal: one real Rush match with six real players on our own box, from queue to demo in storage, with a correct rating change. Then one aim match. This covers items 1 to 12 of REVIEW-TECH "Do not launch until".

### 1.1 Decide the topology (do this first)

- [ ] **S. Choose where the site runs.** The brief says one AX box runs everything. The live deploy runs Postgres, Redis, API and web on a shared VPS with small memory caps (Postgres 512m, Redis 128m). Two options:
  - **Recommended:** move the site onto the AX box, as `infra/hetzner/README.md` describes. The API then reaches the agent over the `rushsite0` bridge, and port 8080 is never exposed.
  - Keep the VPS. Then the agent API crosses the internet in plain HTTP with one shared token that carries GSLTs and webhook secrets (SECURITY 7). You would need WireGuard or TLS plus a token per host first. That is **M**.

### 1.2 Box, Steam account and GSLTs

- [ ] **S. Order the Hetzner box.** AX102, or AX52 to start, in FSN1 or NBG1 with NVMe RAID 1. Recheck the price, since Hetzner repriced in 2026 and REVIEW-BIZ uses €122.30. Then run installimage with Ubuntu 24.04, harden it, and set up the Robot firewall plus ufw exactly as in `infra/hetzner/README.md` §2 and §3. Apply `infra/sysctl/99-rushsite-gameserver.conf`.
- [ ] **S. Set up the GSLT account.** Use a dedicated Steam account that is not limited, has a phone number, and owns CS2. Create about 20 tokens for app 730 and load them into the `gslt_tokens` pool from env or the secret store, never the repo.
  - **Prepare a second token account now.** One GSLT ban takes the whole fleet offline (REVIEW-BIZ §6).
  - Never ship `!ws`, knife or skin plugins.
- [ ] **S. Install the game.** Run `agent/scripts/bootstrap.sh` and check that `game/csgo/maps/rush_001.vpk` is present at about 569 MB. **Pin both `CSS_ZIP` and `METAMOD_URL`.** Metamod currently defaults to "latest 2.0 dev" (REVIEW-TECH 6.4).
- [ ] **S. Turn off hot reload.** Add `"PluginHotReloadEnabled": false` to `addons/counterstrikesharp/configs/core.json` from `bootstrap.sh`. This is not done yet. `match_state.json` is only the safety net (REVIEW-TECH 6.2, `plugin/README.md`).

### 1.3 Prove Rush on a community server (week one, the critical path)

- [ ] **M. Run the vanilla Rush experiment.** Follow `docs/RUSH-RESEARCH.md` "Recommended experiment" steps 1 to 5 and `agent/RUSH.md` "First test", with no Metamod. Record each of these in RUSH-RESEARCH:
  - `mp_team_intro_type` reads `rush` and `mp_maxrounds` reads 15
  - there are no script errors
  - the tower capture works and rounds end at about 40 s
  - the `round_end` reason values
  - **whether `cs_win_panel_match` fires before `mp_match_end_restart`**
  - what the restart does afterwards
  - whether `+map rush_001` alone picks up the mode, or needs `extraArgs: ["+mapgroup","mg_rush_001"]`
  - whether `-maxplayers 7` is honoured and GOTV does not take a player slot
  - whether `tv_record` under `tv_delay 105` writes a complete demo
- [ ] **S. Run a demo parse check.** Parse the test demo with demoparser2 and look for the `CFuncConveyor` desync (RUSH-RESEARCH §6). If it fails, file upstream and move the Rush heuristics later. This does not block the prototype.
- [ ] **M, optional. Test room-draw control.** Run the room names check (`ent_find t1room`) and the `rush_001.vjs_c` override test (step 7). This only decides whether a Rush veto is ever possible. It does not block anything.

### 1.4 CounterStrikeSharp and the plugin on a real server

- [ ] **M to L. Get a working CSS build.** CSS v1.0.374 predates CS2 1.41.8.2. PRs #1432 and #1433 are open, and entity listeners are still broken on #1433. Either build from #1432 plus the Skybox fork's extra offsets, or wait for a release. Pin that exact zip. Dep: 1.2.
- [ ] **S. Retarget the plugin.** Build with `-p:RushsiteRuntime=net10 -p:CounterStrikeSharpVersion=<deployed>` against the pinned build (REVIEW-TECH 6.3). .NET 8 support ends in November 2026, so make net10 the default in `plugin/Directory.Build.props`.
- [ ] **M. Add a `rushsite_selftest` console command.** It should call every CSS API the adapter uses: schema props, `GetAllEntities`, `AuthorizedSteamID`, `ExecuteClientCommandFromServer` and the `jointeam` listener, and print the results. Use it for the canary in 1.6.
- [ ] **M. Check the plugin assumptions on the box.** These are listed in `plugin/README.md` and REVIEW-TECH §1.4:
  - Rush go-live fires one of `round_announce_match_start`, `begin_new_match` or `round_freeze_end`
  - the win panel, or the score fallback, ends the match exactly once
  - the `jointeam` redirect works through `ExecuteClientCommandFromServer`, which is unverified
  - bots leave within 1 s
  - arena detection finds `t1room.<id>`
  - the aim `mode.cfg` re-exec survives the map load, checked with `mp_startmoney` reading 16000 and no C4
  - several concurrent `host_workshop_map` downloads into one install are safe

### 1.5 Remaining tech review highs (#4 onward)

| # | Item | State after 5cd9ea0 | Remaining step | Effort |
|---|---|---|---|---|
| 4 | DatHost surge race and double clone | Race fixed with a lease | Measure clone-to-ready time on the real account. Run DatHost starts outside the `eachLimit` allocation pass so a 240 s boot cannot stall Hetzner allocation (4.2). **Recommended: keep DatHost off for the first match night** | M |
| 4b | DatHost template | Not built | Follow `packages/dathost/README.md` "Building the template". Check `rushsite_base.cfg` into the repo, since it is currently only referenced (2.5). Do the hand check of `game_type 0; game_mode 6; changelevel rush_001` on DatHost | M, dep 1.4 |
| 5 | Late Steam auth | Fixed in Core with tests | Check it on a real server on a slow Steam day | S |
| 6 | Infra failures punished | Cooldowns now need the other team connected. `server_unreachable` added | **Forfeit wins are still rated in full when the winner connected** (`flow.ts:847-849`), which alts can farm (3.4). Rate them only after N played rounds, or at reduced weight. Stop allocating to hosts whose `cs2Version` is behind Steam's current build (3.3) | S + S |
| 7 | Demo pipeline | Unchanged | Create a Hetzner Object Storage bucket. Point `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` at a public URL, not `http://rushsite-minio:9000`. The plugin should delete the `.dem` after upload, the agent should sweep old `.dem` files, and an API job should read `delete_after`, which is only written today (`flow.ts:600`). Stream DatHost demos instead of buffering them in the 512 MB API | M |
| 8 | CS2 updates break the plugin silently | Unchanged | Add a canary gate in `update/update.go` `drain`: start one synthetic server, wait for `server_ready` plus the selftest, and reopen only after that. Otherwise stay closed and alert. Write a one-page patch-day runbook covering who watches CSS, how to pin, and how to close `queue.<mode>.open` | M |
| 9 | Ops: CI, migrations, backups, Redis, deployed SHA | 0013 fixed. No CI (no `.github` or `.forgejo`) | See 1.6 | M |
| 10 | Tests check code against its own fakes | Partly done: `agent-contract.ts` and the modes fixture | Run the API suite on real Postgres 16 in CI with `ALLOW_UNRESOLVED_MODES` off. Add a test for the SQL `TournamentStore`. Add golden webhook bodies shared by the plugin and the API. Add a Playwright smoke run against the local stack. Save the first real match's server and webhook logs as a fixture | M |
| 2.3 | Webhooks drop after about 150 s | Unchanged | Persist unsent events to the match dir and replay them on load. Keep retrying `match_end` and `match_abandoned` for at least 15 minutes | S |
| 3.2 | A failed stop frees the slot and GSLT | Unchanged | Keep the slot and token `releasing` until the agent's list no longer shows the server. Reconcile in `syncHosts` | S |
| 3.6 | Rating drift | Unchanged | Nightly job that replays rating events and reports differences | S |
| SEC 17, 16, 8 | Compose defaults, public `/health` metrics, `trustProxy` | Proposed | Set real Postgres and Redis passwords and HSTS, hide the `/health` metrics, and trust only Caddy | S |

### 1.6 CI, deploy and backups

- [ ] **M. Add a CI pipeline** on Forgejo Actions or GitHub. It runs `pnpm -r typecheck`, `pnpm -r test`, the web build, `go test ./...` and `dotnet test`, plus migrations against Postgres 16. `deploy.sh` should refuse any SHA that has not passed.
- [ ] **S. Run migrations separately.** Run them in a one-off container before `compose up`, so a failed migration leaves the old API running. Add a `/version` endpoint that returns the deployed SHA, then deploy HEAD (7.6).
- [ ] **S. Fix backups.**
  - `infra/scripts/db-backup.sh` targets the repo compose file, not the live stack (7.3). Fix the service name.
  - Add a systemd timer for a nightly `pg_dump`, copied to Hetzner Object Storage in another location or to a Storage Box.
  - **Do one restore drill.**
- [ ] **S. Fix Redis and logs.** Run Redis with `--maxmemory` and `volatile-lru`, and raise its cap. Set logging options on every container, and add logrotate for `/var/lib/rushsite-agent/logs` and `steamcmd.log`.

### 1.7 Observability

- [ ] **S. External uptime checks** on the web, `/health` and each agent `/health`, sending alerts to a private Discord webhook.
- [ ] **S. Error tracking** for the API and web, using Sentry or GlitchTip, which can be self-hosted.
- [ ] **M. Metrics and alerts** from SCALABILITY §10. The admin ops metrics (`admin/ops-routes.ts`) already exist, so extend them:
  - `queue_wait_seconds{mode}`
  - `allocation_wait_seconds`, `slots_free`
  - match cancellations by reason (`server_unreachable`, `server_lost`, `timeout`, `no_server`)
  - webhook 4xx and 5xx rates
  - watchdog kills
  - agent `updating` state
  - Alert on any `server_start_failed`, on `slots_free` = 0, on a host in `updating` for more than 30 minutes, and on more than one watchdog kill an hour.
- [ ] **S. Keep the CS2 console log for each match** for 7 days, linked from the admin match view.

### 1.8 FACEIT check

- [ ] **S. Work through the terms checklist** in `packages/faceit/README.md` §"API terms: verify before launch". Every box is still unticked. Confirm that using the data to gate access on a competing platform is allowed, check the rate limits, and confirm who owns the key. Record the date checked.
- [ ] **S. Set the key.** Register the app and set `FACEIT_API_KEY`. If the terms forbid this use, set the FACEIT weight to zero. Trust must still work from Steam signals and platform history alone. Having no FACEIT account stays neutral.

### 1.9 Manual test script for match night one

Dep: everything above. Six testers with real Steam accounts. Two admins in `ADMIN_STEAM_IDS`, with `/admin` open. Keep the server console on screen.

1. **Pre-flight**
   - `/version` shows the SHA that passed CI.
   - `/status` shows `rush3v3` available.
   - Agent `/health` shows 16 free slots and the current `cs2Version`.
   - The canary passed.
   - The GSLT pool has at least 3 free tokens.
   - A presigned PUT from the game box to the bucket works, tested with curl.
2. **Sign-in and trust.** All six sign in with Steam. Each profile shows trust level New, and FACEIT and Steam signals are visible in the admin user lookup.
3. **Party.** A trio forms through an invite link, a duo through Steam friends, and one player stays solo. Each queues for Rush.
4. **Accept.** A match is found. One player declines on purpose, then checks that the others are requeued with the copy "Back in queue" and that the decliner gets a short cooldown. Everyone accepts on the second try.
5. **Allocation.** Time from accept to `server_ready`. The connect string and password appear, and Launch CS2 works.
6. **Joining**
   - A non-whitelisted account is kicked.
   - A wrong password is refused.
   - A player joining the wrong side is redirected, and is kicked after 3 wrong attempts.
   - `rushsite_status` shows the correct lineup.
   - Warmup is held until all six are in.
7. **Live play**
   - `match_started` arrives.
   - `round_end` arrives with `arena` set.
   - The kill feed on the match page matches the game.
   - Log every round winner by hand and compare with the page.
8. **Disconnect.** One player disconnects mid-match for less than 180 s and reconnects. The match continues.
9. **End**
   - `match_end` arrives once.
   - The rating changes follow Glicko-2 for the right team.
   - The result card shows Won or Lost, the score and the tier change.
   - `demo_uploaded ok` arrives about 110 s later.
   - The demo downloads and plays in CS2.
   - The server is torn down, and the slot and GSLT are free again.
10. **Aim match.** Repeat steps 1 to 9 for 1v1 Aim, with the veto. Confirm $16000 start money and no C4.
11. **Failure drills**
    - Kill a CS2 process mid-match. Expect a crash webhook, a cancelled unrated match, and no cooldowns.
    - Stop the API for 3 minutes during a match. Expect `match_end` to arrive after the restart.
    - Run a forced allocation with a wrong `RUSHSITE_PUBLIC_IP`. Expect `server_unreachable` with no cooldowns.
    - Use admin cancel and admin ban. Expect the ban to close the player's socket.
12. **Archive.** Save the server logs, the webhook logs and the admin screenshots as the reference fixture.

---

## Part 2. Take it to market

### 2.1 Launch readiness

- [x] **S. Decide the name.** DuelRush, at duelrush.site.
  - Search EUIPO and UKIPO in classes 9, 41 and 42.
  - Still to do: the Discord, X, YouTube and TikTok handles.
  - Brand set in `packages/shared/src/config/brand.ts`, so page titles, the manifest and the plugin chat prefix read DuelRush.
  - Keep CS, Counter-Strike and Valve out of the name and logo.
- [ ] **M. Legal pages** (mostly writing, plus a solicitor review for about €500 to €1,500):
  - Terms of service, including a minimum age of 16 to avoid parental consent across the EU
  - Fair-play and conduct rules
  - Privacy notice
  - Cookie notice (the session cookie is strictly necessary, so no banner is needed if there is no analytics tracking)
  - Ban appeal process
  - Imprint and contact
  - "Not affiliated with Valve" wording
- [ ] **M. GDPR work for EU players** (REVIEW-BIZ §6):
  - A record of processing that covers SteamID64, IPs, FACEIT lookups, trust scores, demos and bans.
  - A legitimate-interest assessment for trust scoring and bans. This is profiling with a significant effect, so add a human-review route.
  - Retention: clean demos 30 days (needs the delete job from 1.5 #7), flagged demos until review ends, IPs 90 days.
  - A data processing agreement with Hetzner, and DatHost if it is used.
  - An access and erasure route by email. Keep ban records under legitimate interest.
  - An EU Article 27 representative if the company is outside the EU.
  - **Check whether GOTV demos carry voice.** Nothing in `agent/internal/match/cfgs/` sets voice. Disable voice in demos, or state it in the notice.
- [ ] **S. Stay inside the Steam API terms.**
  - Budget calls against the 100k-a-day limit. Cache profiles, bans and playtime for 6 to 24 hours, as the FACEIT client already does.
  - Show "Powered by Steam" and use Steam's sign-in button.
  - Imply no endorsement from Valve.
  - Nothing on the site should resemble gambling or items, because the terms allow termination without notice.
- [ ] **S. Set up support.**
  - A Discord server with a ticket bot for support, appeals and bug reports.
  - `support@<domain>` for GDPR requests and appeals. Link it from `/banned`, which has had an appeal link since UX #13.
  - The existing `/status` page, plus admin announcements tied to mode availability.
  - Post a patch-day norm: queues close after a Valve update until the canary passes.

### 2.2 Liquidity strategy (REVIEW-BIZ §4 and §11, strategy A)

The numbers that bind: acceptable waits need about 100 to 200 players in the Rush loop at peak and about 24 in 1v1. With 50 online, Rush has a p90 wait of 20 to 25 minutes.

- [ ] **S. Rush-only matchmaking at launch.**
  - Close `aim2v2` with `queue.<mode>.open`.
  - Offer 1v1 only through direct challenges (`/challenge` exists), not a public queue.
  - Open the 1v1 queue once Rush holds 100 or more players in the loop at peak.
- [ ] **M. Fixed queue windows**, for example 19:00 to 23:00 CET, shown as a countdown on home and Play. Outside the window, show "Queues open at 19:00" in place of Play now. This needs a small schedule field on each mode's config.
- [ ] **S. Cup schedule.**
  - A nightly Rush trio cup at 21:00 CET, in the middle of the window.
  - A weekly team cup on Saturdays.
  - Stagger cups, since today all daily cups start at 18:00 UTC.
  - Reserve surge capacity for cups only.
- [ ] **M. Seeding.** Aim for 150 to 300 committed players on launch night, not a trickle.
  - Recruit 20 to 40 trios before launch through Discord and "founding team" sign-ups. Give them a permanent Founder badge.
  - Hold a scheduled launch night with a cup.
  - Reach Verified faster: 5 clean matches is already the rule, so run two practice nights before launch.
- [ ] **M. Discord as the home.** Channels for LFG trios, cup check-in, results bot posts, patch-day status, appeals and feedback. Bots post match results and new tier-ups.
- [ ] **M. Streamers.** Find 3 to 5 small to mid EU CS2 creators with 500 to 5,000 viewers who already play Rush. Offer:
  - their own streamer cup
  - a custom badge for their community
  - an early-access trio ladder
  Budget cosmetics and possibly €100 to €300 per stream if cash exists. Skin and gambling sites outbid us on cash, so compete on exclusivity: "the Rush ladder".
- [ ] **S. Kill criteria, set now.**
  - By week 6: fewer than 60 players in the Rush loop at the weekly peak, or under 20% of week-one players back in week four.
  - If either holds, move to strategy C: tools for hubs and Discord organisers (REVIEW-BIZ §11).

### 2.3 Community and content

- Rush room guides for 16 rooms (4 start rooms and 12 mid rooms). Use the `arena` field in `round_end` to publish room win rates by side each week. No one else has this data. **M**
- A weekly "Ladder report" post covering the top 10, biggest climbers and cup winners, auto-generated from the leaderboard and `rating_events`. **S**
- Cup highlight clips cut from stored demos, posted to the Discord and to TikTok or Shorts. **M, ongoing**
- SEO pages for "CS2 Rush ladder", "Rush tournament" and each room, while the terms are uncontested. **S**
- One launch post on r/cs2 with a playable night announced. Follow the self-promotion rules and post once. **S**

### 2.4 Growth loops

- **Trio invites.** A party invite link is the unit of growth. Put "Bring your trio" first on Play, and show a lone solo "Invite 2 friends, queue faster".
- **Challenges.** The `/challenge` share link is the only 1v1 path at launch. Add an OG image built from the share card.
- **Cup badges.** Badges for placings show on the profile, the hover card and the leaderboard. Add a "Founding season" badge and a participation badge for cups entered.
- **Friends leaderboard.** It already exists. Nudge after each match: "You passed @friend".
- **Referral badge.** A badge for 3 invited players who each reach Verified. Cosmetic only, with no credits for now.

### 2.5 Metrics to watch

| Metric | Target at launch | Source |
|---|---|---|
| Players in the Rush loop at peak | 100 or more by week 4 | `matchmaker_tickets` plus active matches |
| Rush queue wait p50 / p90 | under 60 s / under 180 s | `queue_wait_seconds{mode}` |
| Accept rate, matches reaching "any gap" | over 90%, under 10% | match flow |
| Match completion rate (not cancelled or abandoned) | over 95% | cancellation reasons |
| Time from sign-in to first match | under 5 min in the window | web events |
| D1 / D7 / W1 to W4 retention | 40% / 20% / 20% | users, matches |
| Share of queues from parties | over 50% | queue tickets |
| New to Verified conversion | over 50% of players with 5 or more matches | trust |
| Cup entrants, no-show rate | 16 or more, under 15% | tournaments |
| Hosting cost per match | under €0.02 | box cost / matches |
| Discord members, weekly active | 1,000 / 25% | Discord |

### 2.6 Remaining UX review items (after the top 15)

Effort is **S** each unless marked.
- Home: a three-step "how it works" strip. Cup times in `LocalTime` on home (`NextCups`). Titles use the brand, and the 404 has the title "Page not found" plus links to Home and Leaderboard.
- Play: explain the Opponents filter or hide it for New players. Connect copy with a visible countdown ("Join within 3:00 or you forfeit"). A header queue pill on every page. Make the mock requeue behave like live.
- Party: confirm Leave when the party has members or a ticket. Put the size icons inline. Use single-initial avatars.
- Match page: merge the duplicate score blocks. Wrap the timeline, or make it a 44 px scroll strip, on phones. Return a real 404 for unknown matches.
- Profile: use the display name in the tab title, not the SteamID64.
- Leaderboard and ranks: default to the viewer's most-played available mode. Add empty states in place of 0% bars. Separate Iron and Silver visually.
- Friends: add by display name (**M**). Use one button style for row actions. Disable invites to offline friends, or give them an expiry.
- Cups: a round picker for the bracket on phones.
- A notifications inbox with a bell (**M**).
- Settings: the colour-blind toggle should use Team A and Team B and explain what it changes. Move the trust filter into Settings.
- Header: put Friends in the phone nav. Announce veto turns in a live region.
- Tap targets under 44 px on the leaderboard tier chips, friends links, profile match links and cup title links. `--color-border-strong` at 3:1 on outlined buttons. Disabled primary buttons should not look live.

### 2.7 90-day plan

| Weeks | Focus | Exit criterion |
|---|---|---|
| 1 to 2 | Part 1: box, Rush experiment, CSS build, demos, CI, backups, canary | Match-night script passes for Rush and aim |
| 3 | Name, domain, legal pages, GDPR notice, Discord, support. Fix the remaining S-sized UX items. Queue windows | Public beta page live. Discord open |
| 4 | Closed beta: 30 to 60 recruited players, 3 nights a week, first nightly cup | Match completion over 95%, no stuck matches |
| 5 | Streamer outreach, founding trio sign-ups, room guides | 150 or more committed for launch night |
| 6 | **Public launch night**: Rush window plus a launch cup | 100 or more in the Rush loop at peak |
| 7 to 9 | Weekly cups, ladder reports, clip content. SCALABILITY quick wins 1 to 8. First patch-day drill run for real | W1 to W4 retention of 20% or more |
| 10 | **Kill or continue review** against the criteria in 2.2 | Continue, or pivot to strategy C |
| 11 to 13 | If continuing: open the 1v1 queue, overwatch beta with a lowered Trusted bar for reviewers, subscription design and legal opinion started (Part 3, stage 0) | 1v1 p50 under 60 s. Legal counsel engaged |

---

## Part 3. Monetise

Decisions already made in `CLAUDE.md` "Later":
- an append-only credit ledger with a `source` on every entry
- credits earned on a win only
- holds by trust level
- wagers with earned credits only
- revenue from a subscription plus store margin, with no rake
- no paid chance mechanics and no skins
- real-value rewards need Trusted status and weekly caps

REVIEW-BIZ §5 adds the key correction: **a store that sells for earned-only credits has no margin and is a cost centre.** So the store margin has to come from direct cash purchases of cosmetics, never from paid credits.

### 3.1 Sequence

**Stage 0: gates (before any payment code).** Dep: Part 2 kill review passed.
- [ ] **M. Company and bank.** A limited company, a business bank account, and a VAT position.
- [ ] **S. Merchant of record.** Paddle, or Lemon Squeezy or FastSpring, acts as the MoR. It collects and remits EU OSS and UK VAT, handles chargebacks and issues invoices. The fee is about 5% plus €0.50. Stripe Billing with Stripe Tax is cheaper per transaction but makes us register for OSS and handle disputes. Stay with an MoR until revenue is over about €5k a month.
- [ ] **L (external). A gambling-law opinion** before stages 3 and 4, per launch country: at least the UK, Germany, the Netherlands and Sweden. The estimate is €2k to €10k (REVIEW-BIZ §5). The questions:
  - Is credit redeemable for real-value rewards "money's worth"?
  - Is a head-to-head wager a betting intermediary?
  - Does the Rush random room draw add a chance element?
  - Does a subscription count as consideration?

**Stage 1: subscription ("Supporter", about €4.99 a month including VAT, €3.46 net).** **M.**
- Safe perks, none of which affect match outcomes or credit earning:
  - cosmetic profile badges, frames and banners
  - extended stats: per-room Rush win rates, rating history beyond 90 days, head-to-head records
  - **longer demo retention** (for example 180 days, against 30 for free), plus bookmarked rounds
  - **private cups and ladders** for your Discord (the strategy C bridge)
  - custom challenge lobbies
  - early access to new modes
- Avoid:
  - Queue priority while any mode has a p50 over 60 s, because it hurts free players in thin queues. It is allowed later as a small tie-break only.
  - Credit multipliers, which make the subscription consideration for rewards.
  - Rating boosts.
  - Extra cup entries.
- Build: a `subscriptions` table fed by MoR webhooks (signed and idempotent), an entitlement check in the API, and a Settings page with a link to the MoR customer portal.
- Needs from trust: none. Anyone can pay. Banned players lose perks, and the terms say no refund.

**Stage 2: cosmetics store for cash.** This is the real store margin. **M.**
- Direct purchases only, with a known item every time and never a random box: profile themes, badge frames, name colours, card backgrounds, and match share-card styles.
- Everything is on-site and has no link to Steam inventory items, per the Valve and GSLT rules.
- Margin is close to 100% before MoR fees.
- Needs from trust: chargeback handling. A chargeback revokes the item and flags the account.

**Stage 3: credits ledger and rewards (earned only).** **L.** Dep: stage 0 legal opinion, and win-trade detection live.
- Schema (append-only, never updated in place):
  - `credit_entries(id, steam_id, amount, source enum[earned, purchased, wager_win, refund, bonus], kind enum[credit, debit, hold, release, void, redemption, stake], status enum[pending, held, cleared, voided], match_id, wager_id, hold_until, hold_reason enum[pre_emptive, report, heuristic_flag, win_trade], reverses_entry_id, created_at, created_by)`
  - Balances are views: cleared, pending and held.
  - A nightly invariant job, in the same spirit as REVIEW-TECH 3.6.
  - `purchased` stays in the enum from day one but is never written.
- Earning: a flat amount per mode on a **rated** win only. Forfeit wins earn nothing until REVIEW-TECH 3.4 is closed.
- Holds: a pre-emptive hold of about 2 to 6 hours by trust level. Extend it to the full hold on a report, a flag or a win-trade signal: New about 7 days, Verified about 72 hours, Trusted about 24 hours. Players always see the reason and the clear time.
- Confirmed cheating:
  - Void pending and cleared-but-unredeemed credits.
  - Refund victims only from that voided pool.
  - Redeemed rewards are the accepted loss.
  - Tie this to the existing `rollbackCheater` window.
- Rewards: in-site cosmetics first, at no cash cost. Real-value rewards only for Trusted players who pass an 18+ identity check, with weekly caps. Budget reward spend at no more than 20% of the previous month's net subscription revenue.
- Needs from trust and fair play:
  - demo heuristics running (demoparser2 must parse rush_001, or aim only)
  - overwatch with at least about 20 active reviewers
  - win-trade detection: repeat pairings, shared IPs and devices, throws
  - rollback correctness (fixed in 5cd9ea0, now needs an invariant check)

**Stage 4: wagers (earned credits only).** **L.** Dep: a positive legal opinion for each country offered, and stage 3 running for 60 days or more without abuse.
- Fixed stakes per queue bracket, equal on both sides. Stakes are escrowed as `stake` entries, and the pot follows the short hold.
- **1v1 Aim only at first.** Leave out Rush, because of the room-draw chance element.
- 18+ verification. Geo-block countries without a clean opinion. Daily loss limits.
- Wager matches require the Trusted level and **count as "flag-priority" for review**.
- No paid credits, skin deposits or cash-out, ever, without a licence plan.

### 3.2 Fraud and chargebacks

- **Payments.** The MoR absorbs the dispute process. On a chargeback, revoke the entitlements, flag the account, and block purchases on it.
- **Credit farming by alts.**
  - A Steam account age and playtime floor for earning.
  - Unrated forfeit wins earn nothing.
  - Flag the same opponents meeting more than N times a week.
  - Hold credits from shared-IP pairings.
- **Account selling of Trusted accounts.** Check for sudden changes in IP or country and in rating behaviour, and reset Trusted on a strong signal. Consider phone verification for Trusted (an open question in `CLAUDE.md`).
- **Never auto-ban or auto-void on a model score.** Humans confirm.

### 3.3 Revenue model

Assumptions:
- Peak-to-DAU ratio of 0.12 and DAU-to-MAU ratio of 0.3 (REVIEW-BIZ §4).
- Subscription at €4.99 including VAT, €3.46 net after VAT and MoR fees.
- Cash cosmetics: 1% of MAU buys about €3 a month, 80% net.
- Private-cup organiser plan at €19 a month.
- Credits and wagers are excluded. They are a cost and risk line, not revenue, under the no-rake rule.

| | Conservative | Base | Upside |
|---|---|---|---|
| Peak concurrent (all modes) | 60 | 250 | 800 |
| DAU / MAU | 500 / 1,700 | 2,100 / 7,000 | 6,700 / 22,000 |
| Subscription conversion of MAU | 1% | 2.5% | 4% |
| Subscribers × €3.46 | 17 → €59 | 175 → €606 | 880 → €3,045 |
| Cosmetics (1% MAU × €3 × 0.8) | €41 | €168 | €528 |
| Organiser plans | 0 | 5 → €95 | 20 → €380 |
| **Revenue per month** | **€100** | **€869** | **€3,953** |

### 3.4 Cost side (per month)

| Item | Conservative | Base | Upside | Notes |
|---|---|---|---|---|
| Hetzner AX102 | 1 × €122 | 3 × €122 = €367 | 9 × €122 = €1,100 | 16 slots each. About 40 concurrent matches at 250 peak (REVIEW-BIZ §5). Recheck 2026 pricing |
| DatHost surge (€0.33 per server-hour) | €10 | €40 | €150 | Cups and peaks only. Boxes are 31 times cheaper at full use |
| Object storage (demos plus backups) | €6 | €15 | €40 | About 40 GB a day at 1,000 matches a day, 30-day clean retention |
| Off-box backups (Storage Box) | €5 | €10 | €20 | |
| Domain, mail, error tracking, uptime | €10 | €20 | €40 | |
| AI and dev tooling | €150 | €150 | €200 | |
| MoR fees | in net | in net | in net | About 5% plus €0.50 per transaction |
| Legal (one-off, amortised over 12 months) | €0 | €300 | €500 | Terms and privacy review, then the gambling opinion |
| Reward budget (stage 3 or later) | €0 | €0 to €120 | €0 to €600 | Capped at 20% of net subscription revenue |
| **Total** | **about €300** | **about €900 to €1,020** | **about €2,050 to €2,650** | |

**Reading it.** Conservative loses about €200 a month, a hobby budget. Base roughly breaks even on cash. Upside covers cash costs with about €1.3k to €1.9k left, well short of one salary (about €5.5k employer cost, REVIEW-BIZ §5). A salary needs about 1,700 subscribers, so 34,000 to 85,000 MAU. That is why the plan keeps strategy C (organiser tooling at higher prices per customer) as the revenue fallback, and treats wagers as a gated, optional stage, not the business model.

### 3.5 What each stage needs from trust and fair play

| Stage | Trust gate | Fair-play prerequisite |
|---|---|---|
| 1 Subscription | None | Bans revoke perks |
| 2 Cosmetics | None | Chargeback flagging |
| 3 Credits and rewards | Earning: Verified. Real-value redemption: Trusted plus 18+ identity check plus weekly caps | Win-trade detection, rollback invariant job, forfeit farming closed (3.4), review SLA under 72 h |
| 4 Wagers | Trusted plus 18+, geo-limited | Heuristics live for aim, overwatch pool of at least 20, every wager match reviewable, legal opinion on file |
