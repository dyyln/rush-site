# Writes public/rush-rooms/<id>.webp from the room screenshots in a local CS2 install. Rerun after CS2 updates.
# Usage: python apps/web/scripts/extract_rush_rooms.py "<steam library>/steamapps/common/Counter-Strike Global Offensive"
# Needs: pip install vpk lz4 texture2ddecoder numpy pillow
import os, struct, sys
import lz4.block, numpy as np, texture2ddecoder, vpk
from PIL import Image

# Room ids from RUSH_ROOMS in packages/shared/src/config/modes.ts
ROOMS = ["101", "102", "103", "104", *[str(i) for i in range(201, 213)], "301", "401", "convoy"]
SRC = "panorama/images/map_icons/screenshots/rush_hud/{}_room_png.vtex_c"
# The shots are drawn at 1280x900 in game and stored squashed into a square texture
SHOT = (1280, 900)
OUT = (640, 400)
DXT5 = 2

def decode(data: bytes) -> Image.Image:
    # Source 2 resource: the pixel data follows the block section, whose size is the first field
    res_size, _, _, block_off, blocks = struct.unpack_from("<IHHII", data, 0)
    for i in range(blocks):
        p = 8 + block_off + i * 12
        if data[p:p + 4] == b"DATA":
            q = p + 4 + struct.unpack_from("<I", data, p + 4)[0]
            w, h = struct.unpack_from("<HH", data, q + 20)
            fmt, mips = data[q + 26], data[q + 27]
            break
    else:
        raise ValueError("no DATA block")
    if fmt != DXT5 or mips != 1:
        raise ValueError(f"unexpected texture format {fmt} with {mips} mips")
    pixels = data[res_size:]
    if len(pixels) != w * h:
        pixels = lz4.block.decompress(pixels, uncompressed_size=w * h)
    bgra = np.frombuffer(texture2ddecoder.decode_bc3(pixels, w, h), np.uint8).reshape(h, w, 4).astype(np.float32) / 255
    b, g, r, a = bgra[..., 0], bgra[..., 1], bgra[..., 2], bgra[..., 3]
    if b"YCoCg" in data[:res_size]:
        # Scaled YCoCg in DXT5: Co in red, Cg in green, scale in blue, luma in alpha
        scale = b * (255 / 8) + 1
        co, cg = (r - 128 / 255) / scale, (g - 128 / 255) / scale
        r, g, b = a + co - cg, a + cg, a - co - cg
    rgb = (np.stack([r, g, b], -1).clip(0, 1) * 255 + 0.5).astype(np.uint8)
    return Image.fromarray(rgb).resize(SHOT, Image.LANCZOS)

def thumb(im: Image.Image) -> Image.Image:
    # Centre crop to the 16:10 tile the site uses
    w, h = im.size
    ch = round(w * OUT[1] / OUT[0])
    top = (h - ch) // 2
    return im.crop((0, top, w, top + ch)).resize(OUT, Image.LANCZOS)

def main():
    game = sys.argv[1] if len(sys.argv) > 1 else r"C:\Program Files (x86)\Steam\steamapps\common\Counter-Strike Global Offensive"
    pak = vpk.open(os.path.join(game, "game", "csgo", "pak01_dir.vpk"))
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "rush-rooms")
    for room in ROOMS:
        path = os.path.join(out, f"{room}.webp")
        thumb(decode(pak.get_file(SRC.format(room)).read())).save(path, "WEBP", quality=80, method=6)
        print(f"{room}.webp {os.path.getsize(path) // 1024} KB")

if __name__ == "__main__":
    main()
