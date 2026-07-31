//go:build e2e_mock

package main

import (
	"log"
	"net/http"

	"github.com/mnohe/cvai/functions/internal/llm"
	"github.com/mnohe/cvai/functions/internal/llm/mock"
)

// newLLMClient returns the deterministic in-memory completer instead of a
// real provider client. This file only compiles into binaries built with
// -tags e2e_mock, which must never be deployed as the production service.
func newLLMClient() (llm.Completer, error) {
	log.Printf("llm_client_init provider=mock")
	return mock.NewCompleter(), nil
}

// registerTestControlRoutes exposes the endpoint an E2E harness uses to
// script a user's next completer response before driving a real user flow
// against this backend.
func registerTestControlRoutes(mux *http.ServeMux, completer llm.Completer) {
	mockCompleter, ok := completer.(*mock.Completer)
	if !ok {
		return
	}
	mux.Handle("POST /e2e/mock-llm/responses", mock.EnqueueHandler(mockCompleter))
}
