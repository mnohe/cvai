package llm

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

type captureCompleter struct {
	system   string
	messages []Message
	schema   json.RawMessage
}

func (c *captureCompleter) Complete(_ context.Context, system string, messages []Message, schema json.RawMessage) (json.RawMessage, error) {
	c.system = system
	c.messages = messages
	c.schema = schema
	return json.RawMessage(`{"summary":"ok"}`), nil
}

func TestImportCVOperationSerializesOnlyRegisteredInputs(t *testing.T) {
	capture := &captureCompleter{}
	operation := NewImportCVOperation(capture)
	pdf := []byte("%PDF private-pdf-marker")
	schema := json.RawMessage(`{"type":"object"}`)

	if _, err := operation.Complete(context.Background(), ImportCVRequest{
		PDF:                  pdf,
		CandidatePreferences: "remote-preference-marker",
		Schema:               schema,
	}); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	serialized, err := json.Marshal(struct {
		System   string          `json:"system"`
		Messages []Message       `json:"messages"`
		Schema   json.RawMessage `json:"schema"`
	}{capture.system, capture.messages, capture.schema})
	if err != nil {
		t.Fatalf("marshal captured payload: %v", err)
	}
	text := string(serialized)
	for _, permitted := range []string{"remote-preference-marker", "application/pdf", "JVBERiBwcml2YXRlLXBkZi1tYXJrZXI", `"type":"object"`} {
		if !strings.Contains(text, permitted) {
			t.Fatalf("permitted input %q missing from payload: %s", permitted, text)
		}
	}
	for _, excluded := range []string{"candidate-email-marker", "billing-marker", "event-note-marker", "story-marker"} {
		if strings.Contains(text, excluded) {
			t.Fatalf("excluded input %q reached payload: %s", excluded, text)
		}
	}
}

func TestPlannedOperationProjectionsExcludeAggregateFieldsByConstruction(t *testing.T) {
	requests := []any{
		QuickAnalysisRequest{RoleText: "role", Candidate: QuickAnalysisCandidateProjection{Summary: "summary"}},
		JobExtractionRequest{RoleText: "role"},
		BundleAssessmentRequest{Job: json.RawMessage(`{"title":"role"}`), Candidate: BundleCandidateProjection{Summary: "summary"}},
		BundleArtifactsRequest{Job: json.RawMessage(`{"title":"role"}`), Analysis: json.RawMessage(`{"verdict":"FIT"}`)},
		ReassessRoleRequest{Job: json.RawMessage(`{"title":"role"}`), Analysis: json.RawMessage(`{"verdict":"FIT"}`)},
		GenerateGapTasksRequest{Gaps: []GapProjection{{GapID: "gap-1", Gap: "gap", Requirement: "requirement"}}},
		ReassessGapTaskRequest{Gap: GapProjection{GapID: "gap-1", Gap: "gap", Requirement: "requirement"}, TaskResult: "done"},
	}

	for _, request := range requests {
		serialized, err := json.Marshal(request)
		if err != nil {
			t.Fatalf("marshal %T: %v", request, err)
		}
		text := string(serialized)
		for _, excludedKey := range []string{"email", "phone", "stories", "events", "billing", "account", "raw_cv", "role_history"} {
			if strings.Contains(text, `"`+excludedKey+`"`) {
				t.Fatalf("%T exposed excluded key %q: %s", request, excludedKey, text)
			}
		}
	}
}

func TestImportCVOperationRejectsIncompleteTypedRequests(t *testing.T) {
	operation := NewImportCVOperation(&captureCompleter{})
	if _, err := operation.Complete(context.Background(), ImportCVRequest{Schema: json.RawMessage(`{"type":"object"}`)}); err == nil {
		t.Fatal("missing PDF should fail")
	}
	if _, err := operation.Complete(context.Background(), ImportCVRequest{PDF: []byte("pdf"), Schema: json.RawMessage(`not-json`)}); err == nil {
		t.Fatal("invalid schema should fail")
	}
}
