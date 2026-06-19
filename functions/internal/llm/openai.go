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
	"net"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

const defaultOpenAIBaseURL = "https://api.openai.com/v1"

// OpenAIClient calls the OpenAI Responses API dialect. BaseURL may point at
// api.openai.com or a fully compatible host; compatibility is intentionally
// defined by the API shape, not by a separate provider enum.
type OpenAIClient struct {
	APIKey     string
	Model      string
	MaxTokens  int
	Timeout    time.Duration
	MaxRetries int

	BaseURL    string
	HTTPClient *http.Client
}

// NormalizeOpenAIBaseURL validates and normalizes an OpenAI-compatible base URL.
func NormalizeOpenAIBaseURL(raw string) (string, error) {
	if raw == "" {
		raw = defaultOpenAIBaseURL
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("parse openai base url: %w", err)
	}
	if parsed.Scheme != "https" {
		return "", errors.New("openai base url must use https")
	}
	if parsed.User != nil {
		return "", errors.New("openai base url must not contain credentials")
	}
	if parsed.Hostname() == "" {
		return "", errors.New("openai base url must include a hostname")
	}
	if net.ParseIP(parsed.Hostname()) != nil {
		return "", errors.New("openai base url must use a hostname, not an IP address")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("openai base url must not include query or fragment")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if parsed.Path == "" {
		parsed.Path = "/v1"
	}
	return parsed.String(), nil
}

// Complete returns the JSON payload emitted through OpenAI strict structured output.
func (c *OpenAIClient) Complete(ctx context.Context, systemPrompt string, messages []Message, schema json.RawMessage) (json.RawMessage, error) {
	if c.APIKey == "" {
		return nil, errors.New("llm api key is not configured")
	}
	if c.Model == "" {
		return nil, errors.New("llm model is not configured")
	}
	if len(schema) == 0 || !json.Valid(schema) {
		return nil, errors.New("invalid structured output schema")
	}
	strictSchema, err := DeriveOpenAIStrictSchema(schema)
	if err != nil {
		return nil, fmt.Errorf("derive openai structured output schema: %w", err)
	}

	body := openAIResponseRequest{
		Model:           c.Model,
		Instructions:    systemPrompt,
		Input:           toOpenAIInput(messages),
		MaxOutputTokens: c.maxTokens(),
		Text: openAITextConfig{
			Format: openAITextFormat{
				Type:   "json_schema",
				Name:   structuredOutputToolName,
				Strict: true,
				Schema: strictSchema,
			},
		},
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
			lastErr = StatusError{Provider: ProviderOpenAI, Status: resp.StatusCode}
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
			return nil, StatusError{Provider: ProviderOpenAI, Status: resp.StatusCode}
		}

		var decoded openAIResponse
		if err := json.Unmarshal(responseBody, &decoded); err != nil {
			return nil, fmt.Errorf("decode llm response: %w", err)
		}
		log.Printf("llm_complete model=%s input_tokens=%d output_tokens=%d latency_ms=%d", c.Model, decoded.Usage.InputTokens, decoded.Usage.OutputTokens, time.Since(start).Milliseconds())
		return extractOpenAIJSON(decoded)
	}
	return nil, lastErr
}

func (c *OpenAIClient) do(ctx context.Context, payload []byte) (*http.Response, error) {
	reqCtx := ctx
	var cancel context.CancelFunc
	if c.Timeout > 0 {
		reqCtx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, c.endpoint(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")
	return c.httpClient().Do(req)
}

func (c *OpenAIClient) endpoint() string {
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = defaultOpenAIBaseURL
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return base + "/responses"
	}
	parsed.Path = path.Join(parsed.Path, "responses")
	return parsed.String()
}

func (c *OpenAIClient) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return http.DefaultClient
}

func (c *OpenAIClient) maxTokens() int {
	if c.MaxTokens > 0 {
		return c.MaxTokens
	}
	return 4096
}

func (c *OpenAIClient) maxRetries() int {
	if c.MaxRetries > 0 {
		return c.MaxRetries
	}
	return 2
}

func (c *OpenAIClient) backoff(attempt int, header http.Header) time.Duration {
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

func toOpenAIInput(messages []Message) []openAIInputMessage {
	out := make([]openAIInputMessage, 0, len(messages))
	for _, message := range messages {
		content := make([]openAIContentBlock, 0, len(message.Content))
		for _, block := range message.Content {
			switch block.Type {
			case "document":
				if block.Source == nil {
					continue
				}
				content = append(content, openAIContentBlock{
					Type:     "input_file",
					Filename: "cv.pdf",
					FileData: fmt.Sprintf("data:%s;base64,%s", block.Source.MediaType, block.Source.Data),
				})
			case "text":
				content = append(content, openAIContentBlock{Type: "input_text", Text: block.Text})
			}
		}
		out = append(out, openAIInputMessage{Role: message.Role, Content: content})
	}
	return out
}

func extractOpenAIJSON(resp openAIResponse) (json.RawMessage, error) {
	if resp.Status != "" && resp.Status != "completed" {
		return nil, fmt.Errorf("openai response status %q", resp.Status)
	}
	if resp.Error != nil {
		return nil, fmt.Errorf("openai response error: %s", resp.Error.Message)
	}
	for _, item := range resp.Output {
		if item.Type != "message" {
			continue
		}
		for _, content := range item.Content {
			if content.Type != "output_text" {
				continue
			}
			raw := json.RawMessage(strings.TrimSpace(content.Text))
			if !json.Valid(raw) {
				return nil, errors.New("openai output_text is not valid json")
			}
			return raw, nil
		}
	}
	return nil, errors.New("openai response did not include output_text json")
}

type openAIResponseRequest struct {
	Model           string               `json:"model"`
	Instructions    string               `json:"instructions"`
	Input           []openAIInputMessage `json:"input"`
	MaxOutputTokens int                  `json:"max_output_tokens,omitempty"`
	Text            openAITextConfig     `json:"text"`
}

type openAIInputMessage struct {
	Role    string               `json:"role"`
	Content []openAIContentBlock `json:"content"`
}

type openAIContentBlock struct {
	Type     string `json:"type"`
	Text     string `json:"text,omitempty"`
	Filename string `json:"filename,omitempty"`
	FileData string `json:"file_data,omitempty"`
}

type openAITextConfig struct {
	Format openAITextFormat `json:"format"`
}

type openAITextFormat struct {
	Type   string          `json:"type"`
	Name   string          `json:"name"`
	Strict bool            `json:"strict"`
	Schema json.RawMessage `json:"schema"`
}

type openAIResponse struct {
	Status string             `json:"status"`
	Error  *openAIError       `json:"error"`
	Output []openAIOutputItem `json:"output"`
	Usage  openAIUsage        `json:"usage"`
}

type openAIError struct {
	Message string `json:"message"`
}

type openAIOutputItem struct {
	Type    string                `json:"type"`
	Content []openAIOutputContent `json:"content"`
}

type openAIOutputContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type openAIUsage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
}
