import tempfile
import unittest
from pathlib import Path

from cvai_core.layouts import LayoutPackError, import_layout_pack, validate_layout_pack


class LayoutPackTests(unittest.TestCase):
    def test_valid_layout_pack_can_be_imported(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source-layout"
            data_root = root / "data"
            (source / "fonts" / "archivo").mkdir(parents=True)
            (source / "layout.yaml").write_text(
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

            pack = validate_layout_pack(source)
            destination = import_layout_pack(source, data_root)

            self.assertEqual(pack.layout_id, "compact")
            self.assertTrue((destination / "layout.yaml").exists())
            self.assertTrue((destination / "cv.typ").exists())

    def test_layout_pack_requires_existing_entrypoint(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)
            (source / "layout.yaml").write_text(
                """
id: broken
name: Broken
version: 1
entrypoint: missing.typ
""",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(LayoutPackError, "entrypoint does not exist"):
                validate_layout_pack(source)

    def test_layout_pack_requires_directory_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing"

            with self.assertRaisesRegex(LayoutPackError, "not a directory"):
                validate_layout_pack(missing)

    def test_layout_pack_requires_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)

            with self.assertRaisesRegex(LayoutPackError, "missing layout.yaml"):
                validate_layout_pack(source)

    def test_layout_pack_rejects_non_mapping_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)
            (source / "layout.yaml").write_text("- not\n- a\n- mapping\n", encoding="utf-8")

            with self.assertRaisesRegex(LayoutPackError, "must contain a mapping"):
                validate_layout_pack(source)

    def test_layout_pack_rejects_bad_id_and_nested_entrypoint(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)
            (source / "layout.yaml").write_text(
                """
id: Bad Layout
name: Bad
entrypoint: cv.typ
""",
                encoding="utf-8",
            )
            (source / "cv.typ").write_text("#set text()\n", encoding="utf-8")

            with self.assertRaisesRegex(LayoutPackError, "layout id"):
                validate_layout_pack(source)

            (source / "layout.yaml").write_text(
                """
id: bad
name: Bad
entrypoint: nested/cv.typ
""",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(LayoutPackError, "entrypoint must be a file name"):
                validate_layout_pack(source)

    def test_layout_pack_validates_declared_fonts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir)
            (source / "layout.yaml").write_text(
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

            with self.assertRaisesRegex(LayoutPackError, "fonts\\[0\\].path does not exist"):
                validate_layout_pack(source)

            (source / "layout.yaml").write_text(
                """
id: compact
name: Compact
entrypoint: cv.typ
fonts:
  - nope
""",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(LayoutPackError, "fonts\\[0\\] must be a mapping"):
                validate_layout_pack(source)

    def test_import_layout_pack_requires_replace_for_existing_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = self._layout_source(root / "source", body="first")
            data_root = root / "data"
            first_destination = import_layout_pack(source, data_root)
            (source / "cv.typ").write_text("second\n", encoding="utf-8")

            with self.assertRaisesRegex(FileExistsError, "already exists"):
                import_layout_pack(source, data_root)

            replaced_destination = import_layout_pack(source, data_root, replace=True)
            self.assertEqual(first_destination, replaced_destination)
            self.assertEqual((replaced_destination / "cv.typ").read_text(encoding="utf-8"), "second\n")

    def _layout_source(self, source: Path, *, body: str = "#set text()\n") -> Path:
        source.mkdir(parents=True)
        (source / "layout.yaml").write_text(
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
