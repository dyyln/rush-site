package procrun

import (
	"io"
	"sync"
	"time"
)

// FakeBehavior controls what a fake process does when started.
type FakeBehavior struct {
	ExitNow bool   // exit right away with Code
	Code    int    // exit code when ExitNow is set
	Output  string // written to Spec.Stdout on start
	Err     error  // Start fails with this error
}

// FakeRunner records starts and hands out FakeProcess values. For tests.
type FakeRunner struct {
	// Behavior picks the outcome per spec. Nil means a long running process.
	Behavior func(Spec) FakeBehavior

	mu      sync.Mutex
	nextPID int
	Specs   []Spec
	Procs   []*FakeProcess
}

// Start implements Runner.
func (r *FakeRunner) Start(spec Spec) (Process, error) {
	var b FakeBehavior
	if r.Behavior != nil {
		b = r.Behavior(spec)
	}
	r.mu.Lock()
	r.Specs = append(r.Specs, spec)
	if b.Err != nil {
		r.mu.Unlock()
		return nil, b.Err
	}
	r.nextPID++
	p := &FakeProcess{pid: 1000 + r.nextPID, done: make(chan struct{}), Spec: spec}
	r.Procs = append(r.Procs, p)
	r.mu.Unlock()
	if b.Output != "" && spec.Stdout != nil {
		_, _ = io.WriteString(spec.Stdout, b.Output)
	}
	if b.ExitNow {
		p.Exit(b.Code)
	}
	return p, nil
}

// Last returns the most recently started process or nil.
func (r *FakeRunner) Last() *FakeProcess {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.Procs) == 0 {
		return nil
	}
	return r.Procs[len(r.Procs)-1]
}

// StartCount returns how many starts were attempted.
func (r *FakeRunner) StartCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.Specs)
}

// FakeProcess is a process that exits when told to.
type FakeProcess struct {
	Spec Spec

	pid     int
	done    chan struct{}
	once    sync.Once
	code    int
	mu      sync.Mutex
	stopped bool
}

// Exit makes the process exit with code. Later calls do nothing.
func (p *FakeProcess) Exit(code int) {
	p.once.Do(func() {
		p.code = code
		close(p.done)
	})
}

// Stopped reports whether Stop was called.
func (p *FakeProcess) Stopped() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.stopped
}

func (p *FakeProcess) Pid() int { return p.pid }

func (p *FakeProcess) Wait() int {
	<-p.done
	return p.code
}

func (p *FakeProcess) Stop(time.Duration) {
	p.mu.Lock()
	p.stopped = true
	p.mu.Unlock()
	p.Exit(-1)
}

// NewFakeProcess returns a running fake process with the given pid.
func NewFakeProcess(pid int) *FakeProcess {
	return &FakeProcess{pid: pid, done: make(chan struct{})}
}
