from __future__ import annotations

import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class TemplatePack:
    """Validated metadata for a CVAI PDF template pack.

    A template pack is intentionally just files on disk: a small manifest, a
    Typst entry point, supporting Typst files, and optional fonts. Keeping this
    simple makes external template repositories easy to audit and import.
    """

    template_id: str
    name: str
    version: str
    entrypoint: str


class TemplatePackError(ValueError):
    """Raised when a template pack cannot be safely imported."""


def list_template_packs(data_root: Path) -> list[TemplatePack]:
    """Return validated template packs installed in `CVAI_DATA`."""
    templates_root = data_root / "pdf" / "templates"
    if not templates_root.exists():
        return []
    packs = []
    for path in sorted(child for child in templates_root.iterdir() if child.is_dir()):
        try:
            packs.append(validate_template_pack(path))
        except TemplatePackError:
            continue
    return packs


def import_template_pack(source: Path, data_root: Path, *, replace: bool = False) -> Path:
    """Copy a validated template pack into `CVAI_DATA/pdf/templates/<template_id>`.

    The source may be a checked-out Git repository or any local directory. A
    future Git-backed command can clone first, then call this function with the
    temporary checkout path.
    """
    pack = validate_template_pack(source)
    templates_root = data_root / "pdf" / "templates"
    destination = templates_root / pack.template_id
    if destination.exists():
        if not replace:
            raise FileExistsError(f"Template {pack.template_id!r} already exists at {destination}")
        shutil.rmtree(destination)
    templates_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination, ignore=shutil.ignore_patterns(".git", "__pycache__"))
    return destination


def import_template_zip(source: Path, data_root: Path, *, replace: bool = False) -> Path:
    """Extract and import a local ZIP template pack into the data directory."""
    if not source.is_file():
        raise TemplatePackError(f"Template ZIP does not exist: {source}")
    unpack_root = data_root / "tmp" / "template-upload"
    if unpack_root.exists():
        shutil.rmtree(unpack_root)
    unpack_root.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(source) as archive:
            _extract_zip_safely(archive, unpack_root)
        source_dir = _find_template_root(unpack_root)
        return import_template_pack(source_dir, data_root, replace=replace)
    finally:
        shutil.rmtree(unpack_root, ignore_errors=True)


def remove_template_pack(data_root: Path, template_id: str) -> Path:
    """Remove an installed template pack by id."""
    if not _valid_template_id(template_id):
        raise TemplatePackError("template id must use lowercase letters, numbers, underscores, or hyphens")
    destination = data_root / "pdf" / "templates" / template_id
    if not destination.is_dir():
        raise FileNotFoundError(f"Unknown CV template: {template_id}")
    shutil.rmtree(destination)
    return destination


def validate_template_pack(source: Path) -> TemplatePack:
    """Read and validate the `template.yaml` manifest for a template pack."""
    source = source.resolve()
    if not source.is_dir():
        raise TemplatePackError(f"Template source is not a directory: {source}")

    manifest_path = source / "template.yaml"
    if not manifest_path.exists():
        raise TemplatePackError("Template pack is missing template.yaml")
    manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    if not isinstance(manifest, dict):
        raise TemplatePackError("template.yaml must contain a mapping")

    template_id = _required_string(manifest, "id")
    if not _valid_template_id(template_id):
        raise TemplatePackError("template id must use lowercase letters, numbers, underscores, or hyphens")
    name = _required_string(manifest, "name")
    version = str(manifest.get("version", "1"))
    entrypoint = _required_string(manifest, "entrypoint")
    if Path(entrypoint).name != entrypoint:
        raise TemplatePackError("entrypoint must be a file name inside the template root")
    if not (source / entrypoint).is_file():
        raise TemplatePackError(f"entrypoint does not exist: {entrypoint}")

    for index, font in enumerate(manifest.get("fonts", []) or []):
        if not isinstance(font, dict):
            raise TemplatePackError(f"fonts[{index}] must be a mapping")
        font_path = font.get("path")
        if font_path is not None:
            if not isinstance(font_path, str) or not font_path.strip():
                raise TemplatePackError(f"fonts[{index}].path must be a non-empty string")
            if not (source / font_path).exists():
                raise TemplatePackError(f"fonts[{index}].path does not exist: {font_path}")

    return TemplatePack(template_id=template_id, name=name, version=version, entrypoint=entrypoint)


def _required_string(mapping: dict[str, Any], field: str) -> str:
    value = mapping.get(field)
    if not isinstance(value, str) or not value.strip():
        raise TemplatePackError(f"template.yaml field {field!r} must be a non-empty string")
    return value.strip()


def _valid_template_id(value: str) -> bool:
    return bool(value) and all(char.isalnum() or char in {"_", "-"} for char in value) and value.lower() == value


def _extract_zip_safely(archive: zipfile.ZipFile, destination: Path) -> None:
    destination = destination.resolve()
    for member in archive.infolist():
        member_path = destination / member.filename
        resolved = member_path.resolve()
        if destination not in resolved.parents and resolved != destination:
            raise TemplatePackError("Template ZIP contains a path outside the extraction directory")
        archive.extract(member, destination)


def _find_template_root(unpack_root: Path) -> Path:
    if (unpack_root / "template.yaml").exists():
        return unpack_root
    candidates = [path for path in unpack_root.iterdir() if path.is_dir() and (path / "template.yaml").exists()]
    if len(candidates) == 1:
        return candidates[0]
    raise TemplatePackError("Template ZIP must contain exactly one template.yaml")
