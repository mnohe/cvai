package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/handlers"
	"github.com/mnohe/cvai/functions/internal/llm"
	"github.com/mnohe/cvai/functions/internal/observability"
	"github.com/mnohe/cvai/functions/internal/repo"
	fsrepo "github.com/mnohe/cvai/functions/internal/repo/firestore"
)

func main() {
	ctx := context.Background()

	shutdownTelemetry, err := observability.Init(ctx)
	if err != nil {
		log.Fatalf("observability: %v", err)
	}

	authMW, err := auth.New(ctx)
	if err != nil {
		log.Fatalf("auth middleware: %v", err)
	}

	fsClient, err := fsrepo.NewClient(ctx)
	if err != nil {
		log.Fatalf("firestore client: %v", err)
	}
	defer fsClient.Close()

	var accounts repo.AccountRepository = fsrepo.NewAccountRepo(fsClient)
	var actions repo.ActionRepository = fsrepo.NewActionRepo(fsClient)
	var candidates repo.CandidateRepository = fsrepo.NewCandidateRepo(fsClient)
	accountHandler := handlers.NewAccountHandler(accounts)
	llmClient, err := newLLMClient()
	if err != nil {
		log.Fatalf("llm client: %v", err)
	}
	importHandler := handlers.NewImportCVHandler(accounts, actions, candidates, llmClient)

	// Two mux instances enforce auth coverage at the structural level.
	// Any route not registered on either mux returns 404 — not a silent auth bypass.
	authMux := http.NewServeMux()
	publicMux := http.NewServeMux()

	// Public routes — no auth required.
	publicMux.Handle("GET /healthz", auth.PublicHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Deep Firestore probe added in Stage 9.
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})))
	publicMux.Handle("POST /webhooks/stripe", auth.PublicHandler(stub501("StripeWebhook")))

	// Authenticated routes — RequireAuth is applied to the entire authMux below.
	authMux.HandleFunc("GET /account", accountHandler.GetAccount)
	authMux.HandleFunc("POST /cv/imports", importHandler.ImportCV)
	authMux.Handle("POST /analyses/quick", stub501("QuickAnalysis"))
	authMux.Handle("POST /roles", stub501("IngestRole"))
	authMux.Handle("POST /roles/{roleId}/bundle", stub501("GenerateBundle"))
	authMux.Handle("POST /roles/{roleId}/bundle/reassess", stub501("ReassessRole"))
	authMux.Handle("POST /roles/{roleId}/events", stub501("RecordRoleEvent"))
	authMux.Handle("POST /roles/{roleId}/gap-tasks", stub501("CreateGapTasks"))
	authMux.Handle("POST /tasks/{taskId}/reassess", stub501("ReassessGapTask"))
	authMux.Handle("POST /billing/checkout", stub501("CreateCheckoutSession"))
	authMux.Handle("POST /account/export", stub501("ExportUserData"))
	// DELETE /account also requires RequireRecentAuth(300) — chained inside the auth mux.
	authMux.Handle("DELETE /account", authMW.RequireRecentAuth(300)(stub501("DeleteAccount")))

	// Root handler: check public mux first, then apply RequireAuth to the auth mux.
	root := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, pattern := publicMux.Handler(r)
		if pattern != "" {
			publicMux.ServeHTTP(w, r)
			return
		}
		authMW.RequireAuth(authMux).ServeHTTP(w, r)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: root,
	}

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		log.Printf("listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-quit
	log.Println("shutting down (30 s drain)")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
	if err := shutdownTelemetry(shutdownCtx); err != nil {
		log.Printf("telemetry shutdown error: %v", err)
	}
}

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

func envOrDefault(key string, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envOrDefaultValue(value string, fallback string) string {
	if value != "" {
		return value
	}
	return fallback
}

func envDurationSeconds(key string, fallback time.Duration) time.Duration {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		log.Printf("invalid_duration_env key=%s value=%q", key, raw)
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

// stub501 returns a handler responding 501 Not Implemented.
func stub501(name string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": name + " not implemented"})
	})
}
