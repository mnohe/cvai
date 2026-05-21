import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cvai_core.pdf import PDFRenderer, default_layouts_root, main


class PDFRendererTests(unittest.TestCase):
    def test_build_cv_invokes_typst_with_data_layout_and_fonts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "cv.yaml"
            output = root / "cv.pdf"
            layouts_root = root / "pdf" / "layouts"
            layout = layouts_root / "portrait"
            font_dir = layout / "fonts" / "archivo"
            layout.mkdir(parents=True)
            font_dir.mkdir(parents=True)
            source.write_text("name: Example\n", encoding="utf-8")
            (layout / "cv.typ").write_text("#set text(font: \"Archivo\")\n", encoding="utf-8")

            def fake_run(command, **kwargs):
                output.write_bytes(b"%PDF")
                return mock.Mock(returncode=0)

            with mock.patch("cvai_core.pdf.shutil.which", return_value="/usr/bin/typst"), mock.patch(
                "cvai_core.pdf.subprocess.run", side_effect=fake_run
            ) as run:
                result = PDFRenderer(layouts_root).build_cv(source=source, output=output)

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
                    PDFRenderer(root / "pdf" / "layouts").build_cv(source=source, output=root / "cv.pdf")

    def test_font_paths_accept_direct_fonts_and_missing_fonts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            layout = root / "pdf" / "layouts" / "portrait"
            fonts = layout / "fonts"
            renderer = PDFRenderer(root / "pdf" / "layouts")

            self.assertEqual(renderer.font_paths(layout), [])

            fonts.mkdir(parents=True)
            (fonts / "font.ttf").write_text("fake font\n", encoding="utf-8")

            self.assertEqual(renderer.font_paths(layout), [fonts])

    def test_build_cv_reports_missing_layout_source_and_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "cv" / "cv.yaml"
            output = root / "out" / "cv.pdf"
            layout = root / "pdf" / "layouts" / "portrait"
            layout.mkdir(parents=True)
            source.parent.mkdir()
            source.write_text("name: Example\n", encoding="utf-8")

            renderer = PDFRenderer(root / "pdf" / "layouts")

            with mock.patch("cvai_core.pdf.shutil.which", return_value="/usr/bin/typst"):
                with self.assertRaisesRegex(FileNotFoundError, "Unknown CV layout"):
                    renderer.build_cv(source=source, output=output, layout="missing")

                (layout / "cv.typ").write_text("#set text()\n", encoding="utf-8")
                with self.assertRaisesRegex(FileNotFoundError, "Missing CV source YAML"):
                    renderer.build_cv(source=root / "cv" / "missing.yaml", output=output)

                with mock.patch("cvai_core.pdf.subprocess.run", return_value=mock.Mock(returncode=0)):
                    with self.assertRaisesRegex(FileNotFoundError, "did not create"):
                        renderer.build_cv(source=source, output=output)

    def test_default_layout_root_and_cli_main_use_data_owned_layouts(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "data" / "cv" / "cv.yaml"
            output = root / "cv.pdf"
            source.parent.mkdir(parents=True)
            source.write_text("name: Example\n", encoding="utf-8")

            self.assertEqual(default_layouts_root(source), root / "data" / "pdf" / "layouts")

            buffer = io.StringIO()
            with mock.patch("cvai_core.pdf.PDFRenderer.build_cv", return_value=output) as build_cv:
                with contextlib.redirect_stdout(buffer):
                    exit_code = main([str(source), str(output), "--layout", "compact"])

        self.assertEqual(exit_code, 0)
        self.assertIn("CV is available", buffer.getvalue())
        self.assertEqual(build_cv.call_args.kwargs["source"], source)
        self.assertEqual(build_cv.call_args.kwargs["output"], output)
        self.assertEqual(build_cv.call_args.kwargs["layout"], "compact")


if __name__ == "__main__":
    unittest.main()
