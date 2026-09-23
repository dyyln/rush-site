# Adversarial UX review (red-ux)

Reviewed 23 Sept 2026, 15:30 to 15:57 UTC (16:30 to 16:57 BST). Other agents were editing pages during the review, so each screenshot has its capture time next to it. All screenshots are in
`/tmp/claude-1000/-home-dylandhokia-dev-rush-site/41c55218-e65e-4ffd-8777-0fabd9d79896/scratchpad/red-ux/` (called `shots/` below).

Instances:
- **Mock** at http://localhost:3108. Signed in as `meridius`, admin, party of 2, trust level New. Also checked signed out by setting `rushsite-mock-signed-in=0`.
- **Live** at http://localhost:3107, real API on :3001, signed out only. Minting a session needs the API's `SESSION_SECRET`, and the permission layer refused access to the API process environment. Signed-in live flows were therefore checked against the code rather than in a browser. Nothing was written to Redis, so there is nothing to clean up.
- **Public** at https://rushsite.dyyln.dev, read only, signed out, at 375 px. It runs an older build (the header has no Sign in button on phones, and cup times show in UTC).

Method: a headless Chrome harness (`shots/audit.mjs`) loaded 22 routes at 1280 px and 375 px. It recorded landmarks, headings, unnamed controls, tap targets under 44 px, horizontal overflow, the computed contrast of every visible text style, and copy that looks like implementation detail. Scripted flows used `shots/queue2.mjs` (mode, queue, match found, veto, connect, result), `shots/kb.mjs` (tab order), `shots/menu.mjs` (phone header) and `shots/solo.mjs` (time to queue). Colour-blind checks used a deuteranopia simulation (`shots/cb-deut.png`).

Severity: **S1** blocks or misleads players in a core flow. **S2** causes real confusion or an accessibility failure. **S3** is polish or inconsistency.

---

## Measurements

### Time and clicks to the first queue (new player)
Path: home, **Play now**, **Sign in with Steam** (the page is empty apart from this button), Steam OpenID (at least 1 click if the browser is already signed in to Steam, otherwise username, password and Steam Guard), back on `/play`, scroll, **pick a mode**, **Start queue**.
- That is at least 5 clicks plus 1 to 2 scrolls. On the mock, excluding Steam, it took about 20 s. Home to an interactive Play page took 0.8 s (`shots/solo.mjs`). A realistic first visit, including reading and the Steam login, is 1 to 2 minutes.
- On **live** at 15:53 UTC the first queue could not happen at all. `/status` said "No modes can queue right now" and every mode said "No servers online" (`shots/live-1280-status.png`). The home page still says "Play now" and "Queue up and be the first" (`shots/live-1280-home.png`).
- At 375 px, **Start queue** sits at y=1307, which is 1.6 screens down, below 3 mode cards, the Rush error box, the Get Verified card, 5 stat tiles and the opponent filter (`shots/mock-375-play.png`, 15:31:59). At 1280x900 it sits at y=859, at the very bottom edge of the viewport.

### Clicks for core flows (mock, signed in)
| Flow | Clicks | Notes |
|---|---|---|
| Queue | 2 (mode, Start queue) | plus a scroll on phones |
| Accept | 1 | first focus lands on a tier chip link, not on Accept |
| Veto (aim, bo1-ban over 6 maps) | 1 per step your team owns (3 of 5) | |
| Connect | 1 (Copy connect or Launch CS2) | |
| Rematch after the result | 1 | only for the 20 s the result toast stays open |
| Invite a friend | 1 (Invite on the friends card) | |
| Challenge a friend | 2 (Challenge, Send challenge) | |
| Enter a cup | 3 (Tournaments, cup, Enter cup) | New players are blocked, and they find out only on the detail page |
| Leave a party | 1 | no confirmation |

