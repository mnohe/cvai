package domain

const (
	StatusInterested  = "interested"
	StatusApplied     = "applied"
	StatusPhoneScreen = "phone_screen"
	StatusInterview   = "interview"
	StatusOffer       = "offer"
	StatusRejected    = "rejected"
	StatusWithdrawn   = "withdrawn"
	StatusArchived    = "archived"

	VerdictClearFit      = "CLEAR_FIT"
	VerdictFit           = "FIT"
	VerdictPossibleFit   = "POSSIBLE_FIT"
	VerdictWeakFit       = "WEAK_FIT"
	VerdictOverqualified = "OVERQUALIFIED"
	VerdictUnfit         = "UNFIT"

	RecommendationApplyNow                = "APPLY_NOW"
	RecommendationApplyNowWhileUpskilling = "APPLY_NOW_WHILE_UPSKILLING"
	RecommendationApplyAfterTargetedPrep  = "APPLY_AFTER_TARGETED_PREP"
	RecommendationReview                  = "review"
	RecommendationAbandon                 = "abandon"

	FulfillmentMet     = "met"
	FulfillmentPartial = "partial"
	FulfillmentUnmet   = "unmet"
	FulfillmentUnknown = "unknown"

	TaskStatusOpen      = "open"
	TaskStatusCompleted = "completed"

	TaskSourceGap    = "gap"
	TaskSourceManual = "manual"

	ActionPending  = "pending"
	ActionRunning  = "running"
	ActionComplete = "complete"
	ActionFailed   = "failed"

	ActionTypeQuickAnalysis         = "quick_analysis"
	ActionTypeIngestRole            = "ingest_role"
	ActionTypeGenerateBundle        = "generate_bundle"
	ActionTypeImportCV              = "import_cv"
	ActionTypeInterpretStatusUpdate = "interpret_status_update"
	ActionTypeReassessRole          = "reassess_role"
	ActionTypeReassessGapTask       = "reassess_gap_task"
	ActionTypeExportUserData        = "export_user_data"
	ActionTypeDeleteAccount         = "delete_account"

	EventRoleIngested            = "RoleIngested"
	EventQuickAnalysisCompleted  = "QuickAnalysisCompleted"
	EventBundleGenerationStarted = "BundleGenerationStarted"
	EventBundleGenerated         = "BundleGenerated"
	EventStatusUpdated           = "StatusUpdated"
	EventInterviewScheduled      = "InterviewScheduled"
	EventOfferReceived           = "OfferReceived"
	EventRoleRejected            = "RoleRejected"
	EventRoleWithdrawn           = "RoleWithdrawn"
	EventOutcomeRecorded         = "OutcomeRecorded"
	EventGapTaskCreated          = "GapTaskCreated"
	EventGapTaskCompleted        = "GapTaskCompleted"
	EventCVImported              = "CVImported"
	EventCVUpdated               = "CVUpdated"
	EventCreditsDeducted         = "CreditsDeducted"
	EventCreditsPurchased        = "CreditsPurchased"
	EventAccountDeleted          = "AccountDeleted"

	OutcomeAccepted = "accepted"
	OutcomeRejected = "rejected"
	OutcomeClosed   = "closed"

	PurchaseProviderStripe = "stripe"

	CalibrationPatternOverconfidence = "overconfidence_bias"
	CalibrationPatternBlindSpot      = "blind_spot"
	CalibrationPatternBarTooLow      = "bar_too_low"
)
