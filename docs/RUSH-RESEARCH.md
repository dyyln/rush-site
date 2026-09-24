# Rush on a community dedicated server: research

Researched 23 September 2026, the day after the "Rush Hour" update (CS2 1.41.8.2, build 2000913, hotfix build 2000914 the same evening).

Each claim is tagged:

- **CONFIRMED**: read directly from Valve's shipped files or Valve's own text.
- **INFERRED**: follows from shipped code or config, but nobody has run it on a community server yet.
- **UNKNOWN**: no evidence either way.

## Sources

| Id | Source |
|---|---|
| S1 | Valve patch notes and blog post, fetched with the Steam news API: `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&count=5&maxlength=0`. Same text as https://steamcommunity.com/games/CSGO/announcements/detail/711161056325533827 and https://store.steampowered.com/news/app/730/view/711161056325533826 |
| S2 | Arena pool image in the blog post: https://clan.fastly.steamstatic.com/images/3381077/4ccfe4f44119ac6ddd5cd39d24c907dd11f4c70a.png |
| S3 | SteamDB GameTracking-CS2 commit for build 2000913: https://github.com/SteamDatabase/GameTracking-CS2/commit/10f3693c381475016b128c549928d14eb3adfcf2 |
| S3a | `game/csgo/cfg/gamemode_rush.cfg` and `gamemode_rush_offline.cfg` (new files) |
| S3b | `game/csgo/pak01_dir/gamemodes.txt` (diff) |
| S3c | `game/csgo/pak01_dir/maps/scripts/rush_001.js`: the map's point_script. **All Rush rules are in this file.** |
| S3d | `game/csgo/pak01_dir/resource/overviews/rush_001.txt` (radar volumes per room) |
| S3e | `DumpSource2/convars.txt` and `commands.txt` (diffs) |
| S3f | `game/csgo/pak01_dir/resource/csgo_english.txt` (diff) |
| S4 | CS2 depot manifests fetched anonymously with DepotDownloader 3.4.0 (`-app 730 -os linux -manifest-only`) on 23 Sep 2026. Depot 2347770 manifest 3469898947734168900, depot 2347773 manifest 2116299376055199661 |
| S5 | CounterStrikeSharp PR #1432, "update linux gamedata for 1.41.8.2": https://github.com/roflmuffin/CounterStrikeSharp/pull/1432, and PR #1433: https://github.com/roflmuffin/CounterStrikeSharp/pull/1433 |
| S6 | Skybox-Technologies CounterStrikeSharp fork PR #1: https://github.com/Skybox-Technologies/CounterStrikeSharp/pull/1 |
| S7 | clarity PR #354 (rush_001 demo desync): https://github.com/skadistats/clarity/pull/354 |
| S8 | cs2parser PR #67 (same bug): https://github.com/osztenkurden/cs2parser/pull/67 |
| S9 | Press articles: https://www.strafe.com/news/read/cs2-introduces-first-new-game-mode-in-3-years/ , https://www.hotspawn.com/counter-strike/news/new-cs2-update-rush-game-mode-clan-tags , https://www.dust2.us/news/78121/breaking-cs2-september-22nd-update-brings-silent-reloads-new-gamemode-changes-to-premier-in-rush-hour-patch |

Searched with no Rush-specific result:

- kus/cs2-modded-server issues. The newest item is PR #302, "UPDATED: 2 mods", 23 Sep, with nothing about Rush.
- GitHub issue search for "rush" in roflmuffin/CounterStrikeSharp and LaihoE/demoparser.
- Reddit r/GlobalOffensive and r/cs2. The JSON API was blocked, and web search surfaced no server threads.
- Hosting provider docs. nolimithost.cc has a post about the 23 Sep update, but it returned 403.

Pages that could not be fetched: steamdb.info (403), dotesports (403), blog.sih.app (DNS failure).

## 1. Rules

### What Valve says (CONFIRMED, S1)

- Rush is a queued 3v3 mode. Teams advance through a gauntlet of randomly selected battle arenas and win the match by capturing the enemy castle.
- "Make the most of your limited budget and precious time to clear the objective."
- "Control the tower when you eliminate the enemy team (or time expires) to win the round."
- There is a Rush friends leaderboard.

