package firestore_test

import (
	"context"
	"testing"

	fsrepo "github.com/mnohe/cvai/functions/internal/repo/firestore"
	"github.com/mnohe/cvai/functions/internal/domain"
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
	if err := r.WriteCV(ctx, uid, cv); err != nil {
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
}

func TestCandidateRepo_WriteCV_MergePreservesOtherFields(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewCandidateRepo(client)
	uid := newUID()

	// Write initial CV.
	cv := domain.CV{Summary: "Initial"}
	if err := r.WriteCV(ctx, uid, cv); err != nil {
		t.Fatalf("first WriteCV: %v", err)
	}

	// Update with different summary; other candidate fields (e.g., evidenceLibrary) should not be clobbered.
	cv.Summary = "Updated"
	if err := r.WriteCV(ctx, uid, cv); err != nil {
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
