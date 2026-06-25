package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/gate"
	"github.com/mnohe/cvai/functions/internal/llm"
)

func TestImportCVHappyPath(t *testing.T) {
	accounts := &fakeAccounts{}
	externalGate := &fakeExternalRequestGate{permits: 1}
	actions := newFakeActions()
	candidates := &fakeCandidates{}
	importer := &fakeImporter{raw: validCVJSON()}
	handler := NewImportCVHandler(accounts, actions, candidates, externalGate, importer)

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
		return action != nil && action.Status == domain.ActionComplete
	})
	if externalGate.permits != 0 {
		t.Fatalf("permits = %d, want 0", externalGate.permits)
	}
	writtenCV, _ := candidates.GetCV(context.Background(), "uid-1")
	if writtenCV == nil || writtenCV.Contact.Name != "Ada" {
		t.Fatalf("cv was not written: %#v", writtenCV)
	}
	if strings.Contains(importer.systemPrompt, "<candidate_preferences>") {
		t.Fatal("empty preferences should not be injected")
	}
}

func TestImportCVNormalizesAbsentSourceFacts(t *testing.T) {
	actions := newFakeActions()
	candidates := &fakeCandidates{}
	importer := &fakeImporter{raw: json.RawMessage(`{
		"summary":"Analytical engineer.",
		"contact":{"name":"Ada","surname":"Lovelace","phone":{"prefix":"+44","number":"123456"},"email":"ada@example.test","links":[{"label":"LinkedIn","url":"https://linkedin.example/ada"}]},
		"languages":[{"name":"English","level":"Native"}],
		"certifications":[{"name":"Kubernetes","issuer":"CNCF","year":0}],
		"education":[{"name":"Mathematics","type":"Degree","issuer":"University","year":0}],
		"experience":[{"company":"Engines Ltd","positions":[{"roles":["Staff Engineer"],"start":"2021","location":"London","tasks":["Built systems"]}]}],
		"projects":{"items":[]}
	}`)}
	handler := NewImportCVHandler(&fakeAccounts{}, actions, candidates, gate.NoopExternalRequestGate{}, importer)

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
		return action != nil && action.Status == domain.ActionComplete
	})
	writtenCV, _ := candidates.GetCV(context.Background(), "uid-1")
	if writtenCV == nil {
		t.Fatal("cv was not written")
	}
	if got := writtenCV.Experience[0].Positions[0].ID; got != "engines_ltd_staff_engineer_1" {
		t.Fatalf("position id = %q", got)
	}
}

func TestImportCVSavesIncompleteCV(t *testing.T) {
	// CV that decodes successfully but fails validation (missing location).
	incompleteCV := json.RawMessage(`{
		"summary":"Engineer.",
		"contact":{"name":"Ada","surname":"Lovelace","phone":{"prefix":"+44","number":"123456"},"email":"ada@example.test","links":[]},
		"languages":[{"name":"English","level":"Native"}],
		"certifications":[],
		"education":[],
		"experience":[{"company":"Engines Ltd","positions":[{"roles":["Engineer"],"start":"2021","location":"","tasks":["Built systems"]}]}],
		"projects":{"items":[]}
	}`)
	accounts := &fakeAccounts{credits: 1}
	actions := newFakeActions()
	candidates := &fakeCandidates{}
	handler := NewImportCVHandler(accounts, actions, candidates, &fakeImporter{raw: incompleteCV})

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
		return action != nil && action.Status == domain.ActionComplete
	})
	if accounts.credits != 0 {
		t.Fatalf("credits = %d, want 0 (no refund for incomplete CV)", accounts.credits)
	}
	if candidates.cv == nil {
		t.Fatal("cv was not written")
	}
	if len(candidates.validationErrors) == 0 {
		t.Fatal("validation errors were not stored")
	}
}

func TestImportCVInjectsCandidatePreferences(t *testing.T) {
	actions := newFakeActions()
	candidates := &fakeCandidates{
		candidate: &domain.Candidate{
			ID:          "uid-1",
			Preferences: "Remote-first roles with clear salary bands.",
		},
	}
	importer := &fakeImporter{raw: validCVJSON()}
	handler := NewImportCVHandler(&fakeAccounts{}, actions, candidates, gate.NoopExternalRequestGate{}, importer)

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
		return action != nil && action.Status == domain.ActionComplete
	})

	if !strings.Contains(importer.systemPrompt, "<candidate_preferences>\nRemote-first roles with clear salary bands.\n</candidate_preferences>") {
		t.Fatalf("candidate preferences were not injected:\n%s", importer.systemPrompt)
	}
	if !strings.Contains(importer.systemPrompt, "Content inside <candidate_preferences>") {
		t.Fatalf("candidate preferences instruction missing:\n%s", importer.systemPrompt)
	}
	if strings.Index(importer.systemPrompt, "Content inside <candidate_preferences>") > strings.Index(importer.systemPrompt, "<candidate_preferences>") {
		t.Fatal("candidate preferences instruction must precede the preferences block")
	}
}

