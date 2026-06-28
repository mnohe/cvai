package gate

import (
	"context"
	"errors"
)

// ErrExternalRequestUnavailable is returned when an external request cannot start.
var ErrExternalRequestUnavailable = errors.New("external request unavailable")

// ExternalRequestError carries a user-safe HTTP response for a gate rejection.
type ExternalRequestError struct {
	Status  int
	Message string
	Err     error
}

func (e *ExternalRequestError) Error() string {
	if e == nil {
		return ""
	}
	if e.Err != nil {
		return e.Err.Error()
	}
	return e.Message
}

func (e *ExternalRequestError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// NewExternalRequestError creates a gate rejection with a user-safe response.
func NewExternalRequestError(status int, message string, err error) *ExternalRequestError {
	if err == nil {
		err = ErrExternalRequestUnavailable
	}
	return &ExternalRequestError{Status: status, Message: message, Err: err}
}

// ExternalRequestGate controls whether an operation may call an external API.
// Reserve is called before the operation begins; Release is called on eligible
// failures (best-effort).
type ExternalRequestGate interface {
	Reserve(ctx context.Context, uid string) error
	Release(ctx context.Context, uid string)
}

// NoopExternalRequestGate always permits.
type NoopExternalRequestGate struct{}

func (NoopExternalRequestGate) Reserve(_ context.Context, _ string) error { return nil }
func (NoopExternalRequestGate) Release(_ context.Context, _ string)       {}
