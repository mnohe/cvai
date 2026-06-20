export type FirestoreTimestamp =
  | Date
  | { seconds: number; nanoseconds: number }
  | { toDate(): Date };

export const StatusInterested = "interested";
export const StatusApplied = "applied";
export const StatusPhoneScreen = "phone_screen";
export const StatusInterview = "interview";
export const StatusOffer = "offer";
export const StatusRejected = "rejected";
export const StatusWithdrawn = "withdrawn";
export const StatusArchived = "archived";

export type RoleStatus =
  | typeof StatusInterested
  | typeof StatusApplied
  | typeof StatusPhoneScreen
  | typeof StatusInterview
  | typeof StatusOffer
  | typeof StatusRejected
  | typeof StatusWithdrawn
  | typeof StatusArchived;

export const VerdictClearFit = "CLEAR_FIT";
export const VerdictFit = "FIT";
export const VerdictPossibleFit = "POSSIBLE_FIT";
export const VerdictWeakFit = "WEAK_FIT";
export const VerdictOverqualified = "OVERQUALIFIED";
export const VerdictUnfit = "UNFIT";

export type Verdict =
  | typeof VerdictClearFit
  | typeof VerdictFit
  | typeof VerdictPossibleFit
  | typeof VerdictWeakFit
  | typeof VerdictOverqualified
  | typeof VerdictUnfit;

export const RecommendationApplyNow = "APPLY_NOW";
export const RecommendationApplyNowWhileUpskilling =
  "APPLY_NOW_WHILE_UPSKILLING";
export const RecommendationApplyAfterTargetedPrep =
  "APPLY_AFTER_TARGETED_PREP";
export const RecommendationReview = "review";
export const RecommendationAbandon = "abandon";

export type RecommendationValue =
  | typeof RecommendationApplyNow
  | typeof RecommendationApplyNowWhileUpskilling
  | typeof RecommendationApplyAfterTargetedPrep
  | typeof RecommendationReview
  | typeof RecommendationAbandon;

export const FulfillmentMet = "met";
export const FulfillmentPartial = "partial";
export const FulfillmentUnmet = "unmet";
export const FulfillmentUnknown = "unknown";

export type RequirementFulfillment =
  | typeof FulfillmentMet
  | typeof FulfillmentPartial
  | typeof FulfillmentUnmet
  | typeof FulfillmentUnknown;

export const TaskStatusOpen = "open";
export const TaskStatusCompleted = "completed";

export type TaskStatus = typeof TaskStatusOpen | typeof TaskStatusCompleted;

export const TaskSourceGap = "gap";
export const TaskSourceManual = "manual";

export type TaskSource = typeof TaskSourceGap | typeof TaskSourceManual;

export const ActionPending = "pending";
export const ActionRunning = "running";
export const ActionComplete = "complete";
export const ActionFailed = "failed";

export type ActionStatus =
  | typeof ActionPending
  | typeof ActionRunning
  | typeof ActionComplete
  | typeof ActionFailed;

export const ActionTypeQuickAnalysis = "quick_analysis";
export const ActionTypeIngestRole = "ingest_role";
export const ActionTypeGenerateBundle = "generate_bundle";
export const ActionTypeImportCV = "import_cv";
export const ActionTypeInterpretStatusUpdate = "interpret_status_update";
export const ActionTypeReassessRole = "reassess_role";
export const ActionTypeReassessGapTask = "reassess_gap_task";
export const ActionTypeExportUserData = "export_user_data";
export const ActionTypeDeleteAccount = "delete_account";

export type ActionType =
  | typeof ActionTypeQuickAnalysis
  | typeof ActionTypeIngestRole
  | typeof ActionTypeGenerateBundle
  | typeof ActionTypeImportCV
  | typeof ActionTypeInterpretStatusUpdate
  | typeof ActionTypeReassessRole
  | typeof ActionTypeReassessGapTask
  | typeof ActionTypeExportUserData
  | typeof ActionTypeDeleteAccount;

export const EventRoleIngested = "RoleIngested";
export const EventQuickAnalysisCompleted = "QuickAnalysisCompleted";
export const EventBundleGenerationStarted = "BundleGenerationStarted";
export const EventBundleGenerated = "BundleGenerated";
export const EventStatusUpdated = "StatusUpdated";
export const EventInterviewScheduled = "InterviewScheduled";
export const EventOfferReceived = "OfferReceived";
export const EventRoleRejected = "RoleRejected";
export const EventRoleWithdrawn = "RoleWithdrawn";
export const EventOutcomeRecorded = "OutcomeRecorded";
export const EventGapTaskCreated = "GapTaskCreated";
export const EventGapTaskCompleted = "GapTaskCompleted";
export const EventCVImported = "CVImported";
export const EventCVUpdated = "CVUpdated";
export const EventCreditsDeducted = "CreditsDeducted";
export const EventCreditsPurchased = "CreditsPurchased";
export const EventAccountDeleted = "AccountDeleted";

