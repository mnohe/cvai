package httpmw

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
)

// Recover turns a panicking handler into a safe, generic 500 response
// instead of an abruptly closed connection (Go's default net/http
// recovery). The panic value and stack trace are logged server-side with
// the request id for correlation; neither is ever sent to the client.
func Recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				requestID := RequestIDFromContext(r.Context())
				Logger.LogAttrs(r.Context(), slog.LevelError, "http_panic_recovered",
					slog.String("request_id", requestID),
					slog.String("path", r.URL.Path),
					slog.Any("panic", rec),
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