### Contrast
Every text token passes 4.5:1 on every surface. The weakest pairs are accent `#9B8AC4` on accent-subtle (4.75) and disabled text `#8E9097` on accent-subtle (4.58). Full matrix: text 12.5 to 16.4, muted 5.6 to 7.3, win 7.8 to 10.3, loss 5.8 to 7.6, info 8.4 to 11.1, amber 8.5 to 11.2.
- Real failures: the disabled **Start queue** and **Enter cup** buttons use `#554C6C` on `#9B8AC4`, which is **2.59:1**. WCAG exempts disabled controls, but these still look like live primary buttons (see U-9).
- `--color-border-strong` `#433D55` is only 1.4 to 1.9:1 against surfaces. It is the only edge on outlined buttons (Copy, Server status, Jump to my rank) and on the mode checkboxes, which falls short of the 3:1 non-text contrast rule.
- The harness flagged "You", "Win", "Loss" and "Online" as failures. All of these are false positives: they are visually hidden or positioned-outside labels, not visible text on those backgrounds.

### Tap targets under 44 px (375 px)
- Match page round timeline segments: **23x44** on a Rush match and 36x44 on an aim match (`shots/mock-375-matches_…b2.png`).
- Leaderboard tier chips are links at 91 to 118 x 24, 50 per page.
- Friends: player name links are 24 px tall, and the **Watch** link is 41x24.
- Profile: the recent-match map and mode links are 30x18 and 32x18. The rating-range radios 7d, 30d, 90d and All have a 1x1 input; check that the label is the 44 px target.
- Tournament list: the cup title links are 29 px tall and the time chip is 20 to 22 px tall.
- Home: the Next cups title link is 130x24.

---

## Findings by flow

### Landing (home)
- **S2. Home promises play while no mode can queue (live).** `shots/live-1280-home.png` 15:52 UTC. A new player clicks Play now, signs in with Steam, and only then learns that nothing can queue. Fix: read `GET /status` on home. When no mode is available, replace "Play now" with "Queues are closed right now" plus a link to `/status`, and change the Watch live empty state so it no longer says "Queue up and be the first."
- **S2. The site banner contradicts the Play page.** The banner says "3v3 Rush is live. Queue up and tell us how the rooms feel." The Play page shows "3v3 Rush: Not configured" in a red box with Rush disabled (`shots/mock-1280-play.png` 15:31:59). Fix: announcements need a condition, or admins need a warning when an announcement names a mode that `/status` reports as unavailable.
- **S2. There is no "how it works" for a stranger.** The hero says "Short matches. Real ladder." and the only other content is cups and live scores. Nothing explains that you sign in with Steam, that the site hands you a server IP to join, that Rush is Valve's new mode, what Verified means, or that the service is free. Fix: add a three-step strip under the hero (Sign in with Steam, Pick a mode, Join the server we start for you) and one line per mode.
- **S3. Cup times use different zones on different pages.** Home shows "Wed 23 Sept, 17:31 UTC" while `/tournaments` shows "21:00 BST" (`shots/mock-1280-home.png`, `shots/live-1280-tournaments.png`). The contract says to use the viewer's zone. Fix: use `LocalTime` in `NextCups` too.
- **S3. (Mock only) Next cups shows "Entered" to a signed-out visitor and to a New player who cannot enter.** `components/home/data.ts:41` fabricates `myEntryId`. The cup page then says Enter cup is disabled because the player is New (`shots/mockout-1280-home.png` 15:51).
- **S3. The document title is the codename.** Pages are titled "rushsite", "Play | rushsite", and so on. The 404 page's title is just "rushsite". This matches the brand constant, but the codename is shipping to real tabs and to the public site. Fix: settle the brand before launch, and give the 404 page the title "Page not found".

