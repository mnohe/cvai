package domain

import "time"

type Role struct {
	ID         string       `firestore:"id"`
	Metadata   RoleMetadata `firestore:"metadata"`
	Status     string       `firestore:"status"`
	Bundle     *Bundle      `firestore:"bundle,omitempty"`
	Outcome    *Outcome     `firestore:"outcome,omitempty"`
	CreatedAt  time.Time    `firestore:"created_at"`
	UpdatedAt  time.Time    `firestore:"updated_at"`
	ArchivedAt *time.Time   `firestore:"archived_at,omitempty"`
}

type RoleMetadata struct {
	Company      string    `firestore:"company"`
	Title        string    `firestore:"title"`
	Location     string    `firestore:"location,omitempty"`
	SourceURL    string    `firestore:"source_url,omitempty"`
	SourceText   string    `firestore:"source_text,omitempty"`
	CapturedAt   time.Time `firestore:"captured_at"`
	PriorityRank *int      `firestore:"priority_rank,omitempty"`
	Active       bool      `firestore:"active"`
}

type Bundle struct {
	RoleID      string            `firestore:"role_id"`
	Job         Job               `firestore:"job"`
	Analysis    Analysis          `firestore:"analysis"`
	Artifacts   map[string]string `firestore:"artifacts,omitempty"`
	GeneratedAt time.Time         `firestore:"generated_at"`
}

type Job struct {
	Version      int                   `firestore:"version"`
	RoleID       string                `firestore:"role_id"`
	Company      string                `firestore:"company"`
	Title        string                `firestore:"title"`
	Location     string                `firestore:"location,omitempty"`
	SourceURL    string                `firestore:"source_url,omitempty"`
	CapturedAt   time.Time             `firestore:"captured_at"`
	Posting      JobPosting            `firestore:"posting"`
	Extracted    JobExtracted          `firestore:"extracted"`
	Requirements []RequirementCoverage `firestore:"requirements,omitempty"`
}

type JobPosting struct {
	RawText string `firestore:"raw_text"`
}

type JobExtracted struct {
	Responsibilities     []string `firestore:"responsibilities,omitempty"`
	HardRequirements     []string `firestore:"hard_requirements,omitempty"`
	SoftRequirements     []string `firestore:"soft_requirements,omitempty"`
	InterviewFocus       []string `firestore:"interview_focus,omitempty"`
	InferredRequirements []string `firestore:"inferred_requirements,omitempty"`
	Skills               []string `firestore:"skills,omitempty"`
}

type Analysis struct {
	Verdict             string                `firestore:"verdict"`
	VerdictLabel        string                `firestore:"verdict_label,omitempty"`
	Recommendation      Recommendation        `firestore:"recommendation"`
	Rationale           string                `firestore:"rationale,omitempty"`
	Notes               []string              `firestore:"notes,omitempty"`
	Strengths           []Strength            `firestore:"strengths,omitempty"`
	Gaps                []Gap                 `firestore:"gaps,omitempty"`
	RequirementCoverage []RequirementCoverage `firestore:"requirement_coverage,omitempty"`
	Outcome             *Outcome              `firestore:"outcome,omitempty"`
}

type Recommendation struct {
	Value  string `firestore:"value"`
	Reason string `firestore:"reason,omitempty"`
}

type Strength struct {
	Title    string        `firestore:"title"`
	Evidence []EvidenceRef `firestore:"evidence,omitempty"`
}

type Gap struct {
	ID                    string   `firestore:"id,omitempty"`
	Description           string   `firestore:"description"`
	Category              string   `firestore:"category,omitempty"`
	TaskRefs              []string `firestore:"task_refs,omitempty"`
	Feasible              bool     `firestore:"feasible"`
	EstimatedDays         *int     `firestore:"estimated_days,omitempty"`
	FeasibleWithinOneWeek *bool    `firestore:"feasible_within_one_week,omitempty"`
}

type RequirementCoverage struct {
	ID          string        `firestore:"id"`
	Text        string        `firestore:"text"`
	Category    string        `firestore:"category,omitempty"`
	Fulfillment string        `firestore:"fulfillment"`
	Evidence    []EvidenceRef `firestore:"evidence,omitempty"`
	Gap         string        `firestore:"gap,omitempty"`
	PatchPlan   string        `firestore:"patch_plan,omitempty"`
	TaskRefs    []string      `firestore:"task_refs,omitempty"`
	Feasible    *bool         `firestore:"feasible,omitempty"`
}

