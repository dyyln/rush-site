# @rushsite/dathost

DatHost surge driver. Implements the `ServerDriver` contract from `docs/CONTRACTS.md` by cloning a prepared
CS2 template server per match, configuring it, starting it and deleting it afterwards.

## Template status (23 Sep 2026)

The template `rushsite-template` exists on the DatHost account, id `6ab450a9e85891190562866f`, in `dusseldorf`, with
Metamod, GOTV, 7 slots, bots off, autostop 30 min and deletion protection on. It ships CounterStrikeSharp 1.0.374
with-runtime, our plugin (net8 build) under `addons/counterstrikesharp/plugins/RushsiteMatch/`, `cfg/rushsite_base.cfg`
from this package's `cfg/` dir, the three mode cfgs and a `core.json` with hot reload off.

Checked on the DatHost box (CS2 1.41.8.2, build 2000914): Metamod lists CounterStrikeSharp, `css_plugins list` shows
RushsiteMatch loaded, and the net8 plugin binds in the .NET 10 host. One gamedata signature fails at load,
`CEntityIOOutput_FireOutputInternal`, which the plugin does not use. The Rush check below passed: after
`game_type 0`, `game_mode 6`, `changelevel rush_001` the server execs Valve's `gamemode_rush.cfg` and reports
`mp_team_intro_type = rush`, `mp_maxrounds = 15`, `mp_halftime = false`, and a player could join and spawn.
`rush_001` is in DatHost's depot. `ent_find` needs `sv_cheats 1`, so the room-name check is still open.

## First: prove Rush on the template

Before relying on this driver for Rush, prove it by hand on the template server. DatHost has no numeric game mode
setting, so the driver boots Rush servers as `custom` and switches over the console. Start the template, run
`game_type 0`, `game_mode 6`, `changelevel rush_001` in its console, join, and check that Valve's Rush rules load
and the plugin works. Record the result in docs/RUSH-RESEARCH.md. Until then Rush on DatHost is unverified.

```ts
import { createDathostDriver, createMemoryServerStore } from "@rushsite/dathost"

const driver = createDathostDriver({
  email: process.env.DATHOST_EMAIL!,                 // DatHost account login, see Authentication
  password: process.env.DATHOST_PASSWORD!,
  templateServerId: process.env.DATHOST_TEMPLATE_SERVER_ID!,
  location: process.env.DATHOST_LOCATION ?? "dusseldorf", // DatHost id or city alias, frankfurt maps to dusseldorf
  store: createMemoryServerStore(),                   // replace with a Postgres backed DathostServerStore
})
const { ip, port, connect } = await driver.start(startServerRequest)
const demo = await driver.fetchDemo(matchId)          // Buffer or null. Call before stop
await driver.stop(matchId)                            // stops and deletes the clone
```

## Exports

- `createDathostDriver(opts)` returns `ServerDriver & { name: "dathost" }`.
  Options: `email`, `password`, `templateServerId`, `location?` (default `dusseldorf`), `location?`, `fetch?`, `baseUrl?` (default `https://dathost.com/api/0.1`),
  `store?`, `maxServers?` (default 1000), `bootTimeoutMs?` (240 s), `pollIntervalMs?` (3 s), `maxRetries?` (4),
  `retryBaseMs?` (500), `sleep?`, `demoDir?` (default root, where the plugin writes `rushsite_<matchId>.dem`),
  `baseCfg?` (default `rushsite_base.cfg`, `null` to skip), `autostopMinutes?` (30), `logger?`.
- `ServerDriver` and `ServerDriverName` are re-exported from `@rushsite/shared`.
- `DathostServerStore` `{ get, set, delete, count? }` maps matchId to the DatHost server id. `createMemoryServerStore()` is the default.
  The api can implement it over `matches.driver_ref`. `count()` feeds `capacity()`.
- `DathostError` with `status` (0 for network or boot timeout), `body`, `method`, `path`. `isDathostError()`.
- Helpers: `buildMatchJson`, `buildServerCfg`, `buildModeCfg`, `modeCfgPath`, `dathostGameMode`, `consoleSwitchLines`, `resolveLocation`.

## What `start(req)` does

1. Validates `req` with `StartServerRequestSchema`. Launches only from `req.cs2`, the block `resolveLaunch` builds from `MODE_CONFIGS`. There is no fallback table.
2. `POST /game-servers/{template}/duplicate` with `location`. The clone id goes into the store straight away.
3. `PUT /game-servers/{clone}` with name, `user_data=matchId`, `deletion_protection=false`, `autostop` as a safety net,
   `cs2_settings.password`, a fresh `rcon`, the GSLT, `enable_gotv`, `enable_metamod`, `slots` (players + 1, min 5),
   `game_mode` and the map (`workshop_single_map` when `cs2.workshopId` is set, otherwise `mapgroup_start_map` with `cs2.mapName`).