### Sign in and first Play visit
- **S2. Signed-out `/play` is a dead end.** A single card says "Sign in to play. Sign in with Steam to queue." (`shots/mockout-375-play.png` 15:56:19). The modes, queue sizes, the cooldown rules and the trust ladder are all hidden until after sign-in, so a curious visitor learns nothing. `/login` redirects to the same card. Fix: render the Play page read-only (mode cards with live counts and ETAs, with Start queue replaced by Sign in with Steam).
- **S2. Mode cards do not say why a mode is disabled.** For a party of 2, AIM 1v1 is greyed out and one of its two person icons turns red. That red icon is the only visual reason, and "Party of 2 is too big for 1 vs 1" exists only as screen-reader text (`shots/crop-modes.png`). Rush shows a red triangle on the card and puts its reason in a separate error box below. Fix: print the reason on the card in muted text ("Party too big", "Not available, see status") and stop relying on the red icon.
- **S2. The two mode cards look the same.** Both are titled "AIM" in large type, and the only difference is small "1v1" and "2v2" text underneath. Fix: make "1v1 Aim", "2v2 Aim" and "3v3 Rush" the titles, add a short description ("First to 13 on aim maps"), and put the typical match length on each card.
- **S2. The primary action is buried** (see Measurements). Fix: move Start queue, the ETA and the opponent filter into a sticky bar directly under the mode cards. On phones, use a bottom sticky bar. Move Get Verified and Your stats below it.
- **S3. The Opponents filter (Any, Verified, Trusted) is unexplained jargon.** It appears next to the primary button for a player who cannot use two of its three options. The "Reach Verified to use this" hint is only in the accessible name. Fix: hide the filter for New players, or show "Verified and Trusted unlock after 5 clean matches" inline.
- **S3. (Mock) The stats are impossible for a New player.** The mock shows 485 matches next to "Completed matches 2/5" for Verified. This misleads anyone who judges the design from the mock. Make the mock user's counts consistent.

### Party
- **S2. Party invite toasts interrupt Match found and the veto.** "sunk invited you to their party" with a primary **Accept** button sits over the Match found dialog and then over the veto map grid (`shots/q1280-sheet.png` 15:37 to 15:38, `shots/f1280-sheet.png` 15:48). In the scripted run, a click meant for Accept on the match landed on the invite toast. Fix: while the player is in accept, veto or connect, hold party-invite and friend toasts in the header badge. Never show two different Accept buttons at the same time.
- **S3. Leave takes one click with no confirmation**, even when the party has members or is queued. The invite page does warn that joining another party "cancels its queue". Fix: ask for confirmation when the party has more than one member or has a queue ticket.
- **S3. The party header's icon row sits above the word "Party" and looks misaligned** (`shots/mock-1280-play.png`). Also, the initials avatar for "meridius" reads "ME", which looks like a "me" label. Fix: put the size icons inline after the title, and use a single initial or the Steam avatar.

### Queue, match found, veto, connect, result
- **S1. The result is a small toast with no outcome.** "2v2 Aim match finished · GOLD 1729 +17 · Rematch · Start queue" appears in the bottom corner, overlaps the Friends card and closes after 20 s (`shots/crop-result.png` 15:49:50, `app/play/PlayView.tsx:132`). It never says "You won 16–11". It has no link to the match page, where the MVP, kill feed, demo and report live. Win or loss is shown only by a green "+17", and the page then returns to mode selection. Fix: replace the connect card on Play with a persistent result card that stays until dismissed. It should show Won or Lost in words, the score, map, rating before and after with the tier change, and View match, Rematch and Queue again buttons. Keep the toast only when the player is on another page.
- **S1 (live). Cancellation and error toasts show raw codes.** `onCancelled` puts `c.reason` straight into the toast body (`PlayView.tsx:57`), and the API sends `declined`, `timeout`, `no_server`, `server_start_failed`, `server_crashed`, `never_started` and `mode_unavailable`. `onError` shows server strings such as "not configured yet: rush3v3", "queue cooldown until 2026-09-23T15:40:12.000Z" and "slow down" under the title "Something went wrong". The mock hides all of this because it sends the friendly "An opponent did not accept". Fix: add a `copy.ts` map from reason code to text, with what happens next ("Someone didn't accept. You're back in the queue."). Format cooldown ends as a countdown, and never render `e.message` from the API.
- **S2 (mock vs live). What happens after a cancelled accept differs.** Live requeues the players who accepted (`outcome.requeueTickets`). The mock drops you to idle, so you have to press Start queue again (`shots/q1280-sheet.png` 15:37:48). Neither tells the player which one happened. Fix: make the mock match live, and say "Back in queue" explicitly.
- **S2. The Match found dialog focuses the wrong element.** In both runs the first focus went to the **Platinum 1927 tier chip link**, not to Accept (`queue2.mjs` log, 15:42:08 and 15:48:06). A keyboard player who presses Enter goes to /ranks during a 20 s accept window. Fix: set `link={false}` on the TierChip inside the dialog and `autoFocus` on Accept.
- **S2. The veto map thumbnails show clipped names.** The labels read "ap", "edline", "g_texture2", "sp", "eagle7k" and "ndia" (`shots/crop-veto.png` 15:48:12). The card titles and ban buttons use raw ids ("Ban aim_ag_texture2"). The `displayName` for aim maps in `packages/shared/src/config/modes.ts` equals the id. Fix: give the maps real display names in config, and drop or fix the overlay label in `MapThumb`.
- **S2. "Connect now, awp_india. Join now or forfeit."** (`shots/crop-connect.png` 15:49:17). The copy is harsh, and it doesn't say how long the player has or what forfeiting costs. Fix: "Server ready on AWP India. Join within 3:00 or you forfeit and lose rating." with a visible countdown.
- **S3. The Rush error box uses implementation language.** "3v3 Rush: Not configured" with a Server status button (`components/stats/copy.ts`). Fix: "3v3 Rush isn't open yet" or "Rush servers are offline". Players don't configure anything.
- **S3. Queue state is shown only next to the button** ("0:01 Est. 1 to 2.5 min"). When the player scrolls to Friends, nothing on screen says they are queued. `QueuePill` exists. Fix: show the queue pill in the header on every page, including Play.

