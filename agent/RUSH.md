# Running Valve's Rush on a rushsite dedicated server

Rush shipped in the "Rush Hour" update on 22 September 2026 (CS2 1.41.8.2, build 2000913, hotfix 2000914). The evidence behind each value here is in `docs/RUSH-RESEARCH.md`. Tags follow that doc: **CONFIRMED** means read from Valve's shipped files, **INFERRED** means it follows from them but nobody has run it on a community server yet.

## Launch values

| Setting | Value | Status |
|---|---|---|
| `game_type` | `0` | CONFIRMED, `gamemodes.txt` |
| `game_mode` | `6` (`"rush"`, maxplayers 6) | CONFIRMED |
| Map | `rush_001` ("Complex"). One map holds every arena | CONFIRMED |
| Map group | `mg_rush_001` | CONFIRMED |
| Mode cfg | `gamemode_rush.cfg`. The game execs it on map load | CONFIRMED |
| Map file | `game/csgo/maps/rush_001.vpk`, 569 MB, in depot 2347770, which anonymous SteamCMD installs on Linux | CONFIRMED |
| Runs on a community server | Should. The rules live in the map's point_script, and point_script runs on community servers | INFERRED |

These are the agent defaults for `rush3v3` in `internal/match/modes.go`. The API sends the map as `{ "id": "rush_001", "mapName": "rush_001" }`.

## What the agent launches

```
game/bin/linuxsteamrt64/cs2 -dedicated -console -port <slot> -maxplayers 7 \
  +tv_port <slot+100> +tv_enable 1 +bot_quota 0 \
  +game_type 0 +game_mode 6 \
  +map rush_001 \
  +sv_setsteamaccount <GSLT> +sv_password <password> \
  +exec rushsite/matches/<matchId>/server.cfg
```

- `+bot_quota 0` is needed because `gamemode_rush.cfg` sets `bot_quota 2` with `bot_quota_mode fill`. `server.cfg` and `rushsite_rush3v3.cfg` also set it and run `bot_kick`.
- `+tv_enable 1` is needed so the plugin can `tv_record`. `gamemode_rush.cfg` leaves GOTV on and sets `tv_delay 105`. The agent sets a random `tv_password`, and the GOTV port is outside the firewall range, so nobody can ghost.
- `-maxplayers 7` is 3v3 plus one spare slot. Valve's mode entry says 6.
- `server.cfg` runs `exec rushsite/matches/<matchId>/rushsite_rush3v3.cfg`. That file only sets `bot_quota`, `bot_kick` and team balance. It must not touch the rules or Valve's warmup.

If a value turns out wrong on a real box, override it without a rebuild by setting `RUSHSITE_MODES_FILE`:

```json
{
  "rush3v3": {
    "gameType": 0,
    "gameMode": 6,
    "extraArgs": ["+mapgroup", "mg_rush_001"]
  }
}
```

`extraArgs` go after `+game_mode` and before `+map`. Only use it if `+map rush_001` on its own does not pick up the mode.

## Rules the server must leave alone

Valve's Rush rules, no tweaks. The map script changes these every round, so neither our cfg nor the plugin may set them:

- `mp_roundtime`
- `mp_maxrounds`
- `mp_default_team_winner_no_objective`
- `mp_ignore_round_win_conditions`
- `sv_full_alltalk`

`gamemode_rush.cfg` also sets the economy, freeze time, `mp_halftime 0`, `mp_friendlyfire 1`, `mp_team_intro_type rush` and `mp_match_end_restart 1`. We leave all of them alone.

## Match end: trust the plugin, not the process

`mp_match_end_restart 1` makes the game restart after a Rush match ends. The CS2 process keeps running, so the process exiting is **not** a match end signal.

- A match is over when the plugin posts `match_end` to the API.
- The API then calls `DELETE /servers/:matchId`, which stops the process and frees the slot.
- A process exit without `match_end` is a crash. `GET /servers?include=exited` shows it as `crashed` with the exit code.
- Unknown: whether `cs_win_panel_match` fires before the restart. The plugin should also watch `round_end` and the score (8 round wins, or a round won in the enemy castle) as a fallback.

## Arena veto: blocked for now

The arena draw is `Math.random()` inside the map script, run on map load. No convar, file or command controls it (CONFIRMED). The only map is `rush_001`, so there is nothing to veto today.

- Launch Rush with no veto, and store which arena each round used. The plugin can find it by comparing the `tspawn1` origin with the `t1room.<id>` targets.
- An overridden `maps/scripts/rush_001.vjs_c` might narrow the pool. That is unproven. See section 4 of the research doc.
- The API should skip the pick-ban step for `rush3v3` until then.

## Blockers and risks

- **CounterStrikeSharp is broken on this build.** v1.0.374 predates the update. On Linux `ChangeTeam` does nothing and `Teleport` crashes. Fixes are in PR #1432 and #1433. `scripts/bootstrap.sh` installs CS# from a pinned zip in `CSS_ZIP`, never the latest release.
- **Demo parsing.** rush_001 demos desync some parsers on `CFuncConveyor` angles. It is unknown whether demoparser2 handles them.
- **Cfg order.** The command line `+exec` may run before the map loads and `gamemode_rush.cfg` runs. If `bot_quota` comes back as 2, the plugin should apply `bot_quota 0` again on map start.

## First test on a real box

1. Run `scripts/bootstrap.sh`, then check that `game/csgo/maps/rush_001.vpk` exists.
2. Vanilla, as the `cs2` user, with no Metamod:
   `cs2 -dedicated -port 27015 +tv_enable 1 +bot_quota 0 +game_type 0 +game_mode 6 +map rush_001 +sv_setsteamaccount <GSLT>`
   Check that `mp_team_intro_type` reads `rush`, `mp_maxrounds` reads 15, and the console shows no script errors.
3. Through the agent: `POST /servers` with `mode: "rush3v3"` and map `rush_001`. Join with the connect string and check the room UI, tower capture and round ends.
4. Play to the end and confirm the restart. Then `DELETE /servers/:matchId` and confirm the slot is free in `/health`.
5. Repeat with Metamod and the pinned CS# plus the rushsite plugin.
