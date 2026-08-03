package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEnvironmentHelpers(t *testing.T) {
	t.Setenv("TEST_STRING", "configured")
	if got := envOrDefault("TEST_STRING", "fallback"); got != "configured" {
		t.Fatalf("envOrDefault configured = %q", got)
	}
	t.Setenv("TEST_STRING", "")
	if got := envOrDefault("TEST_STRING", "fallback"); got != "fallback" {
		t.Fatalf("envOrDefault fallback = %q", got)
	}
	if got := envOrDefaultValue("configured", "fallback"); got != "configured" {
		t.Fatalf("envOrDefaultValue configured = %q", got)
	}
	if got := envOrDefaultValue("", "fallback"); got != "fallback" {
		t.Fatalf("envOrDefaultValue fallback = %q", got)
	}
}

func TestDurationAndIntegerEnvironmentParsing(t *testing.T) {
	for _, tc := range []struct {
		name string
		raw  string
		want time.Duration
	}{
		{name: "unset", want: 7 * time.Second},
		{name: "valid", raw: "12", want: 12 * time.Second},
		{name: "not a number", raw: "nope", want: 7 * time.Second},
		{name: "non-positive", raw: "0", want: 7 * time.Second},
	} {
		t.Run("duration "+tc.name, func(t *testing.T) {
			t.Setenv("TEST_DURATION", tc.raw)
			if got := envDurationSeconds("TEST_DURATION", 7*time.Second); got != tc.want {
				t.Fatalf("envDurationSeconds = %v, want %v", got, tc.want)
			}
		})
	}
	for _, tc := range []struct {
		name string
		raw  string
		want int
	}{
		{name: "unset", want: 7},
		{name: "valid", raw: "12", want: 12},
		{name: "not a number", raw: "nope", want: 7},
		{name: "non-positive", raw: "-1", want: 7},
	} {
		t.Run("integer "+tc.name, func(t *testing.T) {
			t.Setenv("TEST_INT", tc.raw)
			if got := envInt("TEST_INT", 7); got != tc.want {
				t.Fatalf("envInt = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestRuntimeConfigurationDefaultsAndOverrides(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")
	if got := corsAllowedOrigins(); got != nil {
		t.Fatalf("empty origins = %#v, want nil", got)
	}
	t.Setenv("CORS_ALLOWED_ORIGINS", " https://one.example,https://two.example ")
	got := corsAllowedOrigins()
	if len(got) != 2 || got[0] != "https://one.example" || got[1] != "https://two.example" {
		t.Fatalf("origins = %#v", got)
	}

	t.Setenv("RATE_LIMIT_PER_MINUTE", "")
	t.Setenv("RATE_LIMIT_BURST", "")
	if rateLimitPerMinute() != defaultRateLimitPerMinute || rateLimitBurst() != defaultRateLimitBurst {
		t.Fatal("rate-limit defaults changed")
	}
	t.Setenv("RATE_LIMIT_PER_MINUTE", "42")
	t.Setenv("RATE_LIMIT_BURST", "9")
	if rateLimitPerMinute() != 42 || rateLimitBurst() != 9 {
		t.Fatal("rate-limit overrides were not applied")
	}
}

func TestStub501(t *testing.T) {
	rec := httptest.NewRecorder()
	stub501("ExampleOperation").ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/example", nil))
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q", got)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["error"] != "ExampleOperation not implemented" {
		t.Fatalf("error = %q", body["error"])
	}
}