### Match page
- **S2. There is no H1.** The first heading is "H2: Team B won" on a finished match and "H2: Rounds" on a live one. The 404-like "Match not found" is also an H2 and returns HTTP 200. Fix: add an H1 such as "3v3 Rush on Complex, Team A 6 : 8 Team B", and add a real not-found response and a back link.
- **S3. The score appears twice** ("Team A 6:8 Team B" in the header and a giant "6 : 8" card below it) (`shots/mock-1280-matches_…b2.png` 15:33:22). Fix: merge the two into one score block.
- **S3. The round timeline on phones.** The segments are 23 px wide, and the score labels (0:3, 2:4) are tiny mono text. Fix: wrap to two rows on phones, or make the timeline a horizontally scrollable 44 px strip.
- Good: the teams use a square vs diamond shape as well as purple vs amber, and Team B's segments are hatched. This passes the deuteranopia simulation.

### Profile
- **S2. Form and Last 5 dots are green or red with no other signal.** Under deuteranopia all five dots are the same khaki (`shots/cb-deut.png`). This also breaks the brief's own "never green vs red" principle. Fix: add W and L letters inside the dots, or use filled vs hollow shapes, and keep the text for screen readers.
- **S3. The tab title leaks the SteamID64**, for example "Player 76561198000001000 | rushsite". Fix: use the display name.
- **S3. Best maps names are truncated** ("aim_ag_textu…") at 375 px. Fixed once display names exist.

### Leaderboard and ranks
- **S3. The default tab is 3v3 Rush while Rush cannot be queued.** Live shows "0 placed" with a bar at 0% for every tier (`shots/live-1280-leaderboard.png`). Fix: default to the viewer's most-played available mode. Show a proper empty state ("The ladder opens when the first 20-match players place") instead of a bar that reads 0% six times.
- **S3. The Iron and Silver segments of the tier bar are both grey** and can be told apart only by the legend. Fix: give Iron a darker slate, or add separators with labels in the segments at desktop widths.
- **S3. Ranks lists 0% for every tier and every mode when live has no data.** Fix: hide the percentages until any player has placed.

### Friends, challenge, invite
- **S2. Adding a friend asks for a "SteamID64 or profile link"** (`shots/mock-375-friends.png` 15:32:17). Players don't know what a SteamID64 is. Fix: let players search by display name (the search box already searches players) and send a request from the results. Keep the ID field under "More ways".
- **S3. The page uses three button styles for peer actions.** Filled Accept, text-only Decline, Cancel, Invite, Challenge and Profile, and outlined Add. Fix: use one secondary style for row actions and one primary per card.
- **S3. Invite and Challenge are offered on offline friends** with no hint that nothing happens until they return. Fix: disable them with "Offline", or queue the invite with an explicit expiry.
- **S3. The invite and challenge pages have no H1** ("Party invite" is an H2).

