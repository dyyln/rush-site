# Aim map Workshop ids

`AIM_MAPS` in `modes.ts` uses these ids. The agent launches them with `+host_workshop_map <id>` and DatHost with `workshop_single_map_id`.

These are the defaults. The live pool is the `map_pool` table, edited at /admin/maps. It stays empty, and the site uses `AIM_MAPS`, until an admin first changes the pool. That change copies these defaults into the table.

How they were picked (2026-09-23): search the app 730 Workshop by map name and take the most subscribed item that is a CS2 upload. An item counts as CS2 when it was created after September 2023, carries the `Cs2` tag, and has no legacy `mymaps/*.bsp` file name. Titles, subscriber counts, dates and tags come from Steam's public `GetPublishedFileDetails` API. Authors come from each creator's Steam profile.

| Slot id | Workshop id | Title | Author | Subscribers | Created / updated | URL |
|---|---|---|---|---|---|---|
| aim_map | 3084291314 | AIM Map | SAZONISCHE | about 1.44M | 2023-11-15 / 2026-07-06 | https://steamcommunity.com/sharedfiles/filedetails/?id=3084291314 |
| aim_redline | 3199551320 | aim_redline | st1ng | about 330k | 2024-03-24 / 2024-11-20 | https://steamcommunity.com/sharedfiles/filedetails/?id=3199551320 |
| aim_ag_texture2 | 3074961197 | aim_ag_texture2 | Reed Timmer | about 4.7k | 2023-11-07 / 2025-12-29 | https://steamcommunity.com/sharedfiles/filedetails/?id=3074961197 |
| aim_usp | 3299812021 | Aim USP | YarFunnyStar | about 28k | 2024-07-30 / 2025-02-11 | https://steamcommunity.com/sharedfiles/filedetails/?id=3299812021 |
| aim_deagle7k | 3075996446 | aim_deagle (substitute) | kuhz | about 51k | 2023-11-08 | https://steamcommunity.com/sharedfiles/filedetails/?id=3075996446 |
| awp_india | 3070290869 | awp_india | Geno | about 60k | 2023-11-03 / 2023-11-08 | https://steamcommunity.com/sharedfiles/filedetails/?id=3070290869 |

## Notes

- **aim_deagle7k has no CS2 upload.** Searches for "aim_deagle7k", "deagle7k" and "deagle 7k" return only generic deagle maps. The slot keeps the id `aim_deagle7k` so stored matches, vetoes and web tiles stay valid, but it plays aim_deagle by kuhz and shows as "Deagle". The runner-up was 3413201520 "aim deagle pro" (about 37k subscribers).
- **aim_ag_texture2** has only one CS2 port and few subscribers. A same-author variant is 3082113929 "aim_ag_texture_city_advanced" (about 6k, no `Cs2` tag).
- CS:GO uploads that must not be used, even though they have more subscribers:
  - aim_map 122443683 (2013, about 1.75M)
  - aim_redline 1687663948 (2019, about 420k)
  - aim_usp 1563657794 "Aim Usp" by yprac (about 580k)
  - awp_india 233903603 "Awp India" (2014)
- Other CS2 candidates if a pick breaks:
  - aim_map: 3137666677 "1 VS 1 AIM MAP" (about 860k), 3070656861 "Aim Map Pro (Source 2)" (about 131k)
  - aim_redline: 3710410548 "aim_redline_fps" (about 120k, 2026)
  - aim_usp: 3085962528 "aim_usp" by st1ng (about 14k)
  - awp_india: 3414483755 "Awp_India_Night" by Geno (about 37k), 3070411770 "awp_india" by kuhz (about 23k)
- None of these has been loaded on our servers yet. Check each one on the first aim test: it downloads, spawns both teams, and has no buy zone problem with `mp_buy_anywhere 1`.

After changing an id, run `pnpm -C packages/shared export:modes` so `agent/testdata/modes.json` stays in step.
