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
	"sync"
	"testing"
	"time"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/domain"
	"github.com/mnohe/cvai/functions/internal/llm"
	"github.com/mnohe/cvai/functions/internal/repo"
)

func TestImportCVHappyPath(t *testing.T) {
	accounts := &fakeAccounts{credits: 1}
	actions := newFakeActions()
	candidates := &fakeCandidates{}
	handler := NewImportCVHandler(accounts, actions, candidates, &fakeImporter{raw: validCVJSON()})

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
	if accounts.credits != 0 {
		t.Fatalf("credits = %d, want 0", accounts.credits)
	}
	writtenCV, _ := candidates.GetCV(context.Background(), "uid-1")
	if writtenCV == nil || writtenCV.Contact.Name != "Ada" {
		t.Fatalf("cv was not written: %#v", writtenCV)
	}
}

func TestImportCVFailureRefundsCredit(t *testing.T) {
	accounts := &fakeAccounts{credits: 1}
	actions := newFakeActions()
	handler := NewImportCVHandler(accounts, actions, &fakeCandidates{}, &fakeImporter{err: errors.New("boom")})

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
	if accounts.credits != 1 {
		t.Fatalf("credits = %d, want refunded 1", accounts.credits)
	}
}

func TestImportCVUserInputFailureDoesNotRefundCredit(t *testing.T) {
	accounts := &fakeAccounts{credits: 1}
	actions := newFakeActions()
	handler := NewImportCVHandler(accounts, actions, &fakeCandidates{}, &fakeImporter{err: llm.StatusError{Provider: llm.ProviderOpenAI, Status: http.StatusBadRequest}})

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
	if accounts.credits != 0 {
		t.Fatalf("credits = %d, want spent 0", accounts.credits)
	}
	action, _ := actions.Get(context.Background(), "uid-1", body["actionId"])
	if action.Error != "The PDF could not be read." {
		t.Fatalf("error = %q", action.Error)
	}
}

func TestImportCVRejectsOversizedBeforeCredit(t *testing.T) {
	accounts := &fakeAccounts{credits: 1}
	handler := NewImportCVHandler(accounts, newFakeActions(), &fakeCandidates{}, &fakeImporter{raw: validCVJSON()})

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, append(smallPDF(), bytes.Repeat([]byte("x"), maxCVImportBytes)...)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rec.Code)
	}
	if accounts.deducts != 0 {
		t.Fatalf("deducts = %d, want 0", accounts.deducts)
	}
}

func TestImportCVZeroCredits(t *testing.T) {
	accounts := &fakeAccounts{credits: 0}
	actions := newFakeActions()
	handler := NewImportCVHandler(accounts, actions, &fakeCandidates{}, &fakeImporter{raw: validCVJSON()})

	rec := httptest.NewRecorder()
	handler.ImportCV(rec, importRequest(t, smallPDF()))
	if rec.Code != http.StatusPaymentRequired {
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
		"contact":{"name":"Ada","surname":"Lovelace","phone":{"prefix":"+44","number":"123456"},"email":"ada@example.test","linkedin":"https://linkedin.example/ada"},
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
	raw json.RawMessage
	err error
}

func (f *fakeImporter) Complete(context.Context, string, []llm.Message, json.RawMessage) (json.RawMessage, error) {
	return f.raw, f.err
}

type fakeAccounts struct {
	mu      sync.Mutex
	credits int
	deducts int
}

func (f *fakeAccounts) GetProfile(context.Context, string) (*domain.Account, error) { return nil, nil }
func (f *fakeAccounts) DeductCredit(context.Context, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deducts++
	if f.credits <= 0 {
		return repo.ErrInsufficientCredits
	}
	f.credits--
	return nil
}
func (f *fakeAccounts) RefundCredit(context.Context, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.credits++
	return nil
}
func (f *fakeAccounts) GrantCredits(context.Context, string, int, string, string) error { return nil }

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
	mu sync.Mutex
	cv *domain.CV
}

func (f *fakeCandidates) GetCV(context.Context, string) (*domain.CV, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.cv, nil
}
func (f *fakeCandidates) WriteCV(ctx context.Context, uid string, cv domain.CV) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cv = &cv
	return nil
}
func (f *fakeCandidates) GetCandidate(context.Context, string) (*domain.Candidate, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.cv == nil {
		return nil, nil
	}
	return &domain.Candidate{ID: "uid-1", CV: *f.cv}, nil
}
