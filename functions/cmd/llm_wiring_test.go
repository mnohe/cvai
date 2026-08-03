//go:build !e2e_mock

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/mnohe/cvai/functions/internal/llm"
)

func TestNewLLMClientValidation(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{
			name:    "missing api key",
			env:     map[string]string{"LLM_MODEL": "gpt-5.5"},
			wantErr: "LLM_API_KEY must be set",
		},
		{
			name:    "missing model",
			env:     map[string]string{"LLM_API_KEY": "sk-test"},
			wantErr: "LLM_MODEL must be set",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("LLM_API_KEY", "")
			t.Setenv("LLM_MODEL", "")
			t.Setenv("ANTHROPIC_API_KEY", "")
			t.Setenv("ANTHROPIC_MODEL", "")
			t.Setenv("OPENAI_API_KEY", "")
			t.Setenv("OPENAI_MODEL", "")
			for k, v := range tc.env {
				t.Setenv(k, v)
			}
			_, err := newLLMClient()
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if err.Error() != tc.wantErr {
				t.Fatalf("error = %q, want %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestNewLLMClientBuildsSupportedProvidersFromAliases(t *testing.T) {
	for _, tc := range []struct {
		name     string
		provider string
		keyEnv   string
		modelEnv string
		baseEnv  string
	}{
		{name: "anthropic", provider: llm.ProviderAnthropic, keyEnv: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", baseEnv: "ANTHROPIC_BASE_URL"},
		{name: "openai", provider: llm.ProviderOpenAI, keyEnv: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, key := range []string{"LLM_API_KEY", "LLM_MODEL", "LLM_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"} {
				t.Setenv(key, "")
			}
			t.Setenv("LLM_PROVIDER", tc.provider)
			t.Setenv(tc.keyEnv, "test-key")
			t.Setenv(tc.modelEnv, "test-model")
			if tc.baseEnv != "" {
				t.Setenv(tc.baseEnv, "https://provider.example.test")
			}
			t.Setenv("LLM_TIMEOUT_SECONDS", "9")

			client, err := newLLMClient()
			if err != nil {
				t.Fatalf("newLLMClient: %v", err)
			}
			if client == nil {
				t.Fatal("newLLMClient returned nil")
			}
		})
	}
}

func TestRegisterTestControlRoutesIsNoOpInProductionBuild(t *testing.T) {
	mux := http.NewServeMux()
	client, err := llm.NewCompleter(llm.Config{
		Provider: llm.ProviderOpenAI,
		APIKey:   "test-key",
		Model:    "test-model",
		Timeout:  time.Second,
	})
	if err != nil {
		t.Fatalf("NewCompleter: %v", err)
	}
	registerTestControlRoutes(mux, client)
	_, pattern := mux.Handler(httptest.NewRequest(http.MethodPost, "/e2e/mock-llm/responses", nil))
	if pattern != "" {
		t.Fatalf("production build registered test route %q", pattern)
	}
}
