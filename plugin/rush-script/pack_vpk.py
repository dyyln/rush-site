# Packs our compiled rush_001 into a single-file VPK for the rush_001 override. See README.md.
#
#   python pack_vpk.py rushsite_rooms.vpk path/to/rush_001.vjs_c --valve-pak <CS2>/game/csgo/pak01_dir.vpk
#
# --valve-pak also writes rushsite_rooms.json next to the VPK with the CRC of Valve's rush_001 in that
# pak01 and its CS2 build. The host agent compares that CRC with the installed pak01 and leaves the VPK
# out of gameinfo.gi once Valve changes rush_001, so a stale copy of Valve's rules never runs.
import argparse, hashlib, json, os, re, struct, zlib

ENTRY = "maps/scripts/rush_001.vjs_c"


def cstr(f):
    b = b""
    while (c := f.read(1)) != b"\0":
        b += c
    return b.decode()


def entry_crc(pak, name):
    with open(pak, "rb") as f:
        sig, ver, _ = struct.unpack("<III", f.read(12))
        assert sig == 0x55AA1234, "not a VPK"
        if ver == 2:
            f.read(16)
        while ext := cstr(f):
            while d := cstr(f):
                while n := cstr(f):
                    crc, pre = struct.unpack("<IH", f.read(6))
                    f.read(12 + pre)
                    if f"{d}/{n}.{ext}" == name:
                        return crc
    raise SystemExit(f"{name} not found in {pak}")


def pack(out, rel, data):
    # Single-file VPK v2: data after the tree (archive index 0x7fff), then the 48 byte checksum section.
    d, name = rel.rsplit("/", 1)
    name, ext = name.rsplit(".", 1)
    tree = ext.encode() + b"\0" + d.encode() + b"\0" + name.encode() + b"\0"
    tree += struct.pack("<IHHIIH", zlib.crc32(data) & 0xFFFFFFFF, 0, 0x7FFF, 0, len(data), 0xFFFF)
    tree += b"\0\0\0"
    body = struct.pack("<IIIIIII", 0x55AA1234, 2, len(tree), len(data), 0, 48, 0) + tree + data
    part = hashlib.md5(tree).digest() + hashlib.md5(b"").digest()
    with open(out, "wb") as f:
        f.write(body + part + hashlib.md5(body + part).digest())


def main():
    p = argparse.ArgumentParser()
    p.add_argument("out", help="rushsite_rooms.vpk")
    p.add_argument("compiled", help="our compiled rush_001.vjs_c")
    p.add_argument("--valve-pak", help="pak01_dir.vpk of the CS2 build the script was made from")
    a = p.parse_args()
    pack(a.out, ENTRY, open(a.compiled, "rb").read())
    if a.valve_pak:
        inf = os.path.join(os.path.dirname(a.valve_pak), "steam.inf")
        build = re.search(r"ServerVersion=(\d+)", open(inf).read()).group(1) if os.path.exists(inf) else ""
        info = {"cs2Build": build, "valveScriptCrc": entry_crc(a.valve_pak, ENTRY)}
        with open(os.path.join(os.path.dirname(os.path.abspath(a.out)), "rushsite_rooms.json"), "w") as f:
            json.dump(info, f)
        print(f"wrote rushsite_rooms.json {info}")


if __name__ == "__main__":
    main()
