# Scalability review: queue, matchmaking and WebSocket

Status: analysis as of 2026-09-23. File and line references match the tree at the time of writing. Other agents were editing `apps/api` during the review, so a few lines may have moved by a handful of lines.

## Summary

- **Up to about 100 concurrent users and 50 in queue, the software is fine.** The limit you hit first is **game servers**: the agent's default port range `27015-27030` gives 16 slots per box. That is 16 matches at once.
- **At about 1,000 users and 500 or more in queue, it degrades.** The periodic `queue_status` refresh makes about 3 Postgres queries and 3 to 5 Redis calls per queued player, one after another, inside the matchmaker's lock and loop. Matchmaking slows down to match. With 1,000 queued in the load test, a 200-player burst of instantly matchable players sometimes got no `match_found` within 12 s.
- **At about 10,000 users and 5,000 in queue, it breaks.** `findMatches` is roughly O(N² log N) and synchronous, and took 2 to 6.5 s of CPU per mode per tick at 5,000 tickets. The queue refresh takes longer than the 10 s lock TTL, so with two instances both run the matchmaker. After a deploy, 5,000 clients reconnect within 500 ms and take about 40 s to settle. One cup start broadcasts about 33 copies of a 15 KB bracket to every socket. There is no back-pressure on slow clients.
- **Correctness under concurrency is mostly sound.** Postgres is the arbiter for ticket claims, match row locks and slot reservation (`SKIP LOCKED`). Timers are deadlines in the database, so they survive a restart. **One real hole:** two concurrent `queue_join` calls for the same party can create two live tickets, and the party can then be matched twice.

The three bottlenecks to fix first, in order:
1. The `queue_status` broadcast N+1 inside the matchmaker lock. About 3 hours, no schema or contract change.
2. The matchmaker algorithm. About 1 day, no schema or contract change.
3. WebSocket fan-out: reconnect storm, snapshot cost, no back-pressure, full-bracket broadcasts. About 1 to 2 days. The bracket part needs a contract change.

---

## 1. Matchmaker

### Where it runs
- It is an in-process `setInterval` loop in every API instance, gated by a Redis lock: `app.ts:199-217`. The lock TTL is `max(everyMs * 5, 10_000)`, so 10 s for the 2 s matchmaker (`app.ts:207`, `MATCHMAKER_INTERVAL_MS` default 2000 in `env.ts:79`).
- `withLock` (`lib/redis.ts:10-20`) uses `SET NX PX`, with no renewal. The release is a non-atomic `GET` then `DEL`. The token check makes this mostly safe, but a Lua compare-and-delete is the correct form.
- Each instance has a local `running` flag, so the loop never overlaps itself in one process. Across instances only the Redis lock protects it.
- Every third matchmaker pass also runs `broadcastQueued()`, inside the same lock and the same awaited function (`app.ts:221-224`). This is the main problem (see section 3).

### Algorithm cost per tick
`findMatches` (`modules/queue/matchmaker.ts:59-110`) works like this:
- It sorts tickets by `enqueuedAt`. For **every** anchor it scans **all** tickets (`filter`, line 72), then sorts the survivors by rating distance (line 80), then keeps 9 (`maxCandidates`, line 62).
- The filter is O(N) per anchor. The sort is O(M log M), where M is the number of tickets inside `window * 2`. After 300 s the window is `null`, which means infinite (`packages/shared/src/config/queue.ts:16-23`), so M becomes N.
- The worst case is therefore O(N² log N) per mode per tick. Subset enumeration over 9 candidates is bounded: for rush, at most about 36 x 35 pairs per anchor.
- A lost claim restarts the whole mode pass, up to 5 times (`loop.ts:7,20-46`). Under contention the CPU cost is multiplied by up to 5.
- All of it runs synchronously on the event loop that also serves HTTP and WebSocket.

Measured CPU time for one `findMatches` call (script `mmbench.ts` in the scratchpad; the machine had load average about 24, so treat the numbers as upper-ish):

| tickets | aim1v1 fresh | aim1v1 waits 0-400 s | aim2v2 waits 0-400 s | rush3v3 waits 0-400 s |
|---|---|---|---|---|
| 50 | 3 ms | 1 ms | 1 ms | 2 ms |
| 500 | 17 ms | 34 ms | 61 ms | 103 ms |
| 5,000 | 3.5 s | 6.5 s | 4.1 s | 3.9 s |

