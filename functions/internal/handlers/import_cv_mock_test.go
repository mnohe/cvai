//go:build e2e_mock

package handlers

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/llm/mock"
)

// This test drives the real async import pipeline (ImportCVHandler.runImport,
// the goroutine, and its Action lifecycle) against mock.Completer instead of
// a hand-rolled fake, proving the per-user queue reaches the completer call
// the real handler makes rather than only the mock package in isolation.
func TestImportCVWithMockCompleterUsesPerUserQueue(t *testing.T) {
	accounts := &fakeAccounts{credits: 2}
	actions := newFakeActions()
	candidates := &fakeCandidates{}
	completer := mock.NewCompleter()
	completer.Enqueue("uid-1", mock.QueuedResponse{Body: validCVJSON()})
	handler := NewImportCVHandler(accounts, actions, candidates, completer)

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != 202 {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	waitFor(t, func() bool {
		cv, _ := candidates.GetCV(context.Background(), "uid-1")
		return cv != nil && cv.Contact.Name == "Ada"
	})
}

// A second user with no scripted response must fail the same way a real
// provider outage would, not silently reuse uid-1's queued response.
func TestImportCVWithMockCompleterFailsWithoutQueuedResponse(t *testing.T) {
	accounts := &fakeAccounts{credits: 2}
	actions := newFakeActions()
	candidates := &fakeCandidates{}
	completer := mock.NewCompleter()
	completer.Enqueue("uid-1", mock.QueuedResponse{Body: validCVJSON()})
	handler := NewImportCVHandler(accounts, actions, candidates, completer)

	req := importRequest(t, smallPDF())
	req = req.WithContext(auth.WithUID(req.Context(), "uid-2"))

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, req)
	if rec.Code != 202 {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-2", "action-1")
		return action != nil && action.Status == domain.ActionFailed
	})
	if accounts.credits != 2 {
		t.Fatalf("credits = %d, want refunded to 2", accounts.credits)
	}
}
