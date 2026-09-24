# Rush room veto: game server work

This is the handoff for the game side of the Rush room veto. The website side is being built separately: a team-vote veto in the match room behind a config flag. This doc covers what has to change on the server so the rooms picked on the site are the rooms played, and how to prove it on a Windows machine with CS2 Workshop Tools.

Nothing here has been tested yet. The plan comes from reading Valve's shipped script. See "Verified" and "Unverified" at the end.

## How the draw works today

The rules live in `rush_001.js`, a CS2 point_script (cs_script) compiled to `maps/scripts/rush_001.vjs_c`. It ships in `game/csgo/pak01_dir.vpk`, not inside the map VPK. A decompiled copy is tracked by SteamDB GameTracking-CS2 at `game/csgo/pak01_dir/maps/scripts/rush_001.js`.

The key parts:

```js
const START_ROOM = 3;
const T_FINAL_ROOM = 0;
const CT_FINAL_ROOM = 6;

const ROOM_IDS = [
  [401],                                                         // 0 T castle
  [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212], // 1 mid
  [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212], // 2 mid
  [101, 102, 103, 104],                                          // 3 start
  [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212], // 4 mid
  [201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212], // 5 mid
  [301],                                                         // 6 CT castle
];

function RandomizeRooms() {
  _roomIds = [];
  ROOM_IDS.forEach((possibilities) => {
    const remaining = possibilities.filter((item) => !_roomIds.includes(item));
    if (remaining.length == 0) { _roomIds.push(possibilities[0]); return; }
    _roomIds.push(remaining[Math.floor(Math.random() * remaining.length)]);
  });
}
```

- **When it runs:** `RandomizeRooms()` is called from `ResetGameState()`. That runs on `Instance.OnActivate`, and again in `OnRoundStart` when `GetRoundsPlayed()` drops, which is a game restart after at least one round.
- **Where the result lives:** only in the script variable `_roomIds`. Everything else reads from it: spawn teleports (`tspawn1-3` go to `t{n}room.<id>`, and the CT spawns likewise), round time, fog, lights, antenna position and the HUD room names on `rush_ui`.
- **The decider:** at 7-7, `MaybeSwapInDeciderRoom` replaces the room in play with `convoy`. This stays as Valve made it.
- **No outside control:** there is no convar, file read or random seed. The only commands are the cheat-only `rush_force_decider` and `move_antenna`.

Room ids and names:

| Id | Name | Pool |
|---|---|---|
| 101 | Spire | start |
| 102 | Wallbang | start |
| 103 | Big Box | start |
| 104 | Madhouse | start |
| 201 | Sewer | mid |
| 202 | Dogleg | mid |
| 203 | Trainyard | mid |
| 204 | Crane | mid |
| 205 | Bloc | mid |
| 206 | Hydro | mid |
| 207 | Atomic | mid |
| 208 | Medusa | mid |
| 209 | Bear | mid |
| 210 | Steel | mid |
| 211 | Container | mid |
| 212 | Drop | mid |
| 301 | CT Castle | fixed, slot 6 |
| 401 | T Castle | fixed, slot 0 |
| convoy | Convoy | decider only |

That is 16 rooms outside the castles: 4 start and 12 mid.

### Open question on the veto format

The proposed veto fills 5 rooms (slots 1 to 5) with ban, ban, pick, pick, ban, ban, pick, pick, ban, ban, then the last room left over. There are two open questions:

- **Pool size.** The script has 16 rooms outside the castles, not 13, and they split into two pools. Slot 3 only takes the 4 start rooms and the mid slots only take the 12 mid rooms. So either the veto runs on the 12 mid rooms and the start room is handled separately (banned down to one, or left random), or the script lets any room go in any slot. The second option needs a test, because start rooms may be built for the opening round.
- **Leftover count.** 13 rooms minus 6 bans and 4 picks leaves 3, not 1. With the 12 mid rooms and 4 picks, 7 bans leave exactly 1. The website agent currently adds 2 bans at the end. This is in config and still needs a decision.

## Changes needed

### 1. A modified rush_001 script

Change only how `_roomIds` gets its values. Everything else stays Valve's code.

**Recommended channel: named script inputs fired by the plugin.**

`point_script.d.ts` has `Instance.OnScriptInput(name, callback)`. Inputs carry no value, so encode the value in the input name. The script registers one input per slot and room. That's 5 slots times 16 rooms, which is 80 small handlers created in a loop. It also registers one input to apply them.

Sketch:

