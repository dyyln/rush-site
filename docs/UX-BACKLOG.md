# rushsite web: 100 UX work items

I read every main page and component under `apps/web/src`, `docs/REVIEW-UX.md` and `docs/CONTRACTS.md`. No files were changed. None of these items repeats the 15 fixes from the REVIEW-UX top 15. Some items pick up that review's lower-ranked findings that are still open, and each of those is tagged (REVIEW S2) or (REVIEW S3). Items marked **[high impact]** are the ones I'd do first.

## Play and queue
1. **[high impact]** `PlayView` mode cards show only "X in queue · Y in progress". `QueueEta` appears only after joining. Show an estimated wait on each card before queueing, so players can pick the faster queue.
2. Add an "All open modes" toggle and a one-line hint above the `PlayView` picker ("Queue several modes, the first match wins"). Many players won't know they can queue more than one mode at once, and it is the fastest way to a match.
3. Party members who are not the leader see their own stale local selection on the disabled mode cards (from `loadLastModes`). Show the leader's chosen modes to them read-only, so everyone knows what the party will queue.
4. `QueueStatus` shows only the longest wait and the shortest ETA across the queued modes. Add a small breakdown per mode (wait and ETA each) when queued for more than one.
5. The Opponents `SegmentedControl` explains its disabled options only in a `title` tooltip. Show the unlock rule inline, and a note that a higher filter can mean longer waits (REVIEW S3).
6. During a cooldown the hint says only "On cooldown." Say why (declined, missed the accept window, forfeit) and how long the next cooldown will be, so the penalty feels fair.
7. With the socket down, Start queue fires a "Not connected" toast. Disable the button and show "Reconnecting" instead, then enable it again automatically when the socket is back.
8. `YourStats` blends HS%, K/D and win rate across all modes, weighted by match count. Show stats for the selected mode or per mode, because Rush and 1v1 Aim numbers mean different things.
9. The `Standing` chip on a mode card shows only the tier and rank. For unplaced players add "N matches to place". For others add the rating change from their last session.
10. Region is stored on the user but never shown. Put the server region (for example "EU servers") on Play, so players know where they will connect.

## Match found / veto / connect
11. **[high impact]** The Match found modal shows only the mode, your tier and an accept count. Add the team size, whether a veto follows, the average opponent tier, and a line by Decline: "Declining gives a queue cooldown".
12. The accept pips are anonymous and `aria-hidden`. Show teammates' avatars filling in as each one accepts, so a party can see who is AFK.
13. The `VetoBoard` subtitle says "Pick a map to ban." even on pick steps. Build it from `step.action`.
14. `PlayView` never passes `names` to `VetoBoard`, so the pending line reads "Waiting on a player, a player". Pass display names from the veto teams.
15. `MapCard` shows only a vote count. Show the small avatars of the teammates who voted for each map, so a team can agree on a ban without voice chat.
16. Show the opposing team (names, avatars, tiers) in the veto header. Right now players learn who they face only once they are on the server.
17. **[high impact]** The `ServerReady` copy says "if you do not connect in time" but never shows the time. Add a live connect countdown, and list which players are connected rather than only "2 of 6".
18. On desktop, make "Launch CS2" the primary button in `ServerReady` and the match page Connect card, since the steam:// link joins in one click. Keep Copy connect as the fallback, with a "CS2 did not open? Paste this in the console" hint.
19. The "Allocating server" and "Starting server" cards (`ConnectSteps`) show no elapsed time. Add a timer, plus "This can take up to a minute when servers are busy" to cover the DatHost surge wait.

## Live match and result
20. **[high impact]** Add a Rush room track to `MatchView`: the seven room slots from T castle to CT castle, with the current front drawn from round `arena` data. Moving between rooms is the core of Rush, and the timeline shows only win and loss segments.
21. `RoundTimeline` and `KillFeed` accept a `highlight` prop, but `MatchView` never passes the viewer's steamId. Pass it so players can spot their own kills.
22. `RoundTitle` prints "A won" or "B won" from raw team ids. Use the team's display name, or "Your team" and "Enemy" to match the markers.
23. The score appears twice on finished matches, in the header scoreboard and in the `MatchSummary` Final block. Merge them into one score block (REVIEW S3).
24. The player tables show raw K, D, HS and DMG. Add K/D, HS%, damage per round and a rating change column, make the columns sortable, and highlight the viewer's row.
25. Abandoned matches show only an "Abandoned" badge, yet `ResultCard` sends players to the match page "for who forfeited". Show on the page who never connected or left, and who was penalised.
26. `ResultCard`: add the player's own line (K–D, HS%, damage), mention the MVP, and add a Report shortcut. The most common after-match actions shouldn't need the match page.
27. For people watching a live match, open the newest round's panel automatically and show a "Live, updated 0:04 ago" indicator. Signed-out viewers poll every 5 s and get no sign that the page is updating.
28. `DemoActions` always says "uploads a few minutes after the match ends", even when the demo has expired or been deleted. Show separate uploading, available and expired states, with the retention date.

