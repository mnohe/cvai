package main

import (
	"testing"
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
