package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"time"
)

const defaultAnthropicBaseURL = "https://api.anthropic.com/v1/messages"

const (
	ProviderAnthropic = "anthropic"
	ProviderOpenAI    = "openai"

	structuredOutputToolName = "structured_output"
)

// Completer is the provider-neutral interface used by LLM-backed handlers.
type Completer interface {
	Complete(ctx context.Context, systemPrompt string, messages []Message, schema json.RawMessage) (json.RawMessage, error)
}

// Config describes one LLM provider using the API dialect named by Provider.
type Config struct {
	Provider   string
	APIKey     string
	Model      string
	MaxTokens  int
	Timeout    time.Duration
	MaxRetries int
	BaseURL    string
	HTTPClient *http.Client
}

// StatusError records an HTTP status returned by a model provider.
type StatusError struct {
	Provider string
	Status   int
}

func (e StatusError) Error() string {
	return fmt.Sprintf("%s status %d", e.Provider, e.Status)
}

// IsUserInputError returns true when a provider status is specific enough to
// treat the failure as caused by unsupported or invalid user input rather than
// a system, configuration, or provider fault.
func IsUserInputError(err error) bool {
	var statusErr StatusError
	if !errors.As(err, &statusErr) {
		return false
	}
	switch statusErr.Status {
	case http.StatusBadRequest, http.StatusRequestEntityTooLarge, http.StatusUnsupportedMediaType, http.StatusUnprocessableEntity:
		return true
	default:
		return false
	}
}

// NewCompleter creates the configured LLM client.
func NewCompleter(cfg Config) (Completer, error) {
	switch cfg.Provider {
	case "", ProviderAnthropic:
		return &Client{
			APIKey:     cfg.APIKey,
			Model:      cfg.Model,
			MaxTokens:  cfg.MaxTokens,
			Timeout:    cfg.Timeout,
			MaxRetries: cfg.MaxRetries,
			BaseURL:    cfg.BaseURL,
			HTTPClient: cfg.HTTPClient,
		}, nil
	case ProviderOpenAI:
		baseURL, err := NormalizeOpenAIBaseURL(cfg.BaseURL)
		if err != nil {
			return nil, err
		}
		return &OpenAIClient{
			APIKey:     cfg.APIKey,
			Model:      cfg.Model,
			MaxTokens:  cfg.MaxTokens,
			Timeout:    cfg.Timeout,
			MaxRetries: cfg.MaxRetries,
			BaseURL:    baseURL,
			HTTPClient: cfg.HTTPClient,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported llm provider %q", cfg.Provider)
	}
}

// Client calls Anthropic's Messages API for structured completions.
type Client struct {
	APIKey     string
	Model      string
	MaxTokens  int
	Timeout    time.Duration
	MaxRetries int

	BaseURL    string
	HTTPClient *http.Client
}

// Message is a provider-neutral chat message.
type Message struct {
	Role    string
	Content []ContentBlock
}

// ContentBlock is one Messages API content block.
type ContentBlock struct {
	Type      string       `json:"type"`
	Text      string       `json:"text,omitempty"`
	Source    *BlockSource `json:"source,omitempty"`
	Name      string       `json:"name,omitempty"`
	Input     any          `json:"input,omitempty"`
	ToolUseID string       `json:"tool_use_id,omitempty"`
}

// BlockSource identifies binary content sent to the model.
type BlockSource struct {
	Type      string `json:"type"`
	MediaType string `json:"media_type"`
	Data      string `json:"data"`
}

// Complete returns the JSON payload emitted by the structured-output tool.
func (c *Client) Complete(ctx context.Context, systemPrompt string, messages []Message, schema json.RawMessage) (json.RawMessage, error) {
	if c.APIKey == "" {
		return nil, errors.New("llm api key is not configured")
	}
	if c.Model == "" {
		return nil, errors.New("llm model is not configured")
	}
	if len(schema) == 0 || !json.Valid(schema) {
		return nil, errors.New("invalid structured output schema")
	}

	body := completionRequest{
		Model:     c.Model,
		MaxTokens: c.maxTokens(),
		System:    systemPrompt,
		Messages:  messages,
		Tools: []toolDefinition{{
			Name:        structuredOutputToolName,
			Description: "Return only the structured JSON matching the provided schema.",
			InputSchema: schema,
		}},
		ToolChoice: toolChoice{Type: "tool", Name: structuredOutputToolName},
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal llm request: %w", err)
	}

	start := time.Now()
	var lastErr error
	for attempt := 0; attempt <= c.maxRetries(); attempt++ {
		resp, err := c.do(ctx, payload)
		if err != nil {
			lastErr = err
			if attempt < c.maxRetries() {
				if err := sleepContext(ctx, c.backoff(attempt+1, nil)); err != nil {
					return nil, err
				}
				continue
			}
			continue
		}
		responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		if readErr != nil {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("read llm response: %w", readErr)
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = StatusError{Provider: ProviderAnthropic, Status: resp.StatusCode}
			if attempt < c.maxRetries() {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
				if err := sleepContext(ctx, c.backoff(attempt+1, resp.Header)); err != nil {
					return nil, err
				}
				continue
			}
		}
		_ = resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return nil, StatusError{Provider: ProviderAnthropic, Status: resp.StatusCode}
		}

		var decoded completionResponse
		if err := json.Unmarshal(responseBody, &decoded); err != nil {
			return nil, fmt.Errorf("decode llm response: %w", err)
		}
		log.Printf("llm_complete model=%s input_tokens=%d output_tokens=%d latency_ms=%d", c.Model, decoded.Usage.InputTokens, decoded.Usage.OutputTokens, time.Since(start).Milliseconds())
		return extractToolJSON(decoded)
	}
	return nil, lastErr
}

