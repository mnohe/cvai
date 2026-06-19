package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestOpenAICompleteUsesResponsesAPIAndStrictSchema(t *testing.T) {
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if got := r.URL.String(); got != "https://api.compat.test/v1/responses" {
			t.Fatalf("url = %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("Authorization = %q", got)
		}
		var request openAIResponseRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		if request.Text.Format.Type != "json_schema" || !request.Text.Format.Strict {
			t.Fatalf("format = %#v", request.Text.Format)
		}
		if len(request.Input) != 1 || len(request.Input[0].Content) != 2 {
			t.Fatalf("input = %#v", request.Input)
		}
		if request.Input[0].Content[0].Type != "input_file" || !strings.HasPrefix(request.Input[0].Content[0].FileData, "data:application/pdf;base64,") {
			t.Fatalf("file block = %#v", request.Input[0].Content[0])
		}
		return jsonResponse(http.StatusOK, `{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"{\"summary\":\"ok\"}"}]}],"usage":{"input_tokens":3,"output_tokens":5}}`), nil
	})

	client := &OpenAIClient{APIKey: "test-key", Model: "test-model", BaseURL: "https://api.compat.test/v1", Timeout: time.Second, MaxRetries: 1, HTTPClient: &http.Client{Transport: transport}}
	raw, err := client.Complete(context.Background(), "system", []Message{{Role: "user", Content: []ContentBlock{
		{Type: "document", Source: &BlockSource{Type: "base64", MediaType: "application/pdf", Data: "abc"}},
		{Type: "text", Text: "extract"},
	}}}, json.RawMessage(`{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"],"additionalProperties":false}`))
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if string(raw) != `{"summary":"ok"}` {
		t.Fatalf("raw = %s", raw)
	}
}

func TestNormalizeOpenAIBaseURL(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		{name: "default", want: "https://api.openai.com/v1"},
		{name: "custom", raw: "https://api.compat.test/v1/", want: "https://api.compat.test/v1"},
		{name: "adds v1", raw: "https://api.compat.test", want: "https://api.compat.test/v1"},
		{name: "rejects http", raw: "http://api.compat.test/v1", wantErr: true},
		{name: "rejects ip", raw: "https://127.0.0.1/v1", wantErr: true},
		{name: "rejects credentials", raw: "https://user:pass@api.compat.test/v1", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeOpenAIBaseURL(tt.raw)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeOpenAIBaseURL: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %q, want %q", got, tt.want)
			}
		})
	}
}

func TestNewCompleterRejectsUnknownProvider(t *testing.T) {
	if _, err := NewCompleter(Config{Provider: "wat"}); err == nil {
		t.Fatal("expected error")
	}
}
