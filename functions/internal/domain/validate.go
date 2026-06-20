package domain

import (
	"errors"
	"fmt"
	"strings"
)

type validatable interface {
	Validate() error
}

// Validate checks that the Role has required identity, metadata, lifecycle status, and valid optional aggregates.
func (r Role) Validate() error {
	return join(
		required("role.id", r.ID),
		r.Metadata.Validate(),
		oneOf("role.status", r.Status, roleStatuses),
		validateOptional("role.bundle", r.Bundle),
		validateOptional("role.outcome", r.Outcome),
	)
}

// Validate checks that RoleMetadata contains the user-facing role identifiers required for display and sorting.
func (m RoleMetadata) Validate() error {
	return join(
		required("role.metadata.company", m.Company),
		required("role.metadata.title", m.Title),
	)
}

// Validate checks that a Bundle is linked to a Role and contains valid Job and Analysis payloads.
func (b Bundle) Validate() error {
	return join(
		required("bundle.role_id", b.RoleID),
		b.Job.Validate(),
		b.Analysis.Validate(),
	)
}

// Validate checks that a Job has required role metadata, source posting text, and valid requirements.
func (j Job) Validate() error {
	return join(
		required("job.role_id", j.RoleID),
		required("job.company", j.Company),
		required("job.title", j.Title),
		j.Posting.Validate(),
		validateSlice("job.requirements", j.Requirements),
	)
}

// Validate accepts JobExtracted because all extracted job detail fields are optional evidence from the LLM.
func (e JobExtracted) Validate() error {
	return nil
}

// Validate checks that JobPosting preserves the source text used to generate downstream analysis.
func (p JobPosting) Validate() error {
	return required("job_posting.raw_text", p.RawText)
}

// Validate checks that Analysis uses supported verdict and recommendation values and valid nested findings.
func (a Analysis) Validate() error {
	return join(
		oneOf("analysis.verdict", a.Verdict, verdicts),
		a.Recommendation.Validate(),
		validateSlice("analysis.strengths", a.Strengths),
		validateSlice("analysis.gaps", a.Gaps),
		validateSlice("analysis.requirement_coverage", a.RequirementCoverage),
		validateOptional("analysis.outcome", a.Outcome),
	)
}

// Validate checks that Recommendation contains a supported recommendation value.
func (r Recommendation) Validate() error {
	return join(
		required("recommendation.value", r.Value),
		oneOf("recommendation.value", r.Value, recommendations),
	)
}

// Validate checks that Strength has a title and valid evidence references.
func (s Strength) Validate() error {
	return join(
		required("strength.title", s.Title),
		validateSlice("strength.evidence", s.Evidence),
	)
}

// Validate checks that Gap describes an unmet requirement and has a non-negative effort estimate when present.
func (g Gap) Validate() error {
	var estimated error
	if g.EstimatedDays != nil && *g.EstimatedDays < 0 {
		estimated = fmt.Errorf("gap.estimated_days must be >= 0")
	}
	return join(required("gap.description", g.Description), estimated)
}

// Validate checks that RequirementCoverage identifies a requirement and uses a supported fulfillment value.
func (r RequirementCoverage) Validate() error {
	return join(
		required("requirement_coverage.id", r.ID),
		required("requirement_coverage.text", r.Text),
		oneOf("requirement_coverage.fulfillment", r.Fulfillment, fulfillments),
		validateSlice("requirement_coverage.evidence", r.Evidence),
	)
}

// Validate checks that EvidenceRef contains displayable evidence text.
func (e EvidenceRef) Validate() error {
	return required("evidence.text", e.Text)
}

// Validate checks that Candidate contains required profile identity, CV, context, and valid portfolio entries.
func (c Candidate) Validate() error {
	return join(
		required("candidate.id", c.ID),
		c.CV.Validate(),
		c.Context.Validate(),
		validateSlice("candidate.evidence_library", c.EvidenceLibrary),
		validateSlice("candidate.story_bank", c.StoryBank),
	)
}

// Validate checks that CV satisfies the required structure used by the checked-in CV JSON schema.
func (c CV) Validate() error {
	return join(
		required("cv.summary", c.Summary),
		c.Contact.Validate(),
		minLen("cv.languages", len(c.Languages), 1),
		validateSlice("cv.languages", c.Languages),
		validateSlice("cv.certifications", c.Certifications),
		validateSlice("cv.education", c.Education),
		minLen("cv.experience", len(c.Experience), 1),
		validateSlice("cv.experience", c.Experience),
		c.Projects.Validate(),
	)
}

// Validate checks that Contact contains the required personal and contact fields for CV rendering.
func (c Contact) Validate() error {
	return join(
		required("contact.name", c.Name),
		required("contact.surname", c.Surname),
		c.Phone.Validate(),
		required("contact.email", c.Email),
		required("contact.linkedin", c.LinkedIn),
	)
}

