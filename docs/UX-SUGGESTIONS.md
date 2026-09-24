# UX suggestions, 24 Sep 2026

A read-only survey of the site, the admin area and the in-game plugin: 100 suggestions. Tags are [impact/effort]. Items marked *(superseded)* were overtaken by work done the same day: the automatic warmup countdown, the unified match room, and placing on the leaderboard after 1 match. Match flow items now apply to the match room.

## Onboarding and sign-in
1. Sign-in doesn't explain what we check (bans, playtime) or that a public Steam profile helps trust. Add a "What we check" line (`app/login/page.tsx`). [med/low]
2. There is no first-run help. Add a one-time checklist on /play: public profile, sound test, notifications, pick modes. [high/med]
3. Rush is described only as "Valve's Rush on Complex" (`components/home/HomeHero.tsx`, `lib/modes.ts`). Add a short "How Rush works" block covering rooms, towers and win conditions. [high/low]
4. Home shows no activity. Show "N searching now" per mode from `mode_stats`. [med/low]
5. Ranks can only be reached from the user menu. Link it from the leaderboard and the footer. [med/low]
6. The signed-out "How it works" card on Play doesn't mention tiers or free cups. [low/low]
7. The banned page only offers a mailto link. Show a ban reference id and whether ratings were rolled back. [med/low]

## Play and queue
8. The veto screen is missing player names ("Waiting on a player, a player"). Pass the `names` prop to `VetoBoard`. [high/low]
9. The veto always says "Pick a map to ban", even on pick steps. [med/low]
10. Party members who aren't the leader can't stop the queue. [high/low]
11. Show the rating search range ("±200, widening"). `ratingWindow` is already sent. [med/low]
12. The queue shows one wait time. Show a chip per mode with its own estimate. [med/low]
13. When your mode has 0 searching, suggest another ("Rush has 12 searching"). [med/low]
14. Explain that stricter opponent filters mean longer waits. [med/low]
15. The cooldown reason and step are only in a toast. Show a lasting line next to Start. [med/low]
16. Your stats on Play blend all modes together. Show the stats for the selected mode. [low/low]
17. Let players stop the queue from the queue pill on any page. [med/low]
18. The queue pill says only "Match ready" or "In queue". Show the phase: "Veto: your turn", "Connect now", "Live 5:3". [high/low]
19. The tab title should also show "Your veto turn" and "Server ready", plus a dot on the tab icon. [high/low]
20. Add sounds for your veto turn and a 5-second warning before the accept window closes. [med/low]

## Party
21. Every party member is always shown as online, which isn't real data. [med/low]
22. Don't disable Copy for the invite link while queued. [low/low]
23. Show each member's tier so the leader can see the rating spread. [med/med]
24. The invite page should list all members with tier and trust. [med/low]
25. Add an optional ready check before the party queues. [high/med]
26. Explain why Leave is disabled ("Stop the queue first"). [low/low]
27. Next to "Party too big", add an inline "Leave party to play 1v1" action. [low/low]
28. The invite page uses inline styles. Move them to a CSS module. [low/low]

## Match flow (now the match room)
29. On match found, show the opponents' average tier and the map pool. [med/low]
30. Before Decline, warn "Declining starts an N min cooldown". [high/low]
31. Show which party members have accepted, by name. [low/med]
32. Show a connect deadline countdown. The plugin allows 5 minutes. [high/med]
33. Show who hasn't connected yet. [high/med]
34. Make Launch CS2 the main button and Copy the secondary one. [med/low]
35. Tailor the cancel message to whether this player accepted. [med/low]
36. Send a browser notification when a match is cancelled. [low/low]
37. Name the player who forfeited on the result card. [med/low]
38. Add K/D, headshot % and damage to the result card. [med/low]
39. Party members who aren't the leader get a "Ready for another" button on the result card. [low/med]
40. Send a browser notification with the result after the plugin kicks players. [med/low]
41. Move focus to each new step and announce it to screen readers. [high/low]

