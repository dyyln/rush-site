# @rushsite/faceit

FACEIT Data API v4 client used by the trust calculation. It looks up a player by SteamID64 and returns a small `FaceitSignal`: whether they have an active FACEIT ban, their CS2 skill level and Elo, and how many CS2 matches they have played.

## Usage

```ts
import { createFaceitClient, isFaceitUnavailableError, signalToTrustDelta } from "@rushsite/faceit"

const faceit = createFaceitClient({ apiKey: process.env.FACEIT_API_KEY! })

try {
  const signal = await faceit.lookupBySteamId("76561198000000001")
  // null means no FACEIT account. That is neutral, not negative.
  const delta = signalToTrustDelta(signal)
} catch (err) {
  if (isFaceitUnavailableError(err)) {
    // Rate limited, 5xx, timeout, network or bad key. Treat FACEIT as unknown and retry later.
  } else {
    throw err
  }
}
```

The library never reads `process.env`. The API reads `FACEIT_API_KEY` and passes it in.

### Options

| Option | Default | Notes |
|---|---|---|
| `apiKey` | required | Server-side Data API key |
| `fetch` | `globalThis.fetch` | Inject a fake in tests |
| `baseUrl` | `https://open.faceit.com/data/v4` | |
| `cacheTtlMs` | 6 hours | In-memory, keyed by SteamID64. `0` disables it. Not-found results are cached, errors are not |
| `cacheMaxEntries` | 10000 | Oldest entry is evicted first |
| `timeoutMs` | 10000 | Per request |

### Calls made per uncached lookup

1. `GET /players?game=cs2&game_player_id=<steamId64>`. 404 returns `null`.
2. `GET /players/{player_id}/bans` and `GET /players/{player_id}/stats/cs2` in parallel. A 404 on either leaves that part empty.

A ban counts as active when it has started and `ends_at` is missing or in the future. Every active ban counts, whatever its type. Expired bans are counted in `pastBans`, and `lastBanEndedAt` holds the latest end date.

TODO: narrow `banned` and `pastBans` by ban `type` or `reason` (for example cheating only, not chat or AFK) once the FACEIT values are confirmed.

### Errors

Any 429, 5xx, 401/403, other unexpected status, network error, timeout or invalid JSON throws `FaceitUnavailableError` with a `reason` of `rate_limited`, `server_error`, `auth`, `bad_response`, `network` or `timeout`. On 429 `retryAfterSeconds` is set when FACEIT sends `Retry-After`. An invalid SteamID64 throws a plain `TypeError`.

### Trust contribution

`signalToTrustDelta(signal, opts?)` returns:

- `null` or no data: `0`
- active ban: `-100`
- no active ban but `pastBans > 0`: `-25`, and no history bonus
- no ban and 500+ CS2 matches: `+10`
- no ban and 100+ CS2 matches: `+5`
- otherwise: `0`

These defaults are placeholders. The api trust module owns the scale and passes `{ bannedDelta, pastBanDelta, experienceSteps }`.

## Getting a key

1. Sign in at https://developers.faceit.com with a FACEIT account.
2. Create an App, then create a **Server side** API key under it. Never ship it to the browser.
3. Put it in `FACEIT_API_KEY` in the env or secret store. Never commit it.

## API terms: verify before launch

CLAUDE.md says to check FACEIT's API terms before relying on this. Nothing here has been confirmed yet. Read the current Developer Terms and the Data API docs on developers.faceit.com and confirm each point below. Record the answers and the date checked in this README.

- [ ] **Permitted use.** Are third-party platforms allowed to use Data API results to gate access or score players on a competing matchmaking service? Some developer terms forbid using data in ways that compete with the provider or harm its users.
- [ ] **Ban data.** Is using a player's FACEIT ban status as a negative signal allowed, and are there rules on showing ban reasons to the player or to others? Our plan is to use it internally only and never display it publicly.
- [ ] **Commercial use.** Does the free tier allow a service with a paid subscription? Is a partnership or paid tier needed?
- [ ] **Rate limits.** Current limits per key, and whether the 6 hour cache plus a lookup at signup and on trust recalculation stays well inside them.
- [ ] **Caching and retention.** How long we may store FACEIT data. We keep the derived signal in `trust_signals`. Check whether a max age or deletion on request applies.
- [ ] **Attribution.** Whether we must credit FACEIT or link to it where the data affects the user, and any rules on using the FACEIT name or logo.
- [ ] **Personal data.** GDPR position for storing a FACEIT id and nickname linked to a Steam id. Add it to our privacy policy and data export and delete flows.
- [ ] **Key ownership.** Which account owns the app and key, and whether the terms require a named organisation contact.

If the terms do not allow this use, set the FACEIT weight to zero in the trust calculation and drop the lookup. Trust must still work from Steam signals and platform history alone.
