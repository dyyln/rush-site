# Packs one compiled file into a single-file VPK, for the rush_001 override. See README.md.
# Usage: python pack_vpk.py rushsite_rooms.vpk maps/scripts/rush_001.vjs_c path/to/rush_001.vjs_c
import hashlib, struct, sys, zlib
# Single-file VPK v2 with the data stored after the tree (archive index 0x7fff) and the 48 byte checksum section.
out, rel, src = sys.argv[1], sys.argv[2], sys.argv[3]
data = open(src, 'rb').read()
d, name = rel.rsplit('/', 1); name, ext = name.rsplit('.', 1)
tree = ext.encode() + b'\0' + d.encode() + b'\0' + name.encode() + b'\0'
tree += struct.pack('<IHHIIH', zlib.crc32(data) & 0xffffffff, 0, 0x7fff, 0, len(data), 0xffff)
tree += b'\0\0\0'
hdr = struct.pack('<IIIIIII', 0x55aa1234, 2, len(tree), len(data), 0, 48, 0)
body = hdr + tree + data
part = hashlib.md5(tree).digest() + hashlib.md5(b'').digest()
whole = hashlib.md5(body + part).digest()
open(out, 'wb').write(body + part + whole)
