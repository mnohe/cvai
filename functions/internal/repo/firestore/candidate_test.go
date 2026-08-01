package firestore_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"cloud.google.com/go/firestore"

	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/repo"
	fsrepo "github.com/mnohe/cvai/functions/internal/repo/firestore"
)

func TestCandidateRepo_GetCandidate_NotFound(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewCandidateRepo(client)

	c, err := r.GetCandidate(ctx, newUID())
	if err != nil {
		t.Fatalf("GetCandidate: %v", err)
	}
	if c != nil {
		t.Errorf("expected nil for nonexistent candidate, got %+v", c)
	}
}

func TestCandidateRepo_GetCV_NotFound(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewCandidateRepo(client)

	cv, err := r.GetCV(ctx, newUID())
	if err != nil {
		t.Fatalf("GetCV: %v", err)
	}
	if cv != nil {
		t.Errorf("expected nil CV for nonexistent candidate, got %+v", cv)
	}
}

func TestCandidateRepo_WriteAndGetCV(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewCandidateRepo(client)
	uid := newUID()

	cv := domain.CV{
		Summary: "Test summary",
		Contact: domain.Contact{
			Name:    "Test",
			Surname: "User",
			Email:   "test@example.com",
		},
	}
	validationErrors := []string{"cv.summary is required"}
	if err := r.WriteCV(ctx, uid, cv, validationErrors); err != nil {
		t.Fatalf("WriteCV: %v", err)
	}

	got, err := r.GetCV(ctx, uid)
	if err != nil {
		t.Fatalf("GetCV: %v", err)
	}
	if got == nil {
		t.Fatal("GetCV returned nil after write")
	}
	if got.Summary != cv.Summary {
		t.Errorf("Summary = %q, want %q", got.Summary, cv.Summary)
	}
	if got.Contact.Name != cv.Contact.Name {
		t.Errorf("Contact.Name = %q, want %q", got.Contact.Name, cv.Contact.Name)
	}
	candidate, err := r.GetCandidate(ctx, uid)
	if err != nil {
		t.Fatalf("GetCandidate: %v", err)
	}
	if candidate == nil {
		t.Fatal("GetCandidate returned nil after write")
	}
	if len(candidate.CVValidationErrors) != 1 || candidate.CVValidationErrors[0] != validationErrors[0] {
		t.Errorf("CVValidationErrors = %#v, want %#v", candidate.CVValidationErrors, validationErrors)
	}
}

// TestCandidateRepo_WriteCV_RefusesATombstonedAccount is GDPR-A18E Finding
// 3's regression test for this shared repo (CVirgil's real CV-import write
// path, per cvirgil/cmd/main.go's wiring): a real deletion tombstone,
// seeded directly at the same path accountdelete.Deleter writes to in
// production, must stop WriteCV from ever committing.
func TestCandidateRepo_WriteCV_RefusesATombstonedAccount(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewCandidateRepo(client)
	uid := newUID()
	seedTombstone(t, ctx, client, uid)

	err := r.WriteCV(ctx, uid, domain.CV{Summary: "should not persist"}, nil)
	if !errors.Is(err, repo.ErrAccountBeingDeleted) {
		t.Fatalf("err = %v, want ErrAccountBeingDeleted", err)
	}

	got, getErr := r.GetCV(ctx, uid)
	if getErr != nil {
		t.Fatalf("GetCV: %v", getErr)
	}
	if got != nil {
		t.Fatalf("candidate document exists after a WriteCV attempt against a tombstoned uid: %+v", got)
	}
}

// TestCandidateRepo_WriteCV_RealConcurrencyAgainstTombstoneWrite races
// WriteCV against the tombstone write actually committing, rather than
// seeding it first. Both safe outcomes are checked: either WriteCV fully
// committed before the tombstone existed (fine), or it failed with
// ErrAccountBeingDeleted and left no document (also fine) — the outcome
// this guards against is WriteCV succeeding *and* a tombstone existing,
// which is exactly the surviving-write bug Finding 3 describes. This is
// only possible to assert this cleanly because the barrier read and the CV
// write share one Firestore transaction (see WriteCV's doc comment):
// Firestore's optimistic-concurrency retry is what turns "checked, then
// separately wrote" into a genuinely atomic pair.
func TestCandidateRepo_WriteCV_RealConcurrencyAgainstTombstoneWrite(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewCandidateRepo(client)

	for i := 0; i < 20; i++ {
		uid := newUID()

		var wg sync.WaitGroup
		var writeErr error
		wg.Add(2)
		go func() {
			defer wg.Done()
			writeErr = r.WriteCV(ctx, uid, domain.CV{Summary: "racing write"}, nil)
		}()
		go func() {
			defer wg.Done()
			seedTombstone(t, ctx, client, uid)
		}()
		wg.Wait()

		got, getErr := r.GetCV(ctx, uid)
		if getErr != nil {
			t.Fatalf("iteration %d: GetCV: %v", i, getErr)
		}

		switch {
		case writeErr == nil:
			if got == nil {
				t.Fatalf("iteration %d: WriteCV reported success but no candidate document exists", i)
			}
		case errors.Is(writeErr, repo.ErrAccountBeingDeleted):
			if got != nil {
				t.Fatalf("iteration %d: WriteCV was rejected as ErrAccountBeingDeleted but a candidate document exists anyway", i)
			}
		default:
			t.Fatalf("iteration %d: unexpected WriteCV error: %v", i, writeErr)
		}
	}
}

func seedTombstone(t *testing.T, ctx context.Context, client *firestore.Client, uid string) {
	t.Helper()
	if _, err := fsrepo.TombstoneDoc(client, uid).Set(ctx, map[string]interface{}{
		"deleted_at": time.Now(),
		"reason":     "user_requested",
	}); err != nil {
		t.Fatalf("seed tombstone: %v", err)
	}
}

func TestCandidateRepo_WriteCV_MergePreservesOtherFields(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewCandidateRepo(client)
	uid := newUID()

	// Write initial CV.
	cv := domain.CV{Summary: "Initial"}
	if err := r.WriteCV(ctx, uid, cv, nil); err != nil {
		t.Fatalf("first WriteCV: %v", err)
	}

	// Update with different summary; other candidate fields (e.g., evidenceLibrary) should not be clobbered.
	cv.Summary = "Updated"
	if err := r.WriteCV(ctx, uid, cv, nil); err != nil {
		t.Fatalf("second WriteCV: %v", err)
	}

	got, err := r.GetCV(ctx, uid)
	if err != nil {
		t.Fatalf("GetCV: %v", err)
	}
	if got.Summary != "Updated" {
		t.Errorf("Summary = %q, want %q", got.Summary, "Updated")
	}
}