Valve's text does not give the arena count, round times or economy numbers. Those come from the shipped files below.

### How the shipped map script plays (CONFIRMED from S3c and S3a)

**One map holds every arena.** The whole mode runs on one map, `rush_001`, whose display name is "Complex". The script moves the spawn points, the tower (the "antenna") and the fog to a different room each round. There are no separate arena map files.

**Seven room slots per match.** The table below is `ROOM_IDS`. Slot 0 is the T castle, slot 6 the CT castle and slot 3 the starting room.

| Slot | Candidates |
|---|---|
| 0 (T castle) | 401 "T Castle" |
| 1, 2 | 201–212 |
| 3 (start) | 101–104: Spire, Wallbang, Big Box, Madhouse |
| 4, 5 | 201–212 |
| 6 (CT castle) | 301 "CT Castle" |

The 201–212 rooms are Sewer, Dogleg, Trainyard, Crane, Bloc, Hydro, Atomic, Medusa, Bear, Steel, Container and Drop.

There is also a decider room, `convoy` "Convoy", swapped in when the score is 7–7 (see below).

The draw is `RandomizeRooms()`, which uses `Math.random()` without repeats. It runs on `Instance.OnActivate` (map load) and again when the rounds-played count goes backwards, for example on a restart.

**Arena pool mismatch between Valve's image and the shipped script.** The blog image (S2) shows 15 tiles:

- 2 castles: T Assault and CT Assault.
- 13 arenas: Spire, Wallbang, Big Box, Sewer, Dogleg, Drop, Crane, Playhouse, Madhouse, Tunnel, King of the Hill, Marksman and Horseshoe.

The press numbers "15 arenas, 7 per match" (S9) count those tiles. The shipped script has 16 non-castle rooms plus Convoy, and some of its names differ: Trainyard, Bloc, Hydro, Atomic, Medusa, Bear, Steel and Container do not appear in the image. Playhouse, Tunnel, King of the Hill, Marksman and Horseshoe do not appear in the script.

For our config, **the script's numeric room ids are what the server uses.** The overview file (S3d) also has volumes for `roomparty` and `convoy`.

Nothing in the shipped files says the rooms are cut from Ancient, Cache, Mirage or Train. The brief's claim is **UNVERIFIED**. `gamemodes.txt` only borrows the `map-mirage-overall` image.

**Tower control.** The tower is a button ("Press [use] to activate the tower"). Pressing it gives your team control of that room. The script sets `mp_default_team_winner_no_objective` to the owning team, so the owner wins when time runs out.

At the start, slots 0–2 are owned by T and slots 3–6 by CT. So T attack first, in the starting room.

**Round end.** During live rounds the script sets `mp_ignore_round_win_conditions 1` and ends rounds itself by firing `FireWinCondition` on `map_params`. `END_ROUND_ON_TEAM_ELIMINATION = false`, so:

- If the non-owning team is wiped, the owner wins at once.
- If the owning team is wiped, the round timer is cut to at most 7 seconds. The survivors must press the tower in that time to win. If they don't, the dead owners win.
- If both teams are wiped, the owner wins.
- When time expires, the owner wins.

**Advancing.** A T round win moves the front line one slot toward the CT castle (+1). A CT round win moves it toward the T castle (−1).

**Match end.** A team wins the match in either of two ways:

- It wins a round in the enemy castle. The front line then moves off the end, and `EndMatch()` sets `mp_maxrounds` to the rounds played so far, which ends the game. That takes 4 net round wins.
- It reaches 8 round wins. `ROUNDS_TO_WIN = 8`, and the cfg sets `mp_maxrounds 15` and `mp_match_can_clinch 1`.

At 7–7 the next room becomes Convoy. So a match is at most 15 rounds. `WinnerOnRoundsExhausted()` exists in the script but nothing calls it.

**Round times.** Mid rooms last 40.5 s and castles and Convoy 60.5 s. The script sets these through `mp_roundtime` each round.

**Timers and economy** (from `gamemode_rush.cfg`):

