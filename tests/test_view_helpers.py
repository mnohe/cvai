import unittest

from cvai_core.repo import RoleRecord, TaskRecord
from cvai_web import view_helpers


class ViewHelperTests(unittest.TestCase):
    def _application(self, *, status: str, detail: str = "") -> RoleRecord:
        # The view helper only reads the status fields, but constructing the real
        # record keeps this test close to the objects the templates receive.
        return RoleRecord(
            canonical_slug="example",
            company="Example Co",
            location="Remote",
            role="Engineer",
            job_file="",
            source_url="",
            captured_on="2026-05-20T00:00:00Z",
            verdict="FIT",
            verdict_label="Good fit",
            status=status,
            status_date="2026-05-20",
            status_detail=detail,
            status_artifacts=[],
            rationale="",
            report_path=None,
            output_dir=None,
            mirror_path=None,
            artifacts=[],
            decision_events=[],
        )

    def _task(self, *, estimated_days: int | None, feasible: bool | None) -> TaskRecord:
        # Task records are rendered in both task lists and requirement gap cells,
        # so ETA formatting gets tested through the real domain object too.
        return TaskRecord(
            id="task-example",
            title="Example task",
            description="Demonstrate the missing evidence.",
            status="open",
            kind="gap_evidence",
            estimated_days=estimated_days,
            feasible_within_one_week=feasible,
            acceptance_criteria=[],
            evidence_refs=[],
            status_detail="",
        )

    def test_dashboard_status_badges_cover_known_and_fallback_states(self) -> None:
        # Dashboard badges deliberately compress detailed status prose into a
        # short state that can be scanned in the application list.
        self.assertEqual(view_helpers.dashboard_status_badge(self._application(status="submitted")), ("Submitted", "submitted"))
        self.assertEqual(view_helpers.dashboard_status_badge(self._application(status="interviewing")), ("Interviewing", "interviewing"))
        self.assertEqual(view_helpers.dashboard_status_badge(self._application(status="draft")), ("Not submitted", "draft"))
        self.assertEqual(view_helpers.dashboard_status_badge(self._application(status="accepted")), ("Accepted", "accepted"))
        self.assertEqual(view_helpers.dashboard_status_badge(self._application(status="rejected")), ("Rejected", "rejected"))
        self.assertEqual(view_helpers.dashboard_status_badge(self._application(status="closed")), ("Closed", "closed"))
        self.assertEqual(
            view_helpers.dashboard_status_badge(self._application(status="submitted", detail="Paused by hiring team")),
            ("Submitted", "submitted"),
        )
        self.assertEqual(view_helpers.dashboard_status_badge(self._application(status="screening")), ("Needs review", "draft"))

    def test_text_labels_and_css_classes_are_stable_for_templates(self) -> None:
        # These helpers keep Jinja templates declarative: templates choose where
        # text goes, while Python decides how domain enum values become labels.
        self.assertEqual(view_helpers.status_sentence(""), "Needs review.")
        self.assertEqual(view_helpers.status_sentence("Already punctuated!"), "Already punctuated!")
        self.assertEqual(view_helpers.status_sentence("Submitted"), "Submitted.")
        self.assertEqual(view_helpers.verdict_class("UNFIT"), "bad")
        self.assertEqual(view_helpers.verdict_class("STRETCH"), "warn")
        self.assertEqual(view_helpers.verdict_class("FIT"), "")
        self.assertEqual(view_helpers.category_label("hard_requirement"), "Must-have")
        self.assertEqual(view_helpers.category_label("portfolio_signal"), "Portfolio Signal")
        self.assertEqual(view_helpers.fulfillment_label("partial"), "Partially met")
        self.assertEqual(view_helpers.fulfillment_label("not_applicable"), "Not Applicable")
        self.assertEqual(view_helpers.fulfillment_class("met"), "submitted")
        self.assertEqual(view_helpers.fulfillment_class("unmet"), "rejected")
        self.assertEqual(view_helpers.fulfillment_class("partial"), "draft")
        self.assertEqual(view_helpers.fulfillment_class("unknown"), "")

    def test_task_labels_eta_and_summary_helpers(self) -> None:
        # Task helpers are small, but they protect the task page from leaking raw
        # enum names or nullable ETA fields into user-facing copy.
        self.assertEqual(view_helpers.task_status_label("wont_do"), "Won't do")
        self.assertEqual(view_helpers.task_status_label("needs_review"), "Needs Review")
        self.assertEqual(view_helpers.task_status_class("completed"), "submitted")
        self.assertEqual(view_helpers.task_status_class("wont_do"), "closed")
        self.assertEqual(view_helpers.task_status_class("open"), "draft")
        self.assertEqual(view_helpers.task_eta_label(self._task(estimated_days=None, feasible=None)), "No ETA")
        self.assertEqual(view_helpers.task_eta_label(self._task(estimated_days=1, feasible=True)), "1 day")
        self.assertEqual(view_helpers.task_eta_label(self._task(estimated_days=3, feasible=True)), "3 days")
        self.assertEqual(view_helpers.task_eta_class(self._task(estimated_days=None, feasible=None)), "")
        self.assertEqual(view_helpers.task_eta_class(self._task(estimated_days=3, feasible=True)), "submitted")
        self.assertEqual(view_helpers.task_eta_class(self._task(estimated_days=9, feasible=False)), "rejected")
        self.assertEqual(
            view_helpers.job_summary({"id": "role", "kind": "url", "status": "draft", "secret": "ignored"}),
            {"id": "role", "kind": "url", "status": "draft"},
        )


if __name__ == "__main__":
    unittest.main()