Going from 500 to 5,000 tickets costs about 100 to 200 times more, which is quadratic-plus growth. Below 500 in queue per mode it does not matter. At 5,000 the process freezes for seconds per tick.

### Two or more instances
- **Correctness holds.** `QueueService.claim` (`service.ts:241-271`) moves tickets from `waiting` to `matched` in one Postgres UPDATE with `status = 'waiting'` in the WHERE clause. If fewer rows change than expected, the whole claim rolls back. Two instances can never both consume the same ticket.
- **Liveness does not hold once a pass runs longer than 10 s.** The lock expires, a second instance takes it, and both run at once. Each wastes work, and each hits `ClaimLost` re-runs, which multiply the CPU time. In the load test, one pass including the broadcast already ran 14 to 18 s at 2,500 queued (section 6), so this happens in practice, not just in theory.
- The tournament scheduler (`tournaments/index.ts:44-55`) and the challenge expiry (`challenges/index.ts:21-31`) take **no** Redis lock and run on every instance. Tournaments are serialised by `SELECT ... FOR UPDATE` on the tournament row (`tournaments/store.ts:307-312`), so this is safe, but every instance holds a pool connection while it waits on that lock.

### Fairness and starvation
- `matchmakeAll` runs modes in a fixed order: aim1v1, then aim2v2, then rush3v3 (`loop.ts:50-53`). A solo player queued for all three modes is always offered to aim1v1 first. **Rush, the headline mode, systematically loses multi-mode solos to 1v1.** Fix: rotate the starting mode each tick, or run rush first.
- Within a mode, anchors are taken oldest first, and the widening window reaches infinity at 300 s. A 1v1 ticket cannot starve for long. For rush, a trio needs another party team until `mixAfterSec: 90`. Mixed teams are last in the preference key, so a lone trio waits at least 90 s by design.
- The best-proposal key is `[mixed, diff, -waited]` (`matchmaker.ts:98`). Rating closeness beats waiting time among candidates. Only the anchor gets the oldest-first guarantee. Candidates near the anchor's rating are preferred even when a candidate waiting longer is inside the window. This is acceptable.

### Races worth knowing about
- **Double ticket per party (real bug under load).** `join` reads the existing ticket (`service.ts:124`), then inserts a new row (`service.ts:141-160`), with no lock and no unique constraint. Two concurrent joins, from two tabs or a double click over both WS and REST, create two `waiting` tickets. Both go into `q:<mode>`, and `q:p:<party>` points only at the second. The orphaned first ticket can still be matched. `inActiveMatch` runs only at join time, so the party can end up in two matches. Fix: a partial unique index `queue_tickets(party_id) WHERE status = 'waiting'` (schema change, no contract change), or `SET NX` on `q:p:<party>` before the insert.
- **Leave versus claim.** If `claim` commits first, `cancelParty` updates 0 rows in Postgres but has already dropped the Redis entry. The player gets `match_found` after leaving. Declining gives a cooldown. This is rare and minor.
- **Multi-mode consumption across modes** in one instance is safe: the next mode re-reads Redis after `dropLive`. Across instances, the Postgres arbiter handles it, and the loser re-runs the pass.

---

## 2. WebSocket

### Connections per process
- `LocalHub` (`modules/ws/hub.ts:30-101`) holds maps from user to set of sockets, admins, match to sockets, and socket to matches. Signed-out spectators get a random `anon:` key (`ws/routes.ts` in `attachSocket`) and receive every broadcast.
- Memory measured on the scratch instance: about 10 to 25 KB of RSS per idle socket (171 MB to 221 MB for 2,000 sockets, 369 MB to 420 MB for 5,000). 10k sockets is about 100 to 250 MB. Memory is not the constraint. CPU on fan-out and snapshot queries is.
- There is a ping every 30 s, and a socket that misses a pong is terminated (`ws/routes.ts:62-69`). There is no limit on connections per IP and no rate limit on inbound messages. A client can spam `queue_join`, which costs about 15 queries each, and saturate the 10-connection pool.

