// Package slots hands out game ports from a fixed range.
package slots

import (
	"errors"
	"fmt"
	"net"
	"sync"
)

// ErrFull means every port in the range is taken.
var ErrFull = errors.New("no free slots")

// Allocator tracks which ports are in use. Safe for concurrent use.
type Allocator struct {
	mu    sync.Mutex
	lo    int
	hi    int
	used  map[int]string
	probe func(port int) bool
}

// New returns an allocator for the inclusive range lo..hi.
// probe, if set, is asked whether a port is really free on the host before it is handed out.
func New(lo, hi int, probe func(port int) bool) *Allocator {
	return &Allocator{lo: lo, hi: hi, used: make(map[int]string), probe: probe}
}

// Acquire reserves the lowest free port for owner.
func (a *Allocator) Acquire(owner string) (int, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for p := a.lo; p <= a.hi; p++ {
		if _, taken := a.used[p]; taken {
			continue
		}
		if a.probe != nil && !a.probe(p) {
			continue
		}
		a.used[p] = owner
		return p, nil
	}
	return 0, ErrFull
}

// Claim reserves a specific port, used when adopting a server that is already running.
func (a *Allocator) Claim(port int, owner string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if port < a.lo || port > a.hi {
		return fmt.Errorf("port %d is outside %d-%d", port, a.lo, a.hi)
	}
	if o, taken := a.used[port]; taken {
		return fmt.Errorf("port %d already held by %s", port, o)
	}
	a.used[port] = owner
	return nil
}

// Release frees port. Releasing a free port does nothing.
func (a *Allocator) Release(port int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.used, port)
}

// Owner returns who holds port.
func (a *Allocator) Owner(port int) (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	o, ok := a.used[port]
	return o, ok
}

// Total is the size of the range.
func (a *Allocator) Total() int { return a.hi - a.lo + 1 }

// Free is the number of ports not reserved by the agent.
func (a *Allocator) Free() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.Total() - len(a.used)
}

// UDPFree reports whether every given UDP port can be bound on this host.
func UDPFree(ports ...int) bool {
	for _, p := range ports {
		c, err := net.ListenPacket("udp", fmt.Sprintf(":%d", p))
		if err != nil {
			return false
		}
		_ = c.Close()
	}
	return true
}
