package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/llm"
	"github.com/mnohe/cvai/llm/prompts"
	"github.com/mnohe/cvai/functions/internal/repo"
)

const maxCVImportBytes = 10 << 20

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
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := h.actions.Update(ctx, uid, actionID, domain.ActionProgress{Step: "analysing", Message: "Analysing PDF", Percent: intPtr(35)}); err != nil {
		log.Printf("action_update_failed uid_set=true action_id=%s", actionID)
	}

	schema, err := h.loadSchema()
	if err != nil {
		log.Printf("schema_load_failed action_id=%s: %v", actionID, err)
		h.failImport(uid, actionID, "CV schema is unavailable")
		return
	}
	rawCV, err := h.llm.Complete(ctx, prompts.ImportCVSystem, []llm.Message{{
		Role: "user",
		Content: []llm.ContentBlock{
			{Type: "document", Source: &llm.BlockSource{Type: "base64", MediaType: "application/pdf", Data: base64.StdEncoding.EncodeToString(pdfBytes)}},
			{Type: "text", Text: prompts.ImportCVUser},
		},
	}}, schema)
	if err != nil {
		if llm.IsUserInputError(err) {
			h.failImportWithoutRefund(uid, actionID, "The PDF could not be read.")
			return
		}
		h.failImport(uid, actionID, "There was a problem reading your PDF. Your credit has been refunded.")
		return
	}
	rawCV, err = llm.NormalizeStructuredOutput(rawCV)
	if err != nil {
		h.failImport(uid, actionID, fmt.Sprintf("The extracted CV did not match the expected schema: %v", err))
		return
	}

	var cv domain.CV
	if err := decodeStrict(rawCV, &cv); err != nil {
		h.failImport(uid, actionID, fmt.Sprintf("The extracted CV did not match the expected schema: %v", err))
		return
	}
	if err := cv.Validate(); err != nil {
		h.failImport(uid, actionID, fmt.Sprintf("The extracted CV did not match the expected schema: %v", err))
		return
	}
	if err := h.actions.Update(ctx, uid, actionID, domain.ActionProgress{Step: "saving", Message: "Saving CV", Percent: intPtr(85)}); err != nil {
		log.Printf("action_update_failed uid_set=true action_id=%s", actionID)
	}
	if err := h.candidates.WriteCV(ctx, uid, cv); err != nil {
		h.failImport(uid, actionID, "There was a problem saving the extracted CV. Your credit has been refunded.")
		return
	}
	if err := h.actions.Complete(ctx, uid, actionID, map[string]interface{}{"resource": "candidate.cv"}); err != nil {
		log.Printf("action_complete_failed uid_set=true action_id=%s", actionID)
	}
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