### The `rs:ws` fan-out
- `RedisNotifier.send` publishes `{audience, msg}` to one channel, `rs:ws` (`hub.ts:106-112`). **Every instance receives every message**, runs `JSON.parse` on it, and filters locally in `LocalHub.deliver` (`hub.ts:81-96`, `114-125`).
- Cost per message per instance: one parse, plus a map lookup per target user. For `broadcast`, it iterates every local socket and calls `socket.send(string)`, and `ws` converts the string to a Buffer on every call.
- Per-user traffic, such as `queue_status`, is published once per player. `notifyParty` publishes one message per member (`service.ts:351-353`), not one per party.
- Redis itself is not the bottleneck: at 5,000 queued with a 6 s refresh this is roughly 1k publishes per second of about 400 B each. With k instances, each instance parses all of them, which is fine to around 10 instances. Sharding channels per instance or per user can wait.

### Broadcast frequency and payload size
| message | trigger | audience | size |
|---|---|---|---|
| `mode_stats` | every 5 s, only on change, one instance under lock (`app.ts:228-237`) | every socket | about 250 B |
| `queue_status` periodic | every 3rd matchmaker tick, nominally 6 s | each queued player | about 300-400 B |
| `queue_status` on change | join, leave, requeue, cancel | party members | about 300-400 B |
| `tournament_update` | every announce (`tournaments/service.ts:467-485`) | **broadcast to every socket** | 4 KB (16 entrants), 8 KB (32), **15.5 KB (64)** |
| `match_update` | round_end, status changes | match subscribers | small |
| `admin_event` | every webhook and error (`lib/event-log.ts`) | admins, but published to every instance | small |

The dangerous one is `tournament_update`. `provision` announces `match_live` once for each bracket match it started (`tournaments/service.ts:384`), and every announce carries the full bracket. The weekly 64-entrant aim cup starts 32 matches, so there are 33 broadcasts of about 15 KB. At 10k sockets that is about 5 GB of outbound frames in a few seconds. At 1k sockets it is about 500 MB. Sunday 17:00 UTC starts all three weekly cups together (`tournaments/config.ts:48`): 64 matches.

### Match subscriptions
`subscribeMatch` is capped at 20 per socket (`hub.ts:27,37-46`) and cleaned up on close (`hub.ts:56-60,72-79`). It does not check that the match exists, but memory is bounded at 20 x sockets. This is fine.

### Reconnect storm after a deploy
- On the web client (`apps/web/src/lib/ws.ts:8-9,74-81`), the first retry waits `random() * 500 ms`. Every client of a restarted instance comes back within half a second.
- Each authenticated connect runs a snapshot (`ws/routes.ts:114-121`): `partyOf` (3 queries), `payload` (1), `queue.status` (3 queries plus Redis, plus cooldowns when idle), and `resendState` (1 join, plus 1 more when a match is active). That is about 8 to 10 sequential Postgres round trips, competing for a pool of 10 (`db/client.ts:16`). There is also the session lookup in Redis.
- Measured on the scratch instance:

| sockets | all reopened | open p50 / p95 | snapshot p50 / p95 |
|---|---|---|---|
| 200 | 0.8 s | 45 / 283 ms | 0.7 / 1.2 s |
| 2,000 (1,000 queued) | 11.4 s | 4.5 / 7.3 s | 11.8 / 12.8 s (only 783 of 2,000 within 5 s) |
| 5,000 (2,500 queued) | 43 s, 26 failed | 12 / 21 s | 28 / 33 s |

**Status: fixed.** The API keeps `snapshot:<steamId>` in Redis, a hash with the latest `party`, `queue` and `match` messages (`lib/snapshots.ts`). The notifier is wrapped in `buildContext`, so every `party_update`, `queue_status`, `match_found`, `veto_state`, `server_ready`, `match_result` and `match_cancelled` sent to users is stored as it is published, whether or not the user is connected. On connect (`ws/routes.ts` `sendSnapshot`) the snapshot is sent to that socket with no Postgres queries. The old DB path runs only when a field is missing and then fills in the missing fields without overwriting newer ones. On read, a `queued` status older than the last match message is served as idle (claiming a ticket sends no `queue_status`), an expired cooldown is served as idle, `match_cancelled` clears the match phase and a `match_result` is replayed for 2 minutes. Keys expire 12 h after the last write. The web client adds 0 to 3 s of jitter to its reconnect backoff and replays its `subscribe_*` messages after each reconnect. Hits and misses are counted on `GET /health` under `ws`.