// Validate checks that Phone contains both prefix and number.
func (p Phone) Validate() error {
	return join(
		required("phone.prefix", p.Prefix),
		required("phone.number", p.Number),
	)
}

// Validate checks that Language has both a name and proficiency level.
func (l Language) Validate() error {
	return join(
		required("language.name", l.Name),
		required("language.level", l.Level),
	)
}

// Validate checks that Certification has required issuer details and a schema-supported year.
func (c Certification) Validate() error {
	return join(
		required("certification.name", c.Name),
		required("certification.issuer", c.Issuer),
		optionalYear("certification.year", c.Year),
	)
}

// Validate checks that Education has required institution details and a schema-supported year.
func (e Education) Validate() error {
	return join(
		required("education.name", e.Name),
		required("education.issuer", e.Issuer),
		optionalYear("education.year", e.Year),
	)
}

// Validate checks that Experience has an employer and at least one valid position.
func (e Experience) Validate() error {
	return join(
		required("experience.company", e.Company),
		minLen("experience.positions", len(e.Positions), 1),
		validateSlice("experience.positions", e.Positions),
	)
}

// Validate checks that CVPosition has required role, date, location, and task details.
func (p CVPosition) Validate() error {
	return join(
		required("cv_position.id", p.ID),
		minLen("cv_position.roles", len(p.Roles), 1),
		nonEmptyStrings("cv_position.roles", p.Roles),
		required("cv_position.start", p.Start),
		required("cv_position.location", p.Location),
		minLen("cv_position.tasks", len(p.Tasks), 1),
		nonEmptyStrings("cv_position.tasks", p.Tasks),
		nonEmptyStrings("cv_position.keywords", p.Keywords),
	)
}

// Validate checks that CVProjects contains at least one valid project item.
func (p CVProjects) Validate() error {
	return join(
		validateSlice("cv.projects.items", p.Items),
	)
}

// Validate checks that CVProjectItem has the required project summary, URL, description, and valid links.
func (p CVProjectItem) Validate() error {
	return join(
		required("cv_project.name", p.Name),
		required("cv_project.summary", p.Summary),
		required("cv_project.description", p.Description),
		validateSlice("cv_project.links", p.Links),
		nonEmptyStrings("cv_project.keywords", p.Keywords),
	)
}

// Validate checks that Link has both a label and URL.
func (l Link) Validate() error {
	return join(
		required("link.label", l.Label),
		required("link.url", l.URL),
	)
}

// Validate checks that CandidateContext has a non-negative version and valid metrics.
func (c CandidateContext) Validate() error {
	var version error
	if c.Version < 0 {
		version = fmt.Errorf("candidate_context.version must be >= 0")
	}
	return join(version, validateSlice("candidate_context.metrics", c.Metrics))
}

// Validate checks that ContextMetric has the required metric identity and value.
func (m ContextMetric) Validate() error {
	return join(
		required("context_metric.id", m.ID),
		required("context_metric.metric", m.Metric),
		required("context_metric.value", m.Value),
	)
}

// Validate checks that EvidenceItem has the required keyword and evidence pointer.
func (e EvidenceItem) Validate() error {
	return join(
		required("evidence_item.id", e.ID),
		required("evidence_item.keyword", e.Keyword),
		required("evidence_item.evidence_pointer", e.EvidencePointer),
	)
}

// Validate checks that Story has the required identity and title.
func (s Story) Validate() error {
	return join(
		required("story.id", s.ID),
		required("story.title", s.Title),
	)
}

// Validate checks that Task has supported lifecycle values and non-negative effort fields when present.
func (t Task) Validate() error {
	var estimated error
	if t.EstimatedDays != nil && *t.EstimatedDays < 0 {
		estimated = fmt.Errorf("task.estimated_days must be >= 0")
	}
	var actual error
	if t.ActualDays != nil && *t.ActualDays < 0 {
		actual = fmt.Errorf("task.actual_days must be >= 0")
	}
	return join(
		required("task.id", t.ID),
		oneOf("task.status", t.Status, taskStatuses),
		oneOf("task.source", t.Source, taskSources),
		required("task.title", t.Title),
		estimated,
		actual,
	)
}

// Validate checks that Event has required identity and a supported event type.
func (e Event) Validate() error {
	return join(
		required("event.id", e.ID),
		required("event.type", e.Type),
		oneOf("event.type", e.Type, eventTypes),
	)
}

// Validate checks that Action has required identity, supported type/status values, and valid progress.
func (a Action) Validate() error {
	return join(
		required("action.id", a.ID),
		oneOf("action.type", a.Type, actionTypes),
		oneOf("action.status", a.Status, actionStatuses),
		a.Progress.Validate(),
	)
}

