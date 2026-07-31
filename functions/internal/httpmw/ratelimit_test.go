package httpmw

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/mnohe/cvai/functions/internal/auth"
)

func TestRateLimiterBlocksAfterBurstForOneUser(t *testing.T) {
	rl := NewRateLimiter(60, 2)
	handler := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := func() *http.Request {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		return r.WithContext(auth.WithUID(r.Context(), "uid-1"))
	}

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req())
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, want 200 (within burst)", i, rec.Code)
		}
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req())
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 once burst is exhausted", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header on 429")
	}
}

func TestRateLimiterTracksUsersIndependently(t *testing.T) {
	rl := NewRateLimiter(60, 1)
	handler := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	requestAs := func(uid string) int {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req = req.WithContext(auth.WithUID(req.Context(), uid))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec.Code
	}

	if got := requestAs("uid-a"); got != http.StatusOK {
		t.Fatalf("uid-a's first request status = %d, want 200", got)
	}
	if got := requestAs("uid-b"); got != http.StatusOK {
		t.Fatalf("uid-b's first request status = %d, want 200 (independent budget from uid-a)", got)
	}
	if got := requestAs("uid-a"); got != http.StatusTooManyRequests {
		t.Fatalf("uid-a's second request status = %d, want 429 (burst of 1 already spent)", got)
	}
}

func TestRateLimiterPassesThroughRequestsWithNoUID(t *testing.T) {
	rl := NewRateLimiter(1, 1)
	called := 0
	handler := rl.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
		w.WriteHeader(http.StatusOK)
	}))

	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d status = %d, want 200 (no uid means not rate limited here)", i, rec.Code)
		}
	}
	if called != 5 {
		t.Fatalf("handler called %d times, want 5", called)
	}
}
