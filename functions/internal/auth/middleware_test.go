package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	firebaseauth "firebase.google.com/go/v4/auth"
)

// mockVerifier implements TokenVerifier for tests.
type mockVerifier struct {
	token *firebaseauth.Token
	err   error
}

func (m *mockVerifier) VerifyIDToken(_ context.Context, _ string) (*firebaseauth.Token, error) {
	return m.token, m.err
}

func okVerifier(uid string, authTime int64) *mockVerifier {
	return &mockVerifier{token: &firebaseauth.Token{UID: uid, AuthTime: authTime}}
}

func errVerifier() *mockVerifier {
	return &mockVerifier{err: errors.New("invalid token")}
}

func okHandler(t *testing.T, wantUID string) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid := UIDFromContext(r.Context())
		if uid != wantUID {
			t.Errorf("UIDFromContext = %q, want %q", uid, wantUID)
		}
		tok := TokenFromContext(r.Context())
		if tok == nil || tok.UID != wantUID {
			t.Errorf("TokenFromContext UID = %v, want %q", tok, wantUID)
		}
		w.WriteHeader(http.StatusOK)
	})
}

func TestRequireAuth_ValidToken(t *testing.T) {
	mw := newWithVerifier(okVerifier("user-123", time.Now().Unix()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	mw.RequireAuth(okHandler(t, "user-123")).ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rr.Code)
	}
}

func TestRequireAuth_MissingHeader(t *testing.T) {
	mw := newWithVerifier(okVerifier("user-123", time.Now().Unix()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	mw.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("next should not be called")
	})).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rr.Code)
	}
}

func TestRequireAuth_WrongScheme(t *testing.T) {
	mw := newWithVerifier(okVerifier("user-123", time.Now().Unix()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Basic dXNlcjpwYXNz")
	mw.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("next should not be called")
	})).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rr.Code)
	}
}

func TestRequireAuth_InvalidToken(t *testing.T) {
	mw := newWithVerifier(errVerifier())
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer bad-token")
	mw.RequireAuth(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("next should not be called")
	})).ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rr.Code)
	}
}

func TestPublicHandler_Bypass(t *testing.T) {
	called := false
	h := PublicHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	h.ServeHTTP(rr, req)
	if !called {
		t.Error("handler was not called")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rr.Code)
	}
}

func TestRequireRecentAuth_Fresh(t *testing.T) {
	mw := newWithVerifier(okVerifier("user-123", time.Now().Unix()))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/account", nil)
	req.Header.Set("Authorization", "Bearer valid-token")

	handler := mw.RequireAuth(mw.RequireRecentAuth(300)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rr.Code)
	}
}

func TestRequireRecentAuth_StaleToken(t *testing.T) {
	staleAuthTime := time.Now().Unix() - 400 // older than 300s threshold
	mw := newWithVerifier(okVerifier("user-123", staleAuthTime))
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/account", nil)
	req.Header.Set("Authorization", "Bearer stale-token")

	handler := mw.RequireAuth(mw.RequireRecentAuth(300)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("next should not be called for stale token")
	})))
	handler.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rr.Code)
	}
}

func TestUIDFromContext_Empty(t *testing.T) {
	uid := UIDFromContext(context.Background())
	if uid != "" {
		t.Errorf("UIDFromContext on empty context = %q, want empty", uid)
	}
}

func TestTokenFromContext_Empty(t *testing.T) {
	if tok := TokenFromContext(context.Background()); tok != nil {
		t.Errorf("TokenFromContext on empty context = %#v, want nil", tok)
	}
}
