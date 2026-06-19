package firestore

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/mnohe/cvai/functions/internal/domain"
)

// ActionRepo implements repo.ActionRepository against Firestore.
type ActionRepo struct {
	client *firestore.Client
}

// NewActionRepo creates an ActionRepo using the provided Firestore client.
func NewActionRepo(client *firestore.Client) *ActionRepo {
	return &ActionRepo{client: client}
}

// Create persists a pending action and returns its generated ID when needed.
func (r *ActionRepo) Create(ctx context.Context, uid string, action domain.Action) (string, error) {
	now := time.Now()
	if action.ID == "" {
		action.ID = uuid.New().String()
	}
	if action.Status == "" {
		action.Status = domain.ActionPending
	}
	if action.CreatedAt.IsZero() {
		action.CreatedAt = now
	}
	action.UpdatedAt = now
	if err := action.Validate(); err != nil {
		return "", fmt.Errorf("validate action: %w", err)
	}
	if _, err := actionDoc(r.client, uid, action.ID).Set(ctx, action); err != nil {
		return "", fmt.Errorf("create action: %w", err)
	}
	return action.ID, nil
}

// Update marks an action running and replaces its progress payload.
func (r *ActionRepo) Update(ctx context.Context, uid string, actionID string, progress domain.ActionProgress) error {
	if err := progress.Validate(); err != nil {
		return fmt.Errorf("validate progress: %w", err)
	}
	now := time.Now()
	ref := actionDoc(r.client, uid, actionID)
	return r.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(ref)
		if err != nil {
			return fmt.Errorf("get action for update: %w", err)
		}
		var action domain.Action
		if err := snap.DataTo(&action); err != nil {
			return fmt.Errorf("decode action for update: %w", err)
		}

		// Preserve started_at as the first-running timestamp. Later progress
		// updates should change updated_at only, otherwise duration metrics lose
		// the time spent inside the provider call.
		updates := []firestore.Update{
			{Path: "status", Value: domain.ActionRunning},
			{Path: "progress", Value: progress},
			{Path: "updated_at", Value: now},
		}
		if action.StartedAt == nil && action.Status == domain.ActionPending {
			updates = append(updates, firestore.Update{Path: "started_at", Value: now})
		}
		if err := tx.Update(ref, updates); err != nil {
			return fmt.Errorf("update action fields: %w", err)
		}
		return nil
	})
}

// Complete marks an action complete with a result payload.
func (r *ActionRepo) Complete(ctx context.Context, uid string, actionID string, result map[string]interface{}) error {
	now := time.Now()
	if _, err := actionDoc(r.client, uid, actionID).Update(ctx, []firestore.Update{
		{Path: "status", Value: domain.ActionComplete},
		{Path: "progress", Value: domain.ActionProgress{Step: "complete", Message: "Done"}},
		{Path: "result", Value: result},
		{Path: "updated_at", Value: now},
		{Path: "completed_at", Value: now},
	}); err != nil {
		return fmt.Errorf("complete action: %w", err)
	}
	return nil
}

// Fail marks an action failed with a user-readable reason.
func (r *ActionRepo) Fail(ctx context.Context, uid string, actionID string, failureReason string) error {
	now := time.Now()
	if _, err := actionDoc(r.client, uid, actionID).Update(ctx, []firestore.Update{
		{Path: "status", Value: domain.ActionFailed},
		{Path: "progress", Value: domain.ActionProgress{Step: "failed", Message: failureReason}},
		{Path: "error", Value: failureReason},
		{Path: "updated_at", Value: now},
		{Path: "completed_at", Value: now},
	}); err != nil {
		return fmt.Errorf("fail action: %w", err)
	}
	return nil
}

// Get returns an action by ID, or nil when it does not exist.
func (r *ActionRepo) Get(ctx context.Context, uid string, actionID string) (*domain.Action, error) {
	snap, err := actionDoc(r.client, uid, actionID).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("get action: %w", err)
	}
	var action domain.Action
	if err := snap.DataTo(&action); err != nil {
		return nil, fmt.Errorf("decode action: %w", err)
	}
	return &action, nil
}