// Validate checks that ActionProgress percent is within the displayable 0-100 range when present.
func (p ActionProgress) Validate() error {
	if p.Percent != nil && (*p.Percent < 0 || *p.Percent > 100) {
		return fmt.Errorf("action_progress.percent must be between 0 and 100")
	}
	return nil
}

// Validate checks that Account has an owner UID, non-negative credit balance, and valid purchase records.
func (a Account) Validate() error {
	var credits error
	if a.CreditBalance < 0 {
		credits = fmt.Errorf("account.credit_balance must be >= 0")
	}
	return join(
		required("account.uid", a.UID),
		credits,
		validateSlice("account.purchases", a.Purchases),
	)
}

// Validate checks that PurchaseRecord has required provider details and a positive credit amount.
func (p PurchaseRecord) Validate() error {
	var credits error
	if p.CreditAmount <= 0 {
		credits = fmt.Errorf("purchase_record.credit_amount must be > 0")
	}
	return join(
		required("purchase_record.id", p.ID),
		oneOf("purchase_record.provider", p.Provider, purchaseProviders),
		credits,
	)
}

// Validate checks that Outcome uses supported terminal result, status, verdict, and recommendation values.
func (o Outcome) Validate() error {
	return join(
		oneOf("outcome.value", o.Value, outcomes),
		oneOf("outcome.status", o.Status, terminalRoleStatuses),
		optionalOneOf("outcome.verdict", o.Verdict, verdicts),
		optionalOneOf("outcome.recommendation", o.Recommendation, recommendations),
	)
}

// Validate checks that CalibrationBlock contains valid optional task and assessment calibration summaries.
func (b CalibrationBlock) Validate() error {
	return join(
		validateOptional("calibration_block.task_calibration", b.TaskCalibration),
		validateOptional("calibration_block.assessment_calibration", b.AssessmentCalibration),
	)
}

// Validate checks that TaskCalibration has non-negative samples and ratio values within expected bounds.
func (t TaskCalibration) Validate() error {
	return join(
		nonNegativeInt("task_calibration.sample_size", t.SampleSize),
		nonNegativeFloat("task_calibration.mean_actual_to_estimated_ratio", t.MeanActualToEstimatedRatio),
		ratio("task_calibration.feasibility_prediction_accuracy", t.FeasibilityPredictionAccuracy),
		validateMap("task_calibration.by_category", t.ByCategory),
	)
}

// Validate checks that AssessmentCalibration has valid aggregate stats, recommendation accuracy, and patterns.
func (a AssessmentCalibration) Validate() error {
	return join(
		nonNegativeInt("assessment_calibration.sample_size", a.SampleSize),
		validateMap("assessment_calibration.per_verdict", a.PerVerdict),
		validateMap("assessment_calibration.by_role_attribute", a.ByRoleAttribute),
		validateRatioMap("assessment_calibration.recommendation_accuracy", a.RecommendationAccuracy),
		validateSlice("assessment_calibration.patterns", a.Patterns),
	)
}

// Validate checks that VerdictStats counters are non-negative and success rate is a valid ratio.
func (s VerdictStats) Validate() error {
	return join(
		nonNegativeInt("verdict_stats.sample_size", s.SampleSize),
		nonNegativeInt("verdict_stats.accepted", s.Accepted),
		nonNegativeInt("verdict_stats.rejected", s.Rejected),
		nonNegativeInt("verdict_stats.closed", s.Closed),
		ratio("verdict_stats.success_rate", s.SuccessRate),
	)
}

// Validate checks that CalibrationPattern uses a supported type and includes an actionable calibration rule.
func (p CalibrationPattern) Validate() error {
	return join(
		oneOf("calibration_pattern.type", p.Type, calibrationPatternTypes),
		required("calibration_pattern.observed", p.Observed),
		required("calibration_pattern.calibration_rule", p.CalibrationRule),
		ratio("calibration_pattern.confidence", p.Confidence),
	)
}

func required(field, value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", field)
	}
	return nil
}

func minLen(field string, got, want int) error {
	if got < want {
		return fmt.Errorf("%s must contain at least %d item(s)", field, want)
	}
	return nil
}

func year(field string, value int) error {
	if value < 1900 || value > 2100 {
		return fmt.Errorf("%s must be between 1900 and 2100", field)
	}
	return nil
}

func optionalYear(field string, value int) error {
	if value == 0 {
		return nil
	}
	return year(field, value)
}

func nonNegativeInt(field string, value int) error {
	if value < 0 {
		return fmt.Errorf("%s must be >= 0", field)
	}
	return nil
}

func nonNegativeFloat(field string, value float64) error {
	if value < 0 {
		return fmt.Errorf("%s must be >= 0", field)
	}
	return nil
}

