package firestore_test

import (
	"context"
	"testing"
	"time"

	"github.com/mnohe/cvai/functions/internal/domain"
	fsrepo "github.com/mnohe/cvai/functions/internal/repo/firestore"
)

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