## Profile and stats
29. The profile tab title is still "Player 7656…" (`profile/[steamId]/page.tsx`). Use the display name.
30. **[high impact]** Match history: filter it by the selected mode tab, add "Load more" past `recentMatches`, and make the whole row clickable instead of only the score link.
31. The rating card says "Unplaced" with no progress. Say "N more matches to place", using `LEADERBOARD_MIN_MATCHES`.
32. On another player's profile, add a head-to-head block: your record against them and your last meeting. It gives the Challenge button a reason.
33. `ModeStats.rd` is fetched but never shown. Mark high-RD ratings as "Provisional" or show a ± range, so large early swings make sense.
34. `RatingChart` points: click to open that match, and show the result and opponent in the tooltip.
35. Best maps: label the unlabelled win % and match count columns, and hide maps below a minimum number of matches so one lucky win doesn't top the list.
36. Cup badges all use the same star. Give each kind its own icon and colour, and group repeats ("3× Daily champion").
37. Profile header: add "Member since" and total matches. For friends, add their presence (in match, with a Watch link).

## Leaderboard
38. `LeaderboardView` defaults to `rush3v3`. Default to the viewer's most-played open mode instead (REVIEW S3).
39. Add tier filter chips (for example jump to Gold) so players can browse their own band.
40. Add a 7-day rating change column and a "last played" column, so rising and inactive players stand out.
41. The pager is only Previous and Next with "1 / N". Add first and last, a page input, and "Showing 51–100 of 1,240".
42. When the viewer's row is not on the current page, pin it at the bottom of the table, so they don't have to click "Jump to my rank".
43. `TierDistributionBar`: make Iron and Silver distinguishable, and show a real empty state when nobody has placed yet (REVIEW S3).

## Tournaments
44. **[high impact]** When the viewer's bracket match is provisioning or live, show a "Your match is ready" banner at the top of `TournamentDetailView`, with a connect link. Today the only sign is a small "Your next match" label inside the bracket.
45. Add a rules panel to the cup page: Bo1 until the semis and a Bo3 final, no check-in, absent players forfeit round one, server waits, badge prizes.
46. The detail page's Starts tile shows only `LocalTime`. Add the live `Countdown` that home already uses, and an "Add to calendar" (.ics) link.
47. Team cups say only "Leader enters the party." Before Enter, show which party members will be entered, and block with a reason when the party size doesn't match the team size.
48. Raw strings reach players: "verified required", cadence "daily", resolution "no show" (`replace("_"," ")`). Run them through `TRUST_NAMES` and proper labels.
49. Past cups show only the champion. Add the top 4 placings to the `TournamentCard` and the detail page.
50. `TournamentsView` and the detail page load with a plain "Loading" line. Use skeleton cards that match the layout, as Play and Profile already do.
51. `BracketView` `MatchBox` shows only series wins. For Bo3, show each game's map and score with its own link.
52. The entrants list has no order or search. Sort it by seed or rating, show seed numbers, and add search for large cups.

## Friends and parties
53. **[high impact]** `FriendsView`'s add form still asks for a "SteamID64 or profile link". Let players search by display name and send requests from the results, and move the ID field under "More ways" (REVIEW S2).
54. `PartyPanel` shows every member with `status="online"` hard-coded. Use real presence, and show "Disconnected" when a member drops.
55. Show each party member's tier for the selected modes, and the party's mean rating (the rating the queue uses).
56. Leave still takes one click with no confirmation. Confirm when the party has other members or a queue ticket (REVIEW S3).
57. Show pending outgoing party invites in the open slots ("Invited juno, 8:12 left", with Cancel), using the invite `expiresAt`.
58. `PartyPanel` disables Copy on the invite link while queued, though copying changes nothing. Keep it enabled, with a note if joining will restart the queue.
59. `FriendRow`: show the per-mode tiers the API already returns, "last seen" for offline friends, and disable Invite and Challenge with an "Offline" note (REVIEW S3).
60. Unfriend exists only on the profile (`FriendButton`). Add a row overflow menu on /friends with Unfriend, and "Hide" for recent players.
61. `InviteView` shows only the leader and "2 of 3 players". Show every member's avatar and tier, so the invitee knows who they are joining.

## Home and navigation
62. **[high impact]** Home is the same for everyone. For signed-in players, add a personal strip: rating per mode, last result with a link, friends online, and a Play button.
63. Add a three-step "How it works" strip and one line per mode under `HomeHero` for new visitors. Today it appears only on signed-out Play (REVIEW S2).
64. Add Friends to the main `SiteHeader` nav. It lives only in the avatar menu, though parties are core (REVIEW S3).
65. `SiteFooter` has only Status, Leaderboard and Tournaments. Add Rules, Fair play, FAQ, Contact (the support email appears only on /banned), Privacy and Terms.
66. `not-found.tsx` offers only "Go to Play" and sets no page title. Add Home and Leaderboard links and the title "Page not found" (REVIEW S3).
67. `/design`, `/design/icons` and `/design/logos` are public routes. Hide them in production or gate them to admins.

