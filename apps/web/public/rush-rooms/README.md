# Rush room images

One screenshot tile per Rush room, 640x400 webp, named by the room id the rush_001 script and the plugin use (`101` to `104`, `201` to `212`, `301`, `401`, `convoy`). Shown in the room veto, the room layout and the round timeline.

## Source

Extracted from a local CS2 install by `apps/web/scripts/extract_rush_images.py`. Rerun it after a CS2 update that touches Rush:

```bash
python apps/web/scripts/extract_rush_images.py "D:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive"
```

The script reads `panorama/images/map_icons/screenshots/rush_hud/<id>_room_png.vtex_c` from `game/csgo/pak01_dir.vpk`. These are the clean room shots the in-game Rush HUD uses. They are DXT5 textures in YCoCg, stored as 1024x1024. The script decodes them, stretches them back to 1280x900, the size the game draws them at, crops the centre to 16:10 and scales down.

The same folder also has `<id>_ui_ct` and `<id>_ui_t` versions with the in-game markers drawn on, and `panorama/images/overheadmaps/rush_001_room<id>_radar_tga` has a top-down radar of each room.

## Licence

These are Valve's images and Valve owns them. We use them only to identify rooms on a community site for CS2. Valve has not granted permission, so remove them if Valve or anyone acting for Valve asks. Replace them with our own screenshots or drawings when we have them.
