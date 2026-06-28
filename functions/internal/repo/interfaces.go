package repo

import (
	"context"

	"github.com/mnohe/cvai/functions/internal/domain"
)

// AccountRepository manages account documents.
type AccountRepository interface {
	// GetProfile returns the account, creating it on first call.
	GetProfile(ctx context.Context, uid string) (*domain.Account, error)
}

// CandidateRepository manages the candidate profile document.
type CandidateRepository interface {
	// GetCV returns the CV from the candidate profile. Returns nil, nil if not found.
	GetCV(ctx context.Context, uid string) (*domain.CV, error)
	// WriteCV persists the CV and any validation errors in the candidate profile document.
	// Pass an empty slice when the CV is valid.
	WriteCV(ctx context.Context, uid string, cv domain.CV, validationErrors []string) error
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
