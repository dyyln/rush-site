package update

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Rush room veto. plugin/rush-script builds rushsite_rooms.vpk, holding our modified
// maps/scripts/rush_001.vjs_c, and rushsite_rooms.json, which records the CRC of Valve's
// rush_001.vjs_c in pak01 at build time. gameinfo.gi names the VPK above `Game csgo`
// so it wins over pak01. See docs/RUSH-ROOM-VETO.md.
const (
	RushRoomsVPKName = "rushsite_rooms.vpk"
	rushRoomsInfo    = "rushsite_rooms.json"
	rushScriptEntry  = "maps/scripts/rush_001.vjs_c"
	rushRoomsLine    = "csgo/" + RushRoomsVPKName
)

func RushRoomsVPKPath(cs2Dir string) string {
	return filepath.Join(cs2Dir, "game", "csgo", RushRoomsVPKName)
}

func rushRoomsInfoPath(cs2Dir string) string {
	return filepath.Join(cs2Dir, "game", "csgo", rushRoomsInfo)
}

func valvePakPath(cs2Dir string) string {
	return filepath.Join(cs2Dir, "game", "csgo", "pak01_dir.vpk")
}

type RushRoomsState string

const (
	// No VPK installed. Valve's random draw.
	RushRoomsOff RushRoomsState = "off"
	// Our script loads.
	RushRoomsOn RushRoomsState = "on"
	// Valve changed rush_001 since the VPK was built. Ours stays out so Valve's current rules run.
	RushRoomsStale RushRoomsState = "stale"
	// The VPK is there but could not be checked. Left out to be safe.
	RushRoomsError RushRoomsState = "error"
)

type rushRoomsBuild struct {
	CS2Build       string `json:"cs2Build"`
	ValveScriptCRC uint32 `json:"valveScriptCrc"`
}

// CheckRushRooms decides whether our rush_001 script may load. Only RushRoomsOn puts it in gameinfo.gi.
func CheckRushRooms(cs2Dir string) (RushRoomsState, string) {
	if _, err := os.Stat(RushRoomsVPKPath(cs2Dir)); errors.Is(err, os.ErrNotExist) {
		return RushRoomsOff, ""
	}
	b, err := os.ReadFile(rushRoomsInfoPath(cs2Dir))
	if err != nil {
		return RushRoomsError, rushRoomsInfo + " missing next to the VPK: " + err.Error()
	}
	var info rushRoomsBuild
	if err := json.Unmarshal(b, &info); err != nil || info.ValveScriptCRC == 0 {
		return RushRoomsError, rushRoomsInfo + " has no valveScriptCrc"
	}
	crc, err := VPKEntryCRC(valvePakPath(cs2Dir), rushScriptEntry)
	if err != nil {
		return RushRoomsError, "reading Valve's " + rushScriptEntry + ": " + err.Error()
	}
	if crc != info.ValveScriptCRC {
		return RushRoomsStale, fmt.Sprintf("Valve's rush_001 changed (crc %08x, VPK built against %08x for build %s). Rebuild rushsite_rooms.vpk",
			crc, info.ValveScriptCRC, info.CS2Build)
	}
	return RushRoomsOn, ""
}

// VPKEntryCRC returns the CRC the directory tree of a VPK records for one file, such as maps/scripts/rush_001.vjs_c.
func VPKEntryCRC(path, name string) (uint32, error) {
	slash := strings.LastIndexByte(name, '/')
	dot := strings.LastIndexByte(name, '.')
	if slash < 0 || dot < slash {
		return 0, fmt.Errorf("bad entry name %q", name)
	}
	wantDir, wantFile, wantExt := name[:slash], name[slash+1:dot], name[dot+1:]

	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	var hdr struct{ Sig, Version, TreeSize uint32 }
	if err := binary.Read(f, binary.LittleEndian, &hdr); err != nil {
		return 0, err
	}
	if hdr.Sig != 0x55aa1234 {
		return 0, errors.New("not a VPK")
	}
	switch hdr.Version {
	case 1:
	case 2:
		if _, err := f.Seek(16, io.SeekCurrent); err != nil {
			return 0, err
		}
	default:
		return 0, fmt.Errorf("VPK version %d", hdr.Version)
	}
	r := bufio.NewReader(io.LimitReader(f, int64(hdr.TreeSize)))
	var entry struct {
		CRC     uint32
		Preload uint16
		Archive uint16
		Offset  uint32
		Length  uint32
		Term    uint16
	}
	for {
		ext, err := readCString(r)
		if err != nil || ext == "" {
			break
		}
		for {
			dir, err := readCString(r)
			if err != nil {
				return 0, err
			}
			if dir == "" {
				break
			}
			for {
				file, err := readCString(r)
				if err != nil {
					return 0, err
				}
				if file == "" {
					break
				}
				if err := binary.Read(r, binary.LittleEndian, &entry); err != nil {
					return 0, err
				}
				if _, err := r.Discard(int(entry.Preload)); err != nil {
					return 0, err
				}
				if ext == wantExt && dir == wantDir && file == wantFile {
					return entry.CRC, nil
				}
			}
		}
	}
	return 0, fmt.Errorf("%s not in %s", name, filepath.Base(path))
}

func readCString(r *bufio.Reader) (string, error) {
	s, err := r.ReadString(0)
	if err != nil {
		return "", err
	}
	return s[:len(s)-1], nil
}
