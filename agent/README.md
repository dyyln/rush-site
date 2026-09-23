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
| `RUSHSITE_MODES_FILE` | none | JSON that overrides mode launch settings. See `RUSH.md` |
| `RUSHSITE_MODE_CFG_DIR` | none | Dir of mode cfgs that replace the embedded ones |
| `RUSHSITE_STEAMCMD` | `/usr/games/steamcmd` | |
| `RUSHSITE_UPDATE_CHECK` | `steamapi` | `steamapi`, `steamcmd` or `off` |
| `RUSHSITE_UPDATE_INTERVAL` | `5m` | How often to check while idle |
| `RUSHSITE_DRAIN_POLL` | `10s` | How often to re-check while waiting for matches to end |
| `RUSHSITE_UPDATE_VALIDATE` | `false` | Add `validate` to `app_update` |
| `RUSHSITE_PATCH_GAMEINFO` | `true` | Re-add the Metamod line to `gameinfo.gi` on start and after updates |
| `RUSHSITE_STEAM_API_BASE` | `https://api.steampowered.com` | For tests |

## HTTP API

Every route needs `Authorization: Bearer <token>`. Errors look like `{ "error": "<code>", "message": "..." }`.

| Route | Result |
|---|---|
| `GET /health` | `{ ok, cs2Version, slots: { total, free }, updating, update: { state, lastCheck, lastUpdate, lastError, attempts } }` |
| `POST /servers` | 201 `{ matchId, ip, port, connect }`. 400 `bad_request`, 409 `exists`, 422 `mode_not_configured`, 503 `updating` or `no_free_slots`, 500 `start_failed` |
| `DELETE /servers/:matchId` | 204 once the process is gone and the slot is free. Unknown ids also get 204 |
| `GET /servers` | Array of `{ matchId, mode, mapId, port, tvPort, pid, connect, status, startedAt, logPath }`. `?include=exited` adds the last 50 ended servers with `status` `exited`, `crashed` or `stopped`, plus `endedAt` and `exitCode` |
| `POST /update` | Operator hook. Drains and runs SteamCMD now. 202 with the update status |

`POST /servers` accepts an optional `cs2: { gameType, gameMode, execCfg, extraArgs? }`. Fields that are present override the agent's mode table and missing ones fall back to it. `extraArgs` entries must be a flag such as `+mapgroup` or a plain value, and `execCfg` must be a mode cfg the agent has.

## Crash webhook

When a server exits without a `DELETE`, the agent posts `{ "event": { "type": "match_abandoned", "reason": "server_crashed", "missingSteamIds": [] } }` to the match's `webhookUrl`. The request carries `X-Rushsite-Signature: sha256=<hmac>` and is tried up to 5 times with backoff. Adopted servers have no exit code, so any exit the agent did not ask for counts as a crash.

## Per match files

`$CS2_DIR/game/csgo/cfg/rushsite/matches/<matchId>/` holds `server.cfg`, the mode cfg (for example `rushsite_rush3v3.cfg`) and `match.json` for the plugin. The dir is removed when the server exits. The CS2 process gets `RUSHSITE_MATCH_ID`, `RUSHSITE_MATCH_DIR` and `RUSHSITE_MATCH_JSON` in its environment, so the plugin can find `match.json`. The agent's own `RUSHSITE_*` settings, including the token, are removed from that environment.

## Restarts

The unit uses `KillMode=process`, so CS2 servers keep running when the agent restarts. The agent writes live servers to `servers.json` and adopts them on start after checking that each pid's command line still mentions its match id. Adopted servers are watched by polling, so their exit code is unknown.

## Updates

`idle` → `draining` → `updating` → `idle`. When Steam reports a newer build, the agent refuses new servers (`updating: true`, 503 on `POST /servers`). It waits for running servers to end, runs `steamcmd +force_install_dir <dir> +login anonymous +app_update 730 +quit`, puts the Metamod line back in `gameinfo.gi`, and reopens. A failed SteamCMD run stays in `draining` and retries on the next poll.
