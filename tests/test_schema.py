import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cvai_core.schema import SchemaValidationError, assert_valid_data_root, initialize_data_root, validate_data_root
from fixtures import create_sample_data_root


class SchemaValidationTests(unittest.TestCase):
    def data_root(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        return create_sample_data_root(Path(temp_dir.name))

    def test_repository_data_matches_stable_schema(self) -> None:
        self.assertEqual(validate_data_root(self.data_root()), [])

    def test_invalid_task_reference_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self._write_minimal_valid_data(root)
            analysis_path = root / "roles" / "example_role" / "analysis.yaml"
            analysis_path.write_text(
                analysis_path.read_text(encoding="utf-8").replace("task_refs: []", "task_refs:\n  - missing_task", 1),
                encoding="utf-8",
            )

            issues = validate_data_root(root)

        self.assertTrue(any("unknown task id 'missing_task'" in str(issue) for issue in issues))

    def test_events_require_uuid_id_and_single_detail_field(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self._write_minimal_valid_data(root)
            (root / "events.yaml").write_text(
                """
events:
- id: evt_0001
  role_id: example_role
  type: submitted
  date: '2026-05-19'
  detail: Submitted.
  text: Submitted.
  artifacts: []
""",
                encoding="utf-8",
            )

            issues = validate_data_root(root)

        rendered = "\n".join(str(issue) for issue in issues)
        self.assertIn("must start with 'event-'", rendered)
        self.assertIn("has been replaced by detail", rendered)

    def test_initialize_data_root_creates_empty_valid_database(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "private-data"

            created = initialize_data_root(root)

            self.assertTrue(created)
            self.assertTrue((root / "roles.yaml").exists())
            self.assertFalse((root / "cv" / "cv-schema.json").exists())
            self.assertTrue((root / "roles").is_dir())
            self.assertEqual(validate_data_root(root), [])

    def test_assert_valid_data_root_raises_readable_error(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "roles.yaml").write_text("roles: bad\n", encoding="utf-8")

            with self.assertRaises(SchemaValidationError) as raised:
                assert_valid_data_root(root)

        self.assertIn("roles.yaml.roles", str(raised.exception))

    def _write_minimal_valid_data(self, root: Path) -> None:
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
  captured_on: '2026-05-19'
  priority_rank: 1
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
        (root / "tasks.yaml").write_text(
            """
tasks: []
""",
            encoding="utf-8",
        )
        (root / "events.yaml").write_text(
            """
events: []
""",
            encoding="utf-8",
        )
        (role_dir / "role.yaml").write_text(
            """
id: example_role
company: Example
title: Backend Engineer
location: Dublin
source_url: https://example.test/job
captured_on: '2026-05-19'
priority_rank: 1
active: true
""",
            encoding="utf-8",
        )
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
        (role_dir / "job.yaml").write_text(
            """
version: 1
role_id: example_role
company: Example
title: Backend Engineer
location: Dublin
source_url: https://example.test/job
captured_on: '2026-05-19'
posting:
  raw_text: Example posting.
  date_posted: ''
  employment_type: ''
  location_mode: unknown
  posting_id: ''
extracted:
  responsibilities: []
  hard_requirements: []
  soft_requirements: []
  inferred_requirements: []
  skills: []
  interview_focus: []
requirements:
- id: req_001
  text: Backend systems
  category: hard_requirement
  fulfillment: met
  evidence: []
  gap: ''
  task_refs: []
""",
            encoding="utf-8",
        )
        (role_dir / "analysis.yaml").write_text(
            """
version: 1
role_id: example_role
summary:
  verdict: FIT
  verdict_label: Good fit
  recommendation:
    value: APPLY_NOW
    reason: Good fit.
  rationale: Good fit.
  notes: []
requirements:
- id: req_001
  text: Backend systems
  category: hard_requirement
  fulfillment: met
  evidence: []
  gap: ''
  task_refs: []
strengths: []
gaps: []
work_items: []
timeline: []
gap_tasks: {}
comments: []
llm_context: {}
""",
            encoding="utf-8",
        )
        (role_dir / "artifacts.yaml").write_text("artifacts: []\n", encoding="utf-8")
        (role_dir / "tasks.yaml").write_text("tasks: []\n", encoding="utf-8")
        (role_dir / "events.yaml").write_text("events: []\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
