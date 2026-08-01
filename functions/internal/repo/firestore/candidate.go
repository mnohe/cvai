package firestore

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/repo"
)

// CandidateRepo implements repo.CandidateRepository against Firestore.
type CandidateRepo struct {
	client *firestore.Client
}

// NewCandidateRepo creates a CandidateRepo using the provided Firestore client.
func NewCandidateRepo(client *firestore.Client) *CandidateRepo {
	return &CandidateRepo{client: client}
}

// GetCandidate returns the full candidate document, or nil if it does not exist.
func (r *CandidateRepo) GetCandidate(ctx context.Context, uid string) (*domain.Candidate, error) {
	snap, err := candidateDoc(r.client, uid).Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, nil
		}
		return nil, fmt.Errorf("get candidate: %w", err)
	}
	var c domain.Candidate
	if err := snap.DataTo(&c); err != nil {
		return nil, fmt.Errorf("decode candidate: %w", err)
	}
	c.ID = uid
	return &c, nil
}

// GetCV returns the CV section of the candidate document, or nil if it does not exist.
func (r *CandidateRepo) GetCV(ctx context.Context, uid string) (*domain.CV, error) {
	c, err := r.GetCandidate(ctx, uid)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, nil
	}
	return &c.CV, nil
}

// WriteCV persists the CV and validation errors into the candidate profile document using a merge update.
// It does not overwrite fields outside the cv subtree.
//
// The deletion-tombstone check happens inside this same transaction, as one
// of its reads, before the write — not as a separate check-then-write step
// beforehand. That's what makes it race-safe against a concurrent account
// deletion: if a tombstone commits after this transaction's tombstone read
// but before this transaction commits, Firestore detects the conflicting
// read and retries the whole transaction, so the retry's tombstone read
// sees it and aborts. See repo.DeletionBarrier's doc comment.
func (r *CandidateRepo) WriteCV(ctx context.Context, uid string, cv domain.CV, validationErrors []string) error {
	ref := candidateDoc(r.client, uid)
	now := time.Now()
	if validationErrors == nil {
		validationErrors = []string{}
	}
	return r.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		beingDeleted, err := IsBeingDeletedInTransaction(ctx, tx, r.client, uid)
		if err != nil {
			return fmt.Errorf("check deletion barrier for write cv: %w", err)
		}
		if beingDeleted {
			return repo.ErrAccountBeingDeleted
		}
		updates := map[string]any{
			"cv":                   cv,
			"cv_validation_errors": validationErrors,
			"updated_at":           now,
		}
		_, err = tx.Get(ref)
		if err != nil {
			if status.Code(err) != codes.NotFound {
				return fmt.Errorf("get candidate for write cv: %w", err)
			}
			updates["created_at"] = now
			updates["context"] = domain.CandidateContext{
				Version:     1,
				Constraints: domain.ContextConstraints{},
				Preferences: domain.ContextPreferences{},
			}
		}
		return tx.Set(ref, updates, firestore.MergeAll)
	})
}