func (c *Client) do(ctx context.Context, payload []byte) (*http.Response, error) {
	reqCtx := ctx
	var cancel context.CancelFunc
	if c.Timeout > 0 {
		reqCtx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, c.baseURL(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", c.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	return c.httpClient().Do(req)
}

func extractToolJSON(resp completionResponse) (json.RawMessage, error) {
	for _, block := range resp.Content {
		if block.Type == "tool_use" && block.Name == structuredOutputToolName {
			raw, err := json.Marshal(block.Input)
			if err != nil {
				return nil, fmt.Errorf("marshal tool input: %w", err)
			}
			if !json.Valid(raw) {
				return nil, errors.New("tool input is not valid json")
			}
			return raw, nil
		}
	}
	return nil, errors.New("llm response did not include structured_output tool use")
}

func (c *Client) baseURL() string {
	if c.BaseURL != "" {
		return c.BaseURL
	}
	return defaultAnthropicBaseURL
}

func (c *Client) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func (c *Client) maxTokens() int {
	if c.MaxTokens > 0 {
		return c.MaxTokens
	}
	return 4096
}

func (c *Client) maxRetries() int {
	if c.MaxRetries > 0 {
		return c.MaxRetries
	}
	return 2
}

func (c *Client) backoff(attempt int, header http.Header) time.Duration {
	if header != nil {
		if value := header.Get("Retry-After"); value != "" {
			if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
				return time.Duration(seconds) * time.Second
			}
			if when, err := http.ParseTime(value); err == nil {
				if d := time.Until(when); d > 0 {
					return d
				}
			}
		}
	}
	return time.Duration(math.Pow(2, float64(attempt-1))) * 100 * time.Millisecond
}

func sleepContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

type completionRequest struct {
	Model      string           `json:"model"`
	MaxTokens  int              `json:"max_tokens"`
	System     string           `json:"system"`
	Messages   []Message        `json:"messages"`
	Tools      []toolDefinition `json:"tools"`
	ToolChoice toolChoice       `json:"tool_choice"`
}

type toolDefinition struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

type toolChoice struct {
	Type string `json:"type"`
	Name string `json:"name"`
}

type completionResponse struct {
	Content []ContentBlock `json:"content"`
	Usage   usage          `json:"usage"`
}

type usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}
