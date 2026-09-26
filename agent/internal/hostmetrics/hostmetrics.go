// Package hostmetrics reads machine and per server usage from /proc for GET /health.
// Only Linux builds report anything. Elsewhere New returns nil and Snapshot returns nil.
package hostmetrics

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// clockTicks is USER_HZ. It is 100 on every Linux build we run on.
const clockTicks = 100

// minWindow is the shortest gap between samples used for a CPU delta.
// A poll sooner than this gets the previous figure again.
const minWindow = time.Second

// Snapshot is the metrics block of GET /health. Fields are nil when they could not be read.
type Snapshot struct {
	SampledAt time.Time `json:"sampledAt"`
	// Whole machine busy percent across every core, 0 to 100
	CPUPct *float64 `json:"cpuPct,omitempty"`
	CPUs   int      `json:"cpus,omitempty"`
	// 1, 5 and 15 minute load averages
	Load           []float64 `json:"load,omitempty"`
	MemUsedBytes   *uint64   `json:"memUsedBytes,omitempty"`
	MemTotalBytes  *uint64   `json:"memTotalBytes,omitempty"`
	DiskUsedBytes  *uint64   `json:"diskUsedBytes,omitempty"`
	DiskTotalBytes *uint64   `json:"diskTotalBytes,omitempty"`
	Servers        []Server  `json:"servers"`
}

// Server is one running CS2 process.
type Server struct {
	PID     int    `json:"pid"`
	Port    int    `json:"port"`
	MatchID string `json:"matchId"`
	// Percent of one core, like top. A server using two full cores reads 200
	CPUPct   *float64 `json:"cpuPct,omitempty"`
	RSSBytes *uint64  `json:"rssBytes,omitempty"`
}

// Ref names a process the agent manages.
type Ref struct {
	PID     int
	Port    int
	MatchID string
}

// Sampler keeps the previous counters so CPU can be taken as a delta. Safe for concurrent use.
type Sampler struct {
	// Root is where proc is mounted, normally /proc
	Root string
	// DiskPath is a path on the filesystem to report, normally the CS2 dir
	DiskPath string
	// Statfs returns total and free bytes for a path. Nil skips disk
	Statfs func(path string) (total, free uint64, err error)
	Now    func() time.Time

	mu      sync.Mutex
	cpuBase *cpuSample
	lastCPU *float64
	procs   map[int]procSample
}

type cpuSample struct {
	at          time.Time
	total, idle uint64
	cpus        int
}

type procSample struct {
	at    time.Time
	ticks uint64
	start uint64
}

func (s *Sampler) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Prime records the first CPU counters so the next Snapshot has a delta.
func (s *Sampler) Prime() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, err := s.readCPU(); err == nil {
		c.at = s.now()
		s.cpuBase = &c
	}
}

// Snapshot reads the machine and the given processes. Nil on a nil sampler.
func (s *Sampler) Snapshot(refs []Ref) *Snapshot {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now()
	out := &Snapshot{SampledAt: now.UTC(), Servers: []Server{}}

	if cur, err := s.readCPU(); err == nil {
		cur.at = now
		out.CPUs = cur.cpus
		switch {
		case s.cpuBase == nil:
			s.cpuBase = &cur
		case now.Sub(s.cpuBase.at) < minWindow:
			out.CPUPct = s.lastCPU
		default:
			if pct, ok := cpuBusy(*s.cpuBase, cur); ok {
				s.lastCPU = &pct
				out.CPUPct = &pct
			}
			s.cpuBase = &cur
		}
	}
	if b, err := os.ReadFile(filepath.Join(s.Root, "loadavg")); err == nil {
		if l, err := ParseLoadAvg(b); err == nil {
			out.Load = l
		}
	}
	if b, err := os.ReadFile(filepath.Join(s.Root, "meminfo")); err == nil {
		if total, avail, err := ParseMemInfo(b); err == nil {
			used := total - min(avail, total)
			out.MemUsedBytes, out.MemTotalBytes = &used, &total
		}
	}
	if s.Statfs != nil && s.DiskPath != "" {
		if total, free, err := s.Statfs(s.DiskPath); err == nil && total > 0 {
			used := total - min(free, total)
			out.DiskUsedBytes, out.DiskTotalBytes = &used, &total
		}
	}
	out.Servers = s.servers(refs, now)
	return out
}

func (s *Sampler) readCPU() (cpuSample, error) {
	b, err := os.ReadFile(filepath.Join(s.Root, "stat"))
	if err != nil {
		return cpuSample{}, err
	}
	total, idle, cpus, err := ParseStat(b)
	return cpuSample{total: total, idle: idle, cpus: cpus}, err
}

func cpuBusy(prev, cur cpuSample) (float64, bool) {
	if cur.total <= prev.total || cur.idle < prev.idle {
		return 0, false
	}
	dt := float64(cur.total - prev.total)
	di := float64(cur.idle - prev.idle)
	return round1(clamp((dt-di)/dt*100, 0, 100)), true
}

