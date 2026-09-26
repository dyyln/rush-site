# rush_001 room veto script

`rush_001.js` is Valve's Rush script from `pak01_dir.vpk` (`maps/scripts/rush_001.js`) plus one marked block, `rushsite: room veto`, and one line at the top of `RandomizeRooms`. Everything else is Valve's code, unchanged. `valve/rush_001.js` is the untouched copy. Diff the two to see our change.

- Source: SteamDB GameTracking-CS2, `game/csgo/pak01_dir/maps/scripts/rush_001.js`
- Valve revision: CS2 1.41.8.5, build 2000918 (GameTracking commit 3fc98e7, 25 Sep 2026)

On every CS2 update that touches `rush_001.js`, fetch the new file into `valve/`, carry the marked block across, rebuild and redeploy. A stale override would run an old copy of Valve's rules.

## What the block does

- Listens for server console chat `rushsite_rooms <5 ids>`, for slots 1 to 5, and applies them. The match plugin sends this line. Chat from a player is ignored.
- `rushsite_rooms print` logs the rooms in play.
- Slot 3 must be a start room (101 to 104) and the others mid rooms (201 to 212), with no repeats. Anything else is logged and ignored.
- Rooms can only be set before the first round. Applying calls Valve's `ResetGameState()`.
- The set is kept for the life of the map, so `mp_restartgame` and the warmup end keep it.
- The 7-7 Convoy decider is left as Valve made it.
- It also keeps the `RunScriptInput rushsite_room_<slot>_<id>` and `rushsite_rooms_apply` inputs. They work only if something can fire entity inputs, for example CounterStrikeSharp `AcceptInput`. `ent_fire` from the console cannot.
- It answers every set with a server command the match plugin registers: `rushsite_rooms_applied <7 ids in play>` or `rushsite_rooms_rejected <bad_set|too_late> <ids>`. Without the plugin the server just prints `Unknown command`.
- It logs `rushsite: room veto script loaded` when it loads.

## Build (any OS)

A compiled cs_script is Valve's Source 2 resource with the script text, CRLF line endings, as its DATA block. `build_vjs.py` takes Valve's `rush_001.vjs_c` out of `pak01`, keeps its header and RED2 block, and swaps in our script. Fed Valve's own script it reproduces Valve's file byte for byte. Run both steps against the same `pak01`, for example on the Hetzner box:

```
python3 build_vjs.py rush_001.js dist/rush_001.vjs_c --valve-pak /srv/cs2/game/csgo/pak01_dir.vpk
python3 pack_vpk.py dist/rushsite_rooms.vpk dist/rush_001.vjs_c --valve-pak /srv/cs2/game/csgo/pak01_dir.vpk
```

## Build (Windows, CS2 Workshop Tools)

1. Copy `rush_001.js` to `<CS2>/content/csgo_addons/rushsite_rooms/maps/scripts/rush_001.js`. Create `<CS2>/game/csgo_addons/rushsite_rooms/addoninfo.txt` if the addon does not exist yet.
2. Compile it:
   `<CS2>/game/bin/win64/resourcecompiler.exe -nop4 -f -i "<CS2>/content/csgo_addons/rushsite_rooms/maps/scripts/rush_001.js"`
   The output is `<CS2>/game/csgo_addons/rushsite_rooms/maps/scripts/rush_001.vjs_c`.
3. Pack it, recording Valve's script from the same install:
   `python pack_vpk.py dist/rushsite_rooms.vpk "<CS2>/game/csgo_addons/rushsite_rooms/maps/scripts/rush_001.vjs_c" --valve-pak "<CS2>/game/csgo/pak01_dir.vpk"`
   This writes `dist/rushsite_rooms.vpk` and `dist/rushsite_rooms.json` (`{ cs2Build, valveScriptCrc }`). `dist/` is git ignored.

To typecheck, run `tsc --noEmit --allowJs --checkJs --target es2022 --module es2022 --moduleResolution bundler rush_001.js <CS2>/content/csgo_addons/cs_script_demo/maps/scripts/point_script.d.ts`. Valve's own code gives 6 errors (Glow, Unglow and two overloads). The block adds none.

## Install on a server

- **Hetzner (agent):** put `rushsite_rooms.vpk` and `rushsite_rooms.json` in `game/csgo/` (bootstrap: `RUSH_ROOMS_VPK=dist/rushsite_rooms.vpk`). The agent checks the JSON against Valve's pak01 and keeps the `gameinfo.gi` line itself, dropping it when Valve changes `rush_001`. See the agent README.
- **DatHost and anything else without the agent:** put `rushsite_rooms.vpk` in `game/csgo/` and add `Game csgo/rushsite_rooms.vpk` to `game/csgo/gameinfo.gi`, directly above `Game csgo`. Nothing checks it against Valve's updates, so rebuild and re-upload whenever Valve changes `rush_001`.
- A loose `.vjs_c` in a directory search path does not work, and neither does a `pak01_dir.vpk` there. See docs/RUSH-ROOM-VETO.md.
- Valve overwrites gameinfo.gi on updates. The host agent must re-apply the line after every SteamCMD update, as it does for Metamod.
- Check: `say rushsite_rooms print` in the server console returns `rushsite: rooms in play ...`.
