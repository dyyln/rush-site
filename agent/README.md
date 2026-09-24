# rushsite-agent

Go host agent, one per machine. It starts and stops CS2 match servers on a port range, all sharing one CS2 install, and keeps that install updated. The API is in `docs/CONTRACTS.md`.

## Build and test

```bash
cd agent
go test ./...
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o rushsite-agent .
```

Install on a fresh box with `scripts/bootstrap.sh`. Paths:

| What | Where |
|---|---|
| Binary | `/opt/rushsite/bin/rushsite-agent` |
| Env | `/etc/rushsite/agent.env` |
| Unit | `/etc/systemd/system/rushsite-agent.service`, same as `infra/systemd/`, including `StateDirectory=rushsite-agent` |
| CS2 | `/srv/cs2`, owned by the `cs2` user |
| State and logs | `/var/lib/rushsite-agent` |

## Environment

| Var | Default | Notes |
|---|---|---|
| `RUSHSITE_AGENT_TOKEN` | required | Bearer token, 16 characters or more |
| `RUSHSITE_CS2_DIR` | required | Shared CS2 install |
| `RUSHSITE_PORT_RANGE` | required | Game ports, for example `27015-27030`. One slot per port |
| `RUSHSITE_PUBLIC_IP` | required | Goes into the connect string |
| `RUSHSITE_LISTEN` | `0.0.0.0:8080` | Keep it firewalled to the API |
| `RUSHSITE_DATA_DIR` | `/var/lib/rushsite-agent` | `servers.json` state file, `logs/<matchId>.log`, `logs/steamcmd.log` |
| `RUSHSITE_CS2_BIN` | `$CS2_DIR/game/bin/linuxsteamrt64/cs2` | |
| `RUSHSITE_TV_PORT_OFFSET` | `100` | GOTV port is the game port plus this |
| `RUSHSITE_STOP_GRACE` | `10s` | Time between SIGTERM and SIGKILL |
| `RUSHSITE_MODE_CFG_DIR` | none | Dir of mode cfgs that add to or replace the embedded ones |
| `RUSHSITE_STEAMCMD` | `/usr/games/steamcmd` | |
| `RUSHSITE_UPDATE_CHECK` | `steamapi` | `steamapi`, `steamcmd` or `off` |
| `RUSHSITE_UPDATE_INTERVAL` | `5m` | How often to check while idle |
| `RUSHSITE_DRAIN_POLL` | `10s` | How often to re-check while waiting for matches to end |
| `RUSHSITE_UPDATE_VALIDATE` | `false` | Add `validate` to `app_update` |
| `RUSHSITE_PATCH_GAMEINFO` | `true` | Keep the Metamod line, and the Rush room veto line, in `gameinfo.gi` on start and after updates |
| `RUSHSITE_STEAM_API_BASE` | `https://api.steampowered.com` | For tests |

## HTTP API

Every route needs `Authorization: Bearer <token>`. Errors look like `{ "error": "<code>", "message": "..." }`.

| Route | Result |
|---|---|
| `GET /health` | `{ ok, cs2Version, slots: { total, free }, updating, update: { state, lastCheck, lastUpdate, lastError, attempts, rushRooms, rushRoomsDetail } }` |
| `POST /servers` | 201 `{ matchId, ip, port, connect }`. 400 `bad_request`, 409 `exists`, 503 `updating` or `no_free_slots`, 500 `start_failed` |
| `DELETE /servers/:matchId` | 204 once the process is gone and the slot is free. Unknown ids also get 204 |
| `GET /servers` | Array of `{ matchId, mode, mapId, port, tvPort, pid, connect, status, startedAt, logPath }`. `?include=exited` adds the last 50 ended servers with `status` `exited`, `crashed` or `stopped`, plus `endedAt` and `exitCode` |
| `POST /update` | Operator hook. Drains and runs SteamCMD now. 202 with the update status |

`POST /servers` requires `cs2: { gameType, gameMode, execCfg, extraArgs?, workshopId | mapName }`, built by `resolveLaunch` in `packages/shared` from `MODE_CONFIGS`. That is the only launch table. The agent keeps just team size and win condition per mode, and it checks the block:

- `execCfg` must name a cfg the agent ships in `internal/match/cfgs/` or finds in `RUSHSITE_MODE_CFG_DIR`, otherwise 400
- exactly one of `workshopId` and `mapName`, and it must match `map`
- `extraArgs` entries must be a flag such as `+mapgroup` or a plain value

`testdata/modes.json` is exported from shared with `pnpm -C packages/shared export:modes`. The Go tests render a launch line for every mode and map in it, and check that the agent ships exactly the cfgs shared names. A shared vitest fails when the file is stale.

## Crash webhook

When a server exits without a `DELETE`, the agent posts `{ "event": { "type": "match_abandoned", "reason": "server_crashed", "missingSteamIds": [] } }` to the match's `webhookUrl`. The request carries `X-Rushsite-Signature: sha256=<hmac>` and is tried up to 5 times with backoff. Adopted servers have no exit code, so any exit the agent did not ask for counts as a crash.

## Per match files

`$CS2_DIR/game/csgo/cfg/rushsite/matches/<matchId>/` holds `server.cfg`, `mode.cfg` (a copy of the shipped cfg named by `execCfg`) and `match.json` for the plugin. The launch line ends with `+exec rushsite/matches/<matchId>/server.cfg +exec rushsite/matches/<matchId>/mode.cfg`. Valve's gamemode cfg runs on map load after that, which for aim resets money and gives C4, so the plugin runs `exec rushsite/matches/<matchId>/mode.cfg` again at match start. The dir is removed when the server exits. The CS2 process gets `RUSHSITE_MATCH_ID`, `RUSHSITE_MATCH_DIR` and `RUSHSITE_MATCH_JSON` in its environment, so the plugin can find `match.json`. The agent's own `RUSHSITE_*` settings, including the token, are removed from that environment.

## Restarts

The unit uses `KillMode=process`, so CS2 servers keep running when the agent restarts. The agent writes live servers to `servers.json` and adopts them on start after checking that each pid's command line still mentions its match id. Adopted servers are watched by polling, so their exit code is unknown.

## Rush room veto script

`game/csgo/rushsite_rooms.vpk` holds our modified `rush_001` script (`plugin/rush-script`). `rushsite_rooms.json` next to it records the CRC of Valve's `rush_001.vjs_c` it was built against. On start and after every CS2 update the agent reads that CRC from the installed `pak01_dir.vpk`:

- `on`: they match. `Game csgo/rushsite_rooms.vpk` goes into `gameinfo.gi` after the Metamod line, above `Game csgo`.
- `stale`: Valve changed `rush_001`. The line is taken out so Valve's current rules and random draw run. Rebuild the VPK.
- `error`: the JSON is missing or pak01 could not be read. The line is taken out.
- `off`: no VPK. The line is taken out.

The state is in `update.rushRooms` on `/health`, with the reason in `update.rushRoomsDetail`. The plugin reports `rush_rooms_failed { reason: "no_reply" }` for matches on a host where the script is not loaded. A line to a missing or broken VPK stops CS2 at startup, which is why the agent only writes it after these checks.

## Updates

`idle` → `draining` → `updating` → `idle`. When Steam reports a newer build, the agent refuses new servers (`updating: true`, 503 on `POST /servers`). It waits for running servers to end, runs `steamcmd +force_install_dir <dir> +login anonymous +app_update 730 +quit`, puts the Metamod line back in `gameinfo.gi`, re-checks the Rush room veto script, and reopens. A failed SteamCMD run stays in `draining` and retries on the next poll.
