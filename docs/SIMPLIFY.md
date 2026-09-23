# Simplify pass

Goal: less code and fewer moving parts, no change in behaviour. Route shapes, WS messages, config values, user-facing copy and visuals are unchanged.

## Numbers

The base is commit `2a9442b`. The "after" column is `2a9442b` plus only this pass's changes, measured in an isolated worktree. Other agents were committing features at the same time, so the live tree has also grown from their work. The live-tree column shows where it stands now.

Lines come from `git ls-files <dir> | xargs cat | wc -l`, including untracked files. Deps are counted as runtime/dev.

| Package | Files before | Files after | Lines before | Lines after | Change | Deps before | Deps after | Live tree now |
|---|---:|---:|---:|---:|---:|---|---|---|
| packages/shared | 31 | 31 | 2412 | 2396 | -16 | 1/3 | 1/3 | 31 files, 2396 lines |
| packages/faceit | 13 | 13 | 749 | 749 | 0 | 0/3 | 0/3 | 13 files, 749 lines |
| packages/dathost | 13 | 13 | 1099 | 1094 | -5 | 1/3 | 1/3 | 13 files, 1094 lines |
| apps/api | 123 | 124 | 44677 | 44607 | -70 | 15/8 | 13/9 | 124 files, 44655 lines |
| apps/web | 231 | 227 | 19676 | 19505 | -171 | 4/4 | 4/4 | 228 files, 19796 lines |
| agent | 30 | 30 | 4308 | 4228 | -80 | stdlib only | stdlib only | 30 files, 4228 lines |
| plugin | 33 | 33 | 3396 | 3390 | -6 | 3 packages | 3 packages | 33 files, 3390 lines |
| **Total** | **474** | **471** | **76317** | **75969** | **-348** | | | |

- About 28k of the api lines are drizzle migration snapshots. Excluding `drizzle/`, api source goes from 16084 to 16014 lines.
- Web build output, measured as a production `next build` of `.next/static` in isolated worktrees:
  - total: 1,903,233 B before, 1,897,024 B after (-6,209 B)
  - JS: 1,488,459 B before, 1,483,558 B after (-4,901 B)
  - CSS: 115,953 B before, 114,645 B after (-1,308 B)
- Mock instance check: `NEXT_PUBLIC_MOCK=1 next build` was run before and after. After normalising the build id, all 93 prerendered artifacts (`.html`, `.rsc`, `.body`) are byte-identical.

## Checks

Every batch ran `pnpm -r typecheck`, `pnpm -r test`, `pnpm --filter @rushsite/web build`, `go vet ./... && go test ./...` in agent/ (Go 1.22 from the scratchpad) and `dotnet test` in plugin/. The plugin project was also built with `dotnet build`. All passed. The final live-tree run gave shared 46, faceit 20, dathost 17, api 230 (other agents added 2), plugin 81, and Go ok. No batch had to be reverted.

## Survey

Status is one of: **applied**, **proposal** (medium or high risk, not applied), or **skipped** (with the reason in the action).

