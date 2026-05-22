import tempfile
import unittest
from pathlib import Path

from cvai_core.templates import TemplatePackError, import_template_pack, validate_template_pack


class TemplatePackTests(unittest.TestCase):
    def test_valid_template_pack_can_be_imported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source-template"
            data_root = root / "data"
            (source / "fonts" / "archivo").mkdir(parents=True)
            (source / "template.yaml").write_text(
                """
id: compact
name: Compact
version: 1
entrypoint: cv.typ
fonts:
  - family: Archivo
    path: fonts/archivo
""",
                encoding="utf-8",
            )
            (source / "cv.typ").write_text("#set text(font: \"Archivo\")\n", encoding="utf-8")

            pack = validate_template_pack(source)
            destination = import_template_pack(source, data_root)

            self.assertEqual(pack.template_id, "compact")
            self.assertTrue((destination / "template.yaml").exists())
            self.assertTrue((destination / "cv.typ").exists())

    def test_template_pack_requires_existing_entrypoint(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)
            (source / "template.yaml").write_text(
                """
id: broken
name: Broken
version: 1
entrypoint: missing.typ
""",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(TemplatePackError, "entrypoint does not exist"):
                validate_template_pack(source)

    def test_template_pack_requires_directory_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing"

            with self.assertRaisesRegex(TemplatePackError, "not a directory"):
                validate_template_pack(missing)

    def test_template_pack_requires_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)

            with self.assertRaisesRegex(TemplatePackError, "missing template.yaml"):
                validate_template_pack(source)

    def test_template_pack_rejects_non_mapping_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)
            (source / "template.yaml").write_text("- not\n- a\n- mapping\n", encoding="utf-8")

            with self.assertRaisesRegex(TemplatePackError, "must contain a mapping"):
                validate_template_pack(source)

    def test_template_pack_rejects_bad_id_and_nested_entrypoint(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)
            (source / "template.yaml").write_text(
                """
id: Bad Template
name: Bad
entrypoint: cv.typ
""",
                encoding="utf-8",
            )
            (source / "cv.typ").write_text("#set text()\n", encoding="utf-8")

            with self.assertRaisesRegex(TemplatePackError, "template id"):
                validate_template_pack(source)

            (source / "template.yaml").write_text(
                """
id: bad
name: Bad
entrypoint: nested/cv.typ
""",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(TemplatePackError, "entrypoint must be a file name"):
                validate_template_pack(source)

    def test_template_pack_validates_declared_fonts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)
            (source / "template.yaml").write_text(
                """
id: compact
name: Compact
entrypoint: cv.typ
fonts:
  - family: Archivo
    path: missing-fonts
""",
                encoding="utf-8",
            )
            (source / "cv.typ").write_text("#set text()\n", encoding="utf-8")

            with self.assertRaisesRegex(TemplatePackError, "fonts\\[0\\].path does not exist"):
                validate_template_pack(source)

            (source / "template.yaml").write_text(
                """
id: compact
name: Compact
entrypoint: cv.typ
fonts:
  - nope
""",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(TemplatePackError, "fonts\\[0\\] must be a mapping"):
                validate_template_pack(source)

    def test_import_template_pack_requires_replace_for_existing_template(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = self._template_source(root / "source", body="first")
            data_root = root / "data"
            first_destination = import_template_pack(source, data_root)
            (source / "cv.typ").write_text("second\n", encoding="utf-8")

            with self.assertRaisesRegex(FileExistsError, "already exists"):
                import_template_pack(source, data_root)

            replaced_destination = import_template_pack(source, data_root, replace=True)
            self.assertEqual(first_destination, replaced_destination)
            self.assertEqual((replaced_destination / "cv.typ").read_text(encoding="utf-8"), "second\n")

    def _template_source(self, source: Path, *, body: str = "#set text()\n") -> Path:
        source.mkdir(parents=True)
        (source / "template.yaml").write_text(
            """
id: compact
name: Compact
version: 1
entrypoint: cv.typ
""",
            encoding="utf-8",
        )
        (source / "cv.typ").write_text(body, encoding="utf-8")
        return source


if __name__ == "__main__":
    unittest.main()
