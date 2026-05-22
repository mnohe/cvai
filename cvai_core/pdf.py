from __future__ import annotations

import argparse
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PDFRenderer:
    # PDFRenderer knows how to call Typst, but it does not own templates or fonts.
    # Templates are data assets under CVAI_DATA/pdf/templates/<template>/, and each
    # template keeps any fonts it needs under its own fonts/ directory.
    templates_root: Path

    def font_paths(self, template_dir: Path) -> list[Path]:
        """Return the font directories that belong to a template.

        Template packs keep fonts beside their Typst files so a template can be
        copied or imported without relying on system fonts. Typst accepts one
        or more `--font-path` values, so we pass every first-level directory in
        `fonts/` (for example `fonts/archivo`). If a template stores fonts
        directly in `fonts/`, we pass that directory instead.
        """
        fonts_dir = template_dir / "fonts"
        if not fonts_dir.exists():
            return []
        child_dirs = sorted(path for path in fonts_dir.iterdir() if path.is_dir())
        return child_dirs or [fonts_dir]

    def build_cv(self, *, source: Path, output: Path, template: str = "demo") -> Path:
        """Compile a CV YAML file into a PDF using a data-owned Typst template."""
        typst = shutil.which("typst")
        if typst is None:
            raise FileNotFoundError("cv/cv.pdf is missing and Typst is not installed in this runtime.")

        # Resolve paths before setting `cwd`; otherwise a relative
        # `--templates-root` would be interpreted again from inside the template
        # directory by the Typst subprocess.
        template_dir = (self.templates_root / template).resolve()
        template_file = template_dir / "cv.typ"
        if not template_file.exists():
            raise FileNotFoundError(f"Unknown CV template: {template}")
        source = source.resolve()
        if not source.exists():
            raise FileNotFoundError(f"Missing CV source YAML: {source}")
        output = output.resolve()

        output.parent.mkdir(parents=True, exist_ok=True)
        command = [
            typst,
            "compile",
            "--root",
            "/",
        ]
        for font_path in self.font_paths(template_dir):
            command.extend(["--font-path", str(font_path)])
        command.extend(
            [
                "--input",
                f"cv={source.resolve()}",
                str(template_file),
                str(output),
            ]
        )
        subprocess.run(
            command,
            cwd=template_dir,
            check=True,
        )
        if not output.exists():
            raise FileNotFoundError(f"Typst completed but did not create {output}")
        return output


def default_templates_root(source: Path) -> Path:
    """Infer CVAI_DATA/pdf/templates from a normal CVAI_DATA/cv/cv.yaml path."""
    return source.resolve().parents[1] / "pdf" / "templates"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a CV PDF with a CVAI Typst template.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--template", default="demo")
    parser.add_argument("--templates-root", type=Path)
    args = parser.parse_args(argv)
    output = PDFRenderer(args.templates_root or default_templates_root(args.source)).build_cv(
        source=args.source,
        output=args.output,
        template=args.template,
    )
    print(f"CV is available at {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