```js
var _forcedRooms = null;   // slot index -> room id, set by the plugin
var _pendingRooms = {};

const PICKABLE = [101, 102, 103, 104, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212];
for (const slot of [1, 2, 3, 4, 5]) {
  for (const id of PICKABLE) {
    Instance.OnScriptInput(`rushsite_room_${slot}_${id}`, () => { _pendingRooms[slot] = id; });
  }
}
Instance.OnScriptInput("rushsite_rooms_apply", () => {
  const slots = [1, 2, 3, 4, 5];
  const ids = slots.map((s) => _pendingRooms[s]);
  const valid = ids.every((id) => id !== undefined) && new Set(ids).size === ids.length;
  if (!valid) { Instance.Msg("rushsite: bad room set, keeping random draw"); return; }
  _forcedRooms = { 0: 401, 1: ids[0], 2: ids[1], 3: ids[2], 4: ids[3], 5: ids[4], 6: 301 };
  ResetGameState();
  Instance.Msg(`rushsite: rooms ${JSON.stringify(_forcedRooms)}`);
});

function RandomizeRooms() {
  if (_forcedRooms) {
    _roomIds = [0, 1, 2, 3, 4, 5, 6].map((i) => _forcedRooms[i]);
    return;
  }
  // Valve's original body follows, unchanged
}
```

Notes:

- **Keep the forced set across restarts.** `ResetGameState()` calls `RandomizeRooms()` again after a restart, so the forced set must persist. The sketch keeps `_forcedRooms` for the life of the map, which handles this.
- **Hot reload.** Also save `_forcedRooms` through `Instance.OnReload(memory)` so a script hot reload keeps it.
- **Slot placement.** Where each pick goes (slot 1 vs 2, T side vs CT side) is decided on the website. The script just takes an ordered list of 5.
- **Fallback: marker entities.** If script inputs can't be fired from the server console, the plugin creates `info_target` entities named `rushsite.room.<slot>.<id>` before the script activates. The script reads them with `Instance.FindEntitiesByName` or `FindEntityByName` inside `OnActivate` and on apply.
- **Fallback: chat.** `Instance.OnPlayerChat` exists and is a last resort if a server `say` reaches it.

**Diff discipline:** keep the file as Valve's `rush_001.js` plus a clearly marked block. Every Valve update means re-diffing and recompiling. Keep our copy in the repo, for example `plugin/rush-script/rush_001.js`, along with the Valve revision it came from.

### 2. Loading the modified script on the server

The compiled `rush_001.vjs_c` has to win over the copy in `pak01`.

- **Dedicated servers (Hetzner and DatHost):** add a search path above `Game csgo` in `game/csgo/gameinfo.gi`, for example `Game csgo/rushsite`, the same way Metamod adds `csgo/addons/metamod`. Put the file at `game/csgo/rushsite/maps/scripts/rush_001.vjs_c`. A loose file directly in `csgo/` is not expected to beat `pak01`.
- **Host agent:** the Go agent's CS2 install and update step has to re-apply the `gameinfo.gi` line after every SteamCMD update. Valve overwrites that file.
- **DatHost:** add the file and the `gameinfo.gi` line to the template server. It already allows editing `gameinfo.gi` for Metamod. Then stop or `sync-files` so clones pick it up.
- **Clients:** point_script is expected to run only on the server, and clients get room names through the networked `rush_ui` entity. If that holds, players need nothing extra and `sv_pure` doesn't matter. This must be tested with a vanilla client.

### 3. Plugin changes (CounterStrikeSharp, `plugin/`)

