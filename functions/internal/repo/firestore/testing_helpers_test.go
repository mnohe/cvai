package firestore_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
)

// mustNewClient creates a Firestore client for integration tests.
// Tests are skipped when FIRESTORE_EMULATOR_HOST is not set.
func mustNewClient(t *testing.T, ctx context.Context) *firestore.Client {
	t.Helper()
	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
		t.Skip("FIRESTORE_EMULATOR_HOST not set; skipping Firestore integration test")
	}
	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	if projectID == "" {
		projectID = "demo-cvai"
	}
	client, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		t.Fatalf("firestore.NewClient: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

// newUID generates a unique test UID to isolate test data.
func newUID() string {
	return fmt.Sprintf("test-uid-%d", time.Now().UnixNano())
}
