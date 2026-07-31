package httpmw

import (
	"net/http"

	"github.com/mnohe/cvai/functions/internal/auth"
)

// WrapAuthenticated composes the standard cross-cutting stack for an
// authenticated route. RequestLogger must be outermost — see its own doc
// comment for why an inner position, however tempting (that's where the
// uid-stamped request "naturally" is), can't observe a rejection at all.
// markAuthenticated sits where only RequireAuth's *success* path can ever
// reach it, so reaching it at all is the "authentication succeeded" signal
// RequestLogger's completion line reports as uid_set.
func WrapAuthenticated(authMW *auth.Middleware, rl *RateLimiter, next http.Handler) http.Handler {
	return RequestLogger(authMW.RequireAuth(markAuthenticated(rl.Middleware(next))))
}

// WrapPublic composes the standard cross-cutting stack for a public
// (unauthenticated) route: logging and panic recovery, with no uid to
// observe and no rate limiting.
func WrapPublic(next http.Handler) http.Handler {
	return RequestLogger(next)
}

// markAuthenticated is RequireAuth's direct next handler in
// WrapAuthenticated. RequireAuth's rejection path writes an error response
// and returns without ever calling next, so this only ever runs once a
// token has actually verified — exactly the condition under which the
// request's shared outcome box (see requestOutcome) should record
// authenticated=true.
func markAuthenticated(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		MarkAuthenticated(r.Context())
		next.ServeHTTP(w, r)
	})
}
