// Package httpmw provides cross-cutting HTTP middleware shared by every
// backend entrypoint (CVAI and CVirgil): a request id, structured request
// logging, panic recovery, CORS, and per-user rate limiting.
package httpmw

import (
	"context"
	"net/http"

	"github.com/google/uuid"
)

type contextKey string

const requestIDKey contextKey = "request_id"

// HeaderRequestID is the response header carrying the request id, so a user
// can quote it to support the same way an Action's reference id already
// works for CV import failures.
const HeaderRequestID = "X-Request-Id"

// WithRequestID assigns a server-generated request id and stores it on the
// request context and response header before calling next. An arbitrary
// inbound X-Request-Id is not trusted: it is user-controlled and would
// otherwise be copied into retained logs. It must run before Recover and
// RequestLogger so both can attribute to the id.
func WithRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.NewString()
		w.Header().Set(HeaderRequestID, id)
		ctx := context.WithValue(r.Context(), requestIDKey, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestIDFromContext returns the request id set by WithRequestID, or ""
// if the request never passed through it.
func RequestIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}
