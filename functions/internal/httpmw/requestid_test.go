package httpmw

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestWithRequestIDGeneratesAndSetsHeader(t *testing.T) {
	var seen string
	handler := WithRequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = RequestIDFromContext(r.Context())
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if seen == "" {
		t.Fatal("no request id reached the handler")
	}
	if got := rec.Header().Get(HeaderRequestID); got != seen {
		t.Fatalf("response header = %q, context value = %q", got, seen)
	}
}

func TestWithRequestIDReplacesUntrustedInboundHeader(t *testing.T) {
	var seen string
	handler := WithRequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = RequestIDFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderRequestID, "upstream-id-123")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if seen == "upstream-id-123" {
		t.Fatalf("request id reused user-controlled inbound value: %q", seen)
	}
	if _, err := uuid.Parse(seen); err != nil {
		t.Fatalf("request id = %q, want generated UUID: %v", seen, err)
	}
	if got := rec.Header().Get(HeaderRequestID); got != seen {
		t.Fatalf("response header = %q, context value = %q", got, seen)
	}
}

func TestRequestIDFromContextEmptyWhenUnset(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if got := RequestIDFromContext(req.Context()); got != "" {
		t.Fatalf("RequestIDFromContext = %q, want empty", got)
	}
}
