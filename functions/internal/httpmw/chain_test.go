package httpmw

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	firebaseauth "firebase.google.com/go/v4/auth"

	"github.com/mnohe/cvai/functions/internal/auth"
)

var errInvalidToken = errors.New("invalid token")

// This file tests the exact production composition (WrapAuthenticated,
// WrapPublic), not each middleware in isolation — the bugs these guard
// against were wiring/ordering mistakes that unit tests of the individual
// pieces did not, and structurally could not, catch.

type fakeVerifier struct {
	token *firebaseauth.Token
	err   error
}

func (f *fakeVerifier) VerifyIDToken(context.Context, string) (*firebaseauth.Token, error) {
	return f.token, f.err
}

func withCapturedLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	original := Logger
	Logger = slog.New(slog.NewJSONHandler(&buf, nil))
	t.Cleanup(func() { Logger = original })
	return &buf
}

func logLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for _, raw := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if raw == "" {
			continue
		}
		var entry map[string]any
		if err := json.Unmarshal([]byte(raw), &entry); err != nil {
			t.Fatalf("log line is not valid JSON: %v (line: %s)", err, raw)
		}
		lines = append(lines, entry)
	}
	return lines
}

func findLine(lines []map[string]any, msg string) map[string]any {
	for _, line := range lines {
		if line["msg"] == msg {
			return line
		}
	}
	return nil
}

func TestWrapAuthenticatedLogsUIDSetTrueForARealAuthenticatedRequest(t *testing.T) {
	buf := withCapturedLog(t)
	authMW := auth.NewWithVerifier(&fakeVerifier{token: &firebaseauth.Token{UID: "uid-1"}})
	rl := NewRateLimiter(120, 20)
	handler := WithRequestID(WrapAuthenticated(authMW, rl, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	req := httptest.NewRequest(http.MethodGet, "/account", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	line := findLine(logLines(t, buf), "http_request")
	if line == nil {
		t.Fatal("no http_request completion log line")
	}
	if line["uid_set"] != true {
		t.Fatalf("uid_set = %v, want true for an authenticated request", line["uid_set"])
	}
}

func TestWrapPublicLogsUIDSetFalseForAnUnauthenticatedRequest(t *testing.T) {
	buf := withCapturedLog(t)
	handler := WithRequestID(WrapPublic(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	line := findLine(logLines(t, buf), "http_request")
	if line == nil {
		t.Fatal("no http_request completion log line")
	}
	if line["uid_set"] != false {
		t.Fatalf("uid_set = %v, want false for an unauthenticated request", line["uid_set"])
	}
}

func TestWrapAuthenticatedStillLogsExactlyOneCompletionEntryWhenTheHandlerPanics(t *testing.T) {
	buf := withCapturedLog(t)
	authMW := auth.NewWithVerifier(&fakeVerifier{token: &firebaseauth.Token{UID: "uid-1"}})
	rl := NewRateLimiter(120, 20)
	handler := WithRequestID(WrapAuthenticated(authMW, rl, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("boom")
	})))

	req := httptest.NewRequest(http.MethodGet, "/account", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	lines := logLines(t, buf)
	var completions int
	for _, line := range lines {
		if line["msg"] == "http_request" {
			completions++
			if line["status"] != float64(http.StatusInternalServerError) {
				t.Fatalf("completion log status = %v, want 500", line["status"])
			}
		}
	}
	if completions != 1 {
		t.Fatalf("http_request completion lines = %d, want exactly 1 (lines: %v)", completions, lines)
	}
}

// TestWrapAuthenticatedLogsRejectionsWithUIDSetFalse is the regression test
// for the Attempt 2 review finding: RequestLogger sat inside RequireAuth, so
// a rejected (401/403) request — which RequireAuth's rejection path answers
// directly, without ever calling its next handler — never reached it and
// produced no completion log at all.
func TestWrapAuthenticatedLogsRejectionsWithUIDSetFalse(t *testing.T) {
	tests := []struct {
		name       string
		authHeader string
		verifyErr  error
		wantStatus int
	}{
		{name: "missing bearer token", authHeader: "", wantStatus: http.StatusUnauthorized},
		{name: "malformed authorization scheme", authHeader: "Basic dXNlcjpwYXNz", wantStatus: http.StatusUnauthorized},
		{name: "invalid token", authHeader: "Bearer garbage", verifyErr: errInvalidToken, wantStatus: http.StatusForbidden},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			buf := withCapturedLog(t)
			authMW := auth.NewWithVerifier(&fakeVerifier{err: tc.verifyErr})
			rl := NewRateLimiter(120, 20)
			called := false
			handler := WithRequestID(WrapAuthenticated(authMW, rl, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			})))

			req := httptest.NewRequest(http.MethodGet, "/account", nil)
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if called {
				t.Fatal("the real route handler ran despite a rejected auth check")
			}

			lines := logLines(t, buf)
			var completions int
			for _, line := range lines {
				if line["msg"] != "http_request" {
					continue
				}
				completions++
				if line["status"] != float64(tc.wantStatus) {
					t.Fatalf("completion log status = %v, want %d", line["status"], tc.wantStatus)
				}
				if line["uid_set"] != false {
					t.Fatalf("uid_set = %v, want false for a rejected request", line["uid_set"])
				}
			}
			if completions != 1 {
				t.Fatalf("http_request completion lines = %d, want exactly 1 (lines: %v)", completions, lines)
			}
		})
	}
}

func TestWrapAuthenticatedNeverLogsASensitivePanicValue(t *testing.T) {
	buf := withCapturedLog(t)
	secret := "provider response contained CV excerpt: John Doe, SSN 123-45-6789"
	authMW := auth.NewWithVerifier(&fakeVerifier{token: &firebaseauth.Token{UID: "uid-1"}})
	rl := NewRateLimiter(120, 20)
	handler := WithRequestID(WrapAuthenticated(authMW, rl, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic(secret)
	})))

	req := httptest.NewRequest(http.MethodGet, "/account", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if strings.Contains(rec.Body.String(), secret) {
		t.Fatalf("response body leaked the panic value: %s", rec.Body.String())
	}
	if strings.Contains(buf.String(), secret) {
		t.Fatalf("captured logs leaked the panic value: %s", buf.String())
	}
	line := findLine(logLines(t, buf), "http_panic_recovered")
	if line == nil {
		t.Fatal("no http_panic_recovered log line")
	}
	if line["panic_type"] != "string" {
		t.Fatalf("panic_type = %v, want string (a safe classification, not the value)", line["panic_type"])
	}
}
