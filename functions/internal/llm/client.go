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
	"strings"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

const defaultAnthropicBaseURL = "https://api.anthropic.com/v1/messages"

const (
	ProviderAnthropic = "anthropic"
	ProviderOpenAI    = "openai"

	structuredOutputToolName = "structured_output"
)

var (
	llmMeter  = otel.Meter("github.com/mnohe/cvai/functions/llm")
	llmTracer = otel.Tracer("github.com/mnohe/cvai/functions/llm")

	llmRequestDuration, _ = llmMeter.Int64Histogram(
		"llm_request_duration_ms",
		metric.WithDescription("Duration of LLM provider requests."),
		metric.WithUnit("ms"),
	)
	llmInputTokens, _ = llmMeter.Int64Histogram(
		"llm_input_tokens",
		metric.WithDescription("Input tokens consumed by LLM provider requests."),
		metric.WithUnit("{token}"),
	)
	llmOutputTokens, _ = llmMeter.Int64Histogram(
		"llm_output_tokens",
		metric.WithDescription("Output tokens emitted by LLM provider requests."),
		metric.WithUnit("{token}"),
	)
	llmRequests, _ = llmMeter.Int64Counter(
		"llm_requests_total",
		metric.WithDescription("Count of LLM provider requests by provider, model, status, and failure class."),
	)
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
	Detail   string
}

func (e StatusError) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("%s status %d (%s)", e.Provider, e.Status, e.Detail)
	}
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

	ctx, start, span := startLLMTelemetry(ctx, ProviderAnthropic, c.Model)
	defer span.End()
	var lastErr error
	for attempt := 0; attempt <= c.maxRetries(); attempt++ {
		reqCtx, cancel := requestContext(ctx, c.Timeout)
		resp, err := c.do(reqCtx, payload)
		if err != nil {
			cancel()
			lastErr = err
			if attempt < c.maxRetries() {
				if err := sleepContext(ctx, c.backoff(attempt+1, nil)); err != nil {
					recordLLMFailure(ctx, ProviderAnthropic, c.Model, start, span, classifyLLMFailure(err))
					return nil, err
				}
				continue
			}
			continue
		}
		responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		if readErr != nil {
			_ = resp.Body.Close()
			cancel()
			recordLLMFailure(ctx, ProviderAnthropic, c.Model, start, span, classifyLLMFailure(readErr))
			return nil, fmt.Errorf("read llm response: %w", readErr)
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = providerStatusError(ProviderAnthropic, resp.StatusCode, responseBody)
			if attempt < c.maxRetries() {
				_, _ = io.Copy(io.Discard, resp.Body)
				_ = resp.Body.Close()
				cancel()
				if err := sleepContext(ctx, c.backoff(attempt+1, resp.Header)); err != nil {
					recordLLMFailure(ctx, ProviderAnthropic, c.Model, start, span, classifyLLMFailure(err))
					return nil, err
				}
				continue
			}
		}
		_ = resp.Body.Close()
		cancel()

		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			err := providerStatusError(ProviderAnthropic, resp.StatusCode, responseBody)
			recordLLMFailure(ctx, ProviderAnthropic, c.Model, start, span, classifyLLMFailure(err))
			return nil, err
		}

		var decoded completionResponse
		if err := json.Unmarshal(responseBody, &decoded); err != nil {
			recordLLMFailure(ctx, ProviderAnthropic, c.Model, start, span, "decode")
			return nil, fmt.Errorf("decode llm response: %w", err)
		}
		raw, err := extractToolJSON(decoded)
		if err != nil {
			recordLLMFailure(ctx, ProviderAnthropic, c.Model, start, span, "response")
			return nil, err
		}
		log.Printf("llm_complete model=%s input_tokens=%d output_tokens=%d latency_ms=%d", c.Model, decoded.Usage.InputTokens, decoded.Usage.OutputTokens, time.Since(start).Milliseconds())
		recordLLMSuccess(ctx, ProviderAnthropic, c.Model, start, span, decoded.Usage.InputTokens, decoded.Usage.OutputTokens)
		return raw, nil
	}
	recordLLMFailure(ctx, ProviderAnthropic, c.Model, start, span, classifyLLMFailure(lastErr))
	return nil, lastErr
}

