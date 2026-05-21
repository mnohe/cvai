from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class LayoutPack:
    """Validated metadata for a CVAI PDF layout pack.

    A layout pack is intentionally just files on disk: a small manifest, a
    Typst entry point, supporting Typst files, and optional fonts. Keeping this
    simple makes external layout repositories easy to audit and import.
    """

    layout_id: str
    name: str
    version: str
    entrypoint: str


class LayoutPackError(ValueError):
    """Raised when a layout pack cannot be safely imported."""


def import_layout_pack(source: Path, data_root: Path, *, replace: bool = False) -> Path:
    """Copy a validated layout pack into `CVAI_DATA/pdf/layouts/<layout_id>`.

    The source may be a checked-out Git repository or any local directory. A
    future Git-backed command can clone first, then call this function with the
    temporary checkout path.
    """
    pack = validate_layout_pack(source)
    layouts_root = data_root / "pdf" / "layouts"
    destination = layouts_root / pack.layout_id
    if destination.exists():
        if not replace:
            raise FileExistsError(f"Layout {pack.layout_id!r} already exists at {destination}")
        shutil.rmtree(destination)
    layouts_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns(".git", "__pycache__"))
    return destination


def validate_layout_pack(source: Path) -> LayoutPack:
    """Read and validate the `layout.yaml` manifest for a layout pack."""
    source = source.resolve()
    if not source.is_dir():
        raise LayoutPackError(f"Layout source is not a directory: {source}")

    manifest_path = source / "layout.yaml"
    if not manifest_path.exists():
        raise LayoutPackError("Layout pack is missing layout.yaml")
    manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    if not isinstance(manifest, dict):
        raise LayoutPackError("layout.yaml must contain a mapping")

    layout_id = _required_string(manifest, "id")
    if not _valid_layout_id(layout_id):
        raise LayoutPackError("layout id must use lowercase letters, numbers, underscores, or hyphens")
    name = _required_string(manifest, "name")
    version = str(manifest.get("version", "1"))
    entrypoint = _required_string(manifest, "entrypoint")
    if Path(entrypoint).name != entrypoint:
        raise LayoutPackError("entrypoint must be a file name inside the layout root")
    if not (source / entrypoint).is_file():
        raise LayoutPackError(f"entrypoint does not exist: {entrypoint}")

    for index, font in enumerate(manifest.get("fonts", []) or []):
        if not isinstance(font, dict):
            raise LayoutPackError(f"fonts[{index}] must be a mapping")
        font_path = font.get("path")
        if font_path is not None:
            if not isinstance(font_path, str) or not font_path.strip():
                raise LayoutPackError(f"fonts[{index}].path must be a non-empty string")
            if not (source / font_path).exists():
                raise LayoutPackError(f"fonts[{index}].path does not exist: {font_path}")

    return LayoutPack(layout_id=layout_id, name=name, version=version, entrypoint=entrypoint)


def _required_string(mapping: dict[str, Any], field: str) -> str:
    value = mapping.get(field)
    if not isinstance(value, str) or not value.strip():
        raise LayoutPackError(f"layout.yaml field {field!r} must be a non-empty string")
    return value.strip()


def _valid_layout_id(value: str) -> bool:
    return bool(value) and all(char.isalnum() or char in {"_", "-"} for char in value) and value.lower() == value
