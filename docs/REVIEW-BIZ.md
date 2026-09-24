# Business viability review (adversarial)

Reviewer: red-biz. Date: 23 September 2026, one day after Valve shipped Rush.
Scope: the business case for rushsite as described in `CLAUDE.md`, `docs/RUSH-RESEARCH.md` and `docs/SCALABILITY.md`, and as the web app presents it ("Short matches. Real ladder. 1v1 Aim, 2v2 Aim and 3v3 Rush. Rated ladders and free cups."). No code was changed.

This document argues against the project on purpose. Where it is wrong, the "what would have to be true" lines say what evidence would prove it wrong.

Severity scale: **Critical** (kills the project on its own), **High** (kills it in combination, or caps it at hobby scale), **Medium** (costly but survivable), **Low**.

## Summary

- The product is sound engineering pointed at a market with no gap it clearly fills. Valve gives Rush away with instant queues and VAC. FACEIT has 1v1 and 2v2 hubs, kernel anti-cheat and around 37,000 concurrent players on average. Free multi-1v1 community servers cover casual aim duels.
- **Liquidity is the binding constraint, not servers or code.** A queue simulation using the real matchmaker rules says acceptable waits (median under 1 minute, 90th percentile under about 3 minutes) need roughly **24 players queued or playing in 1v1, 50 to 90 in 2v2 and 100 to 200 in Rush, at the same time**. That is about 200 to 300 at peak, which implies roughly 2,000 daily and 5,000 to 10,000 monthly active players. A launch with 50 players online gives Rush a median wait near 5 minutes and a 90th percentile near 25 minutes.
- Servers are cheap. A Hetzner AX102 serves a Rush player for well under 1 cent at reasonable load. DatHost costs about 2 to 4 cents per player per match. Hosting is not what breaks the business.
- **The revenue model has no product yet.** Nothing in the launch scope is worth a subscription, and a store that sells for earned-only credits has no margin. It is a cost centre.
- The deferred wager and real-value reward plan is the only real differentiator from Valve and FACEIT. It is also where the legal risk sits: head-to-head stakes of "money's worth", minors, and Rush's random room draw adding chance.
- **Recommended strategy:** a Rush-first, event-driven community (one queue, fixed prime-time windows, nightly trio cups, Discord), with clear kill criteria and a planned fallback to tools for existing hubs. Details in section 11.

## 1. Market

### Who plays third-party CS2 in 2026

