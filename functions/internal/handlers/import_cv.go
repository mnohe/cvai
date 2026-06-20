package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/llm"
	"github.com/mnohe/cvai/functions/internal/llm/prompts"
	"github.com/mnohe/cvai/functions/internal/repo"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

const (
	maxCVImportBytes          = 10 << 20
	importCVParseErrorMessage = "The extracted CV could not be parsed."
	defaultImportCVTimeout    = 180 * time.Second
)

var (
	cvImportMeter  = otel.Meter("github.com/mnohe/cvai/functions/cv_import")
	cvImportTracer = otel.Tracer("github.com/mnohe/cvai/functions/cv_import")

	cvImportPDFBytes, _ = cvImportMeter.Int64Histogram(
		"cv_import_pdf_bytes",
		metric.WithDescription("Size of uploaded CV import PDFs."),
		metric.WithUnit("By"),
	)
	cvImportLLMDuration, _ = cvImportMeter.Int64Histogram(
		"cv_import_llm_duration_ms",
		metric.WithDescription("Duration of the CV import LLM call."),
		metric.WithUnit("ms"),
	)
	cvImportTotalDuration, _ = cvImportMeter.Int64Histogram(
		"cv_import_total_duration_ms",
		metric.WithDescription("Total duration of asynchronous CV import processing."),
		metric.WithUnit("ms"),
	)
	cvImportAttempts, _ = cvImportMeter.Int64Counter(
		"cv_import_attempts_total",
		metric.WithDescription("Count of CV import attempts by terminal status and failure class."),
	)
)

type cvImporter interface {
	Complete(ctx context.Context, systemPrompt string, messages []llm.Message, schema json.RawMessage) (json.RawMessage, error)
}

// ImportCVHandler handles PDF CV imports.
type ImportCVHandler struct {
	accounts   repo.AccountRepository
	actions    repo.ActionRepository
	candidates repo.CandidateRepository
	llm        cvImporter
	schemaPath string
}

// NewImportCVHandler creates an ImportCVHandler.
func NewImportCVHandler(accounts repo.AccountRepository, actions repo.ActionRepository, candidates repo.CandidateRepository, importer cvImporter) *ImportCVHandler {
	return &ImportCVHandler{
		accounts:   accounts,
		actions:    actions,
		candidates: candidates,
		llm:        importer,
		schemaPath: filepath.Join("..", "schemas", "cv.schema.json"),
	}
}

// ImportCV handles POST /cv/imports.
func (h *ImportCVHandler) ImportCV(w http.ResponseWriter, r *http.Request) {
	uid := auth.UIDFromContext(r.Context())
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		writeJSONError(w, http.StatusBadRequest, "upload must be multipart/form-data")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxCVImportBytes+1024*1024)
	if err := r.ParseMultipartForm(maxCVImportBytes); err != nil {
		writeJSONError(w, http.StatusBadRequest, "pdf upload is too large or invalid")
		return
	}
	file, header, err := r.FormFile("pdf")
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "missing pdf field")
		return
	}
	defer file.Close()
	if header.Size > maxCVImportBytes {
		writeJSONError(w, http.StatusBadRequest, "pdf must be 10 MB or smaller")
		return
	}
	pdfBytes, err := io.ReadAll(io.LimitReader(file, maxCVImportBytes+1))
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "failed to read pdf")
		return
	}
	if len(pdfBytes) > maxCVImportBytes {
		writeJSONError(w, http.StatusBadRequest, "pdf must be 10 MB or smaller")
		return
	}
	if !looksLikePDF(header.Header.Get("Content-Type"), pdfBytes) {
		writeJSONError(w, http.StatusBadRequest, "upload must be an application/pdf file")
		return
	}

	if err := h.accounts.DeductCredit(r.Context(), uid); err != nil {
		if errors.Is(err, repo.ErrInsufficientCredits) {
			writeJSONError(w, http.StatusPaymentRequired, "not enough credits")
			return
		}
		writeJSONError(w, http.StatusInternalServerError, "failed to deduct credit")
		return
	}

	actionID, err := h.actions.Create(r.Context(), uid, domain.Action{
		Type:   domain.ActionTypeImportCV,
		Status: domain.ActionPending,
		Progress: domain.ActionProgress{
			Step:    "queued",
			Message: "Import queued",
		},
	})
	if err != nil {
		if refundErr := h.accounts.RefundCredit(context.Background(), uid); refundErr != nil {
			log.Printf("credit_refund_failed uid_set=true reason=action_create")
		}
		writeJSONError(w, http.StatusInternalServerError, "failed to create import action")
		return
	}

	go h.runImport(uid, actionID, pdfBytes)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{"actionId": actionID})
}