| Item | Location | Proposed action | Risk | Status |
|---|---|---|---|---|
| Four mock modules for one data set, with circular imports | web `lib/mock.ts`, `lib/mock-match.ts`, `lib/mock-match-extras.ts`, `lib/mock-session.ts` | Merge into `lib/mock.ts` | low | applied |
| `rng` written 4 times, `hash` 3 times | `lib/mock*.ts`, `app/admin/_lib/mock.ts` | Export once from `lib/mock.ts` | low | applied |
| `delay` + `mocked` written 5 times | `lib/api.ts`, `components/{challenges,friends}/api.ts`, `components/stats/statsApi.ts`, `app/admin/_lib/client.ts` | `mockDelay` and `mockCall(fn, ms)` in `lib/mock.ts`. Each caller keeps its delay (250 or 200 ms) | low | applied |
| `rt()` MockRealtime lookup written 3 times | `components/{friends,challenges}/mock.ts`, `lib/api.ts` | `mockRealtime()` in `lib/ws.ts` | low | applied |
| Team size ternary `mode === "aim1v1" ? 1 : ...` | `lib/mock.ts` (2), `components/home/data.ts` | Use `teamSize()` from `lib/modes.ts` | low | applied |
| Dead component `FriendsChallenge` | `components/challenges/FriendsChallenge.tsx` | Delete | low | applied |
| Dead `isParticipant` | `components/challenges/useChallenges.ts` | Delete | low | applied |
| Dead `statsApi.liveMatches` and its mock | `components/stats/statsApi.ts`, `components/stats/mock.ts` | Delete. `WatchLive` uses `home/data.ts` | low | applied |
| Unused CSS rules | `challenges.module.css` (friends, friend, friendName, subtitle, friendActions), `SiteHeader.module.css` (mockBar), `BracketView.module.css` (liveTag, linked), `play.module.css` (actions), `PartyPanel.module.css` (friends) | Delete | low | applied |
| Local copy of bracket response type | web `lib/types.ts` `TournamentBracket` | Alias shared `TournamentBracketResponse` | low | applied |
| Local copies of `EntryPlayer`, `EntryView`, `TournamentDetail` | web `lib/types.ts` | Alias the shared types. `TeamCard` now treats `rating: null` or `tier: "unranked"` as unranked, which is the API's real shape. This was a bug fix, done at the coordinator's request | medium | applied |
| Dead `clientMessage()` | shared `ws.ts` | Delete | low | applied |
| Dead `UNKNOWN_GAME_ID` | shared `config/modes.ts` | Delete | low | applied |
| Player card schema written 4 times | shared `ws.ts` PartyMember, `schemas/friends.ts` FriendCard, `schemas/challenges.ts` ChallengePlayer, `schemas/stats.ts` LiveMatchPlayer | One `PlayerCardSchema` in `common.ts`. Old names are kept as aliases | low | applied |
| Active match status list written 3 times | api `queue/service.ts`, `parties/service.ts` (LOCKED_MATCH_STATUSES) | `ACTIVE_MATCH_STATUSES` in shared `schemas/match.ts` | low | applied |
| Many shared `z.infer` type aliases with no consumer (`PartyMember`, `MatchWebhookBody`, payload types, ...) | shared | Keep. They are the documented contract surface | low | skipped |
| Dead `mapLoadName` | dathost `cfg.ts` | Delete | low | applied |
| Dead `systemClock`/`Clock`, `RedisClient` | api `lib/clock.ts`, `lib/redis.ts` | Delete | low | applied |
| Dead `AdminEventMessage`, `ADMIN_EVENT_KINDS`, namespace re-exports `adminSchema` and `tournamentsSchema` | api `admin/types.ts`, `admin/index.ts`, `tournaments/index.ts` | Delete | low | applied |
| `AdminEventKind` defined 3 times | api `lib/event-log.ts`, `admin/types.ts`, shared `ws.ts` | Import from shared | low | applied |
| Admin active-match hook fields nobody reads, plus an N+1 `playersOf` query per active match | api `app.ts` `adminOptions`, `admin/types.ts` | Drop `players`, `acceptDeadline`, `agentUrl` and the per-match query | low | applied |
| `eachLimit` and `runLimited` are the same function | api `match/flow.ts`, `tournaments/service.ts` | `lib/async.ts` `eachLimit` | low | applied |
| Tournament copies of `MODES`, `TournamentStatus` list and `TEAM_SIZE` | api `tournaments/routes.ts`, `tournaments/config.ts` | Use shared `MODES`, `TournamentStatusSchema.options`, `getModeConfig().teamSize` | low | applied |
| Match and tournament subscribe/unsubscribe written twice | api `ws/hub.ts` | Shared `follow` and `unfollow` helpers | low | applied |
| `hasActiveBan` repeats the `activeBans` query | api `trust/service.ts` | Call `activeBans([id])` | low | applied |
| Party target SteamID regex | api `parties/routes.ts` | Use shared `SteamId64Schema`. The route discards the zod message, so replies are unchanged | low | applied |
| Unused dependency `fastify-plugin` | api `package.json` | Remove | low | applied |
| `pino` is only imported by tests | api `package.json` | Move to devDependencies. The built `dist` never references it | low | applied |
| Dead `Manager.StopAll`, `Manager.Accepting`, test helper `waitFor` | agent `internal/manager` | Delete | low | applied |
| `Sender.Client`, `SteamAPIChecker.Client`, `Manager.now`, `Updater.now` fields never set | agent `webhook`, `update`, `manager` | Use a fixed client and `time.Now` | low | applied |
| `api.Servers` and `api.Updates` interfaces with one implementation, not used as test seams | agent `internal/api/api.go` | Use `*manager.Manager` and `*update.Updater` | low | applied |
| `intVar`, `durVar`, `boolVar` share one shape | agent `internal/config/config.go` | One generic `envVar`. Error text is unchanged | low | applied |
| Dead `PresenceTracker.IsConnected`/`EverConnected`, `MatchController.Config`, unneeded `InternalsVisibleTo` | plugin Core | Delete | low | applied |
| `"rushsite_match_config"` literal repeats `MatchConfigLoader.ConVarName` | plugin `RushsiteMatchPlugin.cs` | Use the constant | low | applied |
| Duplicate aim cfg files | agent `internal/match/cfgs/rushsite_aim{1v1,2v2}.cfg` | Keep. `execCfg` names are in the agent contract | high | skipped |
| Local exports only used in their own file (about 140) | all TS packages | Could drop `export`. No line saving | low | skipped |

## Proposals, not applied

Each has a one-line rationale. They are ordered roughly by value.