type EvidenceRef struct {
	Text string   `firestore:"text"`
	Refs []string `firestore:"refs,omitempty"`
}

type Candidate struct {
	ID                 string           `firestore:"id"`
	CV                 CV               `firestore:"cv"`
	CVValidationErrors []string         `firestore:"cv_validation_errors,omitempty"`
	Context            CandidateContext `firestore:"context"`
	Preferences        string           `firestore:"preferences,omitempty"`
	EvidenceLibrary    []EvidenceItem   `firestore:"evidence_library,omitempty"`
	StoryBank          []Story          `firestore:"story_bank,omitempty"`
	CreatedAt          time.Time        `firestore:"created_at"`
	UpdatedAt          time.Time        `firestore:"updated_at"`
}

type CV struct {
	Summary        string          `firestore:"summary"`
	Contact        Contact         `firestore:"contact"`
	Skills         []string        `firestore:"skills,omitempty"`
	Languages      []Language      `firestore:"languages"`
	Certifications []Certification `firestore:"certifications"`
	Education      []Education     `firestore:"education"`
	Experience     []Experience    `firestore:"experience"`
	Projects       CVProjects      `firestore:"projects"`
}

type Contact struct {
	Name    string `firestore:"name"`
	Surname string `firestore:"surname"`
	Phone   Phone  `firestore:"phone"`
	Email   string `firestore:"email"`
	Links   []Link `firestore:"links"`
}

type Phone struct {
	Prefix string `firestore:"prefix"`
	Number string `firestore:"number"`
}

type Language struct {
	Name  string `firestore:"name"`
	Level string `firestore:"level"`
}

type Certification struct {
	Name   string `firestore:"name"`
	ID     string `firestore:"id"`
	Issuer string `firestore:"issuer"`
	Year   int    `firestore:"year"`
}

type Education struct {
	Name   string `firestore:"name"`
	Type   string `firestore:"type,omitempty"`
	Issuer string `firestore:"issuer"`
	Year   int    `firestore:"year"`
}

type Experience struct {
	Company   string       `firestore:"company"`
	Visible   *bool        `firestore:"visible,omitempty"`
	Positions []CVPosition `firestore:"positions"`
}

type CVPosition struct {
	ID       string   `firestore:"id"`
	Roles    []string `firestore:"roles"`
	Start    string   `firestore:"start"`
	End      string   `firestore:"end,omitempty"`
	Location string   `firestore:"location"`
	Tasks    []string `firestore:"tasks"`
	Keywords []string `firestore:"keywords,omitempty"`
}

type CVProjects struct {
	URL   string          `firestore:"url,omitempty"`
	Items []CVProjectItem `firestore:"items"`
}

type CVProjectItem struct {
	Name        string   `firestore:"name"`
	Visible     *bool    `firestore:"visible,omitempty"`
	Summary     string   `firestore:"summary"`
	URL         string   `firestore:"url"`
	Description string   `firestore:"description"`
	Links       []Link   `firestore:"links,omitempty"`
	Keywords    []string `firestore:"keywords,omitempty"`
}

type Link struct {
	Label string `firestore:"label"`
	URL   string `firestore:"url"`
}

type CandidateContext struct {
	Version     int                `firestore:"version"`
	Constraints ContextConstraints `firestore:"constraints"`
	Preferences ContextPreferences `firestore:"preferences"`
	Metrics     []ContextMetric    `firestore:"metrics,omitempty"`
	Portfolio   Portfolio          `firestore:"portfolio,omitempty"`
}

type ContextConstraints struct {
	SalaryTargetRange            string `firestore:"salary_target_range,omitempty"`
	LocationConstraints          string `firestore:"location_constraints,omitempty"`
	VisaWorkAuthorization        string `firestore:"visa_work_authorization,omitempty"`
	NoticePeriod                 string `firestore:"notice_period,omitempty"`
	RemoteHybridOnsitePreference string `firestore:"remote_hybrid_onsite_preference,omitempty"`
	OtherConstraints             string `firestore:"other_constraints,omitempty"`
}