// servers reads each process and keeps only live pids for the next delta.
func (s *Sampler) servers(refs []Ref, now time.Time) []Server {
	next := make(map[int]procSample, len(refs))
	out := make([]Server, 0, len(refs))
	var uptime float64
	uptimeRead := false
	for _, r := range refs {
		if r.PID <= 0 {
			continue
		}
		srv := Server{PID: r.PID, Port: r.Port, MatchID: r.MatchID}
		dir := filepath.Join(s.Root, strconv.Itoa(r.PID))
		if b, err := os.ReadFile(filepath.Join(dir, "stat")); err == nil {
			if ticks, start, err := ParsePidStat(b); err == nil {
				cur := procSample{at: now, ticks: ticks, start: start}
				prev, seen := s.procs[r.PID]
				switch {
				case seen && prev.start == start && now.Sub(prev.at) >= minWindow && ticks >= prev.ticks:
					pct := round1(float64(ticks-prev.ticks) / clockTicks / now.Sub(prev.at).Seconds() * 100)
					srv.CPUPct = &pct
				case seen && prev.start == start && now.Sub(prev.at) < minWindow:
					// Too soon for a fair delta. Keep the older base
					cur = prev
				default:
					// First sight of this pid. Use the average since it started
					if !uptimeRead {
						uptime, _ = s.uptime()
						uptimeRead = true
					}
					if age := uptime - float64(start)/clockTicks; age > 0 {
						pct := round1(float64(ticks) / clockTicks / age * 100)
						srv.CPUPct = &pct
					}
				}
				next[r.PID] = cur
			}
		}
		if b, err := os.ReadFile(filepath.Join(dir, "status")); err == nil {
			if rss, err := ParseStatusRSS(b); err == nil {
				srv.RSSBytes = &rss
			}
		}
		out = append(out, srv)
	}
	s.procs = next
	return out
}

func (s *Sampler) uptime() (float64, error) {
	b, err := os.ReadFile(filepath.Join(s.Root, "uptime"))
	if err != nil {
		return 0, err
	}
	f := strings.Fields(string(b))
	if len(f) == 0 {
		return 0, errors.New("empty uptime")
	}
	return strconv.ParseFloat(f[0], 64)
}

// ParseStat reads the aggregate cpu line of /proc/stat.
// Busy time is everything but idle and iowait. Guest time is already inside user.
func ParseStat(b []byte) (total, idle uint64, cpus int, err error) {
	found := false
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 0 || !strings.HasPrefix(f[0], "cpu") {
			continue
		}
		if f[0] != "cpu" {
			cpus++
			continue
		}
		if len(f) < 5 {
			return 0, 0, 0, errors.New("short cpu line")
		}
		// user nice system idle iowait irq softirq steal
		for i := 1; i < len(f) && i <= 8; i++ {
			v, perr := strconv.ParseUint(f[i], 10, 64)
			if perr != nil {
				return 0, 0, 0, fmt.Errorf("cpu field %d: %w", i, perr)
			}
			total += v
			if i == 4 || i == 5 {
				idle += v
			}
		}
		found = true
	}
	if !found {
		return 0, 0, 0, errors.New("no cpu line")
	}
	return total, idle, cpus, nil
}

// ParseLoadAvg reads the three load averages.
func ParseLoadAvg(b []byte) ([]float64, error) {
	f := strings.Fields(string(b))
	if len(f) < 3 {
		return nil, errors.New("short loadavg")
	}
	out := make([]float64, 3)
	for i := range out {
		v, err := strconv.ParseFloat(f[i], 64)
		if err != nil {
			return nil, err
		}
		out[i] = v
	}
	return out, nil
}

// ParseMemInfo returns MemTotal and MemAvailable in bytes.
func ParseMemInfo(b []byte) (total, avail uint64, err error) {
	var haveTotal, haveAvail bool
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) < 2 {
			continue
		}
		v, perr := strconv.ParseUint(f[1], 10, 64)
		if perr != nil {
			continue
		}
		switch f[0] {
		case "MemTotal:":
			total, haveTotal = v*1024, true
		case "MemAvailable:":
			avail, haveAvail = v*1024, true
		}
	}
	if !haveTotal || !haveAvail {
		return 0, 0, errors.New("meminfo lacks MemTotal or MemAvailable")
	}
	return total, avail, nil
}

// ParsePidStat returns utime plus stime and the start time, both in clock ticks.
// The command name can hold spaces and brackets, so fields are counted after the last ")".
func ParsePidStat(b []byte) (ticks, start uint64, err error) {
	i := bytes.LastIndexByte(b, ')')
	if i < 0 {
		return 0, 0, errors.New("no command name in stat")
	}
	// After ")" the first field is state, which is field 3
	f := strings.Fields(string(b[i+1:]))
	field := func(n int) (uint64, error) {
		idx := n - 3
		if idx >= len(f) {
			return 0, fmt.Errorf("stat has no field %d", n)
		}
		return strconv.ParseUint(f[idx], 10, 64)
	}
	utime, err := field(14)
	if err != nil {
		return 0, 0, err
	}
	stime, err := field(15)
	if err != nil {
		return 0, 0, err
	}
	start, err = field(22)
	if err != nil {
		return 0, 0, err
	}
	return utime + stime, start, nil
}

// ParseStatusRSS returns VmRSS in bytes.
func ParseStatusRSS(b []byte) (uint64, error) {
	sc := bufio.NewScanner(bytes.NewReader(b))
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) >= 2 && f[0] == "VmRSS:" {
			v, err := strconv.ParseUint(f[1], 10, 64)
			if err != nil {
				return 0, err
			}
			return v * 1024, nil
		}
	}
	return 0, errors.New("no VmRSS")
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }
