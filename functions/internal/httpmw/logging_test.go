package httpmw

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestLoggerRecordsMethodPathStatusAndRequestID(t *testing.T) {
	var buf bytes.Buffer
	original := Logger
	Logger = slog.New(slog.NewJSONHandler(&buf, nil))
	t.Cleanup(func() { Logger = original })

	handler := WithRequestID(RequestLogger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	})))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/cv/imports", nil))

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("log line is not valid JSON: %v (line: %s)", err, buf.String())
	}
	if entry["method"] != http.MethodPost {
		t.Fatalf("method = %v", entry["method"])
	}
	if entry["path"] != "/cv/imports" {
		t.Fatalf("path = %v", entry["path"])
	}
	if entry["status"] != float64(http.StatusCreated) {
		t.Fatalf("status = %v, want 201", entry["status"])
	}
	if entry["request_id"] == "" || entry["request_id"] == nil {
		t.Fatal("request_id missing from log entry")
	}
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