### Cups
- **S2. The Verified requirement shows up only at the last step.** The list and the signed-out cup page show a "Verified required" chip and a live "Sign in to enter" button. Signed-in New players then get a disabled Enter cup with "2 of 5 matches to Verified" (`shots/mock-1280-tournaments_…01.png` 15:32:48). Fix: tell signed-out visitors "Needs Verified: 5 clean ladder matches after sign in". For New players, replace the button with a progress block linking to Play.
- **S2. Every team entrant avatar reads "TE".** Initials are taken from "Team kolt", "Team juno", and so on, which makes the avatar stack and entrant list useless (`shots/mockout-375-tournaments_…01.png` 15:56:29). Fix: use the captain's avatar, or initials from the name after "Team".
- **S3. On phones the bracket scrolls sideways with no hint.** The live quarterfinal is off-screen (`shots/mock-375-tournaments_…02.png` 15:32:57). Fix: add a round picker (tabs per round) on phones, or open on the viewer's path or the live match.

### Settings and notifications
- **S2. There is no notifications inbox.** Notifications exist only as toasts, which close after 5 s, plus a number on the avatar. A missed challenge or party invite toast can be recovered only by visiting Friends. "Notifications" in Settings is just sound and browser permission. Fix: add a bell with a list of pending invites, challenges, requests and cup starts, and keep the avatar badge in sync with it.
- **S3. The colour-blind team colours toggle contradicts the rest of the site.** The default palette is already colour-blind safe, the toggle's preview says "Your team" and "Enemy" while match pages use Team A and Team B, and it doesn't say what changes. Fix: explain that it switches to blue and orange, and use the same team terms as match pages.
- **S3. The opponent trust filter is saved on the server but is not in Settings.** Settings says "Saved in this browser only". Fix: add the filter to Settings, or reword the note.

### Banned and 404
- **S2. `/banned` with no query string says "The ban is permanent."** That includes a bookmark, a shared link, or a visit after the ban is lifted. The page offers no appeal or contact route anywhere on the site, and in the mock it renders the signed-in header next to "You cannot sign in" (`shots/live-1280-banned.png` 15:54:07, `shots/mock-375-banned_…Cheating.png` 15:35:03). Fix: only say "permanent" when the redirect set it explicitly. Otherwise ask the API or show "We could not load ban details". Add an appeal link (email or form), and suppress the user menu on this page.
- **S3. The 404 page's only action is "Go to Play"** and its title is "rushsite". Fix: add links to Home and Leaderboard, and set the title to "Page not found".

### Keyboard and screen reader
- Good: there is a skip link, landmarks are present on every page (`header`, `nav`, `main` and `footer`), toasts use `role=status` or `alert`, and the tab order follows the visual order. Every focusable element shows a focus ring. The Match found dialog is a native modal, so focus is trapped.
- **S2. Escape does not close the phone menu,** and the user menu can open on top of the open nav menu (`shots/m375-usermenu.png`, `menu.mjs` log: `aria-expanded` stays true after Escape). Fix: handle Escape in `SiteHeader`, return focus to the Menu button, and close one menu when the other opens.
- **S3. The phone nav menu holds only Play, Tournaments and Leaderboard.** Friends, Ranks, Settings and Sign out are only in the avatar menu. Fix: put Friends in the main nav, since parties are core.
- **S3. The veto has no live-region announcement of turn changes.** Only the timer is visual. Fix: announce "Your team bans, 18 seconds" and "Opponent banned aim_usp" in a polite live region.

### 375 px
- No route had page-level horizontal overflow. The bracket and the tables scroll inside their own containers.
- The problems specific to phones are the buried Start queue, the 23 px timeline segments, the unhinted bracket scroll, and invite toasts covering the veto grid and the Accept area. On the public build the header also has no Sign in button on phones.

---

## Top fifteen (ranked)

