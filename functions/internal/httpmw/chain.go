package httpmw

import (
	"net/http"

	"github.com/mnohe/cvai/functions/internal/auth"
)

// WrapAuthenticated composes the standard cross-cutting stack for an
// authenticated route in the one order that actually works: RequireAuth
// must be outermost, not innermost, because it establishes the uid on the
// request by building a *new* request value (see auth.Middleware.RequireAuth
// and Go's http.Request.WithContext) — a context change that is only
// visible to handlers *called from inside* RequireAuth, never to a handler
// that already ran and is holding an older request value from before
// RequireAuth executed. RequestLogger must therefore be RequireAuth's direct
// next handler to observe the uid at all, and Recover must sit directly
// inside RequestLogger so a panic anywhere inside (including the rate
// limiter or the final route handler) is caught, its safe response written
// through RequestLogger's status-capturing writer, before RequestLogger's
// own completion log line runs — one line per request, panic or not, with
// the real final status.
func WrapAuthenticated(authMW *auth.Middleware, rl *RateLimiter, next http.Handler) http.Handler {
	return authMW.RequireAuth(RequestLogger(Recover(rl.Middleware(next))))
}

// WrapPublic composes the standard cross-cutting stack for a public
// (unauthenticated) route: logging and panic recovery, with no uid to
// observe and no rate limiting.
func WrapPublic(next http.Handler) http.Handler {
	return RequestLogger(Recover(next))
}
