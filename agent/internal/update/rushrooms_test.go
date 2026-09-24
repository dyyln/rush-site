package update

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeVPK writes a VPK v2 directory with the given entries and their CRCs, like pak01_dir.vpk.
func writeVPK(t *testing.T, path string, entries map[string]uint32) {
	t.Helper()
	var tree bytes.Buffer
	for name, crc := range entries {
		slash, dot := strings.LastIndexByte(name, '/'), strings.LastIndexByte(name, '.')
		tree.WriteString(name[dot+1:] + "\x00" + name[:slash] + "\x00" + name[slash+1:dot] + "\x00")
		binary.Write(&tree, binary.LittleEndian, struct {
			CRC              uint32
			Preload, Archive uint16
			Offset, Length   uint32
			Term             uint16
		}{crc, 0, 0, 0, 1, 0xffff})
		tree.WriteString("\x00\x00")
	}
	tree.WriteString("\x00")
	var out bytes.Buffer
	binary.Write(&out, binary.LittleEndian, [7]uint32{0x55aa1234, 2, uint32(tree.Len()), 0, 0, 0, 0})
	out.Write(tree.Bytes())
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, out.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestVPKEntryCRC(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pak01_dir.vpk")
	want := crc32.ChecksumIEEE([]byte("rush"))
	writeVPK(t, path, map[string]uint32{
		"maps/scripts/hello.vjs_c":    1,
		"maps/scripts/rush_001.vjs_c": want,
		"resource/game.gameevents":    2,
	})
	got, err := VPKEntryCRC(path, "maps/scripts/rush_001.vjs_c")
	if err != nil || got != want {
		t.Fatalf("got %08x err %v, want %08x", got, err, want)
	}
	if _, err := VPKEntryCRC(path, "maps/scripts/missing.vjs_c"); err == nil {
		t.Fatal("want an error for a missing entry")
	}
	if err := os.WriteFile(path, []byte("not a vpk at all"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := VPKEntryCRC(path, "maps/scripts/rush_001.vjs_c"); err == nil {
		t.Fatal("want an error for a bad file")
	}
}

func rushInstall(t *testing.T, valveCRC uint32, info any) string {
	t.Helper()
	dir := t.TempDir()
	writeVPK(t, valvePakPath(dir), map[string]uint32{rushScriptEntry: valveCRC})
	if info != nil {
		if err := os.WriteFile(RushRoomsVPKPath(dir), []byte("vpk"), 0o644); err != nil {
			t.Fatal(err)
		}
		b, _ := json.Marshal(info)
		if s, ok := info.(string); ok {
			b = []byte(s)
		}
		if err := os.WriteFile(rushRoomsInfoPath(dir), b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestCheckRushRooms(t *testing.T) {
	built := rushRoomsBuild{CS2Build: "2000915", ValveScriptCRC: 0xabc123}
	cases := []struct {
		name  string
		dir   string
		want  RushRoomsState
		match string
	}{
		{"no vpk", rushInstall(t, 0xabc123, nil), RushRoomsOff, ""},
		{"matching", rushInstall(t, 0xabc123, built), RushRoomsOn, ""},
		{"valve changed", rushInstall(t, 0xdef456, built), RushRoomsStale, "Rebuild"},
		{"bad json", rushInstall(t, 0xabc123, "{"), RushRoomsError, "valveScriptCrc"},
	}
	for _, c := range cases {
		got, detail := CheckRushRooms(c.dir)
		if got != c.want || !strings.Contains(detail, c.match) {
			t.Errorf("%s: got %s %q", c.name, got, detail)
		}
	}
	noInfo := rushInstall(t, 0xabc123, built)
	os.Remove(rushRoomsInfoPath(noInfo))
	if got, _ := CheckRushRooms(noInfo); got != RushRoomsError {
		t.Errorf("vpk without json: got %s", got)
	}
}

func TestEnsureGameinfoRushLine(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gameinfo.gi")
	if err := os.WriteFile(path, []byte(gameinfo), 0o644); err != nil {
		t.Fatal(err)
	}
	changed, err := EnsureGameinfo(path, true)
	if err != nil || !changed {
		t.Fatalf("add: changed=%v err=%v", changed, err)
	}
	b, _ := os.ReadFile(path)
	want := "\t\t\tGame\tcsgo/addons/metamod\n\t\t\tGame\tcsgo/rushsite_rooms.vpk\n\t\t\tGame\tcsgo\n"
	if !strings.Contains(string(b), want) {
		t.Fatalf("rush line not above Game csgo:\n%s", b)
	}
	if changed, _ := EnsureGameinfo(path, true); changed {
		t.Fatal("second add changed the file")
	}
	if changed, err := EnsureGameinfo(path, false); err != nil || !changed {
		t.Fatalf("remove: changed=%v err=%v", changed, err)
	}
	b, _ = os.ReadFile(path)
	if strings.Contains(string(b), "rushsite_rooms") || !strings.Contains(string(b), "csgo/addons/metamod") {
		t.Fatalf("after remove:\n%s", b)
	}
}

func TestPatchGameinfoReportsRushState(t *testing.T) {
	dir := rushInstall(t, 0xdef456, rushRoomsBuild{CS2Build: "2000915", ValveScriptCRC: 0xabc123})
	gi := GameinfoPath(dir)
	// A stale install whose gameinfo.gi still names the VPK from before the update.
	if err := os.WriteFile(gi, []byte(strings.Replace(gameinfo, "\t\t\tGame\tcsgo\n",
		"\t\t\tGame\tcsgo/addons/metamod\n\t\t\tGame\tcsgo/rushsite_rooms.vpk\n\t\t\tGame\tcsgo\n", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	u := New(Config{CS2Dir: dir, PatchGameinfo: true}, nil, nil, nil, nil)
	if err := u.PatchGameinfo(); err != nil {
		t.Fatal(err)
	}
	if s := u.Status(); s.RushRooms != RushRoomsStale || s.RushRoomsDetail == "" {
		t.Fatalf("status %+v", s)
	}
	b, _ := os.ReadFile(gi)
	if strings.Contains(string(b), "rushsite_rooms") {
		t.Fatalf("stale VPK still in gameinfo.gi:\n%s", b)
	}
}
