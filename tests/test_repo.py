import unittest
from unittest import mock
from pathlib import Path
import sys
import tempfile
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cvai_core.repo import Repository, RoleRecord, slugify, status_sentence, verdict_label
from cvai_web.server import load_repo_env
from fixtures import create_sample_data_root


class RepoTests(unittest.TestCase):
    def data_root(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        return create_sample_data_root(Path(temp_dir.name))

    def test_slugify_basic(self) -> None:
        self.assertEqual(slugify("Software Engineer, Encryption"), "software_engineer_encryption")
        self.assertEqual(slugify("R&D / Platform"), "r_and_d_platform")

    def test_list_roles_loads_known_role(self) -> None:
        repo = Repository(self.data_root())
        roles = repo.list_roles()
        known = [role for role in roles if role.canonical_slug == "example_dublin_backend_engineer"]
        self.assertTrue(known)
        self.assertEqual(known[0].company, "Example")
        self.assertEqual(known[0].verdict, "FIT")

    def test_not_submitted_status_is_draft(self) -> None:
        app = RoleRecord(
            canonical_slug="example_dublin_role",
            company="Example",
            location="Dublin",
            role="Role",
            job_file="inputs/jobs/example/dublin/role.md",
            source_url="",
            captured_on="2026-05-16",
            verdict="FIT",
            verdict_label=verdict_label("FIT"),
            status="draft",
            status_date="",
            status_detail="",
            status_artifacts=[],
            rationale="",
            report_path=Path("tracking/suitability_reports/example_dublin_role.md"),
            output_dir=None,
            mirror_path=None,
            artifacts=[],
            decision_events=[],
        )

        self.assertEqual(app.status_key, "draft")

    def test_load_repo_env_sets_missing_values(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True):
            root = self.data_root()
            (root / ".env").write_text("LLM_API_KEY=test-key\n", encoding="utf-8")
            load_repo_env(root)

            self.assertIn("LLM_API_KEY", __import__("os").environ)

    def test_dashboard_roles_follow_backlog_order_and_count_tasks(self) -> None:
        repo = Repository(self.data_root())
        roles = repo.list_dashboard_roles()
        slugs = [role.role.canonical_slug for role in roles]

        self.assertLess(
            slugs.index("example_dublin_backend_engineer"),
            slugs.index("sample_remote_platform_engineer"),
        )
        network_role = [
            role
            for role in roles
            if role.role.canonical_slug == "sample_remote_platform_engineer"
        ][0]
        self.assertEqual(network_role.open_task_count, 1)

    def test_tasks_are_ordered_by_eta_and_status_updates_persist(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "tasks.yaml").write_text(
                """
tasks:
- id: task_long
  status: open
  kind: gap_evidence
  title: Long task
  estimated_days: 10
  feasible_within_one_week: false
  description: Long gap.
  acceptance_criteria:
  - Prove the long thing.
  evidence_refs: []
- id: task_short
  status: open
  kind: gap_evidence
  title: Short task
  estimated_days: 2
  feasible_within_one_week: true
  description: Short gap.
  acceptance_criteria:
  - Prove the short thing.
  evidence_refs: []
""",
                encoding="utf-8",
            )
            repo = Repository(root)

            tasks = repo.list_tasks()
            self.assertEqual([task.id for task in tasks], ["task_short", "task_long"])
            self.assertEqual(tasks[0].acceptance_criteria, ["Prove the short thing."])

            repo.update_task_status("task_short", "completed", "pp-demo")
            updated = repo.get_task("task_short")
            self.assertIsNotNone(updated)
            self.assertEqual(updated.status, "completed")
            self.assertEqual(updated.status_detail, "pp-demo")
            self.assertEqual(updated.evidence_refs, ["pp-demo"])

    def test_write_bundle_prefers_direct_structured_job_and_analysis(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            repo = Repository(root)
            generated = {
                "metadata": {
                    "company": "Example",
                    "role": "Backend Engineer",
                    "location": "Dublin",
                    "source_url": "https://example.test/job",
                    "captured_on": "2026-05-18",
                },
                "mirror_summary": {
                    "verdict": "FIT",
                    "bullets": ["Good Java/backend fit."],
                },
                "job": {
                    "version": 1,
                    "posting": {"raw_text": "Structured raw posting."},
                    "extracted": {
                        "responsibilities": ["Build backend services."],
                        "hard_requirements": ["Java"],
                        "soft_requirements": ["Go"],
                        "inferred_requirements": [],
                        "skills": ["Java", "Go"],
                        "interview_focus": ["Distributed systems"],
                    },
                    "requirements": [
                        {
                            "id": "req_001",
                            "text": "Java",
                            "category": "hard_requirement",
                            "fulfillment": "met",
                            "evidence": [{"text": "Java backend.", "refs": ["je-example"]}],
                            "gap": "",
                            "task_refs": ["task_go_coroutines"],
                        }
                    ],
                },
                "analysis": {
                    "version": 1,
                    "summary": {
                        "verdict": "FIT",
                        "verdict_label": "Good fit",
                        "recommendation": {"value": "APPLY_NOW", "reason": "Strong fit."},
                        "rationale": "Structured analysis rationale.",
                        "notes": [],
                    },
                    "requirements": [
                        {
                            "id": "req_001",
                            "text": "Java",
                            "category": "hard_requirement",
                            "fulfillment": "met",
                            "evidence": [{"text": "Java backend.", "refs": ["je-example"]}],
                            "gap": "",
                            "task_refs": ["task_go_coroutines"],
                        }
                    ],
                    "llm_context": {"responsibilities": ["Build backend services."]},
                },
                "suitability_report": "# Report\n\nThis fallback text should not be parsed.",
                "role_matrix": "# Matrix\n\nThis fallback text should not be parsed.",
                "interview_prep": {
                    "story_bank_md": "# Stories",
                    "system_design_bank_md": "# Systems",
                    "security_bank_md": "# Security",
                    "coding_plan_md": "# Coding",
                },
            }

            paths = repo.write_bundle(
                canonical_slug="example_dublin_backend_engineer",
                company_slug="example",
                location_slug="dublin",
                role_slug="backend_engineer",
                job_markdown="# Example job",
                generated=generated,
            )

            analysis = repo.load_data(paths["analysis"])
            job = repo.load_data(paths["job_data"])

        self.assertEqual(analysis["summary"]["rationale"], "Structured analysis rationale.")
        self.assertEqual(analysis["requirements"][0]["task_refs"], [])
        self.assertEqual(job["posting"]["raw_text"], "Structured raw posting.")
        self.assertEqual(job["source_url"], "https://example.test/job")
        self.assertEqual(job["requirements"][0]["task_refs"], [])

    def test_write_bundle_rejects_missing_structured_analysis(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo = Repository(Path(temp_dir))
            generated = {
                "metadata": {
                    "company": "Example",
                    "role": "Backend Engineer",
                    "location": "Dublin",
                    "source_url": "https://example.test/job",
                    "captured_on": "2026-05-18",
                },
                "mirror_summary": {"verdict": "FIT", "bullets": ["Good fit."]},
                "suitability_report": "# Report",
                "role_matrix": "# Matrix",
                "interview_prep": {
                    "story_bank_md": "# Stories",
                    "system_design_bank_md": "# Systems",
                    "security_bank_md": "# Security",
                    "coding_plan_md": "# Coding",
                },
            }

            with self.assertRaisesRegex(ValueError, "structured analysis"):
                repo.write_bundle(
                    canonical_slug="example_dublin_backend_engineer",
                    company_slug="example",
                    location_slug="dublin",
                    role_slug="backend_engineer",
                    job_markdown="# Example job",
                    generated=generated,
                )

    def test_write_reassessed_analysis_updates_structured_yaml_and_application(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "roles" / "example_role").mkdir(parents=True)
            (root / "roles.yaml").write_text(
                """
roles:
- id: example_role
  company: Example
  title: Backend Engineer
  location: Dublin
  source_url: https://example.test/job
  captured_on: '2026-05-18'
  active: true
""",
                encoding="utf-8",
            )
            (root / "role_states.yaml").write_text(
                """
role_states:
- role_id: example_role
  status: draft
  verdict: WEAK_FIT
  verdict_label: Weak fit
  rationale: Old rationale.
""",
                encoding="utf-8",
            )
            (root / "roles" / "example_role" / "role.yaml").write_text(
                """
id: example_role
company: Example
title: Backend Engineer
location: Dublin
""",
                encoding="utf-8",
            )
            (root / "roles" / "example_role" / "state.yaml").write_text(
                """
role_id: example_role
status: draft
verdict: WEAK_FIT
verdict_label: Weak fit
rationale: Old rationale.
""",
                encoding="utf-8",
            )
            repo = Repository(root)

            repo.write_reassessed_analysis(
                "example_role",
                {
                    "summary": {
                        "verdict": "FIT",
                        "verdict_label": "Good fit",
                        "rationale": "Updated structured rationale.",
                    },
                    "requirements": [
                        {
                            "id": "req_001",
                            "text": "Backend systems",
                            "category": "hard_requirement",
                            "fulfillment": "met",
                            "evidence": [{"text": "Backend work.", "refs": ["je-example"]}],
                            "gap": "",
                            "task_refs": ["task_backend"],
                        }
                    ],
                    "comments": [{"text": "Comment data may be reassessed by the LLM."}],
                },
            )

            analysis = repo.load_data("roles/example_role/analysis.yaml")
            state = repo.load_data("roles/example_role/state.yaml")
            global_state = repo.load_data("role_states.yaml")["role_states"][0]

        self.assertEqual(analysis["requirements"][0]["task_refs"], [])
        self.assertEqual(analysis["comments"][0]["text"], "Comment data may be reassessed by the LLM.")
        self.assertEqual(state["verdict"], "FIT")
        self.assertEqual(state["rationale"], "Updated structured rationale.")
        self.assertEqual(global_state["verdict_label"], "Good fit")

    def test_record_status_writes_uuid_event_without_duplicate_text(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            role_dir = root / "roles" / "example_role"
            role_dir.mkdir(parents=True)
            (root / "roles.yaml").write_text(
                """
roles:
- id: example_role
  company: Example
  title: Backend Engineer
  location: Dublin
  source_url: https://example.test/job
  captured_on: '2026-05-18'
  active: true
""",
                encoding="utf-8",
            )
            (root / "role_states.yaml").write_text(
                """
role_states:
- role_id: example_role
  status: draft
  status_date: null
  status_detail: ''
  status_artifacts: []
  verdict: FIT
  verdict_label: Good fit
  rationale: Good fit.
""",
                encoding="utf-8",
            )
            (root / "events.yaml").write_text("events: []\n", encoding="utf-8")
            (role_dir / "state.yaml").write_text(
                """
role_id: example_role
status: draft
status_date: null
status_detail: ''
status_artifacts: []
verdict: FIT
verdict_label: Good fit
rationale: Good fit.
""",
                encoding="utf-8",
            )
            (role_dir / "events.yaml").write_text("events: []\n", encoding="utf-8")
            repo = Repository(root)

            repo.record_status("example_role", "submitted", "2026-05-19", "with tailored CV", artifacts=["roles/example_role/artifacts/cv.pdf"])

            state = repo.load_data("role_states.yaml")["role_states"][0]
            event = repo.load_data("events.yaml")["events"][0]
            role_event = repo.load_data("roles/example_role/events.yaml")["events"][0]

        self.assertEqual(state["status"], "submitted")
        self.assertTrue(event["id"].startswith("event-"))
        UUID(event["id"].removeprefix("event-"))
        self.assertNotIn("text", event)
        self.assertEqual(event["detail"], "Example `Backend Engineer` role was submitted.")
        self.assertEqual(role_event["id"], event["id"])

    def test_interview_status_sentence_prefers_detail(self) -> None:
        self.assertEqual(
            status_sentence(
                "interviewing",
                "2026-05-21",
                "Next interview with an engineer scheduled for Tue Jun 2, 2026, 11:30 AM-12:30 PM GMT+2",
                ["roles/example_role/artifacts/interview_prep/notes.md"],
            ),
            "Next interview with an engineer scheduled for Tue Jun 2, 2026, 11:30 AM-12:30 PM GMT+2",
        )

    def test_append_analysis_notes_adds_unique_normalized_notes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            role_dir = root / "roles" / "example_role"
            role_dir.mkdir(parents=True)
            (root / "roles.yaml").write_text(
                """
roles:
- id: example_role
  company: Example
  title: Backend Engineer
  location: Dublin
  source_url: https://example.test/job
  captured_on: '2026-05-18'
  active: true
""",
                encoding="utf-8",
            )
            (root / "role_states.yaml").write_text(
                """
role_states:
- role_id: example_role
  status: interviewing
  status_date: '2026-05-21'
  status_detail: ''
  status_artifacts: []
  verdict: FIT
  verdict_label: Good fit
  rationale: Good fit.
""",
                encoding="utf-8",
            )
            (role_dir / "state.yaml").write_text(
                """
role_id: example_role
status: interviewing
status_date: '2026-05-21'
status_detail: ''
status_artifacts: []
verdict: FIT
verdict_label: Good fit
rationale: Good fit.
""",
                encoding="utf-8",
            )
            (role_dir / "analysis.yaml").write_text(
                """
version: 1
role_id: example_role
summary:
  notes:
  - Existing note.
requirements:
- id: req_001
  text: Java
""",
                encoding="utf-8",
            )
            repo = Repository(root)

            repo.append_analysis_notes("example_role", ["New   note.", "Existing note.", ""])

            notes = repo.load_data("roles/example_role/analysis.yaml")["summary"]["notes"]

        self.assertEqual(notes, ["Existing note.", "New note."])


if __name__ == "__main__":
    unittest.main()
