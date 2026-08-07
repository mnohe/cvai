package llm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"

	"github.com/mnohe/cvai/functions/internal/llm/prompts"
)

// ImportCVRequest is the complete, default-deny input boundary for CV import.
// Callers cannot pass a Candidate aggregate; they must select preferences explicitly.
type ImportCVRequest struct {
	PDF                  []byte
	CandidatePreferences string
	Schema               json.RawMessage
}

// ImportCVOperation serializes the registered import_cv provider request.
type ImportCVOperation struct{ completer Completer }

func NewImportCVOperation(completer Completer) ImportCVOperation {
	return ImportCVOperation{completer: completer}
}

func (o ImportCVOperation) Complete(ctx context.Context, request ImportCVRequest) (json.RawMessage, error) {
	if o.completer == nil {
		return nil, errors.New("cv import completer is not configured")
	}
	if len(request.PDF) == 0 {
		return nil, errors.New("cv import PDF is required")
	}
	if len(request.Schema) == 0 || !json.Valid(request.Schema) {
		return nil, errors.New("cv import schema is invalid")
	}
	return o.completer.Complete(ctx, prompts.ImportCVSystemPrompt(request.CandidatePreferences), []Message{{
		Role: "user",
		Content: []ContentBlock{
			{Type: "document", Source: &BlockSource{Type: "base64", MediaType: "application/pdf", Data: base64.StdEncoding.EncodeToString(request.PDF)}},
			{Type: "text", Text: prompts.ImportCVUser},
		},
	}}, request.Schema)
}

// The planned-operation request types mirror docs/LLM_OPERATIONS.md. They contain
// only explicitly admitted projections; adding a field to a domain aggregate does not
// make it serializable into a provider request.
type QuickAnalysisRequest struct {
	RoleText  string                           `json:"role_text"`
	Candidate QuickAnalysisCandidateProjection `json:"candidate"`
}

type QuickAnalysisCandidateProjection struct {
	Summary        string   `json:"summary,omitempty"`
	Skills         []string `json:"skills,omitempty"`
	Experience     []string `json:"experience,omitempty"`
	Qualifications []string `json:"qualifications,omitempty"`
	Preferences    []string `json:"preferences,omitempty"`
}

type JobExtractionRequest struct {
	RoleText string `json:"role_text"`
}

type BundleAssessmentRequest struct {
	Job         json.RawMessage           `json:"job"`
	Candidate   BundleCandidateProjection `json:"candidate"`
	Calibration *CalibrationProjection    `json:"calibration,omitempty"`
}

type BundleCandidateProjection struct {
	Summary        string               `json:"summary,omitempty"`
	Skills         []string             `json:"skills,omitempty"`
	Experience     []string             `json:"experience,omitempty"`
	Qualifications []string             `json:"qualifications,omitempty"`
	Evidence       []EvidenceProjection `json:"evidence,omitempty"`
	Preferences    []string             `json:"preferences,omitempty"`
}

type EvidenceProjection struct {
	ID      string `json:"id"`
	Claim   string `json:"claim"`
	Outcome string `json:"outcome,omitempty"`
}

type CalibrationProjection struct {
	SampleSize int      `json:"sample_size"`
	Rules      []string `json:"rules"`
}

type BundleArtifactsRequest struct {
	Job             json.RawMessage             `json:"job"`
	Analysis        json.RawMessage             `json:"analysis"`
	PublicCandidate ArtifactCandidateProjection `json:"public_candidate,omitempty"`
}

type ArtifactCandidateProjection struct {
	DisplayName string   `json:"display_name,omitempty"`
	PublicLinks []string `json:"public_links,omitempty"`
}

type ReassessRoleRequest struct {
	Job         json.RawMessage           `json:"job"`
	Analysis    json.RawMessage           `json:"analysis"`
	Candidate   BundleCandidateProjection `json:"candidate"`
	Calibration *CalibrationProjection    `json:"calibration,omitempty"`
}

type GenerateGapTasksRequest struct {
	Gaps        []GapProjection `json:"gaps"`
	RoleContext string          `json:"role_context,omitempty"`
}

type GapProjection struct {
	GapID       string `json:"gap_id"`
	Gap         string `json:"gap"`
	Requirement string `json:"requirement"`
}

type ReassessGapTaskRequest struct {
	Gap        GapProjection        `json:"gap"`
	TaskResult string               `json:"task_result"`
	Evidence   []EvidenceProjection `json:"evidence,omitempty"`
}
