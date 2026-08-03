package firestore_test

import (
	"context"
	"strings"
	"testing"

	fsrepo "github.com/mnohe/cvai/functions/internal/repo/firestore"
)

func TestDeletionBarrierCheckerReportsAbsentAndPresentTombstones(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	uid := newUID()
	checker := fsrepo.NewDeletionBarrierChecker(client)

	deleting, err := checker.IsBeingDeleted(ctx, uid)
	if err != nil {
		t.Fatalf("IsBeingDeleted absent: %v", err)
	}
	if deleting {
		t.Fatal("absent tombstone reported as present")
	}

	if _, err := fsrepo.TombstoneDoc(client, uid).Set(ctx, map[string]any{"reason": "test"}); err != nil {
		t.Fatalf("seed tombstone: %v", err)
	}
	deleting, err = checker.IsBeingDeleted(ctx, uid)
	if err != nil {
		t.Fatalf("IsBeingDeleted present: %v", err)
	}
	if !deleting {
		t.Fatal("present tombstone reported as absent")
	}
}

func TestDeletionBarrierCheckerWrapsReadFailure(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	checker := fsrepo.NewDeletionBarrierChecker(client)
	canceled, cancel := context.WithCancel(ctx)
	cancel()

	if _, err := checker.IsBeingDeleted(canceled, newUID()); err == nil {
		t.Fatal("IsBeingDeleted canceled context = nil error")
	}
}

func TestTombstoneDocUsesCanonicalPath(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	if got := fsrepo.TombstoneDoc(client, "uid-1").Path; !strings.HasSuffix(got, "/documents/_admin/deleted_accounts/records/uid-1") {
		t.Fatalf("TombstoneDoc path = %q", got)
	}
}
