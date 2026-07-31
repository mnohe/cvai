package httpmw

import "net/http"

// CORS restricts cross-origin browser access to an explicit allow-list
// instead of leaving it to the accidental, undocumented default of no CORS
// headers at all (which still lets a browser send a cross-origin request in
// some cases and merely blocks the page from reading the response). With an
// empty allow-list it preserves that default deny-by-omission behaviour
// exactly — no header is added, and preflight requests still get a plain
// 404/whatever the mux would otherwise return — so existing deployments
// that never set CORS_ALLOWED_ORIGINS see no behaviour change.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowed[origin] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		if len(allowed) == 0 {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if _, ok := allowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
				// Bearer tokens travel in the Authorization header, not cookies,
				// so credentialed (cookie-based) CORS is never needed here.
			}
			if r.Method == http.MethodOptions && origin != "" {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
