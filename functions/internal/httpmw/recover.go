package httpmw

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
)

// Recover turns a panicking handler into a safe, generic 500 response
// instead of an abruptly closed connection (Go's default net/http
// recovery). Only a safe classification of the panic — its Go type, never
// its value — plus the stack trace are logged server-side for correlation.
// A panic's value is often a formatted string built from whatever the
// panicking code was holding (provider responses, filenames, user input),
// so it is never logged, even server-side. A runtime/debug.Stack() trace
// contains only function/file/line locations, never variable values, so it
// carries no equivalent risk and is kept for diagnosis.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				requestID := RequestIDFromContext(r.Context())
				Logger.LogAttrs(r.Context(), slog.LevelError, "http_panic_recovered",
					slog.String("request_id", requestID),
					slog.String("path", r.URL.Path),
					slog.String("panic_type", fmt.Sprintf("%T", rec)),
					slog.String("stack", string(debug.Stack())),
				)
				writeSafeError(w, requestID)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// writeSafeError writes a generic error body carrying only a request id a
// user can quote to support — never the panic value, an error string, or a
// stack trace, any of which could leak internal detail.
func writeSafeError(w http.ResponseWriter, requestID string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusInternalServerError)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error":     "internal server error",
		"requestId": requestID,
	})
}
