import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cvai_core.pdf import PDFRenderer, default_templates_root, main


class PDFRendererTests(unittest.TestCase):
    def test_build_cv_invokes_typst_with_data_template_and_fonts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "cv.yaml"
            output = root / "cv.pdf"
            templates_root = root / "pdf" / "templates"
            template_dir = templates_root / "portrait"
            font_dir = template_dir / "fonts" / "archivo"
            template_dir.mkdir(parents=True)
            font_dir.mkdir(parents=True)
            source.write_text("name: Example\n", encoding="utf-8")
            (template_dir / "cv.typ").write_text("#set text(font: \"Archivo\")\n", encoding="utf-8")

            def fake_run(command, **kwargs):
                output.write_bytes(b"%PDF")
                return mock.Mock(returncode=0)

            with mock.patch("cvai_core.pdf.shutil.which", return_value="/usr/bin/typst"), mock.patch(
                "cvai_core.pdf.subprocess.run", side_effect=fake_run
            ) as run:
                result = PDFRenderer(templates_root).build_cv(source=source, output=output)

        self.assertEqual(result, output)
        command = run.call_args.args[0]
        self.assertEqual(command[:4], ["/usr/bin/typst", "compile", "--root", "/"])
        self.assertIn(f"cv={source.resolve()}", command)
        self.assertIn(str(font_dir), command)

    def test_build_cv_reports_missing_typst(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "cv.yaml"
            source.write_text("name: Example\n", encoding="utf-8")

            with mock.patch("cvai_core.pdf.shutil.which", return_value=None):
                with self.assertRaisesRegex(FileNotFoundError, "Typst is not installed"):
                    PDFRenderer(root / "pdf" / "templates").build_cv(source=source, output=root / "cv.pdf")

    def test_font_paths_accept_direct_fonts_and_missing_fonts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            template_dir = root / "pdf" / "templates" / "portrait"
            fonts = template_dir / "fonts"
            renderer = PDFRenderer(root / "pdf" / "templates")

            self.assertEqual(renderer.font_paths(template_dir), [])

            fonts.mkdir(parents=True)
            (fonts / "font.ttf").write_text("fake font\n", encoding="utf-8")

            self.assertEqual(renderer.font_paths(template_dir), [fonts])

    def test_build_cv_reports_missing_template_source_and_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "cv" / "cv.yaml"
            output = root / "out" / "cv.pdf"
            template_dir = root / "pdf" / "templates" / "portrait"
            template_dir.mkdir(parents=True)
            source.parent.mkdir()
            source.write_text("name: Example\n", encoding="utf-8")

            renderer = PDFRenderer(root / "pdf" / "templates")

            with mock.patch("cvai_core.pdf.shutil.which", return_value="/usr/bin/typst"):
                with self.assertRaisesRegex(FileNotFoundError, "Unknown CV template"):
                    renderer.build_cv(source=source, output=output, template="missing")

                (template_dir / "cv.typ").write_text("#set text()\n", encoding="utf-8")
                with self.assertRaisesRegex(FileNotFoundError, "Missing CV source YAML"):
                    renderer.build_cv(source=root / "cv" / "missing.yaml", output=output)

                with mock.patch("cvai_core.pdf.subprocess.run", return_value=mock.Mock(returncode=0)):
                    with self.assertRaisesRegex(FileNotFoundError, "did not create"):
                        renderer.build_cv(source=source, output=output)

    def test_default_templates_root_and_cli_main_use_data_owned_templates(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "data" / "cv" / "cv.yaml"
            output = root / "cv.pdf"
            source.parent.mkdir(parents=True)
            source.write_text("name: Example\n", encoding="utf-8")

            self.assertEqual(default_templates_root(source), root / "data" / "pdf" / "templates")

            buffer = io.StringIO()
            with mock.patch("cvai_core.pdf.PDFRenderer.build_cv", return_value=output) as build_cv:
                with contextlib.redirect_stdout(buffer):
                    exit_code = main([str(source), str(output), "--template", "compact"])

        self.assertEqual(exit_code, 0)
        self.assertIn("CV is available", buffer.getvalue())
        self.assertEqual(build_cv.call_args.kwargs["source"], source)
        self.assertEqual(build_cv.call_args.kwargs["output"], output)
        self.assertEqual(build_cv.call_args.kwargs["template"], "compact")


if __name__ == "__main__":
    unittest.main()