export type EventType =
  | typeof EventRoleIngested
  | typeof EventQuickAnalysisCompleted
  | typeof EventBundleGenerationStarted
  | typeof EventBundleGenerated
  | typeof EventStatusUpdated
  | typeof EventInterviewScheduled
  | typeof EventOfferReceived
  | typeof EventRoleRejected
  | typeof EventRoleWithdrawn
  | typeof EventOutcomeRecorded
  | typeof EventGapTaskCreated
  | typeof EventGapTaskCompleted
  | typeof EventCVImported
  | typeof EventCVUpdated
  | typeof EventCreditsDeducted
  | typeof EventCreditsPurchased
  | typeof EventAccountDeleted;

export const OutcomeAccepted = "accepted";
export const OutcomeRejected = "rejected";
export const OutcomeClosed = "closed";

export type OutcomeValue =
  | typeof OutcomeAccepted
  | typeof OutcomeRejected
  | typeof OutcomeClosed;

export const PurchaseProviderStripe = "stripe";

export type PurchaseProvider = typeof PurchaseProviderStripe;

export const CalibrationPatternOverconfidence = "overconfidence_bias";
export const CalibrationPatternBlindSpot = "blind_spot";
export const CalibrationPatternBarTooLow = "bar_too_low";

export type CalibrationPatternType =
  | typeof CalibrationPatternOverconfidence
  | typeof CalibrationPatternBlindSpot
  | typeof CalibrationPatternBarTooLow;

export interface Role {
  id: string;
  metadata: RoleMetadata;
  status: RoleStatus;
  bundle?: Bundle;
  outcome?: Outcome;
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
  archived_at?: FirestoreTimestamp;
}

export interface RoleMetadata {
  company: string;
  title: string;
  location?: string;
  source_url?: string;
  source_text?: string;
  captured_at: FirestoreTimestamp;
  priority_rank?: number;
  active: boolean;
}

export interface Bundle {
  role_id: string;
  job: Job;
  analysis: Analysis;
  artifacts?: Record<string, string>;
  generated_at: FirestoreTimestamp;
}

export interface Job {
  version: number;
  role_id: string;
  company: string;
  title: string;
  location?: string;
  source_url?: string;
  captured_at: FirestoreTimestamp;
  posting: JobPosting;
  extracted: JobExtracted;
  requirements?: RequirementCoverage[];
}

export interface JobPosting {
  raw_text: string;
}

export interface JobExtracted {
  responsibilities?: string[];
  hard_requirements?: string[];
  soft_requirements?: string[];
  interview_focus?: string[];
  inferred_requirements?: string[];
  skills?: string[];
}

export interface Analysis {
  verdict: Verdict;
  verdict_label?: string;
  recommendation: Recommendation;
  rationale?: string;
  notes?: string[];
  strengths?: Strength[];
  gaps?: Gap[];
  requirement_coverage?: RequirementCoverage[];
  outcome?: Outcome;
}

export interface Recommendation {
  value: RecommendationValue;
  reason?: string;
}

export interface Strength {
  title: string;
  evidence?: EvidenceRef[];
}

export interface Gap {
  id?: string;
  description: string;
  category?: string;
  task_refs?: string[];
  feasible: boolean;
  estimated_days?: number;
  feasible_within_one_week?: boolean;
}

export interface RequirementCoverage {
  id: string;
  text: string;
  category?: string;
  fulfillment: RequirementFulfillment;
  evidence?: EvidenceRef[];
  gap?: string;
  patch_plan?: string;
  task_refs?: string[];
  feasible?: boolean;
}

export interface EvidenceRef {
  text: string;
  refs?: string[];
}

export interface Candidate {
  id: string;
  cv: CV;
  context: CandidateContext;
  preferences?: string;
  evidence_library?: EvidenceItem[];
  story_bank?: Story[];
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
}

export interface CV {
  summary: string;
  contact: Contact;
  skills?: string[];
  languages: Language[];
  certifications: Certification[];
  education: Education[];
  experience: Experience[];
  projects: CVProjects;
}

export interface Contact {
  name: string;
  surname: string;
  phone: Phone;
  email: string;
  linkedin: string;
  github?: string;
  www?: string;
}

export interface Phone {
  prefix: string;
  number: string;
}

export interface Language {
  name: string;
  level: string;
}

export interface Certification {
  name: string;
  id: string;
  issuer: string;
  year: number;
}

export interface Education {
  name: string;
  type?: string;
  issuer: string;
  year: number;
}

export interface Experience {
  company: string;
  visible?: boolean;
  positions: CVPosition[];
}

export interface CVPosition {
  id: string;
  roles: string[];
  start: string;
  end?: string;
  location: string;
  tasks: string[];
  keywords?: string[];
}

