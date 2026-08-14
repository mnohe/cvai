package httpmw

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecoverReturnsSafeErrorAndNeverLeaksThePanicValue(t *testing.T) {
	secret := "internal file path /etc/secret-config.yaml and a stack trace"
	handler := WithRequestID(Recover(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic(secret)
	})))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/boom", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if strings.Contains(rec.Body.String(), secret) {
		t.Fatalf("response body leaked the panic value: %s", rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if body["error"] != "internal server error" {
		t.Fatalf("error = %q", body["error"])
	}
	if body["requestId"] == "" {
		t.Fatal("requestId is empty, want a correlation id")
	}
	if got := rec.Header().Get(HeaderRequestID); got != body["requestId"] {
		t.Fatalf("response header request id = %q, body requestId = %q", got, body["requestId"])
	}
}

func TestRecoverLogsRoutePatternWithoutConcretePath(t *testing.T) {
	var buf bytes.Buffer
	original := Logger
	Logger = slog.New(slog.NewJSONHandler(&buf, nil))
	t.Cleanup(func() { Logger = original })

	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/users/{uid}", func(http.ResponseWriter, *http.Request) {
		panic("safe classification only")
	})
	handler := WithRequestID(Recover(mux))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/admin/users/subject-poison", nil))

	var entry map[string]any
	if err := json.Unmarshal(buf.Bytes(), &entry); err != nil {
		t.Fatalf("decode log: %v", err)
	}
	if entry["route"] != "GET /admin/users/{uid}" {
		t.Fatalf("route = %v", entry["route"])
	}
	if bytes.Contains(buf.Bytes(), []byte("subject-poison")) {
		t.Fatalf("concrete path leaked into panic log: %s", buf.String())
	}
}

func TestRecoverDoesNotInterfereWithNonPanickingHandlers(t *testing.T) {
	handler := Recover(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("fine"))
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want 418", rec.Code)
	}
	if rec.Body.String() != "fine" {
		t.Fatalf("body = %q", rec.Body.String())
	}
}
