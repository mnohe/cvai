from __future__ import annotations

import argparse
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PDFRenderer:
    # PDFRenderer knows how to call Typst, but it does not own layouts or fonts.
    # Layouts are data assets under CVAI_DATA/pdf/layouts/<layout>/, and each layout
    # keeps any fonts it needs under its own fonts/ directory.
    layouts_root: Path

    def font_paths(self, layout_dir: Path) -> list[Path]:
        """Return the font directories that belong to a layout.

        Layout packs keep fonts beside their Typst files so a layout can be
        copied or imported without relying on system fonts. Typst accepts one
        or more `--font-path` values, so we pass every first-level directory in
        `fonts/` (for example `fonts/archivo`). If a layout stores fonts
        directly in `fonts/`, we pass that directory instead.
        """
        fonts_dir = layout_dir / "fonts"
        if not fonts_dir.exists():
            return []
        child_dirs = sorted(path for path in fonts_dir.iterdir() if path.is_dir())
        return child_dirs or [fonts_dir]

    def build_cv(self, *, source: Path, output: Path, layout: str = "portrait") -> Path:
        """Compile a CV YAML file into a PDF using a data-owned Typst layout."""
        typst = shutil.which("typst")
        if typst is None:
            raise FileNotFoundError("cv/cv.pdf is missing and Typst is not installed in this runtime.")

        # Resolve paths before setting `cwd`; otherwise a relative
        # `--layouts-root` would be interpreted again from inside the layout
        # directory by the Typst subprocess.
        layout_dir = (self.layouts_root / layout).resolve()
        layout_file = layout_dir / "cv.typ"
        if not layout_file.exists():
            raise FileNotFoundError(f"Unknown CV layout: {layout}")
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
        for font_path in self.font_paths(layout_dir):
            command.extend(["--font-path", str(font_path)])
        command.extend(
            [
                "--input",
                f"cv={source.resolve()}",
                str(layout_file),
                str(output),
            ]
        )
        subprocess.run(
            command,
            cwd=layout_dir,
            check=True,
        )
        if not output.exists():
            raise FileNotFoundError(f"Typst completed but did not create {output}")
        return output


def default_layouts_root(source: Path) -> Path:
    """Infer CVAI_DATA/pdf/layouts from a normal CVAI_DATA/cv/cv.yaml path."""
    return source.resolve().parents[1] / "pdf" / "layouts"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a CV PDF with a CVAI Typst layout.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--layout", default="portrait")
    parser.add_argument("--layouts-root", type=Path)
    args = parser.parse_args(argv)
    output = PDFRenderer(args.layouts_root or default_layouts_root(args.source)).build_cv(
        source=args.source,
        output=args.output,
        layout=args.layout,
    )
    print(f"CV is available at {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
