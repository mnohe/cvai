package domain

import (
	"strings"
	"testing"
)

func TestRoleValidateAcceptsCompleteRole(t *testing.T) {
	role := Role{
		ID: "role-1",
		Metadata: RoleMetadata{
			Company: "Acme",
			Title:   "Staff Engineer",
		},
		Status: StatusInterested,
		Bundle: &Bundle{
			RoleID: "role-1",
			Job: Job{
				RoleID:  "role-1",
				Company: "Acme",
				Title:   "Staff Engineer",
				Posting: JobPosting{RawText: "Build useful systems."},
			},
			Analysis: Analysis{
				Verdict: VerdictFit,
				Recommendation: Recommendation{
					Value: RecommendationApplyNow,
				},
				RequirementCoverage: []RequirementCoverage{
					{
						ID:          "req-1",
						Text:        "Go experience",
						Fulfillment: FulfillmentMet,
					},
				},
			},
		},
	}

	if err := role.Validate(); err != nil {
		t.Fatalf("Role.Validate() returned error: %v", err)
	}
}

func TestRoleValidateRejectsInvalidStatus(t *testing.T) {
	role := Role{
		ID: "role-1",
		Metadata: RoleMetadata{
			Company: "Acme",
			Title:   "Staff Engineer",
		},
		Status: "maybe",
	}

	assertValidationErrorContains(t, role.Validate(), `role.status has invalid value "maybe"`)
}

func TestCVValidateEnforcesSchemaRequiredFields(t *testing.T) {
	cv := validCV()
	cv.Contact.Links = []Link{{Label: "LinkedIn"}}
	cv.Projects.Items[0].Links = []Link{{Label: "Demo"}}

	err := cv.Validate()
	assertValidationErrorContains(t, err, "contact.links[0]: link.url is required")
	assertValidationErrorContains(t, err, "cv_project.links[0]: link.url is required")
}

func TestCVValidateAllowsOptionalImportedFields(t *testing.T) {
	cv := validCV()
	cv.Certifications[0].ID = ""
	cv.Certifications[0].Year = 0
	cv.Education[0].Year = 0
	cv.Projects.Items = nil

	if err := cv.Validate(); err != nil {
		t.Fatalf("Validate() returned error: %v", err)
	}
}

func TestTaskValidateRejectsInvalidEffortAndSource(t *testing.T) {
	negative := -1
	task := Task{
		ID:            "task-1",
		Status:        TaskStatusOpen,
		Source:        "analysis",
		Title:         "Close skill gap",
		EstimatedDays: &negative,
	}

	err := task.Validate()
	assertValidationErrorContains(t, err, `task.source has invalid value "analysis"`)
	assertValidationErrorContains(t, err, "task.estimated_days must be >= 0")
}

func TestActionProgressValidateRejectsPercentOutOfRange(t *testing.T) {
	percent := 101
	progress := ActionProgress{Percent: &percent}

	assertValidationErrorContains(t, progress.Validate(), "action_progress.percent must be between 0 and 100")
}

func TestAccountAndPurchaseValidateInvariants(t *testing.T) {
	account := Account{
		UID:           "uid-1",
		CreditBalance: -1,
		Purchases: []PurchaseRecord{
			{
				ID:           "purchase-1",
				Provider:     PurchaseProviderStripe,
				CreditAmount: 0,
			},
		},
	}

	err := account.Validate()
	assertValidationErrorContains(t, err, "account.credit_balance must be >= 0")
	assertValidationErrorContains(t, err, "purchase_record.credit_amount must be > 0")
}

func TestCalibrationPatternValidateRejectsUnknownType(t *testing.T) {
	pattern := CalibrationPattern{
		Type:            "guess",
		Observed:        "CLEAR_FIT underperformed",
		CalibrationRule: "Tighten the top verdict bar.",
	}

	assertValidationErrorContains(t, pattern.Validate(), `calibration_pattern.type has invalid value "guess"`)
}

func validCV() CV {
	return CV{
		Summary: "Staff engineer with platform experience.",
		Contact: Contact{
			Name:     "Ada",
			Surname:  "Lovelace",
			Phone:    Phone{Prefix: "+1", Number: "5551234"},
			Email:    "ada@example.com",
			Links:    []Link{{Label: "LinkedIn", URL: "https://linkedin.example/ada"}},
		},
		Languages: []Language{
			{Name: "English", Level: "Native"},
		},
		Certifications: []Certification{
			{Name: "Cloud Architect", ID: "cert-1", Issuer: "Cloud Org", Year: 2025},
		},
		Education: []Education{
			{Name: "Computer Science", Issuer: "Example University", Year: 2020},
		},
		Experience: []Experience{
			{
				Company: "Acme",
				Positions: []CVPosition{
					{
						ID:       "staff_engineer",
						Roles:    []string{"Staff Engineer"},
						Start:    "2022",
						Location: "Remote",
						Tasks:    []string{"Led platform migration"},
					},
				},
			},
		},
		Projects: CVProjects{
			Items: []CVProjectItem{
				{
					Name:        "Migration",
					Summary:     "Moved workloads safely.",
					URL:         "https://example.com/migration",
					Description: "Reduced deployment time.",
					Links:       []Link{{Label: "Case study", URL: "https://example.com/case-study"}},
				},
			},
		},
	}
}

func assertValidationErrorContains(t *testing.T, err error, want string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected validation error containing %q, got nil", want)
	}
	if !strings.Contains(err.Error(), want) {
		t.Fatalf("expected validation error containing %q, got %q", want, err.Error())
	}
}