### Back-pressure
There is none. `hub.deliver` and `send` call `socket.send` without checking `bufferedAmount` (`hub.ts:93`, `ws/routes.ts:55-56`). A slow or stalled client makes `ws` buffer without limit in process memory until the ping timeout, up to 60 s. Combined with the bracket broadcasts above, a few thousand phones on a bad network can add gigabytes of RSS on a box that also runs Postgres and CS2. `maxPayload: 64 KB` (`app.ts:58`) limits inbound frames only.

**Status: fixed.** Every send goes through `sendChecked` (`lib/backpressure.ts`), from both `hub.deliver` and the per-socket send. Above 256 KB buffered, `mode_stats` and `queue_status` messages flagged `refresh: true` are dropped. State changes are never dropped. Above 1 MB the socket is closed with code 1013. Drops and closes are counted per process on `GET /health` under `ws`.

---

## 3. Redis and Postgres

### Hot paths and N+1
- **`broadcastQueued` (`service.ts:356-366`)** is the worst. For every waiting ticket in all 3 modes, it awaits `notifyParty`, which awaits `status(id)` for each member, one at a time (`service.ts:324-353`).
  - `status` is `partyOf`: 3 queries (`parties/service.ts` `partyOf` then `get`, with members in a separate select). Then `ticketForParty`: 2 Redis GETs. Then per mode, `playersInQueue` (Redis, and on a cache miss a full `waiting()` with ZRANGE plus MGET plus parse of the whole queue) and `eta` (cached in process).
  - At 1,000 queued, one refresh took 8 to 16 s in the load test (nominal 6 s). At 2,500 queued it took 14 to 18 s. That is longer than the 10 s lock TTL.
- **`playersInQueue` cache thrash.** `putLive` and `dropLive` delete `q:n:<mode>` on every join and leave (`service.ts:165-180`). The next `status()` then recomputes by reading and parsing the whole queue (`service.ts:312-322`). During a join burst, each join's `notifyParty` pays O(queue), so a burst of joins costs O(N²). This is why 2,500 joins took more than 30 s to settle in the test. Fix: maintain the count with `INCRBY` and `DECRBY` in the same MULTI, or keep a `q:size:<mode>` hash.
- **`waiting(mode)`** does a full `ZRANGE` plus `MGET` plus `JSON.parse`. It runs once per pass per mode, again in `broadcastQueued`, and again for admin snapshots. At 5,000 tickets that is about 1.5 MB per call. This is fine for Redis but costs parse CPU.
- **Profile** (`stats/routes.ts:97-204`):
  - It loads **all** rating events for the user with no limit and trims to 200 per mode in JS (`stats/routes.ts:128-132`). Fix: a window function or a per-mode `LIMIT` in SQL.
  - The per-mode rank is a `count(*)` of higher ratings with a correlated `notBanned` subquery (`stats/routes.ts:141-152`). It is O(rank) per mode and gets slow for low-ranked players on large boards.
- **Leaderboard** (`stats/routes.ts:58-95`): every page view runs `count(*)` over all placed ratings plus the ban subquery (line 80), and uses OFFSET pagination up to 100k. Fix: cache `total` for 30 to 60 s. Deep offsets are rare.
- **Queue ETA** (`stats/eta.ts:31-37`) filters `status = 'matched' AND matched_mode = ? AND updated_at >= ?`. The only helpful index is `queue_tickets_status_idx` (`status`), and `matched` is most rows. This becomes a near table scan 3 times every 15 s per instance.

### Missing indexes (schema change, no contract change)
| query | where | index to add |
|---|---|---|
| tick: finished or abandoned, not released, ended before cutoff | `flow.ts:826-835` | `matches (ended_at) WHERE server_released_at IS NULL`. Today it uses `matches_status_idx`, which matches almost every row ever, **every second** |
| tick: due veto steps | `flow.ts:809-813` | `vetoes (step_deadline) WHERE done = false`. Today it is a seq scan of every veto ever, every second |
| ETA | `stats/eta.ts:31-37` | `queue_tickets (matched_mode, updated_at) WHERE status = 'matched'` |
| one waiting ticket per party | `service.ts:124-160` | `UNIQUE queue_tickets (party_id) WHERE status = 'waiting'` |
| tournament game-1 maps | `flow.ts` `enterPostAccept` | `matches (tournament_id, bracket_match_key, game_number)`. Small table, low priority |