## In-game (plugin)
42. The chat prefix shows the codename `[rushsite]`. Use the brand name from config. [med/low]
43. List who isn't ready. *(superseded: the countdown reminds players who are off their side)* [high/low]
44. Announce the auto-start timer. [med/low]
45. Add a `!help` command. [low/low]
46. Pause message: "X disconnected, 3:00 to return or they forfeit". [high/low]
47. Name who abandoned, and say the others aren't penalised. [med/low]
48. At match end, print the score and match link and wait about 10s before kicking. [high/low]
49. Print the round score. For Rush, also print where play moves next. [high/med]
50. Add a Rush live message that states the win conditions. [med/low]
51. Restore the ready state after a plugin reload. *(superseded)* [low/med]
52. Welcome message on connect: mode, map, teammates, which side to join. [low/low]
53. Show critical messages such as pauses as a center-screen alert. [med/med]

## Tournaments
54. The page shows lowercase "verified required". Use `TRUST_NAMES`. [low/low]
55. Pin a "Your next match" card for entrants. [high/med]
56. Show a countdown to the cup start. [med/low]
57. Add an "Entered" badge on cup cards. [med/low]
58. Add an "Add to calendar" button, since there's no check-in. [med/low]
59. Add a rules section: Bo1 until the semis, Bo3 final, forfeits. [med/low]
60. For team cups, show the party roster and block entry when the party size is wrong. [med/med]
61. Use loading skeletons instead of plain "Loading" text. [low/low]
62. Play a sound and send a notification when your bracket match is ready. [high/low]
63. On phones, split the bracket into round tabs. [med/med]

## Leaderboard and ranks
64. Add a rank movement column. [med/med]
65. Add a column with the last 5 results. [low/low]
66. Default to the viewer's most-played or last-chosen mode. [low/low]
67. Make the tier distribution bar clickable. [low/med]
68. The Ranks page should show distance to demotion and explain why early matches move your rating more. [med/low]
69. The tier descriptions are aim-specific. Make them fit every mode. [low/low]

## Profile
70. Add a mode filter and "Load more" to match history. [high/med]
71. Show progress toward placement. *(superseded: 1 match places you)* [med/low]
72. Default to the most-played mode, not the highest-rated one. [low/low]
73. Make the whole match-history row clickable. [med/low]
74. Shade the tier bands behind the rating chart. [med/med]
75. Show your head-to-head record on another player's profile. [med/med]
76. Make the badge icons different for each placing and show counts. [low/low]
77. Add a link preview card (Open Graph) for profiles. [low/med]

## Navigation and layout
78. Add Friends to the desktop header with the pending count. [med/low]
79. The mobile nav doesn't close on Escape or when you click outside it. [low/low]
80. Add footer links: Rules, Fair play, Privacy, FAQ. [med/low]
81. On mobile, move the party panel right after the mode picker. [med/low]

## Accessibility
82. The queue timer ticks inside a live region and floods screen readers. Announce only state changes. [high/low]
83. Reasons for disabled options are only in tooltips. Render them as text. [med/low]
84. Spell out "Opp" as "Opponents". [low/low]

## Mobile
85. Hide headshot % and shrink the damage bar in match tables on phones. [med/low]
86. Keep the veto header with its timer fixed at the top on phones. [med/low]
87. On phones, say "Connect from your PC" instead of offering Launch CS2. [med/low]
88. On very narrow screens, the header queue pill shows only the timer. [low/low]

## Feedback and errors
89. Show a site-wide banner when the live connection has been down for more than 5s. [high/low]
90. Link /status from error toasts. [low/low]
91. Explain why a match is unrated. [low/low]
92. Add a Retry button to match page errors. [low/low]
93. Add "Report a problem with this match". [med/med]

## Settings
94. The "Saved in this browser only" copy is wrong for the opponent filter. Also add the default filter to Settings. [low/low]
95. Add volume and a toggle per sound. [low/low]

## Admin
96. User lookup only accepts a SteamID64. Add search by name. [high/low]
97. Make the Fair play tiles links, and rename the nav item "Flags" to "Feature flags". [med/low]
98. Add host actions: drain, force CS2 update, restart slot. [high/med]
99. On the user page, add "Clear cooldown" and current queue or match state, and show admin names in the log. [med/low]

## Trust and fair play
100. Tell players when a banned opponent's win is rolled back and their rating restored, and tell reporters when their report led to action. [high/med]

## Top 10 for impact against effort
8, 30, 48, 19, 46, 82, 89, 18, 96, 62