func ratio(field string, value float64) error {
	if value < 0 || value > 1 {
		return fmt.Errorf("%s must be between 0 and 1", field)
	}
	return nil
}

func nonEmptyStrings(field string, values []string) error {
	var errs []error
	for i, value := range values {
		if strings.TrimSpace(value) == "" {
			errs = append(errs, fmt.Errorf("%s[%d] is required", field, i))
		}
	}
	return errors.Join(errs...)
}

func oneOf(field, value string, allowed map[string]struct{}) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s is required", field)
	}
	if _, ok := allowed[value]; !ok {
		return fmt.Errorf("%s has invalid value %q", field, value)
	}
	return nil
}

func optionalOneOf(field, value string, allowed map[string]struct{}) error {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return oneOf(field, value, allowed)
}

func validateOptional[T validatable](field string, v *T) error {
	if v == nil {
		return nil
	}
	if err := (*v).Validate(); err != nil {
		return fmt.Errorf("%s: %w", field, err)
	}
	return nil
}

func validateSlice[T validatable](field string, values []T) error {
	var errs []error
	for i, value := range values {
		if err := value.Validate(); err != nil {
			errs = append(errs, fmt.Errorf("%s[%d]: %w", field, i, err))
		}
	}
	return errors.Join(errs...)
}

func validateMap[T validatable](field string, values map[string]T) error {
	var errs []error
	for key, value := range values {
		if strings.TrimSpace(key) == "" {
			errs = append(errs, fmt.Errorf("%s contains an empty key", field))
			continue
		}
		if err := value.Validate(); err != nil {
			errs = append(errs, fmt.Errorf("%s[%q]: %w", field, key, err))
		}
	}
	return errors.Join(errs...)
}

func validateRatioMap(field string, values map[string]float64) error {
	var errs []error
	for key, value := range values {
		if strings.TrimSpace(key) == "" {
			errs = append(errs, fmt.Errorf("%s contains an empty key", field))
			continue
		}
		if err := ratio(fmt.Sprintf("%s[%q]", field, key), value); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func join(errs ...error) error {
	return errors.Join(errs...)
}

func enum(values ...string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		out[value] = struct{}{}
	}
	return out
}

var roleStatuses = enum(
	StatusInterested,
	StatusApplied,
	StatusPhoneScreen,
	StatusInterview,
	StatusOffer,
	StatusRejected,
	StatusWithdrawn,
	StatusArchived,
)

var terminalRoleStatuses = enum(
	StatusOffer,
	StatusRejected,
	StatusWithdrawn,
	StatusArchived,
)

var verdicts = enum(
	VerdictClearFit,
	VerdictFit,
	VerdictPossibleFit,
	VerdictWeakFit,
	VerdictOverqualified,
	VerdictUnfit,
)

var recommendations = enum(
	RecommendationApplyNow,
	RecommendationApplyNowWhileUpskilling,
	RecommendationApplyAfterTargetedPrep,
	RecommendationReview,
	RecommendationAbandon,
)

var fulfillments = enum(
	FulfillmentMet,
	FulfillmentPartial,
	FulfillmentUnmet,
	FulfillmentUnknown,
)

var taskStatuses = enum(
	TaskStatusOpen,
	TaskStatusCompleted,
)

var taskSources = enum(
	TaskSourceGap,
	TaskSourceManual,
)

var actionStatuses = enum(
	ActionPending,
	ActionRunning,
	ActionComplete,
	ActionFailed,
)

var actionTypes = enum(
	ActionTypeQuickAnalysis,
	ActionTypeIngestRole,
	ActionTypeGenerateBundle,
	ActionTypeImportCV,
	ActionTypeInterpretStatusUpdate,
	ActionTypeReassessRole,
	ActionTypeReassessGapTask,
	ActionTypeExportUserData,
	ActionTypeDeleteAccount,
)

var eventTypes = enum(
	EventRoleIngested,
	EventQuickAnalysisCompleted,
	EventBundleGenerationStarted,
	EventBundleGenerated,
	EventStatusUpdated,
	EventInterviewScheduled,
	EventOfferReceived,
	EventRoleRejected,
	EventRoleWithdrawn,
	EventOutcomeRecorded,
	EventGapTaskCreated,
	EventGapTaskCompleted,
	EventCVImported,
	EventCVUpdated,
	EventCreditsDeducted,
	EventCreditsPurchased,
	EventAccountDeleted,
)

var outcomes = enum(
	OutcomeAccepted,
	OutcomeRejected,
	OutcomeClosed,
)

var purchaseProviders = enum(
	PurchaseProviderStripe,
)

var calibrationPatternTypes = enum(
	CalibrationPatternOverconfidence,
	CalibrationPatternBlindSpot,
	CalibrationPatternBarTooLow,
)
