# Builds our rush_001.vjs_c on any OS, with no Workshop Tools. See README.md.
#
#   python build_vjs.py rush_001.js dist/rush_001.vjs_c --valve-pak <CS2>/game/csgo/pak01_dir.vpk
#
# A compiled cs_script is a Source 2 resource whose DATA block is the script text with CRLF line
# endings. This takes Valve's rush_001.vjs_c from pak01, keeps its header and RED2 block, and swaps
# the DATA block for our script. Build it from the same pak01 you pass to pack_vpk.py.
import argparse, os, struct

ENTRY = "maps/scripts/rush_001.vjs_c"


def cstr(f):
    b = b""
    while (c := f.read(1)) != b"\0":
        b += c
    return b.decode()


def read_entry(pak, name):
    with open(pak, "rb") as f:
        sig, ver, tree_size = struct.unpack("<III", f.read(12))
        assert sig == 0x55AA1234 and ver == 2, "not a VPK v2"
        f.read(16)
        while ext := cstr(f):
            while d := cstr(f):
                while n := cstr(f):
                    _, pre, idx, off, length, _ = struct.unpack("<IHHIIH", f.read(18))
                    preload = f.read(pre)
                    if f"{d}/{n}.{ext}" == name:
                        break
                else:
                    continue
                break
            else:
                continue
            break
        else:
            raise SystemExit(f"{name} not found in {pak}")
    if idx == 0x7FFF:
        src, off = pak, 28 + tree_size + off
    else:
        src = pak.replace("_dir.vpk", f"_{idx:03d}.vpk")
    with open(src, "rb") as g:
        g.seek(off)
        return preload + g.read(length)


def swap_data(resource, script):
    size, _, _, block_offset, block_count = struct.unpack("<IHHII", resource[:16])
    assert size == len(resource), "unexpected resource size"
    table = 8 + block_offset
    blocks = []
    for i in range(block_count):
        at = table + i * 12
        kind, rel, length = struct.unpack("<4sII", resource[at : at + 12])
        blocks.append((kind, at, at + 4 + rel, length))
    kind, at, start, length = blocks[-1]
    assert kind == b"DATA" and start + length == len(resource), "DATA is not the last block"
    out = bytearray(resource[:start] + script)
    struct.pack_into("<I", out, 0, len(out))
    struct.pack_into("<I", out, at + 8, len(script))
    return bytes(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("script", help="our rush_001.js")
    p.add_argument("out", help="rush_001.vjs_c to write")
    p.add_argument("--valve-pak", required=True, help="pak01_dir.vpk of the CS2 build to build against")
    a = p.parse_args()

    with open(a.script, "rb") as f:
        text = f.read().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    out = swap_data(read_entry(a.valve_pak, ENTRY), text)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "wb") as f:
        f.write(out)
    print(f"wrote {a.out} ({len(out)} bytes)")


if __name__ == "__main__":
    main()
