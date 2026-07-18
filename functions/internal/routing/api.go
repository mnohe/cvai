package routing

import (
	"net/http"
	"strings"
)

// StripAPIPrefix maps Firebase Hosting /api/** rewrites onto the backend mux paths.
func StripAPIPrefix(r *http.Request) *http.Request {
	if r.URL.Path != "/api" && !strings.HasPrefix(r.URL.Path, "/api/") {
		return r
	}
	routeReq := r.Clone(r.Context())
	routeURL := *r.URL
	routeURL.Path = strings.TrimPrefix(r.URL.Path, "/api")
	if routeURL.Path == "" {
		routeURL.Path = "/"
	}
	routeReq.URL = &routeURL
	return routeReq
}
