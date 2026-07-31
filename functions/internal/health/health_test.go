package health

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"cloud.google.com/go/firestore"
)

func TestHandlerReportsOKWhenFirestoreIsReachable(t *testing.T) {
	client := mustNewClient(t)

	rec := httptest.NewRecorder()
	Handler(client).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Status       string            `json:"status"`
		Dependencies map[string]string `json:"dependencies"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if body.Status != "ok" {
		t.Fatalf("status field = %q, want ok", body.Status)
	}
	if body.Dependencies["firestore"] != "ok" {
		t.Fatalf("dependencies.firestore = %q, want ok", body.Dependencies["firestore"])
	}
}

func TestHandlerReportsDegradedWhenFirestoreIsUnreachable(t *testing.T) {
	client := mustNewClient(t)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	ctx, cancel := context.WithCancel(req.Context())
	cancel() // force the probe to fail immediately, without a real outage
	req = req.WithContext(ctx)

	rec := httptest.NewRecorder()
	Handler(client).ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503, body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Status       string            `json:"status"`
		Dependencies map[string]string `json:"dependencies"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if body.Status != "degraded" {
		t.Fatalf("status field = %q, want degraded", body.Status)
	}
	if body.Dependencies["firestore"] != "unavailable" {
		t.Fatalf("dependencies.firestore = %q, want unavailable", body.Dependencies["firestore"])
	}
}

func mustNewClient(t *testing.T) *firestore.Client {
	t.Helper()
	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
		t.Skip("FIRESTORE_EMULATOR_HOST not set; skipping Firestore integration test")
	}
	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	if projectID == "" {
		projectID = "demo-cvai"
	}
	client, err := firestore.NewClient(context.Background(), projectID)
	if err != nil {
		t.Fatalf("firestore.NewClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}
