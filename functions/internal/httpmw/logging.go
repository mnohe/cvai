package httpmw

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime/debug"
	"time"
)

// Logger is the shared structured (JSON) logger for request logging, panic
// recovery, and any other cross-cutting log line that needs to correlate
// with a request id. JSON to stdout is picked up as structured log entries
// by Cloud Run/Cloud Logging without extra configuration.
var Logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))

type outcomeKeyType struct{}

var outcomeKey = outcomeKeyType{}

// requestOutcome is a mutable box RequestLogger installs on the request
// context. Every context value derived from that point on (however many
// r.WithContext calls happen further down the chain) still resolves
// outcomeKey to this same pointer, since context.WithValue only adds
// associations — it never removes or replaces an ancestor's. That's what
// lets MarkAuthenticated, called from deep inside a wrapped handler, record
// a fact RequestLogger's own completion line reads back afterward, without
// either side needing to agree on which *http.Request value is "the" one.
type requestOutcome struct {
	authenticated bool
}

// MarkAuthenticated records, on the current request's shared outcome box,
// that authentication succeeded, so RequestLogger's completion line reports
// uid_set=true. It's a no-op if the request never passed through
// RequestLogger (no box installed), so it's safe to call unconditionally.
func MarkAuthenticated(ctx context.Context) {
	if outcome, ok := ctx.Value(outcomeKey).(*requestOutcome); ok {
		outcome.authenticated = true
	}
}

// RequestLogger is the sole owner of the completion log line and panic
// recovery for everything it wraps: exactly one "http_request" entry per
// request, with the real final status, whether the request finished
// normally, was rejected before reaching application code, or panicked
// partway through.
//
// It must wrap authentication from the outside (see WrapAuthenticated),
// never sit inside it: an auth check's rejection path writes directly to
// the ResponseWriter and returns without calling its next handler at all,
// so anything positioned as that next handler — including a logger — never
// runs for a rejected request. Wrapping from the outside means the same
// status-capturing writer installed here is what a rejection (or anything
// deeper) ultimately writes to, either way, so the completion line still
// fires with the real status.
//
// Observing the uid can't lean on which *http.Request value this handler
// happens to be holding, either: a successful auth check calls its own next
// handler with a *new* request built via r.WithContext, invisible to a
// *http.Request an outer closure already captured. Instead, RequestLogger
// installs a small mutable box (requestOutcome) on the context before
// calling next; MarkAuthenticated — called only from a position that auth
// rejection can't reach — mutates that same box by pointer, regardless of
// how many context/request layers sit between the two. See requestOutcome.
//
// It never logs headers, query strings, bodies, concrete URL paths, or — on a
// recovered panic — the panic value itself, only its Go type. Concrete paths
// can contain subject identifiers, so only the matched ServeMux pattern is
// recorded. Any of those other values can carry tokens or user/provider
// content.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		outcome := &requestOutcome{}
		r = r.WithContext(context.WithValue(r.Context(), outcomeKey, outcome))

		defer func() {
			if rec := recover(); rec != nil {
				requestID := RequestIDFromContext(r.Context())
				Logger.LogAttrs(r.Context(), slog.LevelError, "http_panic_recovered",
					slog.String("request_id", requestID),
					slog.String("route", safeRoutePattern(r)),
					slog.String("panic_type", fmt.Sprintf("%T", rec)),
					slog.String("stack", string(debug.Stack())),
				)
				writeSafeError(sw, requestID)
			}

			attrs := []slog.Attr{
				slog.String("method", r.Method),
				slog.String("route", safeRoutePattern(r)),
				slog.Int("status", sw.status),
				slog.Int64("duration_ms", time.Since(start).Milliseconds()),
				slog.String("request_id", RequestIDFromContext(r.Context())),
				slog.Bool("uid_set", outcome.authenticated),
			}
			Logger.LogAttrs(r.Context(), slog.LevelInfo, "http_request", attrs...)
		}()

		next.ServeHTTP(sw, r)
	})
}

const unmatchedRoutePattern = "<unmatched>"

func safeRoutePattern(r *http.Request) string {
	if r.Pattern == "" {
		return unmatchedRoutePattern
	}
	return r.Pattern
}

// statusWriter captures the status code a handler actually wrote, since
// http.ResponseWriter doesn't expose it after the fact.
type statusWriter struct {
	http.ResponseWriter
	status      int
	wroteHeader bool
}

func (w *statusWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}