func providerStatusError(provider string, status int, body []byte) StatusError {
	return StatusError{Provider: provider, Status: status, Detail: providerErrorSummary(body)}
}

func startLLMTelemetry(ctx context.Context, provider string, model string) (context.Context, time.Time, trace.Span) {
	ctx, span := llmTracer.Start(ctx, "llm.complete",
		trace.WithAttributes(
			attribute.String("llm.provider", provider),
			attribute.String("llm.model", model),
		),
	)
	return ctx, time.Now(), span
}

func recordLLMSuccess(ctx context.Context, provider string, model string, start time.Time, span trace.Span, inputTokens int, outputTokens int) {
	duration := time.Since(start).Milliseconds()
	attrs := metric.WithAttributes(
		attribute.String("provider", provider),
		attribute.String("model", model),
		attribute.String("status", "completed"),
		attribute.String("failure_class", "none"),
	)
	llmRequestDuration.Record(ctx, duration, attrs)
	llmInputTokens.Record(ctx, int64(inputTokens), attrs)
	llmOutputTokens.Record(ctx, int64(outputTokens), attrs)
	llmRequests.Add(ctx, 1, attrs)
	span.SetAttributes(
		attribute.String("llm.status", "completed"),
		attribute.String("llm.failure_class", "none"),
		attribute.Int64("llm.duration_ms", duration),
		attribute.Int("llm.input_tokens", inputTokens),
		attribute.Int("llm.output_tokens", outputTokens),
	)
}

func recordLLMFailure(ctx context.Context, provider string, model string, start time.Time, span trace.Span, failureClass string) {
	duration := time.Since(start).Milliseconds()
	attrs := metric.WithAttributes(
		attribute.String("provider", provider),
		attribute.String("model", model),
		attribute.String("status", "failed"),
		attribute.String("failure_class", failureClass),
	)
	llmRequestDuration.Record(ctx, duration, attrs)
	llmRequests.Add(ctx, 1, attrs)
	span.SetAttributes(
		attribute.String("llm.status", "failed"),
		attribute.String("llm.failure_class", failureClass),
		attribute.Int64("llm.duration_ms", duration),
	)
}

func classifyLLMFailure(err error) string {
	if err == nil {
		return "unknown"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "timeout"
	}
	var statusErr StatusError
	if errors.As(err, &statusErr) {
		switch {
		case statusErr.Status == http.StatusTooManyRequests:
			return "rate_limit"
		case statusErr.Status == http.StatusUnauthorized || statusErr.Status == http.StatusForbidden:
			return "provider_auth"
		case statusErr.Status >= 500:
			return "provider_5xx"
		case statusErr.Status >= 400:
			return "provider_4xx"
		}
	}
	return "provider_or_system"
}

func providerErrorSummary(body []byte) string {
	var payload struct {
		Error struct {
			Type    string `json:"type"`
			Code    any    `json:"code"`
			Param   string `json:"param"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	parts := make([]string, 0, 4)
	if payload.Error.Type != "" {
		parts = append(parts, "type="+cleanProviderErrorValue(payload.Error.Type, 80))
	}
	if payload.Error.Code != nil {
		parts = append(parts, "code="+cleanProviderErrorValue(fmt.Sprint(payload.Error.Code), 80))
	}
	if payload.Error.Param != "" {
		parts = append(parts, "param="+cleanProviderErrorValue(payload.Error.Param, 80))
	}
	if payload.Error.Message != "" {
		parts = append(parts, "message="+cleanProviderErrorValue(payload.Error.Message, 240))
	}
	return strings.Join(parts, " ")
}

func cleanProviderErrorValue(value string, maxLen int) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) > maxLen {
		return value[:maxLen] + "..."
	}
	return value
}

func requestContext(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return parent, func() {}
	}
	return context.WithTimeout(parent, timeout)
}

func (c *Client) do(ctx context.Context, payload []byte) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL(), bytes.NewReader(payload))
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
