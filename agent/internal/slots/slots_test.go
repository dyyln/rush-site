package slots

import (
	"errors"
	"sync"
	"testing"
)

func TestAcquireLowestFirstAndRelease(t *testing.T) {
	a := New(27015, 27017, nil)
	if a.Total() != 3 || a.Free() != 3 {
		t.Fatalf("total=%d free=%d", a.Total(), a.Free())
	}
	for i, want := range []int{27015, 27016, 27017} {
		p, err := a.Acquire("m")
		if err != nil || p != want {
			t.Fatalf("acquire %d: got %d, %v", i, p, err)
		}
	}
	if _, err := a.Acquire("m"); !errors.Is(err, ErrFull) {
		t.Fatalf("want ErrFull, got %v", err)
	}
	a.Release(27016)
	if a.Free() != 1 {
		t.Fatalf("free=%d", a.Free())
	}
	p, err := a.Acquire("n")
	if err != nil || p != 27016 {
		t.Fatalf("reacquire got %d, %v", p, err)
	}
	if o, ok := a.Owner(27016); !ok || o != "n" {
		t.Fatalf("owner=%q ok=%v", o, ok)
	}
	a.Release(27016)
	a.Release(27016)
	if a.Free() != 1 {
		t.Fatalf("double release changed count, free=%d", a.Free())
	}
}

func TestProbeSkipsBusyPorts(t *testing.T) {
	busy := map[int]bool{27015: true}
	a := New(27015, 27016, func(p int) bool { return !busy[p] })
	p, err := a.Acquire("m")
	if err != nil || p != 27016 {
		t.Fatalf("got %d, %v", p, err)
	}
	if _, err := a.Acquire("m"); !errors.Is(err, ErrFull) {
		t.Fatalf("want ErrFull, got %v", err)
	}
	busy[27015] = false
	if p, err := a.Acquire("m"); err != nil || p != 27015 {
		t.Fatalf("got %d, %v", p, err)
	}
}

func TestConcurrentAcquireGivesUniquePorts(t *testing.T) {
	a := New(30000, 30049, nil)
	var mu sync.Mutex
	seen := map[int]bool{}
	var wg sync.WaitGroup
	for i := 0; i < 60; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := a.Acquire("x")
			if err != nil {
				return
			}
			mu.Lock()
			defer mu.Unlock()
			if seen[p] {
				t.Errorf("port %d handed out twice", p)
			}
			seen[p] = true
		}()
	}
	wg.Wait()
	if len(seen) != 50 || a.Free() != 0 {
		t.Fatalf("seen=%d free=%d", len(seen), a.Free())
	}
}

func TestClaim(t *testing.T) {
	a := New(27015, 27016, nil)
	if err := a.Claim(27016, "old"); err != nil {
		t.Fatal(err)
	}
	if err := a.Claim(27016, "x"); err == nil {
		t.Fatal("double claim allowed")
	}
	if err := a.Claim(28000, "x"); err == nil {
		t.Fatal("out of range claim allowed")
	}
	if p, _ := a.Acquire("new"); p != 27015 {
		t.Fatalf("got %d", p)
	}
}