Existing indexes that are adequate: `match_players_user_idx`, `ratings_mode_rating_idx`, `cooldowns_user_idx`, `bans_user_idx`, and the PKs on `ratings` and `match_players`.

### Locks
- `withLock` keys are `lock:matchmaker`, `lock:match_tick`, `lock:match_alloc` (30 s TTL), `lock:hosts`, `lock:mode_stats`, and per match `lock:alloc:<id>` and `lock:teardown:<id>`. There is no contention between keys. The risk is TTL expiry under slow passes, as described above.
- Postgres row locks are short. `respond` and `vote` lock one match row, plus the veto row for votes. `finishMatch` locks the match row plus the rating rows, ordered by `steam_id` (`rating/service.ts:62-75`).

### Pools
- Postgres: `max: 10` per instance (`db/client.ts:16`). Postgres defaults to `max_connections = 100`, so about 9 instances at most without PgBouncer.
- Redis: one command connection, one publisher and one subscriber per instance (`server.ts`). ioredis pipelines automatically, so this is fine.

### Rating update and rollback
- `applyMatch` (`rating/service.ts:78-135`) takes one locking select, then an INSERT event and an UPDATE rating per player, one after another. A 3v3 match is about 15 statements plus 6 `match_players` updates in `finishMatch` (`flow.ts:631-700`). Then `trust.recomputeMany` runs about 7 queries per player outside the transaction. That is about 60 statements per finished rush match, which is trivial at any realistic match rate.
- `rollbackCheater` (`rating/service.ts:138-251`) runs **one transaction for the whole window** (30 days by default).
  - A prolific cheater has hundreds of victims. For each victim it does a lock, a full history read, a replay, and 3 writes. That holds rating row locks for seconds and blocks those players' `finishMatch`.
  - Victims are locked in map order, not sorted, so it can deadlock with a concurrent `applyMatch`. Postgres resolves the deadlock by aborting one side. If it aborts `finishMatch`, the webhook gets a 500.
  - Fix when it matters: sort victims by `steam_id`, and run one transaction per victim. This is rare enough to defer.

---

## 4. Match flow

- **Accept and veto timers** are deadlines stored in Postgres (`matches.accept_deadline`, `vetoes.step_deadline`). **They survive restarts and failover.** Every transition re-checks under `FOR UPDATE`, so a double run is safe.
- **The match tick is split into two loops** (`app.ts` `startLoops`, `flow.ts` `timersTick` and `allocationTick`):
  - `match_tick` runs `timersTick()` every 1 s under `lock:match_tick` (10 s TTL). It touches only Postgres and Redis: accept, veto, connect and stuck-starting deadlines, plus a cooldown-expiry sweep that pushes a fresh `queue_status`. An accept or veto that completes here leaves the server start to the allocation loop. Cancellations here defer the server stop to the allocation loop teardown.
  - `match_alloc` runs `allocationTick()` every 2 s (`ALLOCATION_TICK_INTERVAL_MS`) under `lock:match_alloc` with a 30 s TTL, because one pass can wait on a 15 s agent call. It does agent and DatHost HTTP: `tryAllocate` for `allocating` matches and `teardown` for ended matches and for cancelled matches still holding a host, slot or DatHost server. At most 4 calls run at once (`ALLOCATION_CONCURRENCY`).
  - A hung agent therefore delays only other allocations, never a countdown. `tick()` still runs both passes in order for tests and scripts.
- The **allocator host sync** runs every 30 s, not every tick (`app.ts:226`, `allocator.ts:126-157`). It is serial per agent URL. That is fine for a handful of hosts.
- Slot reservation uses `FOR UPDATE SKIP LOCKED` (`allocator.ts:176-196`). That is correct under concurrency.
- **Webhook throughput**: about 4 to 6 queries per event (`match/routes.ts` webhook handler, `flow.ts:518-600`), plus a Redis `LPUSH` and an `admin_event` publish for each one. A rush match sends about 30 webhooks over about 20 minutes. At 100 live matches that is under 3 per second. This is not a concern.
- **Game server capacity is the real ceiling.**
  - With the default `RUSHSITE_PORT_RANGE=27015-27030` there are 16 slots per box. At average lengths of about 8 min for aim1v1, 10 min for aim2v2 and 20 min for rush, 16 slots serve about 32 to 96 players in game.
  - Matches that cannot get a slot sit in `allocating` for 120 s and are then cancelled and requeued (`env.ts:82`). Players churn.
  - DatHost surge after `SURGE_WAIT_SEC=20` is the pressure valve. Watch its cost.

