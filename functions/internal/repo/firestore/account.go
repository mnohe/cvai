package firestore

import (
	"context"
	"fmt"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/mnohe/cvai/functions/internal/domain"
)

// AccountRepo implements repo.AccountRepository against Firestore.
type AccountRepo struct {
	client *firestore.Client
}

// NewAccountRepo creates an AccountRepo using the provided Firestore client.
func NewAccountRepo(client *firestore.Client) *AccountRepo {
	return &AccountRepo{client: client}
}

// GetProfile returns the account, creating it on first call.
func (r *AccountRepo) GetProfile(ctx context.Context, uid string) (*domain.Account, error) {
	ref := accountDoc(r.client, uid)
	snap, err := ref.Get(ctx)
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return r.createAccount(ctx, uid, ref)
		}
		return nil, fmt.Errorf("get account: %w", err)
	}
	var acc domain.Account
	if err := snap.DataTo(&acc); err != nil {
		return nil, fmt.Errorf("decode account: %w", err)
	}
	return &acc, nil
}

func (r *AccountRepo) createAccount(ctx context.Context, uid string, ref *firestore.DocumentRef) (*domain.Account, error) {
	now := time.Now()
	acc := &domain.Account{
		UID:       uid,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if _, err := ref.Set(ctx, acc); err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}
	return acc, nil
}
