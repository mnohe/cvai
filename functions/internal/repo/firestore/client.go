package firestore

import (
	"context"
	"os"

	"cloud.google.com/go/firestore"
)

// Collection path constants.
const (
	collUsers     = "users"
	collAccount   = "account"
	collCandidate = "candidate"
	docProfile    = "profile"
)

// accountDoc returns the document ref for a user's account profile.
// Path: users/{uid}/account/profile
func accountDoc(client *firestore.Client, uid string) *firestore.DocumentRef {
	return client.Collection(collUsers).Doc(uid).Collection(collAccount).Doc(docProfile)
}

// candidateDoc returns the document ref for a user's candidate profile.
// Path: users/{uid}/candidate/profile
func candidateDoc(client *firestore.Client, uid string) *firestore.DocumentRef {
	return client.Collection(collUsers).Doc(uid).Collection(collCandidate).Doc(docProfile)
}

// NewClient creates a Firestore client.
// When FIRESTORE_EMULATOR_HOST is set, the client connects to the local emulator.
func NewClient(ctx context.Context) (*firestore.Client, error) {
	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	if projectID == "" {
		projectID = "demo-cvai"
	}
	return firestore.NewClient(ctx, projectID)
}