4. Uploads `cfg/match.json` (the `PluginMatchConfig` shape), `cfg/rushsite/matches/<matchId>/mode.cfg` (`exec <execCfg>`) and
   `cfg/server.cfg` (`exec rushsite_base.cfg`, `sv_password`, team names, `tv_enable 1`, `exec rushsite/matches/<matchId>/mode.cfg`).
   The mode.cfg path is the same as on the Hetzner agent, so the plugin re-execs it at match start the same way.
   The template must ship the agent's cfgs from `agent/internal/match/cfgs/` in its `cfg/` dir. That DatHost's file upload
   creates the nested dir is not yet checked against the real API.
   The plugin already falls back to `cfg/match.json` when `RUSHSITE_MATCH_JSON` is unset.
5. `POST /start`, then polls `GET /game-servers/{clone}` until `on && !booting`.
6. If the mode has no DatHost preset (Rush is 0/6) the server is booted as `custom`, then the driver sends
   `game_type`, `game_mode` and `changelevel <mapName>` (or `host_workshop_map <id>`) from `cs2` through the console endpoint.
7. Returns `{ matchId, ip: raw_ip || ip, port: ports.game, connect: "connect ip:port; password X" }`.

Any failure after the clone exists stops and deletes the clone, clears the mapping and rethrows.
Idempotent calls retry on 5xx, 429 and network errors with exponential backoff and jitter. 429 honours `Retry-After`.
The duplicate call only retries on 429 so a 5xx never leaves two clones.

