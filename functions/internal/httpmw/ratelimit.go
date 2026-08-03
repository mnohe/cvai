package httpmw

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"

	"github.com/mnohe/cvai/functions/internal/auth"
)

// RateLimiter enforces a per-user request budget with an in-memory token
// bucket per uid. It is process-local: on Cloud Run's default multi-instance
// scaling, a user's budget is really "N requests per minute per instance
// currently handling them," not a single global budget. That's a real,
// documented limitation, not a distributed rate limiter — but it's still
// effective at absorbing a single client or bug that hammers one instance,
// which is this hardening pass's actual goal.
type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	limit    rate.Limit
	burst    int
	ttl      time.Duration
}

type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// NewRateLimiter creates a limiter allowing requestsPerMinute sustained,
// with bursts up to burst. It starts a background goroutine that evicts
// uids idle for more than 10 minutes, so memory doesn't grow unbounded
// across the process's lifetime as users come and go.
func NewRateLimiter(requestsPerMinute int, burst int) *RateLimiter {
	rl := &RateLimiter{
		visitors: make(map[string]*visitor),
		limit:    rate.Limit(float64(requestsPerMinute) / 60),
		burst:    burst,
		ttl:      10 * time.Minute,
	}
	go rl.evictStaleVisitors()
	return rl
}

func (rl *RateLimiter) evictStaleVisitors() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for now := range ticker.C {
		rl.evictStaleVisitorsAt(now)
	}
}

func (rl *RateLimiter) evictStaleVisitorsAt(now time.Time) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	for uid, v := range rl.visitors {
		if now.Sub(v.lastSeen) > rl.ttl {
			delete(rl.visitors, uid)
		}
	}
}

func (rl *RateLimiter) allow(uid string) bool {
	rl.mu.Lock()
	v, ok := rl.visitors[uid]
	if !ok {
		v = &visitor{limiter: rate.NewLimiter(rl.limit, rl.burst)}
		rl.visitors[uid] = v
	}
	v.lastSeen = time.Now()
	limiter := v.limiter
	rl.mu.Unlock()
	return limiter.Allow()
}

// Middleware enforces the limiter per authenticated uid (auth.UIDFromContext).
// It must run after auth.RequireAuth so the uid is known; a request with no
// uid is passed through unlimited here, since RequireAuth already rejects
// unauthenticated requests before this middleware would see them.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid := auth.UIDFromContext(r.Context())
		if uid == "" {
			next.ServeHTTP(w, r)
			return
		}
		if !rl.allow(uid) {
			w.Header().Set("Retry-After", "1")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "too many requests"})
			return
		}
		next.ServeHTTP(w, r)
	})
}