type ContextPreferences struct {
	PreferredTone           string `firestore:"preferred_tone,omitempty"`
	AvoidTheseClaimsPhrases string `firestore:"avoid_these_claims_phrases,omitempty"`
	PreferredFraming        string `firestore:"preferred_framing,omitempty"`
	TopicsToDeEmphasize     string `firestore:"topics_to_de_emphasize,omitempty"`
}

type ContextMetric struct {
	ID      string `firestore:"id"`
	Metric  string `firestore:"metric"`
	Value   string `firestore:"value"`
	Context string `firestore:"context,omitempty"`
	Source  string `firestore:"source,omitempty"`
	Status  string `firestore:"status,omitempty"`
}

type Portfolio struct {
	PublicSurfaces []string           `firestore:"public_surfaces,omitempty"`
	Projects       []PortfolioProject `firestore:"projects,omitempty"`
}

type PortfolioProject struct {
	ID         string `firestore:"id"`
	Name       string `firestore:"name"`
	PublicLink string `firestore:"public_link,omitempty"`
	Proves     string `firestore:"proves,omitempty"`
	Relevance  string `firestore:"relevance,omitempty"`
	Notes      string `firestore:"notes,omitempty"`
}

type EvidenceItem struct {
	ID              string `firestore:"id"`
	Keyword         string `firestore:"keyword"`
	EvidencePointer string `firestore:"evidence_pointer"`
	ProofStrength   string `firestore:"proof_strength,omitempty"`
	Notes           string `firestore:"notes,omitempty"`
}

type Story struct {
	ID              string       `firestore:"id"`
	JobID           string       `firestore:"job_id,omitempty"`
	Title           string       `firestore:"title"`
	Project         StoryProject `firestore:"project,omitempty"`
	Summary         string       `firestore:"summary,omitempty"`
	Situation       string       `firestore:"situation,omitempty"`
	Task            string       `firestore:"task,omitempty"`
	Action          string       `firestore:"action,omitempty"`
	Result          string       `firestore:"result,omitempty"`
	Reflection      string       `firestore:"reflection,omitempty"`
	InterviewAngles []string     `firestore:"interview_angles,omitempty"`
	EvidenceRefs    []string     `firestore:"evidence_refs,omitempty"`
	Skills          []string     `firestore:"skills,omitempty"`
	Confidentiality string       `firestore:"confidentiality,omitempty"`
}

type StoryProject struct {
	Name string `firestore:"name,omitempty"`
	Kind string `firestore:"kind,omitempty"`
}

type Task struct {
	ID                    string     `firestore:"id"`
	RoleID                *string    `firestore:"role_id,omitempty"`
	Status                string     `firestore:"status"`
	Source                string     `firestore:"source"`
	Kind                  string     `firestore:"kind,omitempty"`
	Title                 string     `firestore:"title"`
	Description           string     `firestore:"description,omitempty"`
	AcceptanceCriteria    []string   `firestore:"acceptance_criteria,omitempty"`
	EvidenceRefs          []string   `firestore:"evidence_refs,omitempty"`
	EstimatedDays         *int       `firestore:"estimated_days,omitempty"`
	FeasibleWithinOneWeek *bool      `firestore:"feasible_within_one_week,omitempty"`
	ActualDays            *int       `firestore:"actual_days,omitempty"`
	CreatedAt             time.Time  `firestore:"created_at"`
	CompletedAt           *time.Time `firestore:"completed_at,omitempty"`
	StatusDetail          string     `firestore:"status_detail,omitempty"`
}

type Event struct {
	ID        string            `firestore:"id"`
	RoleID    *string           `firestore:"role_id,omitempty"`
	Type      string            `firestore:"type"`
	Date      time.Time         `firestore:"date"`
	Detail    string            `firestore:"detail,omitempty"`
	Note      string            `firestore:"note,omitempty"`
	Artifacts []string          `firestore:"artifacts,omitempty"`
	Metadata  map[string]string `firestore:"metadata,omitempty"`
	CreatedAt time.Time         `firestore:"created_at"`
}