`stop(matchId)` does `POST /stop` then `DELETE`, both tolerating 404. `fetchDemo(matchId)` lists `demoDir` with `max_depth=1`,
prefers `rushsite_<matchId>.dem` (the plugin's name), else the last `.dem` by name, and downloads it. Deleting the server deletes its files,
so the api must call `fetchDemo` before `stop`.

## DatHost API facts

### Confirmed from the docs

| Fact | Source |
|---|---|
| Base URL `https://dathost.com/api/0.1` (dathost.net redirects to dathost.com) | OpenAPI `servers: //dathost.com` on every reference page, e.g. https://dathost.readme.io/reference/post_game_server_start.md |
| Auth is HTTP Basic with the account email and password. No API tokens are documented. Optional `Account-Email` header acts on invited accounts | https://dathost.readme.io/docs/cs2-platform-onboarding.md, https://dathost.com/reference |
| Recommended platform flow: template server, duplicate per match, PUT settings while off, start, poll, delete | https://dathost.readme.io/docs/cs2-platform-onboarding.md |
| `POST /game-servers/{id}/duplicate` (multipart `location`, `destination_server_id`) returns the new server, created off. Files come from a cache refreshed hourly and on stop, `POST /sync-files` forces it | https://dathost.readme.io/reference/post_game_server_duplicate.md, https://dathost.readme.io/reference/post_game_server_sync_files.md |
| The GSLT is not copied on duplicate. FTP and MySQL passwords are regenerated | onboarding doc |
| `PUT /game-servers/{id}` takes multipart form fields such as `cs2_settings.password`, `cs2_settings.rcon`, `cs2_settings.steam_game_server_login_token`, `cs2_settings.enable_gotv`, `cs2_settings.enable_metamod`, `cs2_settings.slots` (5 to 64), `cs2_settings.maps_source`, `cs2_settings.mapgroup_start_map`, `cs2_settings.workshop_single_map_id`, `autostop`, `autostop_minutes`, `user_data`, `deletion_protection`. PUT on a running server restarts it | https://dathost.readme.io/reference/put_game_server_item.md |
| `cs2_settings.game_mode` is an enum: `competitive`, `casual`, `arms_race`, `ffa_deathmatch`, `retakes`, `wingman`, `custom`. There is no numeric game_type or game_mode field and no launch args field | same |
| `POST /start` reboots if already on. `POST /stop`. `DELETE /game-servers/{id}`. 404 when unknown | https://dathost.readme.io/reference/post_game_server_start.md, .../post_game_server_stop.md, .../delete_game_server_item.md |
| Poll the single server GET until `booting` is false. The list endpoint does not refresh `booting`. Address is `ip` or `raw_ip` plus `ports.game` | onboarding doc, https://dathost.readme.io/reference/get_game_server_item.md |
| Files: `GET /files` (`path`, `max_depth`, `hide_default_files`), `GET /files/{path}` download (a dir comes back as zip), `POST /files/{path}` multipart `file` upload (100 MB limit, 507 over the 30 GB quota). Paths are relative to the file manager root, `cfg/server.cfg` for `csgo/cfg/server.cfg` | https://dathost.readme.io/reference/get_game_server_files.md, .../get_game_server_files_item.md, .../post_game_server_files_item.md |
| `POST /console` with form field `line`. `GET /console?max_lines=` reads the backlog | https://dathost.readme.io/reference/post_game_server_console.md |
| Custom Metamod and CounterStrikeSharp plugins are allowed: enable `cs2_settings.enable_metamod` and upload plugins by file API or FTP. Duplicates inherit them | onboarding doc, "Step 1" and "Your own flow" |
| DatHost never stops or deletes servers. Teardown is ours, including on setup errors | onboarding doc, "Step 5" |
| Billing is per slot per hour while on, per minute in practice. Stopped servers and duplicating cost nothing | onboarding doc |
| Location ids are historical. `dusseldorf` is Frankfurt, `strasbourg` Paris, `bristol` London, `barcelona` Madrid. There is no `frankfurt` id | https://dathost.readme.io/reference/server-locations-mapping.md |
| `GET /account` has `credits` and `seconds_left` but no server limit | https://dathost.readme.io/reference/get_account.md |
| A Match API (`POST /cs2-matches`) exists with whitelisting, teams, webhooks and `enable_plugin`. We do not use it because our own plugin owns the match | https://dathost.readme.io/reference/post_api-0-1-cs2-matches.md |
| GOTV demos land in the server root, kept 14 days, need `tv_record` | https://help.dathost.net/article/140-cs2-record-gotv-demo |

### Inferred or unverified

- **Rush (game_type 0, game_mode 6) on DatHost: unverified.** DatHost exposes no numeric game mode and no launch options, and no DatHost page mentions Rush (searched 2026-09-23). The driver boots as `custom` and switches with `game_type 0; game_mode 6; changelevel rush_001` on the console. That this loads Valve's Rush rules correctly on a DatHost box, and that rush_001 is in DatHost's CS2 depot, is untested. What `custom` sets at launch (likely `+game_type 3 +game_mode 0`) is also unverified.
- `mapgroup_start_map=rush_001` with the template's mapgroup: unverified that DatHost accepts a start map outside the mapgroup. The console `changelevel` covers it either way.
- File list response shape `[{ path, size? }]` with no timestamps: inferred from the community client https://github.com/WardPearce/dathost (`dathost/models/file.py`). The docs only say "Success". Hence "newest" demo is picked by name.
- Whether list paths are relative to the root or to the `path` query: unverified. The driver handles both.
- Rate limits: no documented limit or 429 behaviour. Retry on 429 and `Retry-After` support are defensive.
- Account server count limit: none documented. `capacity()` reports `maxServers` (1000 by default) minus clones in the store.
- Whether the base cfg exec order matters versus DatHost's own generated settings (password, rcon from `cs2_settings`) is unverified. We set the password both ways.
- Whether a GOTV slot counts against `cs2_settings.slots`: the onboarding doc suggests 11 slots for 5v5 with GOTV, so we add one.

## Building the template server (once, by hand)

1. In https://dathost.com/control-panel create a CS2 server in the `dusseldorf` (Frankfurt) location. Pay as you go.
   Use an email and password login, not social login, because the API authenticates with them.
2. Settings: game mode `Competitive`, enable **MetaMod**, enable **GOTV**, slots 7, disable bots, set `autostop` on.
   Turn on `deletion_protection` for the template (the driver turns it off on each clone).
3. Install CounterStrikeSharp on top of the managed Metamod: upload the CounterStrikeSharp release to `addons/`
   through the file manager or FTP (unzip endpoint exists: `POST /game-servers/{id}/unzip`). Pin the build that works on
   the current CS2 version, see the CounterStrikeSharp note in CLAUDE.md.
4. Upload our plugin build from `plugin/` to `addons/counterstrikesharp/plugins/RushsiteMatch/`.
5. Upload `cfg/rushsite_base.cfg` (kept in this package under `cfg/`) with the settings every match shares (hostname prefix, `sv_hibernate_when_empty 0`,
   `tv_enable 1`, `tv_delay`, `sv_lan 0`, logging). The generated `server.cfg` execs it first. Also upload every mode cfg
   from `agent/internal/match/cfgs/` (`rushsite_aim1v1.cfg`, `rushsite_aim2v2.cfg`, `rushsite_rush3v3.cfg`) to `cfg/`.
   `gamemode_rush.cfg` is Valve's and the game runs it by itself.
6. Start the template, join it, check the plugin loads (`css_plugins list` in the console), and do the Rush check at the top of this README.
7. Stop the template (this refreshes the duplicate cache) or call `POST /game-servers/{id}/sync-files`.
8. Copy the server id from the control panel URL or `GET /game-servers` into `DATHOST_TEMPLATE_SERVER_ID`.
   Set `DATHOST_EMAIL`, `DATHOST_PASSWORD` and `DATHOST_LOCATION=dusseldorf` (`frankfurt` also works as an alias).

After any template change, stop it or call sync-files before the next match so clones pick up the change.
