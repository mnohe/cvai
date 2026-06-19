package repo

import (
	"context"
	"errors"

	"github.com/mnohe/cvai/functions/internal/domain"
)

// ErrInsufficientCredits is returned by DeductCredit when the account balance is zero.
var ErrInsufficientCredits = errors.New("insufficient credits")

// AccountRepository manages account documents and credit balances.
type AccountRepository interface {
	// GetProfile returns the account, creating it with zero credits on first call.
	GetProfile(ctx context.Context, uid string) (*domain.Account, error)
	// DeductCredit atomically decrements the credit balance by 1.
	// Returns ErrInsufficientCredits when balance is zero.
	DeductCredit(ctx context.Context, uid string) error
	// RefundCredit atomically increments the credit balance by 1.
	// Best-effort: callers should log but not fail on error.
	RefundCredit(ctx context.Context, uid string) error
	// GrantCredits adds amount credits, records a PurchaseRecord, and sets has_ever_purchased.
	GrantCredits(ctx context.Context, uid string, amount int, source string, ref string) error
}

// CandidateRepository manages the candidate profile document.
type CandidateRepository interface {
	// GetCV returns the CV from the candidate profile. Returns nil, nil if not found.
	GetCV(ctx context.Context, uid string) (*domain.CV, error)
	// WriteCV persists the CV in the candidate profile document.
	WriteCV(ctx context.Context, uid string, cv domain.CV) error
	// GetCandidate returns the full candidate document. Returns nil, nil if not found.
	GetCandidate(ctx context.Context, uid string) (*domain.Candidate, error)
}

// ActionRepository manages asynchronous LLM-backed action documents.
type ActionRepository interface {
	Create(ctx context.Context, uid string, action domain.Action) (string, error)
	Update(ctx context.Context, uid string, actionID string, progress domain.ActionProgress) error
	Complete(ctx context.Context, uid string, actionID string, result map[string]interface{}) error
	Fail(ctx context.Context, uid string, actionID string, failureReason string) error
	Get(ctx context.Context, uid string, actionID string) (*domain.Action, error)
}
