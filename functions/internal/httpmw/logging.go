package httpmw

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/mnohe/cvai/functions/internal/auth"
)

// Logger is the shared structured (JSON) logger for request logging, panic
// recovery, and any other cross-cutting log line that needs to correlate
// with a request id. JSON to stdout is picked up as structured log entries
// by Cloud Run/Cloud Logging without extra configuration.
var Logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))

// RequestLogger logs one structured line per request: method, path, status,
// duration, and the request id and uid (when known) for correlation. It
// never logs headers, query strings, or bodies, since those can carry
// tokens or user content.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)

		attrs := []slog.Attr{
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Int("status", sw.status),
			slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			slog.String("request_id", RequestIDFromContext(r.Context())),
		}
		if uid := auth.UIDFromContext(r.Context()); uid != "" {
			attrs = append(attrs, slog.Bool("uid_set", true))
		}
		Logger.LogAttrs(r.Context(), slog.LevelInfo, "http_request", attrs...)
	})
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