| Fact | Number | Source |
|---|---|---|
| CS2 monthly active players | about 25 to 30 million (third-party estimates) | [critfeed](https://critfeed.com/how-many-people-play-cs2/), [skinrave](https://skinrave.gg/en/blog/cs2-player-count-how-many-people-are-playing-in-2026) |
| CS2 average concurrent players, last 30 days | about 809,000 | same |
| FACEIT competitive matches in 2025 | 49.33 million, so about 135,000 a day | [FACEIT CS2 on X](https://x.com/FACEITcs/status/2006047678677819568) |
| FACEIT average concurrent players, derived | about 37,500 (135k matches a day, 10 players, about 40 min each) | own calculation |
| FACEIT Premium price | $10.99 a month, or $7.99 a month billed yearly (regional pricing) | [shattered.io](https://shattered.io/cs2-premier-rank-vs-faceit-level/), [FACEIT support](https://support.faceit.com/hc/en-us/articles/360000760659-What-is-a-premium-subscription) |
| Refrag price | about $7 (Player) to $15 (Competitor) a month | [skin.land](https://skin.land/blog/cs2-refrag-guide/) |

So the dominant third-party platform, after ten years and with a Saudi-funded owner, holds about **5% of CS2 concurrency**. Everyone else fights over what is left.

### Consolidation and failures

- **ESEA** stopped running its own pugs. Its league moved onto FACEIT and players were told to use FACEIT matchmaking and hubs instead ([HLTV](https://www.hltv.org/news/36529/esea-league-moves-to-faceit), [FACEIT support](https://support.faceit.com/hc/en-us/articles/9717812924956-Where-can-I-play-in-the-meantime)). The second-biggest Western platform was absorbed, not beaten.
- **Esportal**, a funded Swedish matchmaking platform with a real user base, filed for bankruptcy on 24 July 2024 because it "could not find the financing necessary to continue operations" ([Dust2.us](https://www.dust2.us/news/50937/esportal-announces-bankruptcy-filing)).
- **ESL FACEIT Group** itself has laid off staff in February 2024, early 2025 and October 2025 (about 80 to 90 people) while under pressure to reach profitability in 2026 ([esports.gg](https://esports.gg/news/gaming/esl-faceit-group-layoff-nearly-100-employees-citing-strategic-realignment/), [esports-news.co.uk](https://esports-news.co.uk/2025/10/15/esl-faceit-group-efg-2025-layoffs/)). Even the market leader finds this business thin.
- **PvPRO**, the explicit inspiration, ran from 2014 out of Cyprus with a store of real items. Its Trustpilot reviews stop in February 2023 and score 1.8/5. Repeated complaints are queue waits ("you have to wait like 10 hours for one game"), store items always "Unavailable", and false cheating bans. pvpro.com shows only "We are currently running maintenance" today ([Trustpilot](https://www.trustpilot.com/review/pvpro.com), pvpro.com fetched 23 Sep 2026). No public post-mortem was found, so the cause is **inferred**: liquidity, reward cost and fair-play trust are the three things reviewers complained about, and all three are in this brief. It also did not survive the move from CS:GO to CS2. Beware lookalike domains (pvpro.us.org, pvpro.uk, pvpro.org) that rank for the name. They look like SEO or scam sites, not the original.
- **PopFlash** and **Challengermode** survive. PopFlash is a small pug site. Challengermode sells tournament and matchmaking tooling to organisers and publishers (PGL Major, KRAFTON, Ubisoft) ([Challengermode](https://www.challengermode.com/)). That B2B path is how survivors make money.

### Direct substitutes, mode by mode

| Our mode | Free or existing substitute | What they have that we lack |
|---|---|---|
| 1v1 Aim | Multi-1v1 community servers ([csdb.gg live list](https://csdb.gg/server-browser/1v1/), [CS2-Multi-1v1 plugin](https://github.com/rockCityMath/CS2-Multi-1v1)), Refrag Duels ([wiki](https://wiki.refrag.gg/en/duels)), FACEIT 1v1 hubs | Zero queue. Many opponents per session on one server. Training tools. |
| 2v2 Aim | Valve Wingman (ranked, about 1 million players in Leetify's August 2026 sample, [Leetify](https://leetify.com/data-library/counter-strike/wingman-rank-distribution)), FACEIT 2v2 and Wingman hubs ([example hub](https://www.faceit.com/en/hub/44901c28-d1cd-4835-a1ed-91eff00eee27/2v2%20Wingman)) | Real maps, instant queues, VAC or kernel anti-cheat |
| 3v3 Rush | Valve's own queued Rush with a friends leaderboard ([Valve](https://steamcommunity.com/games/CSGO/announcements/detail/711161056325533827)). Valve also shipped a "Community Rush" string, so community Rush servers are expected (`RUSH-RESEARCH.md` S3f) | Instant queue, no website step, VAC Live |

FACEIT hubs support "5v5, 2v2, 1v1, Wingman and Hostage" game modes ([eloking](https://eloking.com/blog/how-to-create-a-cs2-hub-in-faceit)). Anyone can already run a ranked 1v1 aim ladder on FACEIT with kernel anti-cheat, for free.

## 2. Value proposition

Why would a player queue here instead of on Valve, FACEIT or Refrag?

| Claimed reason | Assessment |
|---|---|
| Short matches | Valve Rush and Wingman are also short. Not unique. |
| Per-mode rated ladder, visible from match one | Real, but only valuable if the ladder is populated. An empty leaderboard is worse than none. |
| Free daily and weekly cups | The strongest reason. Valve runs no cups. FACEIT hubs and Challengermode do. It only works with enough Verified entrants. |
| Parties and Bo3-style veto | Veto is disabled for Rush, the headline mode, because the room draw cannot be controlled (`RUSH-RESEARCH.md` section 4). For aim maps a veto is a minor feature. |
| Fair play with held rewards | See below |
| Credits, wagers, store | Deferred. At launch there is nothing to win. |

**"Fair play with held rewards" is a reason not to bother at launch.** Holds only matter when there is something to hold, and there is not. Fair play is a claim every platform makes, and ours is the weakest version: no client anti-cheat, no working demo heuristics for Rush, and an overwatch that needs Trusted reviewers, which takes 150 completed matches and a 365-day-old Steam account (`apps/api/src/env.ts` lines 71 to 73). FACEIT advertises kernel anti-cheat plus AI input detection. Once wagers exist, holds become a real selling point against sketchy wager sites. They are a feature of phase two, not a reason to join phase one.

What would have to be true for the value proposition to work: there is a group of players who want **competitive, rated Rush with cups among trios** and who find Valve's queue lacking (no global ladder, no events, randoms). That is plausible for about 2 to 6 weeks of novelty, and then it has to be proven with retention data.

## 3. Rush as the headline mode

**Severity: High.**

Evidence:
- The mode shipped on 22 September 2026, one day before this review. Nothing is known about its retention. Press reaction is "split" ([ghacks](https://www.ghacks.net/2026/09/23/cs2-update-overhauls-premier-map-picks-and-adds-a-3v3-rush-game-mode/), [pcgamesn](https://www.pcgamesn.com/counter-strike-2/update-rush-chicken-egg)).
- Valve already offers it with free matchmaking, a friends leaderboard and VAC. We compete with the mode's own publisher on the mode's own terms, with a slower path (website, accept, allocate, connect).
- Valve changes and drops modes. Danger Zone did not make it into CS2. Game rules live in one map script (`rush_001.js`) that Valve can change in any patch. Our plugin must not fight five convars that the script sets at runtime.
- On community servers Rush is still **inferred**, not proven (`RUSH-RESEARCH.md` section 2). CounterStrikeSharp is broken on the current build. demoparser2 may not parse `rush_001` demos. The room draw is random and cannot be vetoed.
- A random room draw is a chance element in a head-to-head match. That matters for how wagers would be classified (section 6).

What would have to be true for it not to matter: Rush keeps a stable player base for months, Valve does not add a global Rush ladder or rating, the community-server path works, and our Rush product adds something Valve's does not (cups, team identity, a global ladder). Also the 1v1 aim ladder must stand on its own if Rush fades, so the brand must not be "the Rush site".

## 4. Cold start

**Severity: Critical.**

### Method

A simulation (`mmsim.py` in the session scratchpad, not in the repo) follows `apps/api/src/modules/queue/matchmaker.ts` closely:
- the widen schedule from `packages/shared/src/config/queue.ts`: gap 100, then 200 at 30 s, 350 at 60 s, 500 at 120 s, 800 at 180 s, and any gap at 300 s
- team-mean windows, with candidates up to twice the window, 9 candidates per anchor
- party buckets: mix after 0, 60 and 90 s
- trust floors that never widen
- a 2 s tick
- declines that keep the other players' queue time, as `requeue` does

Other assumptions:
- ratings are normal with mean 1500 and standard deviation 250 (a mature ladder)
- ticket mixes: 2v2 is 60% solo and 40% duo; Rush is 45% solo, 25% duo and 30% trio
- 50% of players are Verified and 20% of those set a Verified floor
- 5% of players decline an accept prompt
- server time per match (play plus overhead): 11 min for 1v1, 13 for 2v2, 24 for Rush
- "U" is the number of players cycling in that mode at once (queued, accepting or playing), and arrivals follow Little's law

These are estimates. Real players also give up after a few minutes, which makes thin queues worse than shown.

### Results: waits in seconds

| Mode | U (players in the loop) | Median wait | p90 wait | Share of matches that reached "any gap" |
|---|---|---|---|---|
| 1v1 | 6 | 54 | 228 | 8% |
| 1v1 | 12 | 30 | 154 | 2% |
| 1v1 | 24 | 18 | 118 | 0% |
| 1v1 | 48 | 14 | 66 | 0% |
| 2v2 | 6 | 126 | 994 | 31% |
| 2v2 | 12 | 96 | 420 | 21% |
| 2v2 | 24 | 60 | 258 | 6% |
| 2v2 | 48 | 60 | 156 | 2% |
| 2v2 | 96 | 30 | 102 | 0% |
| Rush | 6 | 384 | 2,280 | 50% |
| Rush | 12 | 274 | 1,504 | 48% |
| Rush | 24 | 170 | 796 | 34% |
| Rush | 48 | 102 | 410 | 15% |
| Rush | 96 | 54 | 250 | 5% |
| Rush | 200 | 34 | 162 | 3% |

Best case (no trust floors, no declines): Rush reaches p90 184 s at U = 96 and 110 s at U = 200. With a heavier trust split (30% Verified, 40% of them with a floor), Rush at U = 96 gets p90 272 s and 9% "any gap" matches.

### Minimum viable concurrency

For a median under 60 s and a p90 under about 3 minutes, a mode needs about:

| Mode | Players in the loop at peak |
|---|---|
| 1v1 | about 24 |
| 2v2 | about 50 to 90 |
| Rush | about 100 to 200 |
| **All three** | **about 200 to 300** |

Rush is the hardest because six players, three party sizes, the 90 s bucket rule and trust floors all multiply. The mode we lead with is the mode that needs the most people.

A typical peak-concurrent to daily-active ratio for online games is about 0.1 to 0.15. So 250 at peak means about 1,700 to 2,500 players a day and roughly 5,000 to 10,000 a month. That is about 0.03% of CS2's monthly players, and about 0.7% of FACEIT's average concurrency.

### Launch with 50 players

Say 50 are online at the EU evening peak and 30 of them are queued or playing, split about 9 in 1v1, 6 in 2v2 and 15 in Rush:

- **1v1:** median about 45 s, p90 about 3 to 4 minutes. Acceptable.
- **2v2:** median about 2 minutes, p90 about 15 minutes, and a third of matches at any rating gap. Broken.
- **Rush:** median about 4 to 5 minutes, p90 about 20 to 25 minutes, and half the matches at any rating gap, so ratings mean little. Broken. A lone trio waits at least 90 s by design and often much longer.
- **Cups:** they need Verified (5 clean matches first). All three daily cups start at 18:00 UTC, split 50 players across three brackets, and a no-show forfeits. Expect 4 to 8 entrants per cup, byes everywhere, and a bracket page that looks dead.
- **Leaderboards:** a player needs 20 matches to place. For most players in the first weeks, the leaderboard will show only a handful of names.

That is the PvPRO failure mode ("wait 10 hours for one game"), and it happens in the first week. The acquisition and retention cost of each lost player is highest at exactly this moment.

What would have to be true for it not to matter: launch with **one queue** (Rush or 1v1, not three), open it only in fixed prime-time windows so everyone is online together, and use direct challenges (the `/challenge` feature already exists) and scheduled cups, which need no liquidity. Or arrive with a community of several hundred players already committed, through a creator or an existing Discord.

## 5. Unit economics

### Hosting cost per match

Inputs:
- DatHost: €0.33 per running hour ([DatHost for platforms](https://dathost.com/for-platforms)). Billing granularity is not published. Per-minute billing is assumed, plus 2 minutes of boot time.
- Hetzner AX102: €122.30 a month ([looking.house](https://looking.house/companies/hetzner-com/dedicated-servers/ax102)). Hetzner repriced dedicated servers in 2026 ([Hetzner docs](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)), so recheck before ordering.
- 16 slots per box by default. The box costs €0.168 an hour, so a slot costs €0.0105 an hour at full use.

| Mode | Slot time | DatHost per match | DatHost per player | Hetzner per match at 100% use | Hetzner at 10% use | DatHost if billed per started hour |
|---|---|---|---|---|---|---|
| 1v1 | 11 min | €0.072 | €0.036 | €0.0019 | €0.019 | €0.33 |
| 2v2 | 13 min | €0.083 | €0.021 | €0.0023 | €0.023 | €0.33 |
| Rush | 24 min | €0.143 | €0.024 | €0.0042 | €0.042 | €0.33 |

- A Hetzner box beats DatHost once it averages **0.51 busy servers**, which is 371 server-hours a month. At full use, one box does the work of €3,854 of DatHost, about 31 times cheaper.
- One box at full use supports about 29,000 Rush matches a month (175,000 player-matches) or 64,000 1v1 matches.
- At the healthy-queue level from section 4 (about 250 players in the loop at peak), there are about 40 matches running at peak: roughly 9 in 1v1, 11 in 2v2 and 21 in Rush. That is **3 boxes, or 1 box plus about 25 DatHost servers for about 3 hours a night**. The surge option costs about €740 a month. Two more boxes cost €245. Plan for boxes, not surge.
- Hosting is not the risk. Even DatHost-only costs about 2 to 4 cents per player per match.

### Fixed monthly costs (cash, excluding the developer's time)

| Item | € a month |
|---|---|
| AX102 | 122 |
| Object storage for demos (about 40 GB a day at 1,000 matches a day, 14-day retention, so about 0.6 TB) | 6 to 15 |
| Backups (Storage Box or a second small server, since Postgres shares the game box) | 5 to 40 |
| Domain, mail, status page | 5 |
| AI tooling for a one-person team | about 100 to 200 |
| **Total** | **about €250 to €400** |

One-off: company setup, terms of service and privacy policy, and a gambling-law opinion before any credits or wagers go live (**estimate** €2,000 to €10,000).

### Revenue

- **Subscription.** Take €4.99 a month including VAT (below FACEIT Premium). After about 21% VAT that is €4.12. After a merchant-of-record fee (about 5% plus €0.46) that is **about €3.46 net**.
- **Store margin.** The brief says "subscription plus store margin, no rake", and credits are earned only, with no paid credits. **A store that sells for earned credits has no margin.** Every reward redeemed is a cash cost to us. The store is funded by subscriptions, as PvPRO's was, and its "Unavailable item" reviews suggest how that ended. Margin only exists if players pay money for store items, which reopens the paid-credit question the brief deliberately closed.
- **What would a subscriber pay for?** At launch, nothing is gated.
  - Priority queue hurts everyone else in a thin queue.
  - Deeper stats and demo review are good, but demoparser2 does not parse Rush yet.
  - Cosmetic profile flair has low willingness to pay without an audience.
  - Credit multipliers turn a subscription into consideration for real-value prizes (see section 6).
  - The honest answer today: **supporting the site**, which converts at well under 1%.

### Break-even

| Target | Subscribers needed | Monthly players at 5% conversion | Monthly players at 2% conversion |
|---|---|---|---|
| Cash costs only (€350 a month) | about 100 | about 2,000 | about 5,000 |
| Cash costs plus one modest salary (about €5,500 a month employer cost) | about 1,700 | about 34,000 | about 85,000 |

A 2 to 5% conversion rate is a generous freemium assumption for a product whose paid tier is not defined yet. Covering cash costs lands at about the same player count the queues need anyway (section 4). **Paying a salary needs a platform ten times bigger than Esportal-scale failures suggest is easy.** Reward costs, once the store exists, come on top.

What would have to be true: a paid feature that players demonstrably want and that does not hurt free players' queues, such as team and trio ladders with seasons, private cups for Discord communities, or stats and replays. Or a B2B customer (section 11, strategy C).

## 6. Legal and platform risk

| Risk | Severity | Evidence | What would have to be true for it not to matter |
|---|---|---|---|
| Valve's stance on third-party matchmaking | Low | FACEIT, ESEA, PopFlash and Challengermode have run on community servers with GSLTs for a decade. Valve even shipped "Community Rush". | Stay inside the server guidelines. |
| GSLT account ban | Medium | Valve bans the GSLT owner for servers that grant items players do not own, or fake ranks. The penalty can block the account from making tokens, block the phone number and add a game ban ([Steam Support](https://help.steampowered.com/en/faqs/view/07AF-502E-A104-BD4B), [DatHost](https://dathost.net/blog/all-you-need-to-know-about-valves-plugin-policies)). One dedicated account holds every token, so one ruling takes the whole fleet offline. | Never ship `!ws` or knife plugins. Keep a second prepared token account. Never tie any credit or store item to in-game skins. |
| Steam Web API terms | Medium | 100,000 calls a day. Valve "may ... suspend or terminate your use ... at any time for any reason, without notice" ([Steam API terms](https://steamcommunity.com/dev/apiterms)). Sign-in, bans, playtime and friends all depend on it. Budget: a few calls per active user a day is fine up to about 20,000 daily users. | Cache aggressively. Do nothing that looks like gambling. |
| Skin economy and gambling scrutiny | High (once credits exist) | Valve banned skin-gambling sponsors from ranked events from December 2025 ([esports-news.co.uk](https://esports-news.co.uk/2025/12/11/valve-ban-skin-gambling-case-sites-for-cs2-tournaments/)). The New York Attorney General sued Valve over loot boxes in February 2026 ([CSGuess](https://csguess.com/blog/cs2-skin-gambling-sponsorship-ban-explained)). The brief already rules out skin deposits. | Keep rewards unrelated to Steam items. |
| Wagers of credits redeemable for real-value rewards | High | The UK Gambling Commission treats in-game currency that can be exchanged "for items of value" as "money or money's worth", read "very broadly". It also warns that organisers of head-to-head match-ups risk being "betting intermediaries" ([Osborne Clarke](https://www.osborneclarke.com/insights/virtual-currencies-esports-and-social-gaming-some-guidance-and-questions-from-the-uk-gambling-commission), [Esports News UK](https://esports-news.co.uk/2017/03/15/will-esports-tournaments-need-gambling-licence-plus-7-key-points-gambling-commission-report/)). A 1v1 wager on earned credits that buy real rewards fits that description. Rush's random room draw adds a chance element. A subscription that affects credit earning adds consideration. Germany, the Netherlands and others are stricter. | A written legal opinion per launch country. Credits with no cash-out and no real-value redemption, or wagers limited to cosmetics. 18+ age checks. Or a licence. |
| GDPR | Medium | We process SteamID64, IP addresses (win-trade detection), FACEIT lookups by Steam ID (third-party data), trust scores and ban decisions (profiling with significant effect), and demos. CS2 GOTV demos can carry voice chat (likely by default, **unverified** for our configuration). | A privacy notice, a retention schedule (the brief already deletes clean demos), voice stripped or disabled, a legitimate-interest assessment for the trust score, a route for access and erasure requests, and a data processing agreement with Hetzner. Manageable for one developer, but it is real work. |
| EU Digital Services Act | Low to medium | Hosting services must give a statement of reasons for restrictions such as bans. | Ban notices with reasons, plus an appeal path. The admin tools mostly cover this. |
| Age of players | High (once rewards exist) | CS2 carries USK 16 in Germany and no PEGI entry ([CSDB](https://csdb.gg/blog/insights/age-rating-for-counter-strike/)). A large share of players are teenagers, and Steam exposes no age. Real-value rewards and wagers for minors are a regulatory and reputational problem, and GDPR consent age for children is 13 to 16 depending on the member state. | An age gate plus identity checks before any real-value reward, as the "Trusted plus weekly caps" rule half anticipates. |
| FACEIT API dependency | Medium | FACEIT moved demo downloads to paid access with days of notice. For Leetify the quoted price was €270,000 a year, double its infrastructure costs ([Leetify](https://leetify.com/blog/faceit-changes/)). Our trust score uses the FACEIT Data API. | The FACEIT check is optional in the trust score (no account already counts as neutral). Confirm the API terms allow this use (listed as an open item in the brief). |

## 7. Operational risk

| Risk | Severity | Evidence | What would have to be true for it not to matter |
|---|---|---|---|
| One developer plus AI agents, no on-call | High | EU peak is 18:00 to 23:00 CET. Valve patches arrive with no warning, and each forces a SteamCMD update. Today's update broke CounterStrikeSharp (`Teleport` crashes, `ChangeTeam` does nothing), and the fix depends on a volunteer maintainer. Without the plugin there is no whitelist, no results and no ladder. | Automated update drain (already in the brief). A pinned, self-built CounterStrikeSharp. A status page. An announced "maintenance after patch" norm. Accepting some dead evenings. |
| Single box runs Postgres, Redis, the API, the web app and CS2 | Medium | One kernel panic, disk failure or runaway CS2 process takes down the whole platform. Backups are not yet in the plan. | Nightly off-box Postgres backups, tested restores, and moving the database off the game box when a second box arrives. |
| Anti-cheat without a client | High | 1v1 aim duels are the most cheat-attractive format there is (a triggerbot wins outright). Rush's small rooms reward wallhacks. FACEIT runs kernel anti-cheat and has added AI input detection. AI and DMA cheats are reported as a large and growing share of bans in 2026 ([CSWatch](https://cswatch.gg/blog/faceit-anticheat-vs-vac), [FACEIT HID FAQ](https://support.faceit.com/hc/en-us/articles/28929483475612-Human-Input-Detection-FAQ)). Our heuristics come after tournaments, and demoparser2 may not read Rush demos. PvPRO drew both "full of cheaters" and "false ban" reviews. | Verified-only queues as the default for rated play. Fast rollback, which the brief has. An honest "this is not FACEIT" position. The FACEIT-ban and VAC signals do much of the work early on. |
| Community overwatch needs a community | High | Reviewers must be Trusted: 150 matches and a 365-day-old account. Each case needs 5 reviews at about 15 minutes each, so about 75 reviewer-minutes per case. At 1,000 matches a day with 2% flagged that is 20 cases, or about 25 reviewer-hours **a day**, which needs about 50 committed reviewers. At launch the pool is zero for weeks, so all review falls on the developer. | Admin review first, with a lower Trusted bar for reviewers during the beta. Flag only high-confidence cases. Consider paying reviewers in badges or subscription time. |
| Tournaments at 18:00 UTC compete with the ladder for slots | Medium | `SCALABILITY.md` section 5: 64 weekly-cup matches against 16 slots per box. | Stagger start times, and reserve DatHost surge for cups only. |

## 8. Go-to-market

**Severity: High.**

How would players hear of it?
- **Reddit** (r/GlobalOffensive, r/cs2): strict self-promotion rules. One launch post might work; a platform needs a steady stream.
- **Creators**: the working channel for CS platforms, but paid, and skin and gambling sites outbid everyone.
- **Steam groups and HLTV forums**: small.
- **Discord communities running Rush trios**: they do not exist yet. Being first to build the Rush Discord is the one opening.
- **SEO** for "CS2 Rush tournament" or "Rush ladder": free while the term is new, and gone once Valve, FACEIT or Leetify rank for it.

A 50-player launch without a channel looks like section 4: 1v1 works, 2v2 and Rush time out, cups have byes, and every friend a player invites meets an empty queue. The **Rush novelty window is probably 2 to 6 weeks** (an **estimate**, based on how new modes usually go). That clashes with the build order: the Rush end-to-end proof is not done, CounterStrikeSharp is broken, and demo parsing is unknown.

What would have to be true: a creator or an existing community commits a few hundred players to one launch night. Queues open only at announced times. Friends-first features (trio invites, challenge links) go ahead of stranger matchmaking.

## 9. Other risks noted

- **The name is DuelRush** (duelrush.site). Do a trademark check before ordering creator assets. (Low)
- **Ratings at launch.** Everyone starts at 1500 with a high RD and there is no placement phase. Early leaderboards reward grinding and smurfs. Buying a fresh Steam account is cheap, and the trust gate is the only defence. (Medium)
- **No seasons.** Ratings freeze in place and the top of the board goes stale, which removes a re-engagement lever FACEIT and Valve both use. (Low)

## 10. Ranked top ten

| Rank | Risk | Severity |
|---|---|---|
| 1 | **Liquidity.** Three modes, party buckets and trust floors need about 200 to 300 players at peak. A 50-player launch gives 20-minute Rush waits and meaningless ratings. | Critical |
| 2 | **No reason to switch.** Valve gives away Rush and Wingman with instant queues. FACEIT has 1v1 and 2v2 hubs with kernel anti-cheat. Free multi-1v1 servers exist. Held rewards mean nothing while there are no rewards. | Critical |
| 3 | **No revenue product.** Nothing is worth subscribing to, and a store for earned-only credits is a cost with no margin. Covering cash costs needs about 100 subscribers; a salary needs about 1,700 (34,000 to 85,000 monthly players). | High |
| 4 | **Rush dependence.** A two-day-old Valve mode that Valve also runs, can change in any patch, and that is still unproven on community servers. The veto is blocked, and demo parsing may not work. | High |
| 5 | **Anti-cheat gap.** Server-side only, in the two formats cheats help most. No reviewer pool for weeks. FACEIT sets the bar. | High |
| 6 | **Go-to-market.** No channel, no budget, and a 2 to 6 week novelty window that the build order may miss. | High |
| 7 | **Legal exposure of wagers and real-value rewards.** "Money's worth", head-to-head betting intermediary, a chance element in Rush, minors. It is the only differentiator and the most regulated part. | High, latent |
| 8 | **Solo operator.** Valve patches and CounterStrikeSharp breakage take the platform down during EU prime time, with no on-call. Everything runs on one box. | High |
| 9 | **Platform dependency.** A GSLT account ban hits every server at once. The Steam API can be terminated without notice. FACEIT API terms and pricing can change (the Leetify precedent). | Medium |
| 10 | **GDPR, DSA and age.** Demos with voice, profiling for trust and bans, FACEIT lookups, teenage players. | Medium |

## 11. Strategies

### A. Rush-first community with cups (recommended, with kill criteria)

Launch **only 3v3 Rush** plus direct 1v1 challenges between friends (no 1v1 queue). Open the queue in fixed EU windows, for example 19:00 to 23:00 CET. Run a nightly trio cup and a weekly team cup. Make the Discord the product's home. Pitch it as "the competitive home of Rush: global ladder, trio teams, cups", which is what Valve's friends leaderboard does not offer. Add 1v1 and 2v2 queues only once Rush holds 100 or more players in the loop at peak.

- **For:** it concentrates all liquidity into one queue and one time window. Trios bring their friends, so invites grow the base. Cups create scheduled liquidity. It uses the novelty window while no one else has built a Rush community. Hosting is about €122 a month.
- **Against:** it doubles down on Rush dependence (risk 4). It must beat Valve's own queue on experience. The Rush pipeline is still unproven (CounterStrikeSharp, demos). Revenue is still undefined.
- **Kill criteria:** by week 6, fewer than 60 players in the loop at the weekly peak, or less than 20% of week-one players returning in week four. Then move to C.

### B. Niche 1v1 aim ladder with wagers (the PvPRO path)

Only 1v1 aim. It needs the least liquidity (about 24 in the loop), the cheapest servers (under 4 cents per player even on DatHost), and a clear gap: Valve has no ranked 1v1. Wagers on earned credits are the differentiator.

- **For:** lowest cold-start threshold. It works with the first 50 players. Easy to explain.
- **Against:** the most cheat-attractive format, with server-side anti-cheat only. Free multi-1v1 servers and FACEIT 1v1 hubs compete for the casual end. The value only arrives with wagers and rewards, which means the legal work (section 6) comes first. It is the same model PvPRO ran for eight years before it went quiet.

### C. Tools for FACEIT hubs and community organisers

Keep the engineering (allocator, match plugin, Glicko ladders, brackets, trust checks) and sell it or give it away to people who already have players: Discord communities, FACEIT hub owners, creators and small leagues. For example "run a Rush or aim cup for your Discord tonight", white-label ladders, or a trust and ban-lookup API.

- **For:** it borrows liquidity instead of creating it. Revenue per customer is higher (a B2B subscription). It is how Challengermode survived.
- **Against:** FACEIT hubs may never support Rush game settings, and FACEIT can change API access or pricing (Leetify). Challengermode and PopFlash already sell organiser tooling. It is a small market. It is a different business, with sales, not a player platform.

### Pick

**A, with C as the planned fallback.** Rush is the only moment when a solo builder is not behind FACEIT, and a single-queue, prime-time, cup-driven launch is the only shape that survives the section 4 numbers. Before building more, prove Rush on a community server this week. Cut 2v2 from launch. Replace "three always-on queues" with scheduled queue windows. Decide on the paid tier before building the credits store. Get a legal opinion before any real-value reward exists.

## Sources

- Valve Rush announcement: https://steamcommunity.com/games/CSGO/announcements/detail/711161056325533827
- Rush press: https://www.ghacks.net/2026/09/23/cs2-update-overhauls-premier-map-picks-and-adds-a-3v3-rush-game-mode/ , https://www.pcgamesn.com/counter-strike-2/update-rush-chicken-egg
- CS2 population: https://critfeed.com/how-many-people-play-cs2/ , https://skinrave.gg/en/blog/cs2-player-count-how-many-people-are-playing-in-2026
- FACEIT 2025 matches: https://x.com/FACEITcs/status/2006047678677819568
- FACEIT Premium pricing: https://shattered.io/cs2-premier-rank-vs-faceit-level/ , https://support.faceit.com/hc/en-us/articles/360000760659-What-is-a-premium-subscription
- FACEIT hubs: https://eloking.com/blog/how-to-create-a-cs2-hub-in-faceit , https://www.faceit.com/en/hub/44901c28-d1cd-4835-a1ed-91eff00eee27/2v2%20Wingman
- FACEIT anti-cheat: https://cswatch.gg/blog/faceit-anticheat-vs-vac , https://support.faceit.com/hc/en-us/articles/28929483475612-Human-Input-Detection-FAQ
- FACEIT paid demos (Leetify): https://leetify.com/blog/faceit-changes/
- ESEA to FACEIT: https://www.hltv.org/news/36529/esea-league-moves-to-faceit , https://support.faceit.com/hc/en-us/articles/9717812924956-Where-can-I-play-in-the-meantime
- EFG layoffs: https://esports.gg/news/gaming/esl-faceit-group-layoff-nearly-100-employees-citing-strategic-realignment/ , https://esports-news.co.uk/2025/10/15/esl-faceit-group-efg-2025-layoffs/
- Esportal bankruptcy: https://www.dust2.us/news/50937/esportal-announces-bankruptcy-filing
- PvPRO reviews: https://www.trustpilot.com/review/pvpro.com
- Challengermode: https://www.challengermode.com/
- Refrag: https://skin.land/blog/cs2-refrag-guide/ , https://wiki.refrag.gg/en/duels
- 1v1 servers: https://csdb.gg/server-browser/1v1/ , https://github.com/rockCityMath/CS2-Multi-1v1
- Wingman distribution: https://leetify.com/data-library/counter-strike/wingman-rank-distribution
- DatHost pricing: https://dathost.com/for-platforms
- Hetzner AX102: https://looking.house/companies/hetzner-com/dedicated-servers/ax102 , https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- GSLT bans and plugin policy: https://help.steampowered.com/en/faqs/view/07AF-502E-A104-BD4B , https://dathost.net/blog/all-you-need-to-know-about-valves-plugin-policies
- Steam Web API terms: https://steamcommunity.com/dev/apiterms
- Valve skin gambling sponsorship ban: https://esports-news.co.uk/2025/12/11/valve-ban-skin-gambling-case-sites-for-cs2-tournaments/ , https://csguess.com/blog/cs2-skin-gambling-sponsorship-ban-explained
- UK Gambling Commission on virtual currencies and esports: https://www.osborneclarke.com/insights/virtual-currencies-esports-and-social-gaming-some-guidance-and-questions-from-the-uk-gambling-commission , https://esports-news.co.uk/2017/03/15/will-esports-tournaments-need-gambling-licence-plus-7-key-points-gambling-commission-report/
- CS2 age ratings: https://csdb.gg/blog/insights/age-rating-for-counter-strike/
