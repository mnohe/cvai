package httpmw

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestLoggerRecordsMethodRouteStatusAndRequestID(t *testing.T) {
	var buf bytes.Buffer
	original := Logger
	Logger = slog.New(slog.NewJSONHandler(&buf, nil))
	t.Cleanup(func() { Logger = original })

	mux := http.NewServeMux()
	mux.HandleFunc("POST /admin/users/{uid}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})
	handler := WithRequestID(RequestLogger(mux))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/admin/users/subject-poison", nil))

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("log line is not valid JSON: %v (line: %s)", err, buf.String())
	}
	if entry["method"] != http.MethodPost {
		t.Fatalf("method = %v", entry["method"])
	}
	if entry["route"] != "POST /admin/users/{uid}" {
		t.Fatalf("route = %v", entry["route"])
	}
	if bytes.Contains(buf.Bytes(), []byte("subject-poison")) {
		t.Fatalf("concrete path leaked into log: %s", buf.String())
	}
	if entry["status"] != float64(http.StatusCreated) {
		t.Fatalf("status = %v, want 201", entry["status"])
	}
	if entry["request_id"] == "" || entry["request_id"] == nil {
		t.Fatal("request_id missing from log entry")
	}
}

func TestRequestLoggerRecordsAuthenticationAndIgnoresDuplicateHeaders(t *testing.T) {
	var buf bytes.Buffer
	original := Logger
	Logger = slog.New(slog.NewJSONHandler(&buf, nil))
	t.Cleanup(func() { Logger = original })

	handler := RequestLogger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		MarkAuthenticated(r.Context())
		w.WriteHeader(http.StatusAccepted)
		w.WriteHeader(http.StatusTeapot)
	}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/account", nil))

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("decode log: %v", err)
	}
	if entry["uid_set"] != true {
		t.Fatalf("uid_set = %v", entry["uid_set"])
	}
	if entry["status"] != float64(http.StatusAccepted) || rec.Code != http.StatusAccepted {
		t.Fatalf("status log=%v response=%d", entry["status"], rec.Code)
	}
}

func TestRequestLoggerRecoversPanicWithoutLoggingItsValue(t *testing.T) {
	var buf bytes.Buffer
	original := Logger
	Logger = slog.New(slog.NewJSONHandler(&buf, nil))
	t.Cleanup(func() { Logger = original })

	handler := WithRequestID(RequestLogger(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("protected panic detail")
	})))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/panic", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", rec.Code)
	}
	if bytes.Contains(buf.Bytes(), []byte("protected panic detail")) {
		t.Fatalf("panic value leaked into logs: %s", buf.String())
	}

	var entries []map[string]any
	scanner := bufio.NewScanner(bytes.NewReader(buf.Bytes()))
	for scanner.Scan() {
		var entry map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			t.Fatalf("decode log line: %v", err)
		}
		entries = append(entries, entry)
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan logs: %v", err)
	}
	if len(entries) != 2 || entries[0]["msg"] != "http_panic_recovered" || entries[1]["msg"] != "http_request" {
		t.Fatalf("log entries = %#v", entries)
	}
	if entries[1]["status"] != float64(http.StatusInternalServerError) {
		t.Fatalf("completion status = %v", entries[1]["status"])
	}
}

func TestRequestLoggerUsesSentinelForUnmatchedRoute(t *testing.T) {
	var buf bytes.Buffer
	original := Logger
	Logger = slog.New(slog.NewJSONHandler(&buf, nil))
	t.Cleanup(func() { Logger = original })

	handler := RequestLogger(http.NotFoundHandler())
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/subject-poison", nil))

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("decode log: %v", err)
	}
	if entry["route"] != unmatchedRoutePattern {
		t.Fatalf("route = %v, want %q", entry["route"], unmatchedRoutePattern)
	}
	if bytes.Contains(buf.Bytes(), []byte("subject-poison")) {
		t.Fatalf("unmatched path leaked into log: %s", buf.String())
	}
}

func TestMarkAuthenticatedWithoutLoggerContextIsNoOp(t *testing.T) {
	MarkAuthenticated(context.Background())
}

func TestRequestLoggerDefaultsStatusTo200WhenHandlerNeverCallsWriteHeader(t *testing.T) {
	var buf bytes.Buffer
	original := Logger
	Logger = slog.New(slog.NewJSONHandler(&buf, nil))
	t.Cleanup(func() { Logger = original })

	handler := RequestLogger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("log line is not valid JSON: %v", err)
	}
	if entry["status"] != float64(http.StatusOK) {
		t.Fatalf("status = %v, want 200", entry["status"])
	}
}