---

## 5. Tournaments and cup start bursts

- Start times: the daily cups all start at 18:00 UTC, and the weekly cups all start Sunday 17:00 UTC (`tournaments/config.ts:36-63`). The largest is the weekly aim1v1 with 64 entrants, which means 32 round-one matches. All three weekly cups together are 64 matches, against 16 slots per box.
- `provision` (`tournaments/service.ts:338-385`) runs **inside the tournament row-lock transaction**. For every playable bracket match it calls `startMatch`, which is `flow.createTournamentMatch` (`flow.ts` `createTournamentMatch`): a slot reservation transaction, an insert transaction, and then:
  - For rush (no veto), `tryAllocate` runs at once, with an agent HTTP call of up to 15 s.
  - For aim modes, it goes into a website veto.
  - These run one after another. The row-lock transaction holds one pool connection and uses 2 or 3 more for its duration. 32 sequential agent starts can take minutes. Meanwhile `handleResult` for that cup blocks on the same row lock.
- **Tournaments take slots first come, first served.** At 18:00 the ladder can be starved of Hetzner slots for the whole first round. Without surge, `createTournamentMatch` throws `no_server_slot` and that bracket match retries on the next 30 s scheduler tick (`tournaments/service.ts:385-392`). That behaviour is correct but slow.
- Each start announces the full bracket to every socket (section 2).
- Fixes:
  - Release the row lock before calling out. Collect the ready matches under the lock, start them outside it with concurrency 4 to 8, and then record `startGame` under the lock again.
  - Send `tournament_update` with the summary only to broadcast. Send the bracket to viewers of that tournament. This needs a `subscribe_tournament` client message or a tournament audience, which is a **contract change**. Alternatively, send `bracketMatchId` plus the single changed match.
  - Optionally stagger cup start times by mode by a few minutes (config only).

---

## 6. Load test (what was run and what happened)

Setup: a separate API instance on port 3101 with its own Redis container and its own Postgres database, all created for the test and removed afterwards. Loops were enabled, there were no agents, and `ALLOW_UNRESOLVED_MODES=1` was set. Sessions **can** be minted in dev without Steam: write `sess:<id> -> steamId` into Redis and sign the `rs_sid` cookie with `SESSION_SECRET` (the `@fastify/cookie` format is `value.base64(hmac-sha256)` with the padding stripped). Script: `loadtest.mjs` in the session scratchpad, not in the repo. The load generator ran on the same laptop, and the machine was heavily loaded by other agents (load average 24 on 22 cores). The absolute numbers are pessimistic. The shape is what matters.

The phases were:
1. Open N sockets.
2. Q players join aim1v1 with ratings 2,000 apart, so they never match.
3. 200 players at 1500 join at once and auto-accept.
4. Terminate all sockets and reconnect with 0 to 500 ms jitter, like the web client.

| N sockets / Q queued | periodic `queue_status` gap p50 / p95 (nominal 6 s) | burst join to `match_found` p50 | `/health` p95 during queue | reconnect storm, all open |
|---|---|---|---|---|
| 200 / 50 | about 4.5 s / 5.2 s | 1.0 s (burst of 20) | 12 ms | 0.8 s |
| 2,000 / 1,000 | 8.0 s / 15.9 s | 3.1 s in one run, **none within 12 s** in the next | 25 ms | 11.4 s |
| 5,000 / 2,500 | 14 s / 18 s | **48 s** | 103 ms | 43 s, 26 failed |

`mode_stats` delivery latency (server `ts` to client receipt) was 2 ms at 200 sockets, 35 ms at 2,000 and 132 ms p50 / 306 ms p95 at 5,000.

What this shows: matchmaking latency is dominated by the serial `queue_status` refresh sharing the matchmaker loop, not by `findMatches` itself, until the queue passes about 1,000 per mode.

