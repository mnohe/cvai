package firestore

import (
	"context"
	"fmt"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Tombstone path constants: the single source of truth for where an
// account-deletion tombstone lives. Every deletion-aware reader or writer —
// in this module and in cvirgil's internal/accountdelete, which writes the
// tombstone — must reference these instead of a local copy. GDPR-A18E's
// own review history is why this matters: Attempt 1 hardcoded this path in
// one place, cvirgil's docs and runbook hardcoded a different (invalid)
// one, and reconciling the drift was Attempt 2's entire Finding 2. A single
// exported source of truth makes that class of drift impossible to
// reintroduce by construction, not just by convention.
const (
	TombstoneAnchorCollection = "_admin"
	TombstoneAnchorDoc        = "deleted_accounts"
	TombstoneRecordCollection = "records"
)

// TombstoneDoc returns the document reference for uid's deletion tombstone,
// path _admin/deleted_accounts/records/{uid}.
func TombstoneDoc(client *firestore.Client, uid string) *firestore.DocumentRef {
	return client.
		Collection(TombstoneAnchorCollection).Doc(TombstoneAnchorDoc).
		Collection(TombstoneRecordCollection).Doc(uid)
}

// DeletionBarrierChecker implements repo.DeletionBarrier against Firestore.
type DeletionBarrierChecker struct {
	client *firestore.Client
}

// NewDeletionBarrierChecker creates a DeletionBarrierChecker using the
// provided Firestore client.
func NewDeletionBarrierChecker(client *firestore.Client) *DeletionBarrierChecker {
	return &DeletionBarrierChecker{client: client}
}

// IsBeingDeleted reports whether uid's deletion tombstone exists.
func (c *DeletionBarrierChecker) IsBeingDeleted(ctx context.Context, uid string) (bool, error) {
	return tombstoneExists(ctx, func() (*firestore.DocumentSnapshot, error) {
		return TombstoneDoc(c.client, uid).Get(ctx)
	})
}

// IsBeingDeletedInTransaction is IsBeingDeleted's transactional form: the
// tombstone read becomes one of tx's reads, so Firestore's own
// optimistic-concurrency retry — a transaction whose read set changed
// before commit is retried, not silently committed against stale data —
// keeps the check atomic with whatever write tx goes on to make, without
// this package needing its own locking.
func IsBeingDeletedInTransaction(ctx context.Context, tx *firestore.Transaction, client *firestore.Client, uid string) (bool, error) {
	return tombstoneExists(ctx, func() (*firestore.DocumentSnapshot, error) {
		return tx.Get(TombstoneDoc(client, uid))
	})
}

func tombstoneExists(ctx context.Context, get func() (*firestore.DocumentSnapshot, error)) (bool, error) {
	snap, err := get()
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return false, nil
		}
		return false, fmt.Errorf("check deletion tombstone: %w", err)
	}
	return snap.Exists(), nil
}
