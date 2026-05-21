import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cvai_core.structure import build_context_data, build_job_data, build_library_data


class StructureTests(unittest.TestCase):
    def test_build_job_data_projects_requirements_and_context(self) -> None:
        payload = build_job_data(
            role={
                "id": "example_role",
                "company": "Example",
                "title": "Backend Engineer",
                "location": "Dublin",
                "source_url": "https://example.test/job",
                "captured_on": "2026-05-18",
                "priority_rank": 1,
                "active": True,
            },
            job_text="Raw posting text",
            analysis={
                "llm_context": {
                    "responsibilities": ["Build backend services."],
                    "must_haves": ["Java"],
                    "nice_to_haves": ["Go"],
                    "interview_focus": ["Distributed systems"],
                },
                "requirements": [
                    {
                        "id": "req_001",
                        "text": "Java",
                        "category": "hard_requirement",
                        "fulfillment": "met",
                        "evidence": [{"text": "Java backend", "refs": ["je-example"]}],
                        "gap": "",
                        "task_refs": [],
                    }
                ],
            },
        )

        self.assertEqual(payload["role_id"], "example_role")
        self.assertEqual(payload["posting"]["raw_text"], "Raw posting text")
        self.assertEqual(payload["extracted"]["responsibilities"], ["Build backend services."])
        self.assertEqual(payload["requirements"][0]["text"], "Java")

    def test_context_and_library_markdown_tables_are_structured(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "context").mkdir()
            (root / "library").mkdir()
            (root / "context" / "constraints.md").write_text("# Constraints\n\n- Notice period: 1 month\n", encoding="utf-8")
            (root / "context" / "preferences.md").write_text("# Preferences\n\n- Preferred tone: Direct\n", encoding="utf-8")
            (root / "context" / "metrics.md").write_text(
                """
| Metric | Value | Context | Source | Status |
|---|---|---|---|---|
| Production clusters supported | 100+ | Platform work | `cv/cv.yaml` | SAFE |
""",
                encoding="utf-8",
            )
            (root / "context" / "portfolio_inventory.md").write_text(
                """
Canonical public surfaces:
- Project index: https://example.test/projects

| Project | Public Link | What It Proves | Relevance | Notes |
|---|---|---|---|---|
| `demo` | https://example.test/demo | Backend proof | Useful | Note |
""",
                encoding="utf-8",
            )
            (root / "library" / "skills_map.md").write_text(
                """
| Skill Keyword | Evidence Pointer | Proof Strength | Notes |
|---|---|---|---|
| Java backend | Example role | High | Safe |
""",
                encoding="utf-8",
            )
            (root / "library" / "story_snippets.md").write_text(
                """
| Situation | Task | Action | Result | Evidence Ref |
|---|---|---|---|---|
| Problem | Fix it | Did work | Result | `cv/cv.yaml` |
""",
                encoding="utf-8",
            )
            (root / "library" / "cover_letter_blocks.md").write_text(
                "## Fit Blocks\n\n- Calm senior backend framing.\n",
                encoding="utf-8",
            )

            context = build_context_data(root)
            library = build_library_data(root)

        self.assertEqual(context["constraints"]["notice_period"], "1 month")
        self.assertEqual(context["metrics"][0]["source"], "cv/cv.yaml")
        self.assertEqual(context["portfolio"]["projects"][0]["id"], "demo")
        self.assertEqual(library["skills"][0]["id"], "java_backend")
        self.assertEqual(library["cover_letter_blocks"]["fit_blocks"], ["Calm senior backend framing."])


if __name__ == "__main__":
    unittest.main()