One side effect to report: during the first attempt, before the script had the right environment, about 200 fake `sess:*` keys, pointing at non-existent Steam IDs in the `76561199000000xxx` range, were written to the **dev** Redis on port 6379. They expire on their own one hour after creation. No dev Postgres rows were touched.

---

## 7. Capacity estimate

Assumptions: one API instance with a Postgres pool of 10, one Redis, one AX box with 16 CS2 slots (DatHost surge off unless stated), EU only, and match lengths as in section 4. A "concurrent user" is an open socket. About 25% of users are queued or in match.

| | 100 users | 1,000 users | 10,000 users |
|---|---|---|---|
| **50 in queue** | Fine. Matchmaker under 5 ms, refresh about 0.3 s. Ceiling is 16 matches (16 slots) | Fine on the API. `mode_stats` fan-out is trivial. Servers are the limit: about 250 players want to play, which needs about 60 or more slots (4 boxes, or surge) | API is OK for queue work. Reconnect storms (about 60 s or more to settle) and bracket broadcasts (about 5 GB per cup start) are the problems |
| **500 in queue** | n/a | Degraded. Refresh about 3 to 8 s (inside the lock), matchmaker latency 2 to 5 s, `findMatches` 20 to 100 ms. Needs about 150 slots | Same as the cell to the left, plus storm and fan-out problems |
| **5,000 in queue** | n/a | n/a | **Broken.** `findMatches` 2 to 6.5 s of synchronous CPU per mode, refresh 30 s or more (more than the lock TTL, so double matchmakers), join-to-match about 1 minute, HTTP p95 in seconds. Needs about 1,500 concurrent slots, which is about 90 boxes or heavy surge |

A single well-fixed Node instance should handle about 10k sockets and 5k queued, once bottlenecks 1 and 2 below are fixed and the snapshot is trimmed. Beyond that, add instances behind a load balancer. That already works functionally.

---

## 8. The first three bottlenecks and their fixes

### 1. `queue_status` refresh N+1 inside the matchmaker lock
- **Where:** `app.ts:221-224`, `service.ts:324-366`, `parties/service.ts` `partyOf` and `get`.
- **Fix:**
  - Move the refresh into its own loop and lock, so matchmaking cadence no longer depends on it.
  - Build the payload straight from the `LiveTicket`, which already holds `partyId`, `steamIds`, `modes` and `enqueuedAt`. Compute `playersInQueue` and `eta` once per mode per refresh. Publish one message per party with `audience: users, steamIds: [...]`. That is zero Postgres queries and one publish per party.
  - Fix the `q:n:<mode>` cache thrash with incremental counters.
  - Optionally drop the periodic push entirely, since `waitSec` and `ratingWindow` can be derived on the client from `queuedAt` and the shared widen schedule.
- **Effort:** 2 to 4 hours, plus 1 hour for tests.
- **Schema change:** no. **Contract change:** no, the payload is identical. Dropping the periodic push changes the behaviour, not the schema, and needs a web change.

### 2. Matchmaker O(N² log N) on the event loop
- **Where:** `matchmaker.ts:69-80`, `loop.ts:20-46`.
- **Fix:**
  - Group by region, sort once by rating, and give each anchor its k nearest unused tickets by expanding two pointers from its index, skipping used ones. The cost becomes about O(N · k). Keep the same preference key so the existing `matchmaker.test.ts` still holds.
  - On a lost claim, drop only the affected proposal instead of re-running the whole pass.
  - Rotate the mode order per tick, for rush fairness.
  - Add a lock renewal (extend the TTL while running), or set the TTL well above the worst-case pass time.
- **Effort:** 1 day including tests.
- **Schema change:** no. **Contract change:** no.

### 3. WebSocket connect and fan-out: reconnect storm, snapshot cost, no back-pressure, bracket broadcasts
- **Where:** `apps/web/src/lib/ws.ts:8-9,74-81`, `ws/routes.ts:114-121`, `hub.ts:81-96`, `tournaments/service.ts:384,467-485`.
- **Fix:**
  - On the web client, make the first retry wait 1 to 5 s with jitter, and back off more when the close code is 1001 or 1012 (server going away).
  - On the server:
    - Collapse `partyOf` into one join query.
    - Serve the snapshot from Redis where possible.
    - Cap snapshot concurrency with a small semaphore, so the pool is not starved.
    - In `deliver`, skip or terminate sockets whose `bufferedAmount` is above about 1 MB.
    - Serialise to a Buffer once per message.
    - Add per-socket token-bucket rate limiting for inbound messages, and a cap on connections per IP.
  - Tournaments: broadcast the summary only, and send the bracket only to viewers.
  - Shut down gracefully on SIGTERM: close sockets with code 1012 over a few seconds instead of all at once.