| Setting | Value |
|---|---|
| `mp_freezetime` | 13 |
| `mp_buytime` | 15 |
| `mp_startmoney` | 800 |
| `mp_maxmoney` | 10000 |
| Round win money | 2500, via `AddTeamMoney` in the script |
| `cash_team_loser_bonus` | 2100 |
| `cash_team_loser_bonus_consecutive_rounds` | 750 |
| `cash_player_killed_enemy_default` | 300 |
| `cash_team_per_dead_enemy` | 50 |
| `ammo_grenade_limit_total` | 1 |
| `ammo_grenade_limit_flashbang` | 1 |
| `mp_friendlyfire` | 1 |
| `mp_halftime` | 0 (teams never swap sides) |
| `mp_warmuptime` | 120 |
| `mp_team_intro_type` | `rush` |
| `mp_team_intro_time` | 9 |
| `mp_match_end_restart` | 1 |
| `tv_delay` | 105 |
| `bot_quota` | 2 |
| `bot_quota_mode` | fill |

`mp_match_end_restart 1` means the game restarts after the match ends. `bot_quota 2` in fill mode means a dedicated server will add bots unless the plugin overrides it.

The Rush "ui" block in `gamemodes.txt` says "$800, 30 rounds, 2 minutes, 45 s buy". That text is stale copy and does not match the cfg.

## 2. Can community dedicated servers run Rush?

- **CONFIRMED: the files ship to dedicated servers (S4).** Depot 2347770 is the common content depot, which a Linux dedicated server downloads with anonymous SteamCMD. It contains:
  - `game/csgo/maps/rush_001.vpk` (569,296,051 bytes)
  - `game/csgo/cfg/gamemode_rush.cfg`
  - `gamemode_rush_offline.cfg`
  - the Rush intro prefabs

  The Linux server binary, `libserver.so`, is in depot 2347773.
- **CONFIRMED: Valve anticipated community play.** The new localisation string `SFUI_Lobby_StatusRichPresence_rush_community` reads "Community Rush" (S3f).
- **INFERRED: it should run.** The rules live entirely in the map's point_script, and point_script already runs on community servers. Starting with `+game_type 0 +game_mode 6 +map rush_001` should apply `gamemode_rush.cfg` and load the script.
- **UNKNOWN: whether anyone has run it yet.** No public report of a community server running it was found.
- **UNKNOWN: whether the queued-mode path needs anything from Valve's game coordinator.** Nothing in the files suggests it does.
- **CONFIRMED: CounterStrikeSharp is broken on this build (S5, S6).**
  - The last release, v1.0.374 from 7 Sep, predates the update.
  - On Linux, `Teleport` moved from vtable offset 162 to 164, `IsPlayerPawn` from 168 to 170, and `CCSPlayerController_ChangeTeam` from 102 to 104. Several signatures changed as well.
  - Unpatched, `ChangeTeam` silently does nothing and `Teleport` crashes the server.
  - PR #1432 is open. On #1433 the maintainer commented "Entity listeners still not working" (23 Sep 10:54 UTC). `CanUse` and `CheckTransmit` signatures are still unmatched.
  - The Skybox fork (S6) reports 36/36 of its integration tests passing with #1432 plus extra vtable offsets.
  - `libserver.so` is byte-identical between builds 2000913 and 2000914 (S5 comment).
  - **Our plugin cannot be tested until a fixed CSS release ships, or we build from the PR branch.**

## 3. Identifiers and convars

**CONFIRMED (S3b):**

- `game_type 0`
- `game_mode 6` (`"rush"`, `maxplayers 6`)
- map group `mg_rush_001`
- map `rush_001`, with `default_game_type 0` and `default_game_mode 6`
- exec files: `gamemode_rush.cfg` online, `gamemode_rush_offline.cfg` offline (sets `bot_quota 6`)

**No `rush_*` convars (CONFIRMED, S3e).** New or changed convars relevant to Rush:

- `mp_team_intro_type`: none, normal, wingman, rush or auto.
- `sv_spawn_random_nudge_offset`
- `sv_allow_approximate_spawns`
- `bot_path_require_reachable_goal`
- `mp_death_drop_gun`: max is now 3.
- `sv_mapvetopickvote_phase_duration`: Premier change. `sv_mapvetopickvote_rnd` was removed.
- `tv_playcast_slow_playback_fragment_count`
- `mp_bot_ai_bt` is used by the cfg (`scripts/ai/rush/bt_default.kv3`).