## Sign in and account
68. Settings has no account section. Add Steam identity, region, FACEIT link status and "Sign out everywhere".
69. Settings says "Saved in this browser only", but `minTrust` is saved on the server. Add a Matchmaking section with the opponent filter and correct the note (REVIEW S3).
70. The colour-blind toggle preview says "Your team" and "Enemy" and doesn't say what changes. Explain the blue and orange swap and use the same wording as match pages (REVIEW S3).
71. On first sign-in, show a short welcome step: your trust level, "5 matches to Verified" and what Verified unlocks. Then return the player to the page they came from.
72. Presence is pushed to all friends with no opt-out. Add privacy controls: appear offline, and hide me from friends leaderboards.

## Notifications and realtime
73. **[high impact]** Add a notification inbox (a bell in `SiteHeader`) for party invites, challenges, friend requests and cup starts, with history. Missed toasts are otherwise lost (REVIEW S2).
74. `QueuePill` shows a generic "Match ready" for every phase. Show "Accept 0:14", "Your veto turn" and "Connect 2:31" instead.
75. `useTabTitle` covers only the accept window and the queue timer. Add the veto turn and server ready, plus a favicon dot for background tabs.
76. `NotifyListener` sounds cues only for `match_found` and `server_ready`. Add browser notifications for "cup starts in 10 min", "your bracket match is ready" and "challenge received".
77. "Reconnecting" is shown only inside `QueueStatus` on Play. Add a site-wide banner when the socket drops, so players on other pages know live data has stopped.
78. When `/status` regions report `updating`, show "CS2 update in progress, matches resume shortly" on Play and in the header, instead of a generic unavailable reason.

## Admin
79. Add a global search to the `AdminShell` sidebar (SteamID64, display name, match id, ticket id). /admin/users takes only a SteamID64.
80. Add count badges to the `AdminShell` nav for open flags, errors in the last hour and hosts down, so admins see pending work at a glance.
81. /admin/queue: show each ticket's `minTrust`, each member's trust level, and how long the ticket has been widening. This helps explain long waits.
82. Admin match detail: link to the public match page, the player profiles and the demo, so admins can see what players see.
83. Add an /admin/audit page with filters. Every cup action writes `admin_audit`, but it is only visible per user in the "Admin log" card.
84. The "Match pipeline" card on the overview prints raw status keys. Use the `MatchView` labels, and link each count to a filtered match list.
85. /admin/announcements: add a live preview of the banner, and warn before publishing when the text names a mode that is closed.
86. /admin/hosts: add a "Drain host" action (stop new matches, let running ones finish) and flag hosts whose CS2 version doesn't match the rest.

## Fair play and reports
87. **[high impact]** Tell players when a confirmed cheater's rollback restores their rating: a notice on the profile and a marker on `RatingChart` ("+23 restored"). Seeing the system work builds trust in fair play.
88. `ReportDialog`: add a round picker from the match's rounds, and let players attach a kill from the feed. Reviewers then get tick-level pointers instead of free text.
89. Move `MyReports` from the bottom of the profile into a Fair play section in Settings, with counts per outcome and a notification when an outcome changes.
90. On the player's own profile, explain what lowers trust (false reports, forfeits) next to `TrustChip`, and show the history of trust level changes.
91. Report reasons cover only cheating and griefing. Add a separate "Report a match problem" (server crash, lag, a player never joined) that feeds the admin events page.

## Onboarding and help
92. **[high impact]** On a signed-in player's first visit to Play, show a dismissible first-match checklist: pick a mode, accept within 20 s, join with Launch CS2 (and enable the console). The existing `readFlag`/`writeFlag` helpers can remember dismissal.
93. Add a Rush explainer (rooms, towers, pushing toward the castle, 8 wins or 15 rounds), linked from the Rush mode card and match page. Rush launched on 22 Sept 2026 and most players won't know it yet.
94. Add a Help/FAQ page: cooldown escalation, forfeits and rating, trust levels, demo retention, and why a mode can be closed.
95. `RanksView`: explain Glicko-2 in plain words (big early swings, uncertainty after long breaks), and link to it from `TierChip` tooltips.

## Polish and accessibility
96. The match page title is "Match" and the tournament page title is "Tournament". Use "3v3 Rush on Complex, 8:6" and the cup name, so tabs and history are readable.
97. Add a polite live region to `VetoBoard` that announces turn changes and opponent bans ("Opponents banned Redline") (REVIEW S3).
98. Raise `--color-border-strong` to at least 3:1 against surfaces. Outlined buttons and mode checkbox edges measure 1.4 to 1.9:1 today.
99. Add desktop keyboard shortcuts: Q starts or stops the queue on Play, A accepts in Match found, number keys ban maps in the veto, and "?" opens a help overlay.
100. Make row actions on /friends use one consistent button style (REVIEW S3). Drop the `mono` class from map display names in `MapCard` and the profile map column, now that they are real names rather than ids.
