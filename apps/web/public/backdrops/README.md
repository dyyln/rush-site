# Backdrops

Full screen scenes, 1920x1080 webp. `src/styles/tokens.css` sets the page backdrop from these (`--backdrop-image`, per mode through `html[data-backdrop]`), and `src/lib/scenes.ts` lists them for use elsewhere on the site.

| File | Scene |
|---|---|
| rush_001.webp | Industrial yard with stairs |
| rush_001_1.webp | Courtyard with the tank (CT Castle) |
| rush_001_2.webp | Plaza with the clock tower and globe (Atomic) |
| rush_001_3.webp | Corridor with the octopus graffiti. The Rush and default page backdrop |
| rush_001_4.webp | Hangar with the rat mural |

## Source

The rush_001 loading screens that CS2 shows full screen while the map loads, from `panorama/images/map_icons/screenshots/1080p/rush_001*_png.vtex_c` in `game/csgo/pak01_dir.vpk`. Extracted by `apps/web/scripts/extract_rush_images.py`, which also writes the room tiles:

```bash
python apps/web/scripts/extract_rush_images.py "D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive"
```

The aim maps are workshop maps with no loading screens in the game files, so the aim backdrop falls back to the default scene.

After changing the backdrop, run the contrast check from apps/web: `python scripts/check-backdrop-contrast.py`.

## Licence

These are Valve's images and Valve owns them. We use them only to show Rush on a community site for CS2. Valve has not granted permission, so remove them if Valve or anyone acting for Valve asks.
