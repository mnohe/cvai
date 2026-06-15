package firestore_test

import (
	"context"
	"errors"
	"testing"

	fsrepo "github.com/mnohe/cvai/functions/internal/repo/firestore"
	"github.com/mnohe/cvai/functions/internal/repo"
)

func TestAccountRepo_GetProfile_CreatesOnFirstRead(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewAccountRepo(client)
	uid := newUID()

	acc, err := r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if acc.UID != uid {
		t.Errorf("UID = %q, want %q", acc.UID, uid)
	}
	if acc.CreditBalance != 0 {
		t.Errorf("CreditBalance = %d, want 0", acc.CreditBalance)
	}
	if acc.HasEverPurchased {
		t.Error("HasEverPurchased should be false for new account")
	}
}

func TestAccountRepo_GetProfile_Idempotent(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewAccountRepo(client)
	uid := newUID()

	first, err := r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("first GetProfile: %v", err)
	}
	second, err := r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("second GetProfile: %v", err)
	}
	// Compare at second granularity: Firestore stores microseconds and strips the
	// monotonic clock, so a strict == would always fail after a round-trip.
	if first.CreatedAt.Unix() != second.CreatedAt.Unix() {
		t.Error("CreatedAt changed between reads — document was re-created")
	}
}

func TestAccountRepo_DeductCredit_InsufficientCredits(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewAccountRepo(client)
	uid := newUID()

	// Ensure account exists with zero credits.
	if _, err := r.GetProfile(ctx, uid); err != nil {
		t.Fatalf("GetProfile: %v", err)
	}

	err := r.DeductCredit(ctx, uid)
	if !errors.Is(err, repo.ErrInsufficientCredits) {
		t.Errorf("DeductCredit on zero balance: got %v, want ErrInsufficientCredits", err)
	}
}

func TestAccountRepo_DeductAndRefund(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewAccountRepo(client)
	uid := newUID()

	// Grant 1 credit, then deduct it.
	if err := r.GrantCredits(ctx, uid, 1, "manual", "test"); err != nil {
		t.Fatalf("GrantCredits: %v", err)
	}
	if err := r.DeductCredit(ctx, uid); err != nil {
		t.Fatalf("DeductCredit: %v", err)
	}
	acc, err := r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("GetProfile after deduct: %v", err)
	}
	if acc.CreditBalance != 0 {
		t.Errorf("balance after deduct = %d, want 0", acc.CreditBalance)
	}

	// Refund.
	if err := r.RefundCredit(ctx, uid); err != nil {
		t.Fatalf("RefundCredit: %v", err)
	}
	acc, err = r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("GetProfile after refund: %v", err)
	}
	if acc.CreditBalance != 1 {
		t.Errorf("balance after refund = %d, want 1", acc.CreditBalance)
	}
}

func TestAccountRepo_GrantCredits(t *testing.T) {
	ctx := context.Background()
	client := mustNewClient(t, ctx)
	r := fsrepo.NewAccountRepo(client)
	uid := newUID()

	if err := r.GrantCredits(ctx, uid, 20, "stripe", "cs_test_abc"); err != nil {
		t.Fatalf("GrantCredits: %v", err)
	}
	acc, err := r.GetProfile(ctx, uid)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if acc.CreditBalance != 20 {
		t.Errorf("CreditBalance = %d, want 20", acc.CreditBalance)
	}
	if !acc.HasEverPurchased {
		t.Error("HasEverPurchased should be true after GrantCredits")
	}
	if len(acc.Purchases) != 1 {
		t.Errorf("len(Purchases) = %d, want 1", len(acc.Purchases))
	}
}
