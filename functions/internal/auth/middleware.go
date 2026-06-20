package auth

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	firebaseauth "firebase.google.com/go/v4/auth"
)

type contextKey string

const (
	uidKey   contextKey = "uid"
	tokenKey contextKey = "token"
)

// TokenVerifier abstracts Firebase Auth token verification so tests can inject a mock.
type TokenVerifier interface {
	VerifyIDToken(ctx context.Context, idToken string) (*firebaseauth.Token, error)
}

// Middleware holds the Firebase Auth token verifier.
type Middleware struct {
	verifier TokenVerifier
}

// New creates an auth Middleware backed by Firebase Auth.
// It detects FIREBASE_AUTH_EMULATOR_HOST automatically via the Firebase SDK.
func New(ctx context.Context) (*Middleware, error) {
	projectID := os.Getenv("FIREBASE_PROJECT_ID")
	authEmulatorHost := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST")
	log.Printf(
		"auth_middleware_init project_id_set=%t auth_emulator_host_set=%t auth_emulator_host=%s",
		projectID != "",
		authEmulatorHost != "",
		authEmulatorHost,
	)
	config := &firebase.Config{ProjectID: projectID}
	app, err := firebase.NewApp(ctx, config)
	if err != nil {
		return nil, err
	}
	client, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}
	return &Middleware{verifier: client}, nil
}

// newWithVerifier creates a Middleware with an injected verifier; used in tests.
func newWithVerifier(v TokenVerifier) *Middleware {
	return &Middleware{verifier: v}
}

// RequireAuth verifies the Bearer ID token and injects the UID into the request context.
// Returns 401 on a missing or malformed Authorization header; 403 on an invalid token.
func (m *Middleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok, authErr := m.extractToken(r)
		if authErr != nil {
			writeError(w, authErr.status, authErr.msg)
			return
		}
		ctx := WithUID(r.Context(), tok.UID)
		ctx = context.WithValue(ctx, tokenKey, tok)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireRecentAuth returns middleware that checks the token's auth_time claim.
// It must be chained after RequireAuth, which stores the verified token in the context.
// Returns 403 when auth_time is older than maxAgeSeconds.
func (m *Middleware) RequireRecentAuth(maxAgeSeconds int) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok, ok := r.Context().Value(tokenKey).(*firebaseauth.Token)
			if !ok || tok == nil {
				writeError(w, http.StatusUnauthorized, "missing authorization")
				return
			}
			if time.Now().Unix()-tok.AuthTime > int64(maxAgeSeconds) {
				writeError(w, http.StatusForbidden, "recent authentication required")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// PublicHandler is an identity wrapper that marks a handler as intentionally public.
// Using it makes the two-mux pattern explicit: any handler that goes through PublicHandler
// is documented as opting out of RequireAuth.
func PublicHandler(h http.Handler) http.Handler { return h }

// WithUID stores the UID in the context.
func WithUID(ctx context.Context, uid string) context.Context {
	return context.WithValue(ctx, uidKey, uid)
}

// UIDFromContext retrieves the UID stored by RequireAuth. Returns "" if not set.
func UIDFromContext(ctx context.Context) string {
	uid, _ := ctx.Value(uidKey).(string)
	return uid
}

type authErr struct {
	status int
	msg    string
}

func (m *Middleware) extractToken(r *http.Request) (*firebaseauth.Token, *authErr) {
	hdr := r.Header.Get("Authorization")
	if hdr == "" {
		return nil, &authErr{http.StatusUnauthorized, "missing authorization header"}
	}
	parts := strings.SplitN(hdr, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return nil, &authErr{http.StatusUnauthorized, "invalid authorization scheme"}
	}
	tok, err := m.verifier.VerifyIDToken(r.Context(), parts[1])
	if err != nil {
		log.Printf(
			"auth_token_verify_failed method=%s path=%s reason=%s",
			r.Method,
			r.URL.Path,
			sanitizeVerifyError(err),
		)
		return nil, &authErr{http.StatusForbidden, "invalid token"}
	}
	return tok, nil
}

func sanitizeVerifyError(err error) string {
	if err == nil {
		return "unknown"
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "project"):
		return "project_mismatch_or_missing"
	case strings.Contains(msg, "expired"):
		return "expired"
	case strings.Contains(msg, "issuer"):
		return "issuer_mismatch"
	case strings.Contains(msg, "audience"):
		return "audience_mismatch"
	case strings.Contains(msg, "emulator"):
		return "emulator_unreachable_or_mismatch"
	default:
		return "invalid"
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
