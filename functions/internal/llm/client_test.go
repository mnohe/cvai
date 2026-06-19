package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestCompleteExtractsToolJSON(t *testing.T) {
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if got := r.Header.Get("x-api-key"); got != "test-key" {
			t.Fatalf("x-api-key = %q", got)
		}
		return jsonResponse(http.StatusOK, `{"content":[{"type":"tool_use","name":"structured_output","input":{"summary":"ok"}}],"usage":{"input_tokens":7,"output_tokens":11}}`), nil
	})

	client := &Client{APIKey: "test-key", Model: "test-model", BaseURL: "https://anthropic.test/messages", Timeout: time.Second, MaxRetries: 1, HTTPClient: &http.Client{Transport: transport}}
	raw, err := client.Complete(context.Background(), "system", []Message{{Role: "user", Content: []ContentBlock{{Type: "text", Text: "hello"}}}}, json.RawMessage(`{"type":"object"}`))
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if string(raw) != `{"summary":"ok"}` {
		t.Fatalf("raw = %s", raw)
	}
}

func TestCompleteRetries429AndDoesNotRetry400(t *testing.T) {
	attempts := 0
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		attempts++
		if attempts == 1 {
			resp := jsonResponse(http.StatusTooManyRequests, `{}`)
			resp.Header.Set("Retry-After", "0")
			return resp, nil
		}
		return jsonResponse(http.StatusOK, `{"content":[{"type":"tool_use","name":"structured_output","input":{"summary":"ok"}}],"usage":{}}`), nil
	})

	client := &Client{APIKey: "test-key", Model: "test-model", BaseURL: "https://anthropic.test/messages", Timeout: time.Second, MaxRetries: 2, HTTPClient: &http.Client{Transport: transport}}
	if _, err := client.Complete(context.Background(), "system", nil, json.RawMessage(`{"type":"object"}`)); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if attempts != 2 {
		t.Fatalf("attempts = %d, want 2", attempts)
	}

	attempts = 0
	client.HTTPClient = &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		attempts++
		return jsonResponse(http.StatusBadRequest, `{}`), nil
	})}
	if _, err := client.Complete(context.Background(), "system", nil, json.RawMessage(`{"type":"object"}`)); err == nil {
		t.Fatal("Complete succeeded on 400")
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}

func TestIsUserInputError(t *testing.T) {
	if !IsUserInputError(StatusError{Provider: ProviderOpenAI, Status: http.StatusBadRequest}) {
		t.Fatal("400 should be classified as user input")
	}
	if IsUserInputError(StatusError{Provider: ProviderOpenAI, Status: http.StatusUnauthorized}) {
		t.Fatal("401 should not be classified as user input")
	}
	if IsUserInputError(StatusError{Provider: ProviderOpenAI, Status: http.StatusTooManyRequests}) {
		t.Fatal("429 should not be classified as user input")
	}
	if IsUserInputError(StatusError{Provider: ProviderOpenAI, Status: http.StatusInternalServerError}) {
		t.Fatal("500 should not be classified as user input")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func jsonResponse(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
