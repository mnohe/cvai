package firestore_test

import (
	"context"
	"testing"

	fsrepo "github.com/mnohe/cvai/functions/internal/repo/firestore"
)

func TestAccountRepo_GetProfile_CreatesOnFirstRead(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewAccountRepo(client)
	uid := newUID()

	acc, err := r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if acc.UID != uid {
		t.Errorf("UID = %q, want %q", acc.UID, uid)
	}
}

func TestAccountRepo_GetProfile_Idempotent(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewAccountRepo(client)
	uid := newUID()

	first, err := r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("first GetProfile: %v", err)
	}
	second, err := r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("second GetProfile: %v", err)
	}
	// Compare at second granularity: Firestore stores microseconds and strips the
	// monotonic clock, so a strict == would always fail after a round-trip.
	if first.CreatedAt.Unix() != second.CreatedAt.Unix() {
		t.Error("CreatedAt changed between reads — document was re-created")
	}
}