export interface CVProjects {
  url?: string;
  items: CVProjectItem[];
}

export interface CVProjectItem {
  name: string;
  visible?: boolean;
  summary: string;
  url: string;
  description: string;
  links?: Link[];
  keywords?: string[];
}

export interface Link {
  label: string;
  url: string;
}

export interface CandidateContext {
  version: number;
  constraints: ContextConstraints;
  preferences: ContextPreferences;
  metrics?: ContextMetric[];
  portfolio?: Portfolio;
}

export interface ContextConstraints {
  salary_target_range?: string;
  location_constraints?: string;
  visa_work_authorization?: string;
  notice_period?: string;
  remote_hybrid_onsite_preference?: string;
  other_constraints?: string;
}

export interface ContextPreferences {
  preferred_tone?: string;
  avoid_these_claims_phrases?: string;
  preferred_framing?: string;
  topics_to_de_emphasize?: string;
}

export interface ContextMetric {
  id: string;
  metric: string;
  value: string;
  context?: string;
  source?: string;
  status?: string;
}

export interface Portfolio {
  public_surfaces?: string[];
  projects?: PortfolioProject[];
}

export interface PortfolioProject {
  id: string;
  name: string;
  public_link?: string;
  proves?: string;
  relevance?: string;
  notes?: string;
}

export interface EvidenceItem {
  id: string;
  keyword: string;
  evidence_pointer: string;
  proof_strength?: string;
  notes?: string;
}

export interface Story {
  id: string;
  job_id?: string;
  title: string;
  project?: StoryProject;
  summary?: string;
  situation?: string;
  task?: string;
  action?: string;
  result?: string;
  reflection?: string;
  interview_angles?: string[];
  evidence_refs?: string[];
  skills?: string[];
  confidentiality?: string;
}

export interface StoryProject {
  name?: string;
  kind?: string;
}

export interface Task {
  id: string;
  role_id?: string;
  status: TaskStatus;
  source: TaskSource;
  kind?: string;
  title: string;
  description?: string;
  acceptance_criteria?: string[];
  evidence_refs?: string[];
  estimated_days?: number;
  feasible_within_one_week?: boolean;
  actual_days?: number;
  created_at: FirestoreTimestamp;
  completed_at?: FirestoreTimestamp;
  status_detail?: string;
}

export interface Event {
  id: string;
  role_id?: string;
  type: EventType;
  date: FirestoreTimestamp;
  detail?: string;
  note?: string;
  artifacts?: string[];
  metadata?: Record<string, string>;
  created_at: FirestoreTimestamp;
}

export interface Action {
  id: string;
  type: ActionType;
  status: ActionStatus;
  role_id?: string;
  task_id?: string;
  progress: ActionProgress;
  result?: Record<string, unknown>;
  error?: string;
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
  started_at?: FirestoreTimestamp;
  completed_at?: FirestoreTimestamp;
}

export interface ActionProgress {
  step?: string;
  message?: string;
  percent?: number;
  log_lines?: string[];
}

export interface Account {
  uid: string;
  email?: string;
  stripe_customer_id?: string;
  credit_balance: number;
  has_ever_purchased: boolean;
  purchases?: PurchaseRecord[];
  created_at: FirestoreTimestamp;
  updated_at: FirestoreTimestamp;
}

export interface PurchaseRecord {
  id: string;
  provider: PurchaseProvider;
  checkout_session_id?: string;
  payment_intent_id?: string;
  credit_amount: number;
  amount_total?: number;
  currency?: string;
  purchased_at: FirestoreTimestamp;
}

export interface Outcome {
  value: OutcomeValue;
  status: RoleStatus;
  verdict?: Verdict;
  recommendation?: RecommendationValue;
  recorded_at: FirestoreTimestamp;
  event_id?: string;
}

export interface CalibrationBlock {
  task_calibration?: TaskCalibration;
  assessment_calibration?: AssessmentCalibration;
  generated_at: FirestoreTimestamp;
}

export interface TaskCalibration {
  sample_size: number;
  mean_actual_to_estimated_ratio: number;
  by_category?: Record<string, TaskCalibration>;
  feasibility_prediction_accuracy?: number;
}

export interface AssessmentCalibration {
  sample_size: number;
  per_verdict?: Partial<Record<Verdict, VerdictStats>>;
  by_role_attribute?: Record<string, VerdictStats>;
  recommendation_accuracy?: Partial<Record<RecommendationValue, number>>;
  patterns?: CalibrationPattern[];
}

export interface VerdictStats {
  sample_size: number;
  accepted: number;
  rejected: number;
  closed: number;
  success_rate: number;
}

export interface CalibrationPattern {
  type: CalibrationPatternType;
  subject?: string;
  observed: string;
  probable_cause?: string;
  calibration_rule: string;
  confidence?: number;
}