1. **S1. The match result has no outcome and disappears.** The result is a 20 s corner toast with no win or loss in words, no score and no match-page link, and win or loss is signalled only by a green "+17". Fix: a persistent result card on Play with Won or Lost, the score, the rating change and the tier change, plus View match, Rematch and Queue again. (`PlayView.tsx:132`, `shots/crop-result.png` 15:49:50)
2. **S1 (live). Cancel and error toasts show raw API codes and strings**, such as `no_server`, `timeout`, "queue cooldown until 2026-…Z" and "slow down". The mock hides this. Fix: map reason codes to plain copy that says what happens next, and never render `e.message`. (`PlayView.tsx:57-58`)
3. **S1 (live). A new player cannot tell that nothing can be played.** Home says "Play now" and "be the first" while `/status` says no mode can queue. Fix: drive the home CTA and the signed-out Play page from `/status`. (`shots/live-1280-home.png`, `shots/live-1280-status.png` 15:52 to 15:53)
4. **S2. The banner says "3v3 Rush is live"** while Play says "3v3 Rush: Not configured" in a red box. Fix: tie announcements to mode availability, and rewrite "Not configured" for players. (`shots/mock-1280-play.png` 15:31:59)
5. **S2. Party invite toasts, each with its own Accept button, cover Match found and the veto.** Fix: hold social toasts during accept, veto and connect. (`shots/q1280-sheet.png`, `shots/f1280-sheet.png`)
6. **S2. Match found focuses a tier link instead of Accept.** Pressing Enter leaves the page during the 20 s window. Fix: `autoFocus` Accept, and make the chip non-interactive. (`queue2.mjs` log 15:42:08)
7. **S2. Start queue is 1.6 screens down on a phone**, below stats and a trust card. Fix: a sticky queue bar under the mode cards, or a bottom bar on phones. (`shots/mock-375-play.png`)
8. **S2. Signed-out Play is a dead end with one button.** Fix: show the Play page read-only with Sign in in place of Start queue. (`shots/mockout-375-play.png` 15:56:19)
9. **S2. Disabled modes show only a red person icon**, and the two AIM cards differ only in small text. Fix: title the cards "1v1 Aim", "2v2 Aim" and "3v3 Rush", add a one-line description, and print the disabled reason on the card. (`shots/crop-modes.png`)
10. **S2. Veto thumbnails show clipped labels ("ap", "edline", "ndia")**, and every map is a raw id. Fix: give maps real display names in shared config, and fix the `MapThumb` overlay. (`shots/crop-veto.png` 15:48:12)
11. **S2. Form and Last 5 dots are green or red only**, and they are identical under deuteranopia. Fix: add W and L glyphs or different shapes. (`shots/cb-deut.png`)
12. **S2. The Verified requirement for cups is revealed only at the final step.** Fix: explain it on the list and the signed-out detail page, and show progress with a route to Play for New players. (`shots/mock-1280-tournaments_…01.png` 15:32:48)
13. **S2. `/banned` claims "permanent" whenever the query string is missing**, and there is no appeal or contact route anywhere. Fix: fetch or hedge the ban details, add an appeal link, and hide the signed-in header on this page. (`shots/live-1280-banned.png` 15:54:07)
14. **S2. Every team entrant avatar in cups reads "TE"**, taken from "Team …". Fix: use the captain's avatar or strip "Team". (`shots/mockout-375-tournaments_…01.png`)
15. **S2. Escape does not close the phone menu, and it overlaps the user menu. Match, invite and challenge pages have no H1.** Fix: handle Escape and return focus in `SiteHeader`, and add H1s. (`shots/m375-usermenu.png`, audit JSON `shots/mock375.json`)

## Verdict

A new player would probably not come back yet. The core loop is well built. Mode pick, a 20 s accept, a clear veto board, three-step connect progress with a copyable command, and a rich match page with an MVP, a kill feed and colour-safe team markers are better than most community platforms offer. Contrast and landmarks are solid throughout. But the first visit fails before any of that is reached. Live home invites the player to "Play now" when nothing can queue. The Play page is empty until they sign in. After sign-in the Rush headline mode is "Not configured" under a banner that calls it live, the action button is below the fold on a phone, and a match ends in a corner toast that never says whether they won before it disappears. A returning competitive player gets most of what they want from the match page and the leaderboard. A newcomer only gets a reason to return once the site can say "you won, here is your new rank" in plain words and stops showing raw codes when things go wrong.

*— Claudius Maximus Decimus Meridius*
