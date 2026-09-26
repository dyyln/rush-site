# Map tiles

- `<mapId>.webp`: preview images of the aim maps, taken from each map's Steam Workshop page.
- `<mapId>.svg`: drawn fallback tiles, our own work. The site falls back to these when a webp is missing or fails to load.

## Workshop previews

These images are community-made Steam Workshop assets. They are **not ours**. We show them with attribution to the author and link to the Workshop item. Any of them will be removed on the author's request: delete the webp and the site falls back to the drawn tile.

Fetched on 2026-09-24 from Steam's public `ISteamRemoteStorage/GetPublishedFileDetails` (`preview_url`), center-cropped to 16:9 and saved as 640x360 webp.

| File | Workshop item | Title | Author (SteamID64) |
|---|---|---|---|
| aim_map.webp | https://steamcommunity.com/sharedfiles/filedetails/?id=3084291314 | AIM Map | SAZONISCHE (76561198010359075) |
| aim_redline.webp | https://steamcommunity.com/sharedfiles/filedetails/?id=3199551320 | aim_redline | st1ng (76561198237674726) |
| aim_ag_texture2.webp | https://steamcommunity.com/sharedfiles/filedetails/?id=3074961197 | aim_ag_texture2 | Reed Timmer (76561198014469869) |
| aim_usp.webp | https://steamcommunity.com/sharedfiles/filedetails/?id=3299812021 | Aim USP | YarFunnyStar (76561198134466458) |
| aim_deagle7k.webp | https://steamcommunity.com/sharedfiles/filedetails/?id=3075996446 | aim_deagle (plays in the aim_deagle7k slot) | kuhz (76561199008495572) |
| awp_india.webp | https://steamcommunity.com/sharedfiles/filedetails/?id=3070290869 | awp_india | Geno (76561198052148850) |

Maps added from /admin are not stored here. Their preview is hotlinked from Steam's CDN (`images.steamusercontent.com`) using the URL saved in the `map_pool` table.

To refresh a preview, fetch the item details again, download `preview_url` and re-encode it the same way.

## Link preview copies

`public/og/<mapId>.jpg` are JPEG copies of the webp previews (and `rush_001.jpg` of `backdrops/rush_001_1.webp`) for the challenge link image, whose renderer cannot read webp. Re-encode them when a preview changes or is removed.