The script changes these at runtime, so our plugin must not fight them:

- `mp_roundtime`
- `mp_maxrounds`
- `mp_default_team_winner_no_objective`
- `mp_ignore_round_win_conditions`
- `sv_full_alltalk`

The script registers two cheat-only commands (need `sv_cheats`):

- `rush_force_decider`: forces Convoy next round.
- `move_antenna`

**Scripting API added (S1):** `CSRadarPoint`, `CSObservablePoint`, `AddTeamMoney`, `OnPlayerTeamChanged`.

## 4. Can the server control the arena draw?

**CONFIRMED: not through any supported setting.**

- `RandomizeRooms()` calls `Math.random()` inside the map script.
- The script reads no convar and no file.
- There is no input or command to set rooms apart from the cheat `rush_force_decider`.
- The draw is fixed at map load.

Options, all **UNKNOWN / unproven**:

1. **Override the compiled script.** Ship a modified `maps/scripts/rush_001.vjs_c` earlier in the search path (for example a custom addon dir or VPK mounted before `csgo`), with `ROOM_IDS` narrowed to the vetoed rooms or read from a convar. Compiling it needs CS2 Workshop Tools.
   - Unknown whether a loose or override script is picked up for a map whose script sits inside the map VPK or pak01.
   - Unknown how `sv_pure` and file consistency checks treat it.
   - Valve's "Valve's Rush rules, no tweaks" requirement would still hold if only the pool changes.
2. **Plugin re-teleport.** A CounterStrikeSharp plugin re-teleports `tspawn*`, `ctspawn*` and `ant.*` to the vetoed room's `t1room.<id>` and `ant.base.<id>` targets each round. This is fragile: the script's internal `_roomIds` still drives the UI names, fog and lights, so the HUD would show the wrong arena.
3. **Reroll by reloading the map.** Reload `rush_001` until the random draw matches the veto. This is impractical: 4 draws from 12 plus 1 from 4.
4. **Veto something else.** Keep Valve's random draw and veto only what the server can actually set. With `rush_001` as the only map, there is nothing to veto today.

**Recommendation.** Treat the arena pick-ban as blocked until option 1 is proven on a test box. The plugin can still **detect** each round's arena. After round start, compare the `tspawn1` origin with each `t1room.<id>` target, or read the dialog variables on `rush_ui`. That lets us store `arena_id` per round for stats.

## 5. Game events

- **CONFIRMED: no new game events.** `game.gameevents`, `core.gameevents`, `mod.gameevents` and `cs_gameevents.proto` are all unchanged in build 2000913 (S3).
- **INFERRED from S3c:**
  - `round_start`, `round_freeze_end`, `round_end` and `player_death` fire as normal. Round ends are raised through `map_params` `FireWinCondition` with standard reasons: `TERRORISTS_WIN`, `CTS_WIN` or `DRAW`.
  - The match ends through `mp_maxrounds` or the clinch, so `cs_win_panel_match` should fire as in any `mp_maxrounds` game.
  - Tower captures are a button `OnPressed` output handled inside the script. **No game event is fired for a capture.** A plugin would need to hook the `ant.button` entity output, or infer captures from `mp_default_team_winner_no_objective` changing.
- **UNKNOWN:**
  - whether `cs_win_panel_match` fires before `mp_match_end_restart` restarts the game
  - what `round_end` `reason` values look like in practice

## 6. tv_record and demos

- **CONFIRMED:**
  - `gamemode_rush.cfg` sets `tv_delay 105` and does not disable GOTV.
  - `spec_replay_enable 0` turns off only the killcam replay.
  - rush_001 demos from build 2000913 exist in the wild and parse once a decoder fix is applied (S7, S8). Their origin, matchmaking or community server, is not stated.
