package routing

import (
	"net/http/httptest"
	"testing"
)

func TestStripAPIPrefix(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "api route", path: "/api/cv/imports", want: "/cv/imports"},
		{name: "bare api", path: "/api", want: "/"},
		{name: "non api route", path: "/healthz", want: "/healthz"},
		{name: "api-like route", path: "/apis/healthz", want: "/apis/healthz"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			req := httptest.NewRequest("GET", tt.path, nil)
			got := StripAPIPrefix(req)
			if got.URL.Path != tt.want {
				t.Fatalf("path = %q, want %q", got.URL.Path, tt.want)
			}
		})
	}
}