type Action struct {
	ID          string                 `firestore:"id"`
	Type        string                 `firestore:"type"`
	Status      string                 `firestore:"status"`
	RoleID      *string                `firestore:"role_id,omitempty"`
	TaskID      *string                `firestore:"task_id,omitempty"`
	Progress    ActionProgress         `firestore:"progress"`
	Result      map[string]interface{} `firestore:"result,omitempty"`
	Error       string                 `firestore:"error,omitempty"`
	CreatedAt   time.Time              `firestore:"created_at"`
	UpdatedAt   time.Time              `firestore:"updated_at"`
	StartedAt   *time.Time             `firestore:"started_at,omitempty"`
	CompletedAt *time.Time             `firestore:"completed_at,omitempty"`
}

type ActionProgress struct {
	Step     string   `firestore:"step,omitempty"`
	Message  string   `firestore:"message,omitempty"`
	Percent  *int     `firestore:"percent,omitempty"`
	LogLines []string `firestore:"log_lines,omitempty"`
}

type Account struct {
	UID              string           `firestore:"uid"`
	Email            string           `firestore:"email,omitempty"`
	StripeCustomerID string           `firestore:"stripe_customer_id,omitempty"`
	CreditBalance    int              `firestore:"credit_balance"`
	HasEverPurchased bool             `firestore:"has_ever_purchased"`
	Purchases        []PurchaseRecord `firestore:"purchases,omitempty"`
	CreatedAt        time.Time        `firestore:"created_at"`
	UpdatedAt        time.Time        `firestore:"updated_at"`
}

type PurchaseRecord struct {
	ID                string    `firestore:"id"`
	Provider          string    `firestore:"provider"`
	CheckoutSessionID string    `firestore:"checkout_session_id,omitempty"`
	PaymentIntentID   string    `firestore:"payment_intent_id,omitempty"`
	CreditAmount      int       `firestore:"credit_amount"`
	AmountTotal       int64     `firestore:"amount_total,omitempty"`
	Currency          string    `firestore:"currency,omitempty"`
	PurchasedAt       time.Time `firestore:"purchased_at"`
}

type Outcome struct {
	Value          string    `firestore:"value"`
	Status         string    `firestore:"status"`
	Verdict        string    `firestore:"verdict,omitempty"`
	Recommendation string    `firestore:"recommendation,omitempty"`
	RecordedAt     time.Time `firestore:"recorded_at"`
	EventID        string    `firestore:"event_id,omitempty"`
}

type CalibrationBlock struct {
	TaskCalibration       *TaskCalibration       `firestore:"task_calibration,omitempty"`
	AssessmentCalibration *AssessmentCalibration `firestore:"assessment_calibration,omitempty"`
	GeneratedAt           time.Time              `firestore:"generated_at"`
}

type TaskCalibration struct {
	SampleSize                    int                        `firestore:"sample_size"`
	MeanActualToEstimatedRatio    float64                    `firestore:"mean_actual_to_estimated_ratio"`
	ByCategory                    map[string]TaskCalibration `firestore:"by_category,omitempty"`
	FeasibilityPredictionAccuracy float64                    `firestore:"feasibility_prediction_accuracy,omitempty"`
}

type AssessmentCalibration struct {
	SampleSize             int                     `firestore:"sample_size"`
	PerVerdict             map[string]VerdictStats `firestore:"per_verdict,omitempty"`
	ByRoleAttribute        map[string]VerdictStats `firestore:"by_role_attribute,omitempty"`
	RecommendationAccuracy map[string]float64      `firestore:"recommendation_accuracy,omitempty"`
	Patterns               []CalibrationPattern    `firestore:"patterns,omitempty"`
}

type VerdictStats struct {
	SampleSize  int     `firestore:"sample_size"`
	Accepted    int     `firestore:"accepted"`
	Rejected    int     `firestore:"rejected"`
	Closed      int     `firestore:"closed"`
	SuccessRate float64 `firestore:"success_rate"`
}

type CalibrationPattern struct {
	Type            string  `firestore:"type"`
	Subject         string  `firestore:"subject,omitempty"`
	Observed        string  `firestore:"observed"`
	ProbableCause   string  `firestore:"probable_cause,omitempty"`
	CalibrationRule string  `firestore:"calibration_rule"`
	Confidence      float64 `firestore:"confidence,omitempty"`
}
