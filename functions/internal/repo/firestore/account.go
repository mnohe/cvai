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
	"github.com/mnohe/cvai/functions/internal/repo"
)

// AccountRepo implements repo.AccountRepository against Firestore.
type AccountRepo struct {
	client *firestore.Client
}

// NewAccountRepo creates an AccountRepo using the provided Firestore client.
func NewAccountRepo(client *firestore.Client) *AccountRepo {
	return &AccountRepo{client: client}
}

// GetProfile returns the account, creating it with zero credits on first call.
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
		UID:              uid,
		CreditBalance:    0,
		HasEverPurchased: false,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if _, err := ref.Set(ctx, acc); err != nil {
		return nil, fmt.Errorf("create account: %w", err)
	}
	return acc, nil
}

// DeductCredit atomically decrements the credit balance by 1.
// Returns repo.ErrInsufficientCredits when balance is zero.
func (r *AccountRepo) DeductCredit(ctx context.Context, uid string) error {
	ref := accountDoc(r.client, uid)
	return r.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(ref)
		if err != nil {
			if status.Code(err) == codes.NotFound {
				return repo.ErrInsufficientCredits
			}
			return fmt.Errorf("get account for deduct: %w", err)
		}
		var acc domain.Account
		if err := snap.DataTo(&acc); err != nil {
			return fmt.Errorf("decode account: %w", err)
		}
		if acc.CreditBalance <= 0 {
			return repo.ErrInsufficientCredits
		}
		return tx.Update(ref, []firestore.Update{
			{Path: "credit_balance", Value: acc.CreditBalance - 1},
			{Path: "updated_at", Value: time.Now()},
		})
	})
}

// RefundCredit atomically increments the credit balance by 1.
func (r *AccountRepo) RefundCredit(ctx context.Context, uid string) error {
	ref := accountDoc(r.client, uid)
	return r.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(ref)
		if err != nil {
			return fmt.Errorf("get account for refund: %w", err)
		}
		var acc domain.Account
		if err := snap.DataTo(&acc); err != nil {
			return fmt.Errorf("decode account: %w", err)
		}
		return tx.Update(ref, []firestore.Update{
			{Path: "credit_balance", Value: acc.CreditBalance + 1},
			{Path: "updated_at", Value: time.Now()},
		})
	})
}

// GrantCredits adds amount credits and records a PurchaseRecord atomically.
func (r *AccountRepo) GrantCredits(ctx context.Context, uid string, amount int, source string, ref string) error {
	docRef := accountDoc(r.client, uid)
	return r.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(docRef)
		if err != nil && status.Code(err) != codes.NotFound {
			return fmt.Errorf("get account for grant: %w", err)
		}

		var acc domain.Account
		if snap.Exists() {
			if err := snap.DataTo(&acc); err != nil {
				return fmt.Errorf("decode account: %w", err)
			}
		} else {
			now := time.Now()
			acc = domain.Account{
				UID:       uid,
				CreatedAt: now,
			}
		}

		purchase := domain.PurchaseRecord{
			ID:          uuid.New().String(),
			Provider:    source,
			CreditAmount: amount,
			PurchasedAt: time.Now(),
		}
		if source == domain.PurchaseProviderStripe {
			purchase.CheckoutSessionID = ref
		}

		acc.CreditBalance += amount
		acc.HasEverPurchased = true
		acc.Purchases = append(acc.Purchases, purchase)
		acc.UpdatedAt = time.Now()

		return tx.Set(docRef, acc)
	})
}