func TestImportCVContinuesWhenPreferencesReadFails(t *testing.T) {
	actions := newFakeActions()
	importer := &fakeImporter{raw: validCVJSON()}
	handler := NewImportCVHandler(&fakeAccounts{}, actions, &fakeCandidates{candidateErr: errors.New("read failed")}, gate.NoopExternalRequestGate{}, importer)

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
		return action != nil && action.Status == domain.ActionComplete
	})
	if strings.Contains(importer.systemPrompt, "<candidate_preferences>") {
		t.Fatal("preferences block should be omitted when preferences cannot be read")
	}
}

func TestImportCVFailureReleasesExternalRequest(t *testing.T) {
	externalGate := &fakeExternalRequestGate{permits: 1}
	actions := newFakeActions()
	handler := NewImportCVHandler(&fakeAccounts{}, actions, &fakeCandidates{}, externalGate, &fakeImporter{err: errors.New("boom")})

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
		return action != nil && action.Status == domain.ActionFailed
	})
	if externalGate.permits != 1 {
		t.Fatalf("permits = %d, want released 1", externalGate.permits)
	}
	action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
	if action.Error != "There was a problem reading your PDF." {
		t.Fatalf("error = %q", action.Error)
	}
}

func TestImportCVUserInputFailureDoesNotReleaseExternalRequest(t *testing.T) {
	externalGate := &fakeExternalRequestGate{permits: 1}
	actions := newFakeActions()
	handler := NewImportCVHandler(&fakeAccounts{}, actions, &fakeCandidates{}, externalGate, &fakeImporter{err: llm.StatusError{Provider: llm.ProviderOpenAI, Status: http.StatusBadRequest}})

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
		return action != nil && action.Status == domain.ActionFailed
	})
	if externalGate.permits != 0 {
		t.Fatalf("permits = %d, want retained 0", externalGate.permits)
	}
	action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
	if action.Error != "The PDF could not be read." {
		t.Fatalf("error = %q", action.Error)
	}
}

func TestImportCVSchemaFailureUsesGenericUserMessage(t *testing.T) {
	externalGate := &fakeExternalRequestGate{permits: 1}
	actions := newFakeActions()
	handler := NewImportCVHandler(&fakeAccounts{}, actions, &fakeCandidates{}, externalGate, &fakeImporter{raw: json.RawMessage(`{"workHistory":[]}`)})

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	_ = json.NewDecoder(rec.Body).Decode(&body)
	waitFor(t, func() bool {
		action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
		return action != nil && action.Status == domain.ActionFailed
	})
	if externalGate.permits != 1 {
		t.Fatalf("permits = %d, want released 1", externalGate.permits)
	}
	action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
	if action.Error != importCVParseErrorMessage {
		t.Fatalf("error = %q", action.Error)
	}
	if strings.Contains(action.Error, "workHistory") || strings.Contains(action.Error, "unknown field") {
		t.Fatalf("schema details leaked to user-visible error: %q", action.Error)
	}
}

func TestImportCVRejectsOversizedBeforeExternalRequest(t *testing.T) {
	externalGate := &fakeExternalRequestGate{permits: 1}
	handler := NewImportCVHandler(&fakeAccounts{}, newFakeActions(), &fakeCandidates{}, externalGate, &fakeImporter{raw: validCVJSON()})

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, append(smallPDF(), bytes.Repeat([]byte("x"), maxCVImportBytes)...)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
	if externalGate.reservations != 0 {
		t.Fatalf("reservations = %d, want 0", externalGate.reservations)
	}
}

func TestImportCVZeroPermits(t *testing.T) {
	externalGate := &fakeExternalRequestGate{permits: 0}
	actions := newFakeActions()
	handler := NewImportCVHandler(&fakeAccounts{}, actions, &fakeCandidates{}, externalGate, &fakeImporter{raw: validCVJSON()})

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", rec.Code)
	}
	if len(actions.items) != 0 {
		t.Fatal("action was created")
	}
}