1. **Admin and tournaments error classes.** `AdminError`, `TournamentError`, their two `setErrorHandler`s, the admin `parse()` and the tournaments `requireUser` duplicate `lib/errors.ts` and `auth/session.ts` (about 45 lines). Medium risk: 4xx bodies change, for example the tournaments 401 message and the admin `invalid_request` code.
2. **Validation helpers.** A `lib/validate.ts` with `parseOr400`, `uuidParam`, `steamIdParam` and `modeParam` would replace about 15 hand-rolled checks across match, friends, admin, tournaments, stats, queue and parties. Medium risk: 400 message texts are inconsistent today and would converge, and zod's `z.uuid()` is stricter than the tournaments `UUID_RE`.
3. **MatchFlow internals** (`match/flow.ts`). `resendState` could reuse `sendServerReady` and `sendVeto`, a `modeBlocked()` would replace 3 repeats, and an `insertMatch` would serve the three create paths (about 30 lines). Medium risk: `sendVeto` and `resendState` differ on showing votes when `acting` is null, so someone must decide which is right first.
4. **Admin active matches. Applied.** The `getActiveMatches` hook, `ActiveMatchSnapshot`, `activeView`, the no-op live merge in match detail and `MatchFlow.activeMatches` are gone. Admin reads `store.listMatches(ACTIVE_STATUSES, 1000)`, and the admin tests seed the store instead.
5. **User card fallback.** The `cards.get(id) ?? { steamId, displayName: id, avatarUrl: null }` pattern appears 7 times (challenges, friends, app, match-page, tournaments, admin, parties). Add `UsersService.cardOf`. Low to medium risk: it touches several owners' modules.
6. **Web admin types.** Move the view types into shared. `app/admin/_lib/types.ts` (163 lines) hand-mirrors `apps/api/src/modules/admin/types.ts`. Medium risk: it touches the admin owner's API and web code together.
7. **Web entry types. Applied.** The web uses the shared `TournamentEntry`, `EntryPlayer` and `TournamentDetail`. `TeamCard` treats `rating: null` or `tier: "unranked"` as unranked and leaves those players out of the mean.
8. **Home live list.** `components/home/data.ts` keeps a defensive `toLiveMatch` parser and its own mock "until the live row is pinned down". `GET /matches/live` is now in shared (`LiveMatchSchema`), so use `LiveMatch` directly. Medium risk: the mock "Watch live" rows would change.
9. **Clipboard.** Four direct `navigator.clipboard.writeText` calls (PartyPanel, useFriendInvite, ChallengeView, PlayView) could use `components/match/copy.ts copyText` (move it to `lib/`). Medium risk: it adds the insecure-origin fallback, which is a behaviour change.
10. **Remaining status lists.** `IN_PROGRESS_STATUSES` (queue, stats), `SERVER_STATUSES` (match-page), `TERMINAL` (flow) and the admin lists could also live in shared next to `ACTIVE_MATCH_STATUSES`. Low to medium risk: the admin code uses `string[]` includes and would need type changes.
11. **pgEnums from shared lists.** `db/schema.ts` pgEnums could build from `MODES`, `TRUST_LEVELS` and `MatchStatusSchema.options`. Medium risk: `drizzle-kit generate` must show no migration diff.
12. **Background loops.** `friends/index.ts`, `challenges/index.ts` and `tournaments/index.ts` hand-roll interval loops. `app.ts startLoops` has a generic `loop()` with locks. Medium risk: backoff and locking differ per loop.
13. **Optional plugins.** `optionalPlugin()` dynamically imports modules that always exist (`app.ts`). Use static imports and keep the boolean flags for tests. Medium risk: it touches how the app boots.
14. **Flow and tournament type copies.** `MatchResultEvent`/`TournamentMatchParams` (flow) duplicate `MatchResult`/`StartMatchParams` (tournaments types), and tournaments `WsMessage` duplicates shared `WsEnvelope`. Low to medium risk: they exist only for the optional-plugin decoupling.
15. **Friends queries.** `friends/presence.ts friendIdsOf` and `friends/service.ts friendIds` run the same query. Make it a free function. Low risk, but the friends owner was active during this pass.
16. **Ban logout. Applied.** `BanService.ban()` now drops every session of the banned user, with a test in `rating/rating.test.ts`. `PresenceService.markOffline` still has no callers.
17. **Go config structs.** `manager.Config` and `update.Config` copy fields from `config.Config` in main (about 15 to 20 lines). Medium risk: the tests build these small structs directly.
18. **bootstrap.sh.** `patch_gameinfo` repeats the agent's own `EnsureMetamod`, and the inline systemd unit repeats `infra/systemd/rushsite-agent.service`. Medium risk: ops scripts, not covered by tests.
19. **Go test-only accessors and small helpers.** `slots.Owner`, `Updater.Updating`, the log-file header helper, and the SIGTERM-then-SIGKILL stop shared by `execProc` and `adoptedProc`. Low value.
20. **C# test-only members.** `WebhookSigner.Verify`, tracker `Wins`/`RoundsPlayed`/`NextIsDecider`, `ReadyTracker.NotReady`, the two identical CSS event handlers, and `HttpDemoUploader` optional ctor parameters. Low value, and the tests need edits.