- **CONFIRMED demo parser risk.** rush_001 spawns `CFuncConveyor` entities whose `m_angRotation` is a 32-bit `qangle_precise`.
  - clarity and cs2parser both desynced on it and needed fixes (S7, S8).
  - demoparser2, which our worker plans to use, has no matching issue or fix yet.
  - **UNKNOWN** whether demoparser2 handles it.
- **UNKNOWN:** whether `tv_enable 1` plus `tv_record` on a community Rush server writes a complete demo.

## Recommended experiment (fresh Hetzner box, about 2 hours including download)

1. Install with `steamcmd +login anonymous +app_update 730 validate` and check `game/csgo/maps/rush_001.vpk` exists (about 569 MB).
2. Start vanilla, with no Metamod:
   `cs2 -dedicated +game_type 0 +game_mode 6 +map rush_001 +sv_setsteamaccount <GSLT> +tv_enable 1 +bot_quota 0`.
   In the console, confirm:
   - `gamemode_rush.cfg` executed (`mp_team_intro_type` reads `rush`, `mp_maxrounds` reads 15)
   - no script errors mention `rush_001`
3. Connect 2 clients, or 1 client plus `bot_quota 1` with `bot_quota_mode normal`. Run `mp_warmup_end`. Check that:
   - the team intro plays
   - the room progression UI appears
   - the tower button captures
   - rounds end at about 40 s, won by the tower owner
4. Log events with `logaddress_add_http`, or with `log on` plus `mp_logdetail 3`. Play to match end: use `sv_cheats 1` and `rush_force_decider`, or just win 4 in a row. Record:
   - every `round_end` winner and reason
   - whether `cs_win_panel_match` fires
   - the final score
   - what `mp_match_end_restart` does afterwards
5. Before warmup ends, run `tv_record rush_test`, and `tv_stoprecord` after the match. Parse the `.dem` with demoparser2 (`parse_event("round_end")`, `parse_ticks(["X","Y"])`) to check for the conveyor desync.
6. Draw control, arena detection:
   - Change the map 5 times and note the arena names from the HUD, to confirm the draw re-rolls on every map load.
   - Run `ent_find t1room` and `ent_find ant.base` to list the room target names.
7. Draw control, override test:
   - Copy `rush_001.js` from pak01 with Source 2 Viewer (VRF).
   - Change `ROOM_IDS` so that slot 3 is `[101]` only.
   - Compile it with the CS2 Workshop Tools resourcecompiler to `rush_001.vjs_c`.
   - Place it at `game/csgo/maps/scripts/rush_001.vjs_c`, or in a custom search path added before `csgo` in `gameinfo.gi`, and reload the map.
   - Pass: the start room is Spire every time. Also check that clients still connect with `sv_pure` at its default.
8. Repeat steps 2–4 with Metamod plus CounterStrikeSharp built from PR #1432 or #1433. Confirm:
   - the plugin loads
   - `EventRoundEnd` and `EventCsWinPanelMatch` callbacks fire
   - `ChangeTeam` and `Teleport` work
   - entity listeners still fail, per the maintainer's note

## Result: Rush on a DatHost community server (23 Sep 2026)

First confirmation that Valve's Rush runs on a community server. On the DatHost template (CS2 1.41.8.2, Metamod plus
CounterStrikeSharp 1.0.374), `game_type 0`, `game_mode 6`, `changelevel rush_001` loaded the map, the game execd
`gamemode_rush.cfg` by itself (`gamemode_rush_server.cfg` is missing and harmless), and the server reported
`mp_team_intro_type = rush`, `mp_maxrounds = 15`, `mp_halftime = false`. A player joined, was put on T and spawned,
and `Match_Start` fired. The map ships in the dedicated server depot. Not yet checked: round flow, tower capture,
`round_end` reasons, the win panel, GOTV demo completeness, and the room names (`ent_find` needs `sv_cheats 1`).

## Result: room draw control (24 Sep 2026)

The room draw can be controlled. A modified `rush_001.js`, packed as a single-file VPK and named in gameinfo.gi above `Game csgo`, replaces Valve's script on a dedicated server. Rooms are sent by console chat, because `ent_fire` does nothing from a dedicated server console. Details, and what is still untested, are in docs/RUSH-ROOM-VETO.md under "Results".
