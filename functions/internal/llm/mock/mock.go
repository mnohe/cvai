//go:build e2e_mock

// Package mock provides a deterministic, in-memory llm.Completer for
// end-to-end tests. It is compiled only into test-only binaries built with
// the e2e_mock tag and must never be linked into a production build.
package mock

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/llm"
)

// ErrNoQueuedResponse is returned when a user has no queued response left,
// mirroring the shape of a real provider failure so handler error paths are
// exercised the same way they would be against a live provider.
var ErrNoQueuedResponse = errors.New("mock llm: no queued response for user")

// QueuedResponse is one scripted reply for a single Complete call.
type QueuedResponse struct {
	// Body is returned as the structured output payload on success.
	Body json.RawMessage
	// StatusCode, when set to a non-2xx value, makes Complete fail with an
	// llm.StatusError instead of returning Body.
	StatusCode int
	Detail     string
}

// Completer implements llm.Completer with per-user FIFO response queues.
// Callers identify the acting user through auth.UIDFromContext, so the
// caller of Complete must carry the UID on the context (see
// auth.WithUID) the same way the real async import pipeline does.
type Completer struct {
	mu     sync.Mutex
	queues map[string][]QueuedResponse
}

// NewCompleter creates an empty mock completer.
func NewCompleter() *Completer {
	return &Completer{queues: make(map[string][]QueuedResponse)}
}

// Enqueue appends a scripted response to uid's queue.
func (c *Completer) Enqueue(uid string, resp QueuedResponse) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.queues[uid] = append(c.queues[uid], resp)
}

// Complete consumes the next queued response for the context's UID. It
// never contacts a network provider.
func (c *Completer) Complete(ctx context.Context, _ string, _ []llm.Message, _ json.RawMessage) (json.RawMessage, error) {
	uid := auth.UIDFromContext(ctx)

	c.mu.Lock()
	queue := c.queues[uid]
	if len(queue) == 0 {
		c.mu.Unlock()
		return nil, ErrNoQueuedResponse
	}
	next := queue[0]
	c.queues[uid] = queue[1:]
	c.mu.Unlock()

	if next.StatusCode != 0 && (next.StatusCode < 200 || next.StatusCode > 299) {
		return nil, llm.StatusError{Provider: "mock", Status: next.StatusCode, Detail: next.Detail}
	}
	return next.Body, nil
}

type enqueueRequest struct {
	UID        string          `json:"uid"`
	Body       json.RawMessage `json:"body"`
	StatusCode int             `json:"statusCode,omitempty"`
	Detail     string          `json:"detail,omitempty"`
}

// EnqueueHandler is the test-control HTTP endpoint an E2E harness uses to
// script a completer's responses before driving the real backend through a
// user flow. It exists only in binaries built with the e2e_mock tag.
func EnqueueHandler(c *Completer) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req enqueueRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if req.UID == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if req.StatusCode == 0 && len(req.Body) == 0 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		c.Enqueue(req.UID, QueuedResponse{Body: req.Body, StatusCode: req.StatusCode, Detail: req.Detail})
		w.WriteHeader(http.StatusNoContent)
	})
}
