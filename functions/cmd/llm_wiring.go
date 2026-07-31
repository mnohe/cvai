//go:build !e2e_mock

package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/mnohe/cvai/functions/internal/llm"
)

func newLLMClient() (llm.Completer, error) {
	provider := envOrDefault("LLM_PROVIDER", llm.ProviderAnthropic)
	apiKey := os.Getenv("LLM_API_KEY")
	model := os.Getenv("LLM_MODEL")
	baseURL := os.Getenv("LLM_BASE_URL")
	if provider == llm.ProviderAnthropic {
		apiKey = envOrDefaultValue(apiKey, os.Getenv("ANTHROPIC_API_KEY"))
		model = envOrDefaultValue(model, os.Getenv("ANTHROPIC_MODEL"))
		baseURL = envOrDefaultValue(baseURL, os.Getenv("ANTHROPIC_BASE_URL"))
	}
	if provider == llm.ProviderOpenAI {
		apiKey = envOrDefaultValue(apiKey, os.Getenv("OPENAI_API_KEY"))
		model = envOrDefaultValue(model, os.Getenv("OPENAI_MODEL"))
	}
	if apiKey == "" {
		return nil, fmt.Errorf("LLM_API_KEY must be set")
	}
	if model == "" {
		return nil, fmt.Errorf("LLM_MODEL must be set")
	}
	timeout := envDurationSeconds("LLM_TIMEOUT_SECONDS", 180*time.Second)
	log.Printf("llm_client_init provider=%s model_set=%t timeout_seconds=%d max_retries=%d", provider, model != "", int(timeout.Seconds()), 2)
	return llm.NewCompleter(llm.Config{
		Provider:   provider,
		APIKey:     apiKey,
		Model:      model,
		MaxTokens:  4096,
		Timeout:    timeout,
		MaxRetries: 2,
		BaseURL:    baseURL,
	})
}

// registerTestControlRoutes is a no-op in production builds. The e2e_mock
// build tag swaps in the variant that exposes the mock LLM control route.
func registerTestControlRoutes(*http.ServeMux, llm.Completer) {}
