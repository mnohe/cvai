package firestore_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/repo"
	fsrepo "github.com/mnohe/cvai/functions/internal/repo/firestore"
)

// TestActionRepo_Create_RefusesATombstonedAccount is GDPR-A18E Finding 3's
// regression test for the one Action write that creates new state (see
// Create's doc comment for why Update/Complete/Fail don't need the same
// check).
func TestActionRepo_Create_RefusesATombstonedAccount(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewActionRepo(client)
	uid := newUID()
	seedTombstone(t, ctx, client, uid)

	actionID, err := r.Create(ctx, uid, domain.Action{Type: domain.ActionTypeImportCV, Status: domain.ActionPending})
	if !errors.Is(err, repo.ErrAccountBeingDeleted) {
		t.Fatalf("err = %v, want ErrAccountBeingDeleted", err)
	}
	if actionID != "" {
		t.Fatalf("actionID = %q, want empty", actionID)
	}
}

func TestActionRepo_Get_NotFound(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewActionRepo(client)

	action, err := r.Get(ctx, newUID(), "missing-action")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if action != nil {
		t.Fatalf("action = %#v, want nil", action)
	}
}

func TestActionRepoValidationAndMissingDocumentFailures(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewActionRepo(client)
	uid := newUID()

	if id, err := r.Create(ctx, uid, domain.Action{}); err == nil || id != "" {
		t.Fatalf("Create invalid action = (%q, %v), want empty id and error", id, err)
	}
	if err := r.Update(ctx, uid, "missing", domain.ActionProgress{}); err == nil {
		t.Fatal("Update invalid progress = nil error")
	}
	validProgress := domain.ActionProgress{Step: "working", Message: "Working"}
	if err := r.Update(ctx, uid, "missing", validProgress); err == nil {
		t.Fatal("Update missing action = nil error")
	}
	if err := r.Complete(ctx, uid, "missing", map[string]any{"ok": true}); err == nil {
		t.Fatal("Complete missing action = nil error")
	}
	if err := r.Fail(ctx, uid, "missing", "failed"); err == nil {
		t.Fatal("Fail missing action = nil error")
	}
}

func TestActionRepoGetRejectsMalformedDocument(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewActionRepo(client)
	uid := newUID()
	if _, err := client.Collection("users").Doc(uid).Collection("actions").Doc("malformed").Set(ctx, map[string]any{
		"created_at": "not-a-timestamp",
	}); err != nil {
		t.Fatalf("seed malformed action: %v", err)
	}
	if _, err := r.Get(ctx, uid, "malformed"); err == nil {
		t.Fatal("Get malformed action = nil error")
	}
}

func TestActionRepo_Lifecycle(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewActionRepo(client)
	uid := newUID()

	actionID, err := r.Create(ctx, uid, domain.Action{
		Type:   domain.ActionTypeImportCV,
		Status: domain.ActionPending,
		Progress: domain.ActionProgress{
			Step:    "queued",
			Message: "Queued",
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	created, err := r.Get(ctx, uid, actionID)
	if err != nil {
		t.Fatalf("Get after Create: %v", err)
	}
	if created == nil {
		t.Fatal("Get after Create returned nil")
	}
	if created.Status != domain.ActionPending {
		t.Fatalf("created.Status = %q, want %q", created.Status, domain.ActionPending)
	}

	if err := r.Update(ctx, uid, actionID, domain.ActionProgress{Step: "analysing", Message: "Analysing"}); err != nil {
		t.Fatalf("first Update: %v", err)
	}
	running, err := r.Get(ctx, uid, actionID)
	if err != nil {
		t.Fatalf("Get after first Update: %v", err)
	}
	if running.Status != domain.ActionRunning {
		t.Fatalf("running.Status = %q, want %q", running.Status, domain.ActionRunning)
	}
	if running.StartedAt == nil {
		t.Fatal("StartedAt was not set on first Update")
	}
	firstStartedAt := *running.StartedAt

	time.Sleep(2 * time.Millisecond)
	if err := r.Update(ctx, uid, actionID, domain.ActionProgress{Step: "saving", Message: "Saving"}); err != nil {
		t.Fatalf("second Update: %v", err)
	}
	runningAgain, err := r.Get(ctx, uid, actionID)
	if err != nil {
		t.Fatalf("Get after second Update: %v", err)
	}
	if runningAgain.StartedAt == nil {
		t.Fatal("StartedAt disappeared after second Update")
	}
	if !runningAgain.StartedAt.Equal(firstStartedAt) {
		t.Fatalf("StartedAt changed from %s to %s", firstStartedAt, runningAgain.StartedAt)
	}

	if err := r.Complete(ctx, uid, actionID, map[string]interface{}{"resource": "candidate.cv"}); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	complete, err := r.Get(ctx, uid, actionID)
	if err != nil {
		t.Fatalf("Get after Complete: %v", err)
	}
	if complete.Status != domain.ActionComplete {
		t.Fatalf("complete.Status = %q, want %q", complete.Status, domain.ActionComplete)
	}
	if complete.Progress.Message != "Done" {
		t.Fatalf("complete.Progress.Message = %q, want Done", complete.Progress.Message)
	}
	if complete.Result["resource"] != "candidate.cv" {
		t.Fatalf("complete.Result = %#v", complete.Result)
	}
	if complete.CompletedAt == nil {
		t.Fatal("CompletedAt was not set on Complete")
	}
}

func TestActionRepo_Fail(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewActionRepo(client)
	uid := newUID()

	actionID, err := r.Create(ctx, uid, domain.Action{
		Type:   domain.ActionTypeImportCV,
		Status: domain.ActionPending,
		Progress: domain.ActionProgress{
			Step:    "queued",
			Message: "Queued",
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := r.Fail(ctx, uid, actionID, "The PDF could not be read."); err != nil {
		t.Fatalf("Fail: %v", err)
	}
	failed, err := r.Get(ctx, uid, actionID)
	if err != nil {
		t.Fatalf("Get after Fail: %v", err)
	}
	if failed.Status != domain.ActionFailed {
		t.Fatalf("failed.Status = %q, want %q", failed.Status, domain.ActionFailed)
	}
	if failed.Error != "The PDF could not be read." {
		t.Fatalf("failed.Error = %q", failed.Error)
	}
	if failed.CompletedAt == nil {
		t.Fatal("CompletedAt was not set on Fail")
	}
}
