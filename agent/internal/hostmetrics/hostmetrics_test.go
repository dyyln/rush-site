package hostmetrics

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "proc", name))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// copyProc copies the fixture tree so a test can rewrite files between samples.
func copyProc(t *testing.T) string {
	t.Helper()
	dst := t.TempDir()
	src := filepath.Join("testdata", "proc")
	err := filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		if info.IsDir() {
			return os.MkdirAll(filepath.Join(dst, rel), 0o755)
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(dst, rel), b, 0o644)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dst
}

func write(t *testing.T, root, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestParseStat(t *testing.T) {
	total, idle, cpus, err := ParseStat(fixture(t, "stat"))
	if err != nil {
		t.Fatal(err)
	}
	// user nice system idle iowait irq softirq steal. Guest columns are left out
	if total != 95200 || idle != 81500 || cpus != 8 {
		t.Fatalf("got total %d idle %d cpus %d", total, idle, cpus)
	}
	if _, _, _, err := ParseStat([]byte("intr 1 2\n")); err == nil {
		t.Fatal("want an error without a cpu line")
	}
	if _, _, _, err := ParseStat([]byte("cpu 1 x 3 4 5\n")); err == nil {
		t.Fatal("want an error on a bad number")
	}
}

func TestParseLoadAvg(t *testing.T) {
	l, err := ParseLoadAvg(fixture(t, "loadavg"))
	if err != nil {
		t.Fatal(err)
	}
	if len(l) != 3 || l[0] != 2.15 || l[1] != 1.80 || l[2] != 1.42 {
		t.Fatalf("got %v", l)
	}
	if _, err := ParseLoadAvg([]byte("1.0 2.0")); err == nil {
		t.Fatal("want an error on a short line")
	}
}

func TestParseMemInfo(t *testing.T) {
	total, avail, err := ParseMemInfo(fixture(t, "meminfo"))
	if err != nil {
		t.Fatal(err)
	}
	if total != 32768000*1024 || avail != 20480000*1024 {
		t.Fatalf("got total %d avail %d", total, avail)
	}
	// Kernels before 3.14 have no MemAvailable
	if _, _, err := ParseMemInfo([]byte("MemTotal: 100 kB\nMemFree: 50 kB\n")); err == nil {
		t.Fatal("want an error without MemAvailable")
	}
}

func TestParsePidStat(t *testing.T) {
	// The command name holds spaces and a closing bracket
	ticks, start, err := ParsePidStat(fixture(t, "4242/stat"))
	if err != nil {
		t.Fatal(err)
	}
	if ticks != 35000 || start != 50000 {
		t.Fatalf("got ticks %d start %d", ticks, start)
	}
	if _, _, err := ParsePidStat([]byte("12 (cs2) S 1 2 3")); err == nil {
		t.Fatal("want an error on a short stat")
	}
}

func TestParseStatusRSS(t *testing.T) {
	rss, err := ParseStatusRSS(fixture(t, "4242/status"))
	if err != nil {
		t.Fatal(err)
	}
	if rss != 4194304*1024 {
		t.Fatalf("got %d", rss)
	}
	// Zombies have no VmRSS line
	if _, err := ParseStatusRSS([]byte("Name:\tcs2\nState:\tZ (zombie)\n")); err == nil {
		t.Fatal("want an error without VmRSS")
	}
}

func TestSnapshotDeltas(t *testing.T) {
	root := copyProc(t)
	now := time.Date(2026, 9, 26, 12, 0, 0, 0, time.UTC)
	s := &Sampler{
		Root:     root,
		DiskPath: "/srv/cs2",
		Statfs: func(path string) (uint64, uint64, error) {
			if path != "/srv/cs2" {
				t.Errorf("statfs on %q", path)
			}
			return 500 << 30, 200 << 30, nil
		},
		Now: func() time.Time { return now },
	}
	refs := []Ref{
		{PID: 4242, Port: 27015, MatchID: "m1"},
		{PID: 5151, Port: 27016, MatchID: "m2"},
		// Gone from proc. Listed without numbers
		{PID: 9999, Port: 27017, MatchID: "m3"},
		// Not started yet
		{PID: 0, Port: 27018, MatchID: "m4"},
	}

	first := s.Snapshot(refs)
	if first.CPUPct != nil {
		t.Fatalf("first sample has no base, got cpu %v", *first.CPUPct)
	}
	if first.CPUs != 8 {
		t.Fatalf("cpus %d", first.CPUs)
	}
	if got := *first.MemUsedBytes; got != (32768000-20480000)*1024 {
		t.Fatalf("mem used %d", got)
	}
	if *first.DiskUsedBytes != 300<<30 || *first.DiskTotalBytes != 500<<30 {
		t.Fatalf("disk %d of %d", *first.DiskUsedBytes, *first.DiskTotalBytes)
	}
	if len(first.Load) != 3 || first.Load[0] != 2.15 {
		t.Fatalf("load %v", first.Load)
	}
	if len(first.Servers) != 3 {
		t.Fatalf("servers %+v", first.Servers)
	}
	// First sight of a pid uses the average since it started. 350 s of cpu over 500 s
	if p := first.Servers[0].CPUPct; p == nil || *p != 70 {
		t.Fatalf("m1 lifetime cpu %v", p)
	}
	if p := first.Servers[1].CPUPct; p == nil || *p != 1.5 {
		t.Fatalf("m2 lifetime cpu %v", p)
	}
	if *first.Servers[0].RSSBytes != 4194304*1024 {
		t.Fatalf("m1 rss %d", *first.Servers[0].RSSBytes)
	}
	if gone := first.Servers[2]; gone.MatchID != "m3" || gone.CPUPct != nil || gone.RSSBytes != nil {
		t.Fatalf("gone pid %+v", gone)
	}

	// 30 s later. 1000 more ticks of which 600 idle, 4242 used 1500 ticks, 5151 restarted with a new start time
	now = now.Add(30 * time.Second)
	write(t, root, "stat", strings.Replace(string(fixture(t, "stat")), "cpu  10000 500 3000 80000 1500", "cpu  10300 500 3100 80500 1600", 1))
	write(t, root, "4242/stat", strings.Replace(string(fixture(t, "4242/stat")), "30000 5000", "31000 5500", 1))
	write(t, root, "5151/stat", strings.Replace(string(fixture(t, "5151/stat")), " 90000 ", " 99000 ", 1))
	write(t, root, "uptime", "1020.00 7000.00\n")

	second := s.Snapshot(refs)
	if second.CPUPct == nil || *second.CPUPct != 40 {
		t.Fatalf("cpu %v", second.CPUPct)
	}
	if p := second.Servers[0].CPUPct; p == nil || *p != 50 {
		t.Fatalf("m1 cpu %v", p)
	}
	// A reused pid is new, so it falls back to its own lifetime. 1.5 s over 30 s
	if p := second.Servers[1].CPUPct; p == nil || *p != 5 {
		t.Fatalf("m2 cpu %v", p)
	}

	// A poll inside the minimum window repeats the last figure and keeps the base
	now = now.Add(200 * time.Millisecond)
	third := s.Snapshot(refs)
	if third.CPUPct == nil || *third.CPUPct != 40 {
		t.Fatalf("repeat cpu %v", third.CPUPct)
	}
	now = now.Add(29800 * time.Millisecond)
	write(t, root, "4242/stat", strings.Replace(string(fixture(t, "4242/stat")), "30000 5000", "31300 5800", 1))
	fourth := s.Snapshot(refs)
	// 600 ticks over the 30 s since the second sample
	if p := fourth.Servers[0].CPUPct; p == nil || *p != 20 {
		t.Fatalf("m1 cpu after short poll %v", p)
	}
}

func TestSnapshotMissingFiles(t *testing.T) {
	s := &Sampler{
		Root:   t.TempDir(),
		Statfs: func(string) (uint64, uint64, error) { return 0, 0, errors.New("no fs") },
	}
	snap := s.Snapshot([]Ref{{PID: 1, Port: 27015, MatchID: "m"}})
	if snap.CPUPct != nil || snap.MemTotalBytes != nil || snap.Load != nil || snap.DiskTotalBytes != nil {
		t.Fatalf("want empty fields, got %+v", snap)
	}
	b, _ := json.Marshal(snap)
	// Unknown numbers are left out, never sent as zero
	for _, k := range []string{"cpuPct", "memUsedBytes", "diskTotalBytes", "load", "rssBytes"} {
		if strings.Contains(string(b), k) {
			t.Fatalf("%s present in %s", k, b)
		}
	}
	if !strings.Contains(string(b), `"servers":[{"pid":1,"port":27015,"matchId":"m"}]`) {
		t.Fatalf("servers missing in %s", b)
	}
}

func TestNilSampler(t *testing.T) {
	var s *Sampler
	s.Prime()
	if s.Snapshot(nil) != nil {
		t.Fatal("nil sampler must report nothing")
	}
}