- **Effort:** about 1 day for the server and web parts, plus half a day for the tournament audience.
- **Schema change:** no. **Contract change:** yes for the tournament bracket (a new `subscribe_tournament` client message, or a slimmer `tournament_update` broadcast plus a REST fetch). The rest needs none.

Also required before the first cup with real players (not a load bottleneck, but it fails at cup start): take `provision` out of the row-lock transaction and start matches with bounded concurrency. Half a day, no schema or contract change.

---

## 9. Do now versus defer

**Quick wins to do now (hours each):**
1. Take `broadcastQueued` out of the matchmaker lock and build it from `LiveTicket`, with no Postgres (bottleneck 1).
2. Keep an incremental `q:n:<mode>` count instead of invalidating it on every join and leave.
3. Add a partial unique index on `queue_tickets(party_id) WHERE status = 'waiting'`, to close the double-match hole.
4. Add the missing partial indexes for `tick()` (`matches` not released, `vetoes` not done) and the ETA index. One migration.
5. Rotate mode order in `matchmakeAll`, so rush is not starved of multi-mode solos.
6. Web: raise the reconnect base delay to about 1 to 5 s with jitter.
7. Add a `bufferedAmount` guard in `LocalHub.deliver` and an inbound message rate limit per socket.
8. Make lock release a Lua compare-and-delete, and add TTL renewal for long passes.

**Defer until there is real load (above about 500 queued per mode, or 2 or more API instances):**
- Rewrite the matchmaker to O(N·k) (bottleneck 2). Worth doing before any marketing push, but not needed for the first hundreds of players.
- A separate allocation loop with concurrency, taking agent HTTP out of `match_tick`.
- Tournament provision outside the row lock, and a bracket audience (contract change). Do it before the first weekly 64-entrant cup.
- Per-instance or per-user pub/sub channels. Not needed below about 10 instances.
- PgBouncer, once there are more than about 8 instances or more than about 80 connections.
- Chunk and sort `rollbackCheater`, and cache leaderboard totals and profile ranks.
- Move the matchmaker out of the API into a single worker process, once the API runs 3 or more instances. CLAUDE.md already says "in the API process for now".

## 10. What to measure

Add Prometheus-style metrics (or pino timings to begin with) so you know when the deferred items are due:

| metric | why | act when |
|---|---|---|
| `matchmaker_pass_ms{mode}`, `matchmaker_tickets{mode}`, `matchmaker_proposals`, `claim_lost_total` | algorithm cost and cross-instance contention | p95 above 200 ms, or claim_lost above 0 with 1 instance |
| `loop_duration_ms{loop}` compared with the lock TTL | lock expiry means double runners | any pass above 50% of its TTL |
| `queue_status_refresh_ms`, `queue_status_refresh_parties` | bottleneck 1 | above 1 s |
| Node event loop delay (`perf_hooks.monitorEventLoopDelay`) p99 | synchronous CPU stalls | above 100 ms |
| `ws_connections`, `ws_messages_sent_total{type}`, `ws_bytes_sent_total`, `ws_max_buffered_amount`, `ws_terminated_slow_total` | fan-out and back-pressure | buffered amount above 1 MB |
| `ws_snapshot_ms`, connects per second | reconnect storms | snapshot p95 above 1 s |
| pg pool wait time and queue length, slow query log (`log_min_duration_statement = 100ms`) | pool starvation, missing indexes | pool wait p95 above 20 ms |
| `queue_wait_seconds{mode}` histogram (enqueue to matched) | player-facing outcome | p50 above 60 s |
| `deadline_lateness_ms{kind=accept|veto}` (now minus the deadline when processed) | timer health | above 2 s |
| `allocating_matches`, `allocation_wait_seconds`, `slots_free`, `surge_active` | server capacity, the real first ceiling | allocation wait p95 above `SURGE_WAIT_SEC`, or slots free at 0 |
| `redis_publish_per_sec` on `rs:ws` | pub/sub volume | above 5k per second |
