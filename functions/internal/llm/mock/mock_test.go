//go:build e2e_mock

package mock

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/llm"
)

func TestCompleteReturnsQueuedResponsesInFIFOOrder(t *testing.T) {
	c := NewCompleter()
	c.Enqueue("uid-1", QueuedResponse{Body: json.RawMessage(`{"n":1}`)})
	c.Enqueue("uid-1", QueuedResponse{Body: json.RawMessage(`{"n":2}`)})

	ctx := auth.WithUID(context.Background(), "uid-1")
	first, err := c.Complete(ctx, "", nil, nil)
	if err != nil {
		t.Fatalf("first Complete: %v", err)
	}
	if string(first) != `{"n":1}` {
		t.Fatalf("first = %s, want {\"n\":1}", first)
	}
	second, err := c.Complete(ctx, "", nil, nil)
	if err != nil {
		t.Fatalf("second Complete: %v", err)
	}
	if string(second) != `{"n":2}` {
		t.Fatalf("second = %s, want {\"n\":2}", second)
	}
}

func TestCompleteCapturesTheProviderBoundary(t *testing.T) {
	c := NewCompleter()
	c.Enqueue("uid-1", QueuedResponse{Body: json.RawMessage(`{"ok":true}`)})
	ctx := auth.WithUID(context.Background(), "uid-1")
	messages := []llm.Message{{Role: "user", Content: []llm.ContentBlock{{Type: "text", Text: "fixed user prompt"}}}}
	schema := json.RawMessage(`{"type":"object"}`)

	if _, err := c.Complete(ctx, "fixed system prompt", messages, schema); err != nil {
		t.Fatalf("Complete: %v", err)
	}
	captures := c.Captures("uid-1")
	if len(captures) != 1 || captures[0].System != "fixed system prompt" {
		t.Fatalf("captures = %#v", captures)
	}
	if got := captures[0].Messages[0].Content[0].Text; got != "fixed user prompt" {
		t.Fatalf("captured text = %q", got)
	}
	if string(captures[0].Schema) != string(schema) {
		t.Fatalf("captured schema = %s", captures[0].Schema)
	}
}

func TestCompleteQueuesAreIsolatedPerUser(t *testing.T) {
	c := NewCompleter()
	c.Enqueue("uid-1", QueuedResponse{Body: json.RawMessage(`{"owner":"uid-1"}`)})

	otherCtx := auth.WithUID(context.Background(), "uid-2")
	if _, err := c.Complete(otherCtx, "", nil, nil); !errors.Is(err, ErrNoQueuedResponse) {
		t.Fatalf("uid-2 err = %v, want ErrNoQueuedResponse", err)
	}

	ownCtx := auth.WithUID(context.Background(), "uid-1")
	got, err := c.Complete(ownCtx, "", nil, nil)
	if err != nil {
		t.Fatalf("uid-1 Complete: %v", err)
	}
	if string(got) != `{"owner":"uid-1"}` {
		t.Fatalf("got = %s", got)
	}
}

func TestCompleteWithoutQueuedResponseFails(t *testing.T) {
	c := NewCompleter()
	ctx := auth.WithUID(context.Background(), "uid-1")
	if _, err := c.Complete(ctx, "", nil, nil); !errors.Is(err, ErrNoQueuedResponse) {
		t.Fatalf("err = %v, want ErrNoQueuedResponse", err)
	}
}

func TestCompleteReturnsStatusErrorForNonSuccessStatus(t *testing.T) {
	c := NewCompleter()
	c.Enqueue("uid-1", QueuedResponse{StatusCode: http.StatusTooManyRequests, Detail: "rate limited"})
	ctx := auth.WithUID(context.Background(), "uid-1")

	_, err := c.Complete(ctx, "", nil, nil)
	var statusErr llm.StatusError
	if !errors.As(err, &statusErr) {
		t.Fatalf("err = %v, want llm.StatusError", err)
	}
	if statusErr.Status != http.StatusTooManyRequests || statusErr.Provider != "mock" || statusErr.Detail != "rate limited" {
		t.Fatalf("statusErr = %#v", statusErr)
	}
}

func TestEnqueueHandlerValidatesRequest(t *testing.T) {
	c := NewCompleter()
	handler := EnqueueHandler(c)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/e2e/mock-llm/responses", strings.NewReader(`not json`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid json status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/e2e/mock-llm/responses", strings.NewReader(`{"body":{"n":1}}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing uid status = %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/e2e/mock-llm/responses", strings.NewReader(`{"uid":"uid-1"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty payload status = %d", rec.Code)
	}
}

func TestEnqueueHandlerAcceptsAndCompleteConsumesIt(t *testing.T) {
	c := NewCompleter()
	handler := EnqueueHandler(c)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/e2e/mock-llm/responses", strings.NewReader(`{"uid":"uid-1","body":{"summary":"ok"}}`)))
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}

	ctx := auth.WithUID(context.Background(), "uid-1")
	got, err := c.Complete(ctx, "", nil, nil)
	if err != nil {
		t.Fatalf("Complete: %v", err)
	}
	if string(got) != `{"summary":"ok"}` {
		t.Fatalf("got = %s", got)
	}
}

func TestCapturesHandlerReturnsOnlyTheRequestedUsersCaptures(t *testing.T) {
	c := NewCompleter()
	c.Enqueue("uid-1", QueuedResponse{Body: json.RawMessage(`{"ok":true}`)})
	_, _ = c.Complete(auth.WithUID(context.Background(), "uid-1"), "private-system", nil, json.RawMessage(`{"type":"object"}`))

	rec := httptest.NewRecorder()
	CapturesHandler(c).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/e2e/mock-llm/requests?uid=uid-1", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "private-system") {
		t.Fatalf("capture body = %s", rec.Body.String())
	}

	rec = httptest.NewRecorder()
	CapturesHandler(c).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/e2e/mock-llm/requests", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing uid status = %d", rec.Code)
	}
}
