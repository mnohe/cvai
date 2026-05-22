import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from cvai_web.__main__ import main


class CLITests(unittest.TestCase):
    def run_cli(self, *args: str) -> tuple[int, str]:
        # The CLI reads process arguments and writes human output, so the tests
        # isolate both pieces instead of spawning a second Python process.
        output = io.StringIO()
        with mock.patch.object(sys, "argv", ["cvai", *args]), contextlib.redirect_stdout(output):
            exit_code = main()
        return exit_code, output.getvalue()

    def test_init_and_validate_commands_manage_a_data_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_root = Path(temp_dir) / "data"

            init_code, init_output = self.run_cli("init", str(data_root))
            validate_code, validate_output = self.run_cli("validate", str(data_root))

        self.assertEqual(init_code, 0)
        self.assertIn("initialized", init_output)
        self.assertEqual(validate_code, 0)
        self.assertIn("schema validation passed", validate_output)

    def test_validate_returns_nonzero_for_invalid_data(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_root = Path(temp_dir) / "data"
            self.run_cli("init", str(data_root))
            (data_root / "roles.yaml").write_text("roles: not-a-list\n", encoding="utf-8")

            exit_code, output = self.run_cli("validate", str(data_root))

        self.assertEqual(exit_code, 1)
        self.assertIn("roles.yaml", output)

    def test_template_import_command_copies_a_template_pack(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            data_root = root / "data"
            source = root / "template"
            source.mkdir()
            (source / "template.yaml").write_text(
                """
id: compact
name: Compact
entrypoint: cv.typ
""",
                encoding="utf-8",
            )
            (source / "cv.typ").write_text("#set text()\n", encoding="utf-8")
            self.run_cli("init", str(data_root))

            exit_code, output = self.run_cli("templates", "import", str(source), str(data_root))

        self.assertEqual(exit_code, 0)
        self.assertIn("Imported template", output)

    def test_templates_command_requires_a_subcommand(self) -> None:
        # argparse reports usage errors by raising SystemExit, which is exactly
        # what a shell user would see as a non-zero process exit.
        with mock.patch.object(sys, "argv", ["cvai", "templates"]), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                main()

        self.assertEqual(error.exception.code, 2)

    def test_default_command_starts_the_web_server(self) -> None:
        # Running `cvai` without a subcommand is the container entry path; patch
        # the server main so the test covers dispatch without opening a socket.
        with mock.patch.object(sys, "argv", ["cvai"]), mock.patch("cvai_web.asgi.main") as asgi_main:
            exit_code = main()

        self.assertEqual(exit_code, 0)
        asgi_main.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
