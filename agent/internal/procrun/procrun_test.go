package procrun

import (
	"bytes"
	"os"
	"testing"
	"time"
)

func TestExecRunnerExitCodeAndOutput(t *testing.T) {
	var out bytes.Buffer
	code, err := Run(ExecRunner{}, Spec{Path: "/bin/sh", Args: []string{"-c", "echo hi; exit 3"}, Stdout: &out})
	if err != nil || code != 3 || out.String() != "hi\n" {
		t.Fatalf("code=%d err=%v out=%q", code, err, out.String())
	}
}

func TestExecRunnerStopKillsGroup(t *testing.T) {
	p, err := ExecRunner{}.Start(Spec{Path: "/bin/sh", Args: []string{"-c", "sleep 30 & sleep 30; wait"}})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	p.Stop(2 * time.Second)
	if time.Since(start) > 3*time.Second {
		t.Fatal("stop took too long")
	}
	if Alive(p.Pid()) {
		t.Fatal("still alive")
	}
}

func TestAlive(t *testing.T) {
	if !Alive(os.Getpid()) || Alive(0) || Alive(1<<22+12345) {
		t.Fatal("Alive gave wrong answers")
	}
}
