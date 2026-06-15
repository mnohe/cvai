package handlers_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/handlers"
	"github.com/mnohe/cvai/functions/internal/repo"
)

// stubAccountRepo is a test double for repo.AccountRepository.
type stubAccountRepo struct {
	profile *domain.Account
	err     error
}

func (s *stubAccountRepo) GetProfile(_ context.Context, uid string) (*domain.Account, error) {
	if s.err != nil {
		return nil, s.err
	}
	if s.profile != nil {
		return s.profile, nil
	}
	return &domain.Account{
		UID:           uid,
		CreditBalance: 0,
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}, nil
}
func (s *stubAccountRepo) DeductCredit(_ context.Context, _ string) error { return nil }
func (s *stubAccountRepo) RefundCredit(_ context.Context, _ string) error { return nil }
func (s *stubAccountRepo) GrantCredits(_ context.Context, _ string, _ int, _ string, _ string) error {
	return nil
}

var _ repo.AccountRepository = (*stubAccountRepo)(nil)

func TestGetAccount_ReturnsAccount(t *testing.T) {
	stub := &stubAccountRepo{}
	h := handlers.NewAccountHandler(stub)

	req := httptest.NewRequest(http.MethodGet, "/account", nil)
	req = req.WithContext(auth.WithUID(req.Context(), "user-abc"))
	rr := httptest.NewRecorder()

	h.GetAccount(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rr.Code)
	}
	var acc domain.Account
	if err := json.NewDecoder(rr.Body).Decode(&acc); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if acc.UID != "user-abc" {
		t.Errorf("UID = %q, want %q", acc.UID, "user-abc")
	}
}

func TestGetAccount_RepoError_Returns500(t *testing.T) {
	stub := &stubAccountRepo{err: context.DeadlineExceeded}
	h := handlers.NewAccountHandler(stub)

	req := httptest.NewRequest(http.MethodGet, "/account", nil)
	req = req.WithContext(auth.WithUID(req.Context(), "user-abc"))
	rr := httptest.NewRecorder()

	h.GetAccount(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", rr.Code)
	}
}
