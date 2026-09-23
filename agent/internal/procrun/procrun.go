// Package procrun starts and stops OS processes behind an interface so tests can fake them.
package procrun

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"
	"time"
)

// Spec describes a process to start.
type Spec struct {
	Path   string
	Args   []string
	Dir    string
	Env    []string
	Stdout io.Writer // receives stdout and stderr. Nil discards.
}

// Process is a started process.
type Process interface {
	Pid() int
	// Wait blocks until exit and returns the exit code, or -1 when killed by a signal.
	// It is safe to call more than once and from several goroutines.
	Wait() int
	// Stop sends SIGTERM to the process group, then SIGKILL after grace, and waits for exit.
	Stop(grace time.Duration)
}

// Runner starts processes.
type Runner interface {
	Start(spec Spec) (Process, error)
}

// ExecRunner runs real processes with os/exec.
type ExecRunner struct{}

type execProc struct {
	cmd  *exec.Cmd
	done chan struct{}
	code int
}

// Start launches spec in its own process group.
func (ExecRunner) Start(spec Spec) (Process, error) {
	cmd := exec.Command(spec.Path, spec.Args...)
	cmd.Dir = spec.Dir
	cmd.Env = spec.Env
	cmd.Stdout = spec.Stdout
	cmd.Stderr = spec.Stdout
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	p := &execProc{cmd: cmd, done: make(chan struct{})}
	go func() {
		p.code = exitCode(cmd.Wait())
		close(p.done)
	}()
	return p, nil
}

func (p *execProc) Pid() int { return p.cmd.Process.Pid }

func (p *execProc) Wait() int {
	<-p.done
	return p.code
}

func (p *execProc) Stop(grace time.Duration) {
	pid := p.cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	select {
	case <-p.done:
		return
	case <-time.After(grace):
	}
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	<-p.done
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	return -1
}

// Run starts spec and waits for it to exit.
func Run(r Runner, spec Spec) (int, error) {
	p, err := r.Start(spec)
	if err != nil {
		return -1, err
	}
	return p.Wait(), nil
}

// Alive reports whether pid exists and is not a zombie.
func Alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	if err := syscall.Kill(pid, 0); err != nil && !errors.Is(err, syscall.EPERM) {
		return false
	}
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return true
	}
	// The state field follows the command name, which is wrapped in parens.
	if i := bytes.LastIndexByte(b, ')'); i >= 0 && i+2 < len(b) && b[i+2] == 'Z' {
		return false
	}
	return true
}

// Adopt wraps a running process that is not a child of this one, such as a CS2 server
// left running across an agent restart. Exit is found by polling, so Wait returns -1.
func Adopt(pid int, poll time.Duration) Process {
	p := &adoptedProc{pid: pid, done: make(chan struct{})}
	go func() {
		for Alive(pid) {
			time.Sleep(poll)
		}
		close(p.done)
	}()
	return p
}

type adoptedProc struct {
	pid  int
	done chan struct{}
}

func (p *adoptedProc) Pid() int { return p.pid }

func (p *adoptedProc) Wait() int {
	<-p.done
	return -1
}

func (p *adoptedProc) Stop(grace time.Duration) {
	if err := syscall.Kill(-p.pid, syscall.SIGTERM); err != nil {
		_ = syscall.Kill(p.pid, syscall.SIGTERM)
	}
	select {
	case <-p.done:
		return
	case <-time.After(grace):
	}
	if err := syscall.Kill(-p.pid, syscall.SIGKILL); err != nil {
		_ = syscall.Kill(p.pid, syscall.SIGKILL)
	}
	<-p.done
}
