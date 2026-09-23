package webhook

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestSendSignsAndRetries(t *testing.T) {
	var calls atomic.Int32
	var gotBody, gotSig string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		if calls.Add(1) < 3 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		gotBody, gotSig = string(b), r.Header.Get(SignatureHeader)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	s := Sender{Attempts: 3, Backoff: time.Millisecond}
	if err := s.Send(context.Background(), srv.URL, "whsec", ServerCrashed()); err != nil {
		t.Fatal(err)
	}
	want := `{"event":{"type":"match_abandoned","reason":"server_crashed","missingSteamIds":[]}}`
	if gotBody != want {
		t.Fatalf("body %s", gotBody)
	}
	if gotSig != Sign("whsec", []byte(want)) || len(gotSig) != len("sha256=")+64 {
		t.Fatalf("signature %s", gotSig)
	}
	if calls.Load() != 3 {
		t.Fatalf("calls %d", calls.Load())
	}
}

func TestSendGivesUp(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	err := Sender{Attempts: 2, Backoff: time.Millisecond}.Send(context.Background(), srv.URL, "s", ServerCrashed())
	if err == nil || calls.Load() != 2 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
}

func TestSignKnownValue(t *testing.T) {
	// echo -n 'hello' | openssl dgst -sha256 -hmac key
	if got := Sign("key", []byte("hello")); got != "sha256=9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b" {
		t.Fatal(got)
	}
}