func (h *ImportCVHandler) runImport(uid string, actionID string, pdfBytes []byte) {
	timeout := importCVTimeout()
	start := time.Now()
	log.Printf("cv_import_started uid_set=true action_id=%s timeout_seconds=%d pdf_bytes=%d", actionID, int(timeout.Seconds()), len(pdfBytes))
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	ctx, span := cvImportTracer.Start(ctx, "cv.import",
		trace.WithAttributes(
			attribute.String("action.id", actionID),
			attribute.Int("cv_import.pdf_bytes", len(pdfBytes)),
			attribute.Int("cv_import.timeout_seconds", int(timeout.Seconds())),
		),
	)
	defer span.End()

	cvImportPDFBytes.Record(ctx, int64(len(pdfBytes)))
	cvImportAttempts.Add(ctx, 1, metric.WithAttributes(attribute.String("status", "started"), attribute.String("failure_class", "none")))
	if err := h.actions.Update(ctx, uid, actionID, domain.ActionProgress{Step: "analysing", Message: "Analysing PDF", Percent: intPtr(35)}); err != nil {
		log.Printf("action_update_failed uid_set=true action_id=%s", actionID)
	}

	schema, err := h.loadSchema()
	if err != nil {
		log.Printf("schema_load_failed action_id=%s: %v", actionID, err)
		h.failImport(uid, actionID, "CV schema is unavailable")
		h.recordImportFailure(ctx, span, start, "schema")
		return
	}
	systemPrompt := prompts.ImportCVSystemPrompt("")
	candidate, err := h.candidates.GetCandidate(ctx, uid)
	if err != nil {
		log.Printf("candidate_preferences_read_failed uid_set=true action_id=%s: %v", actionID, err)
	} else if candidate != nil {
		systemPrompt = prompts.ImportCVSystemPrompt(candidate.Preferences)
	}

	llmStart := time.Now()
	rawCV, err := h.llm.Complete(ctx, systemPrompt, []llm.Message{{
		Role: "user",
		Content: []llm.ContentBlock{
			{Type: "document", Source: &llm.BlockSource{Type: "base64", MediaType: "application/pdf", Data: base64.StdEncoding.EncodeToString(pdfBytes)}},
			{Type: "text", Text: prompts.ImportCVUser},
		},
	}}, schema)
	llmDuration := time.Since(llmStart)
	cvImportLLMDuration.Record(ctx, llmDuration.Milliseconds())
	span.SetAttributes(attribute.Int64("cv_import.llm_duration_ms", llmDuration.Milliseconds()))
	if err != nil {
		if llm.IsUserInputError(err) {
			log.Printf("cv_import_user_input_failed uid_set=true action_id=%s reason=%v", actionID, err)
			h.failImportWithoutRefund(uid, actionID, "The PDF could not be read.")
			h.recordImportFailure(ctx, span, start, "user_input")
			return
		}
		log.Printf("cv_import_llm_failed uid_set=true action_id=%s: %v", actionID, err)
		h.failImport(uid, actionID, "There was a problem reading your PDF.")
		h.recordImportFailure(ctx, span, start, classifyImportFailure(err))
		return
	}
	rawCV, err = llm.NormalizeStructuredOutput(rawCV)
	if err != nil {
		log.Printf("cv_normalize_failed uid_set=true action_id=%s: %v", actionID, err)
		h.failImport(uid, actionID, importCVParseErrorMessage)
		h.recordImportFailure(ctx, span, start, "parse")
		return
	}

	var cv domain.CV
	if err := decodeStrict(rawCV, &cv); err != nil {
		log.Printf("cv_decode_failed uid_set=true action_id=%s: %v", actionID, err)
		h.failImport(uid, actionID, importCVParseErrorMessage)
		h.recordImportFailure(ctx, span, start, "parse")
		return
	}
	normalizeImportedCV(&cv)
	if err := cv.Validate(); err != nil {
		log.Printf("cv_validate_failed uid_set=true action_id=%s: %v", actionID, err)
		h.failImport(uid, actionID, importCVParseErrorMessage)
		h.recordImportFailure(ctx, span, start, "parse")
		return
	}
	if err := h.actions.Update(ctx, uid, actionID, domain.ActionProgress{Step: "saving", Message: "Saving CV", Percent: intPtr(85)}); err != nil {
		log.Printf("action_update_failed uid_set=true action_id=%s", actionID)
	}
	if err := h.candidates.WriteCV(ctx, uid, cv); err != nil {
		h.failImport(uid, actionID, "There was a problem saving the extracted CV.")
		h.recordImportFailure(ctx, span, start, "save")
		return
	}
	if err := h.actions.Complete(ctx, uid, actionID, map[string]interface{}{"resource": "candidate.cv"}); err != nil {
		log.Printf("action_complete_failed uid_set=true action_id=%s", actionID)
	}
	h.recordImportSuccess(ctx, span, start)
}