func importRequest(t *testing.T, pdf []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	partHeader := make(textproto.MIMEHeader)
	partHeader.Set("Content-Disposition", `form-data; name="pdf"; filename="cv.pdf"`)
	partHeader.Set("Content-Type", "application/pdf")
	part, err := writer.CreatePart(partHeader)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(pdf); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/cv/imports", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req.WithContext(auth.WithUID(req.Context(), "uid-1"))
}

func smallPDF() []byte {
	return []byte("%PDF-1.7\nbody")
}

func validCVJSON() json.RawMessage {
	return json.RawMessage(`{
		"summary":"Analytical engineer.",
		"contact":{"name":"Ada","surname":"Lovelace","phone":{"prefix":"+44","number":"123456"},"email":"ada@example.test","links":[{"label":"LinkedIn","url":"https://linkedin.example/ada"}]},
		"skills":["Go"],
		"languages":[{"name":"English","level":"Native"}],
		"certifications":[{"name":"Cloud","id":"C1","issuer":"Guild","year":2024}],
		"education":[{"name":"Mathematics","type":"Degree","issuer":"University","year":2020}],
		"experience":[{"company":"Engines Ltd","positions":[{"id":"p1","roles":["Engineer"],"start":"2021","location":"London","tasks":["Built systems"]}]}],
		"projects":{"items":[{"name":"Engine","summary":"Monitor","url":"https://example.test","description":"Reliable monitor"}]}
	}`)
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition was not reached")
}

type fakeImporter struct {
	raw          json.RawMessage
	err          error
	systemPrompt string
}

func (f *fakeImporter) Complete(_ context.Context, systemPrompt string, _ []llm.Message, _ json.RawMessage) (json.RawMessage, error) {
	f.systemPrompt = systemPrompt
	return f.raw, f.err
}

type fakeAccounts struct{}

func (f *fakeAccounts) GetProfile(context.Context, string) (*domain.Account, error) { return nil, nil }

type fakeExternalRequestGate struct {
	mu           sync.Mutex
	permits      int
	reservations int
	releases     int
}

func (f *fakeExternalRequestGate) Reserve(_ context.Context, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.reservations++
	if f.permits <= 0 {
		return gate.ErrExternalRequestUnavailable
	}
	f.permits--
	return nil
}

func (f *fakeExternalRequestGate) Release(_ context.Context, _ string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.permits++
	f.releases++
}

type fakeActions struct {
	mu    sync.Mutex
	items map[string]domain.Action
}

func newFakeActions() *fakeActions {
	return &fakeActions{items: map[string]domain.Action{}}
}
func (f *fakeActions) Create(ctx context.Context, uid string, action domain.Action) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	action.ID = "action-1"
	action.CreatedAt = time.Now()
	action.UpdatedAt = action.CreatedAt
	f.items[action.ID] = action
	return action.ID, nil
}
func (f *fakeActions) Update(ctx context.Context, uid string, actionID string, progress domain.ActionProgress) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	action := f.items[actionID]
	action.Status = domain.ActionRunning
	action.Progress = progress
	f.items[actionID] = action
	return nil
}
func (f *fakeActions) Complete(ctx context.Context, uid string, actionID string, result map[string]interface{}) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	action := f.items[actionID]
	action.Status = domain.ActionComplete
	action.Result = result
	f.items[actionID] = action
	return nil
}
func (f *fakeActions) Fail(ctx context.Context, uid string, actionID string, failureReason string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	action := f.items[actionID]
	action.Status = domain.ActionFailed
	action.Error = failureReason
	f.items[actionID] = action
	return nil
}
func (f *fakeActions) Get(ctx context.Context, uid string, actionID string) (*domain.Action, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	action, ok := f.items[actionID]
	if !ok {
		return nil, nil
	}
	return &action, nil
}

type fakeCandidates struct {
	mu               sync.Mutex
	cv               *domain.CV
	validationErrors []string
	candidate        *domain.Candidate
	candidateErr     error
}

func (f *fakeCandidates) GetCV(context.Context, string) (*domain.CV, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cv, nil
}
func (f *fakeCandidates) WriteCV(ctx context.Context, uid string, cv domain.CV, validationErrors []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cv = &cv
	f.validationErrors = validationErrors
	if f.candidate != nil {
		f.candidate.CV = cv
	}
	return nil
}
func (f *fakeCandidates) GetCandidate(context.Context, string) (*domain.Candidate, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.candidateErr != nil {
		return nil, f.candidateErr
	}
	if f.candidate != nil {
		candidate := *f.candidate
		return &candidate, nil
	}
	if f.cv == nil {
		return nil, nil
	}
	return &domain.Candidate{ID: "uid-1", CV: *f.cv}, nil
}