- **Config:** read `rushRooms` from match.json. It is an ordered array of 5 room ids for slots 1 to 5, written by the API after the veto. It is optional: when it's absent or invalid, do nothing and keep the random draw. Validate against the id table above and reject duplicates.
- **Firing the rooms:** on map load in Rush mode, once the point_script entity exists and before the match goes live, fire the inputs. Use `ent_fire <point_script targetname> RunScriptInput rushsite_room_<slot>_<id>` for each slot, then `rushsite_rooms_apply`. Find the point_script entity's targetname in the map with the plugin or `ent_find point_script`. Check that `RunScriptInput` is the right input name.
- **Checking the result:** after apply, compare the start room with the existing detector (`plugin/src/RushsiteMatch.Core/Match/RushArena.cs` detects the room from T spawn positions against `t1room.<id>` targets). Also check the script's `rushsite: rooms` line in the console if the plugin can capture it. If the start room doesn't match slot 3, report it. Options are a new webhook event such as `rush_rooms_mismatch`, or a flag on `match_started`, so the API can warn or cancel.
- **Webhooks:** extend `round_end` with the room played (it's already detected) so the match room can show the room path. Optionally send the full forced list on `match_started`.
- **Scope:** in a Bo3 each map is its own Rush match, so re-fire the rooms after each changelevel. The API contract has one `rushRooms` per match today. A per-map list would go in `series.maps[n]`.
- **Tests:** in `RushsiteMatch.Core`, add tests for parsing and validation and for building the command list.

### 4. API and contract (after the game side is proven)

- Add `rushRooms` to `StartServerRequest` and match.json in `docs/CONTRACTS.md`. The website agent is already writing it.
- Turn the room veto flag on only once steps 1 to 3 pass on a real server.

## Test plan on the Windows machine

What you need: CS2 with the "Counter-Strike 2 Workshop Tools" DLC installed (Steam → CS2 → Properties → DLC). The tools include `resourcecompiler` and the addon system that compiles `.js` scripts to `.vjs_c`.

1. **Get Valve's script.** Take `rush_001.js` from GameTracking-CS2, matching the installed CS2 build, or the copy in this repo once it's saved there.
2. **Local test through an addon, with no gameinfo change.** Create a Workshop Tools addon, for example `rushsite_rooms`. Put the edited script at `content/csgo_addons/rushsite_rooms/maps/scripts/rush_001.js`. Launch the tools with that addon so it compiles to `game/csgo_addons/rushsite_rooms/maps/scripts/rush_001.vjs_c`. A mounted addon sits above `pak01`, so `map rush_001` in the tools session should load our script.
3. **Smallest possible proof.** Change only slot 3 to `[101]`. Load `rush_001` 5 times with `map rush_001`. Pass means the start room is Spire every time. Confirm with `rush_ui`, the room name shown in game, and a `Instance.Msg` print from the script.
4. **Input channel.** Restore slot 3 and add the `OnScriptInput` block. In the console run `ent_find point_script` to get the targetname, then `ent_fire <name> RunScriptInput rushsite_room_1_203` and so on, then `ent_fire <name> RunScriptInput rushsite_rooms_apply`. The console should print `rushsite: rooms ...`, and spawns, fog, antenna and the HUD should follow the forced rooms. Play several rounds, including a restart with `mp_restartgame 1` after round 1, and the decider at 7-7 (the cheat `rush_force_decider` speeds this up).
5. **Any room in any slot.** Only if the veto needs it: put a mid room in slot 3 and a start room in a mid slot. Check that spawns, towers and the round flow still work.
6. **Dedicated server path.** Run a local CS2 dedicated server on Windows, or use the Hetzner box once it's up. Add the `gameinfo.gi` search path and the compiled `.vjs_c`, then repeat step 3. Connect with a normal client that has no addon and default `sv_pure`. Pass means the client joins with no consistency kick and sees the forced rooms on the HUD.
7. **Plugin firing.** Only after step 6 passes: have the plugin send the `ent_fire` sequence from a test `match.json` with `rushRooms`, and check the detector agrees.

Record the results in `docs/RUSH-RESEARCH.md`: the CS2 build number, which steps passed, and the exact input name that works.

## Verified

- The draw code, the room tables, `_roomIds` as the single source, the spawn target names and the decider logic, all from Valve's `rush_001.js` (GameTracking-CS2).
- `Instance.OnScriptInput`, `FindEntitiesByName`, `GetEntityName`, `OnReload` and `OnPlayerChat` exist in `point_script.d.ts`.
- `gameinfo.gi` search paths are `csgo`, `csgo_imported`, `csgo_core` and `core`, with nothing above `csgo` by default.
- Our plugin already detects the current room from spawn positions (`RushArena.cs`).

## Unverified

- That a mounted addon or an extra search path overrides `pak01`'s `rush_001.vjs_c`.
- That `ent_fire ... RunScriptInput <name>` reaches `OnScriptInput` when sent from the server console, and what the input is actually called.
- That clients need no copy of the modified script and that `sv_pure` doesn't kick them.
- That any room works in any slot.
- That DatHost keeps a custom `gameinfo.gi` line through CS2 updates.

## Rules note

Controlling the draw doesn't change how rounds are won, the economy or the timers. But it does replace Valve's random draw, and the brief says "Valve's Rush rules, no tweaks". The brief also says "Rush has no veto until the room draw can be controlled", which suggests a room veto is wanted once this works. It should still be confirmed before the flag is turned on.
