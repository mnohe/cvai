import tempfile
import unittest
from pathlib import Path

from cvai_core.cv import load_cv, parse_section_payload, save_cv_form, update_cv_section, validate_cv
from cvai_core.yaml_format import dump_yaml


def valid_cv() -> dict:
    # The test CV is intentionally tiny but exercises every required top-level
    # section in the public CVAI CV schema.
    return {
        "summary": "Backend engineer.",
        "contact": {
            "name": "Ada",
            "surname": "Lovelace",
            "phone": {"prefix": "+44", "number": "123456"},
            "email": "ada@example.test",
            "linkedin": "ada",
        },
        "languages": [{"name": "English", "level": "Native"}],
        "certifications": [],
        "education": [{"name": "Maths", "issuer": "Example University", "year": 1843}],
        "experience": [
            {
                "company": "Analytical Engines",
                "positions": [
                    {
                        "roles": ["Programmer"],
                        "start": "1842",
                        "location": "London",
                        "tasks": ["Designed an algorithm."],
                    }
                ],
            }
        ],
        "projects": {
            "url": "https://example.test",
            "items": [
                {
                    "name": "Notes",
                    "summary": "Published notes.",
                    "url": "https://example.test/notes",
                    "description": "Explained computation.",
                }
            ],
        },
    }


class CVDocumentTests(unittest.TestCase):
    def write_cv(self, root: Path, payload: dict) -> Path:
        path = root / "cv" / "cv.yaml"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(dump_yaml(payload), encoding="utf-8")
        return path

    def test_load_cv_reports_missing_empty_and_malformed_documents(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            missing = load_cv(root)
            self.assertTrue(missing.is_empty)
            self.assertFalse(missing.valid)

            path = root / "cv" / "cv.yaml"
            path.parent.mkdir(parents=True)
            path.write_text("summary: [unterminated\n", encoding="utf-8")
            malformed = load_cv(root)

        self.assertFalse(malformed.valid)
        self.assertIn("invalid YAML", malformed.issues[0].message)

    def test_validate_cv_reports_field_level_errors(self) -> None:
        payload = valid_cv()
        payload["languages"] = []
        payload["experience"][0]["positions"][0]["tasks"] = [""]

        issues = validate_cv(payload)

        self.assertIn("languages", {issue.path for issue in issues})
        self.assertIn("experience[0].positions[0].tasks[0]", {issue.path for issue in issues})

    def test_parse_and_update_section_validate_before_writing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cv_path = self.write_cv(root, valid_cv())
            (root / "cv" / "cv.pdf").write_bytes(b"%PDF")
            (root / "cv" / "alovelace-demo.pdf").write_bytes(b"%PDF")

            bad_section = parse_section_payload("not_a_section", "value")
            issues = update_cv_section(root, "languages", "[]")
            before = cv_path.read_text(encoding="utf-8")
            success = update_cv_section(root, "summary", "Updated summary.")

            updated = load_cv(root)
            pdf_exists = (root / "cv" / "cv.pdf").exists()
            template_pdf_exists = (root / "cv" / "alovelace-demo.pdf").exists()

        self.assertIn("not a known", bad_section[1][0].message)
        self.assertTrue(any(issue.path == "languages" for issue in issues))
        self.assertIn("Backend engineer.", before)
        self.assertEqual(success, [])
        self.assertEqual(updated.data["summary"], "Updated summary.")
        self.assertFalse(pdf_exists)
        self.assertFalse(template_pdf_exists)

    def test_save_cv_form_builds_nested_cv_without_exposing_yaml(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            self.write_cv(root, valid_cv())

            issues = save_cv_form(
                root,
                {
                    "summary": "Structured form summary.",
                    "contact.name": "Ada",
                    "contact.surname": "Lovelace",
                    "contact.phone.prefix": "+44",
                    "contact.phone.number": "123456",
                    "contact.email": "ada@example.test",
                    "contact.linkedin": "ada",
                    "languages.0.name": "English",
                    "languages.0.level": "Native",
                    "education.0.name": "Maths",
                    "education.0.issuer": "Example University",
                    "education.0.year": "1843",
                    "experience.0.company": "Analytical Engines",
                    "experience.0.positions.0.roles.0": "Programmer",
                    "experience.0.positions.0.start": "1842",
                    "experience.0.positions.0.location": "London",
                    "experience.0.positions.0.tasks.0": "Designed an algorithm.",
                    "projects.url": "https://example.test",
                    "projects.items.0.name": "Notes",
                    "projects.items.0.summary": "Published notes.",
                    "projects.items.0.url": "https://example.test/notes",
                    "projects.items.0.description": "Explained computation.",
                },
            )
            updated = load_cv(root)

        self.assertEqual(issues, [])
        self.assertEqual(updated.data["summary"], "Structured form summary.")
        self.assertEqual(updated.data["experience"][0]["positions"][0]["roles"], ["Programmer"])


if __name__ == "__main__":
    unittest.main()