func (h *ImportCVHandler) recordImportSuccess(ctx context.Context, span trace.Span, start time.Time) {
	duration := time.Since(start)
	cvImportTotalDuration.Record(ctx, duration.Milliseconds(), metric.WithAttributes(attribute.String("status", "completed"), attribute.String("failure_class", "none")))
	cvImportAttempts.Add(ctx, 1, metric.WithAttributes(attribute.String("status", "completed"), attribute.String("failure_class", "none")))
	span.SetAttributes(
		attribute.String("cv_import.status", "completed"),
		attribute.String("cv_import.failure_class", "none"),
		attribute.Int64("cv_import.total_duration_ms", duration.Milliseconds()),
	)
}

func (h *ImportCVHandler) recordImportFailure(ctx context.Context, span trace.Span, start time.Time, failureClass string) {
	duration := time.Since(start)
	cvImportTotalDuration.Record(ctx, duration.Milliseconds(), metric.WithAttributes(attribute.String("status", "failed"), attribute.String("failure_class", failureClass)))
	cvImportAttempts.Add(ctx, 1, metric.WithAttributes(attribute.String("status", "failed"), attribute.String("failure_class", failureClass)))
	span.SetAttributes(
		attribute.String("cv_import.status", "failed"),
		attribute.String("cv_import.failure_class", failureClass),
		attribute.Int64("cv_import.total_duration_ms", duration.Milliseconds()),
	)
}

func classifyImportFailure(err error) string {
	if err == nil {
		return "unknown"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "timeout"
	}
	var statusErr llm.StatusError
	if errors.As(err, &statusErr) {
		if statusErr.Status == http.StatusTooManyRequests {
			return "rate_limit"
		}
		if statusErr.Status == http.StatusUnauthorized || statusErr.Status == http.StatusForbidden {
			return "provider_auth"
		}
		if statusErr.Status >= 500 {
			return "provider_5xx"
		}
		if statusErr.Status >= 400 {
			return "provider_4xx"
		}
	}
	return "provider_or_system"
}

func normalizeImportedCV(cv *domain.CV) {
	for experienceIndex := range cv.Experience {
		experience := &cv.Experience[experienceIndex]
		companySlug := slugID(experience.Company)
		if companySlug == "" {
			companySlug = "experience"
		}
		for positionIndex := range experience.Positions {
			position := &experience.Positions[positionIndex]
			if strings.TrimSpace(position.ID) != "" {
				position.ID = slugID(position.ID)
				continue
			}
			roleSlug := "position"
			if len(position.Roles) > 0 {
				if slug := slugID(position.Roles[0]); slug != "" {
					roleSlug = slug
				}
			}
			position.ID = companySlug + "_" + roleSlug + "_" + strconv.Itoa(positionIndex+1)
		}
	}
}

func slugID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	lastUnderscore := false
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			out.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if !lastUnderscore && out.Len() > 0 {
			out.WriteByte('_')
			lastUnderscore = true
		}
	}
	return strings.Trim(out.String(), "_")
}

func importCVTimeout() time.Duration {
	if raw := os.Getenv("CV_IMPORT_TIMEOUT_SECONDS"); raw != "" {
		seconds, err := strconv.Atoi(raw)
		if err == nil && seconds > 0 {
			return time.Duration(seconds) * time.Second
		}
		log.Printf("invalid_cv_import_timeout_seconds value=%q", raw)
	}
	return defaultImportCVTimeout
}

func (h *ImportCVHandler) failImport(uid string, actionID string, reason string) {
	if refundErr := h.accounts.RefundCredit(context.Background(), uid); refundErr != nil {
		log.Printf("credit_refund_failed uid_set=true action_id=%s", actionID)
	}
	h.failImportWithoutRefund(uid, actionID, reason)
}

func (h *ImportCVHandler) failImportWithoutRefund(uid string, actionID string, reason string) {
	if err := h.actions.Fail(context.Background(), uid, actionID, reason); err != nil {
		log.Printf("action_fail_failed uid_set=true action_id=%s", actionID)
	}
}

func (h *ImportCVHandler) loadSchema() (json.RawMessage, error) {
	path := h.schemaPath
	if override := os.Getenv("CV_SCHEMA_PATH"); override != "" {
		path = override
	}
	schema, err := os.ReadFile(path)
	if err != nil {
		schema = []byte(prompts.CVSchemaFallback)
	}
	if !json.Valid(schema) {
		return nil, errors.New("schema is invalid json")
	}
	return schema, nil
}

func decodeStrict(raw json.RawMessage, out any) error {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}

func looksLikePDF(contentType string, body []byte) bool {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	return contentType == "application/pdf" && len(body) >= 4 && string(body[:4]) == "%PDF"
}

func intPtr(value int) *int {
	return &value
}
