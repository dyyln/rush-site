// Package webhook posts signed match events to the API, as described in docs/CONTRACTS.md.
package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// SignatureHeader carries sha256=<hex hmac of the body>.
const SignatureHeader = "X-Rushsite-Signature"

// Sign returns the header value for body.
func Sign(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// Abandoned is the match_abandoned event.
type Abandoned struct {
	Type            string   `json:"type"`
	Reason          string   `json:"reason"`
	MissingSteamIDs []string `json:"missingSteamIds"`
}

// ServerCrashed is the event sent when a match server dies on its own.
func ServerCrashed() Abandoned {
	return Abandoned{Type: "match_abandoned", Reason: "server_crashed", MissingSteamIDs: []string{}}
}

// Sender posts events with retries.
type Sender struct {
	Attempts int
	Backoff  time.Duration // doubled after each failed attempt
}

// Send posts {event} to url, retrying on network errors and non 2xx replies.
func (s Sender) Send(ctx context.Context, url, secret string, event any) error {
	body, err := json.Marshal(map[string]any{"event": event})
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	attempts := s.Attempts
	if attempts < 1 {
		attempts = 1
	}
	wait := s.Backoff
	var last error
	for i := 0; i < attempts; i++ {
		if i > 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(wait):
			}
			wait *= 2
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set(SignatureHeader, Sign(secret, body))
		resp, err := client.Do(req)
		if err != nil {
			last = err
			continue
		}
		resp.Body.Close()
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}
		last = fmt.Errorf("webhook returned %s", resp.Status)
	}
	return fmt.Errorf("after %d attempts: %w", attempts, last)
}
