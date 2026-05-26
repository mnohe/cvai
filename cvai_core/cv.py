from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .yaml_format import dump_yaml


# These are the first-class sections in CVAI's public CV schema. The web editor
# renders them as structured controls instead of exposing YAML blocks.
CV_SECTIONS = ("summary", "contact", "languages", "certifications", "education", "experience", "projects")
CV_LIST_SECTIONS = ("languages", "certifications", "education", "experience", "projects")
CV_MANUALLY_ORDERED_SECTIONS = ("languages", "projects")
CV_SOURCE = "cv/cv.yaml"
CV_PDF = "cv/cv.pdf"


@dataclass(frozen=True)
class CVIssue:
    # CVIssue mirrors the database validator's issue style, but stays focused on
    # one CV document. The web page can show these strings directly to a user.
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


@dataclass(frozen=True)
class CVDocument:
    # A loaded CV carries both the parsed data and the validation issues found
    # while reading it. Routes decide whether to render, reject, or onboard.
    path: Path
    data: dict[str, Any]
    issues: list[CVIssue]

    @property
    def exists(self) -> bool:
        return self.path.exists()

    @property
    def is_empty(self) -> bool:
        return not self.path.exists() or not self.path.read_text(encoding="utf-8").strip()

    @property
    def valid(self) -> bool:
        return not self.issues and not self.is_empty


def load_cv(data_root: Path, relative_path: str = CV_SOURCE) -> CVDocument:
    """Load and validate the base CV YAML document from a CVAI data root."""
    path = data_root / relative_path
    if not path.exists() or not path.read_text(encoding="utf-8").strip():
        return CVDocument(path=path, data={}, issues=[])
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        return CVDocument(path=path, data={}, issues=[CVIssue(relative_path, f"invalid YAML: {exc}")])
    if not isinstance(payload, dict):
        return CVDocument(path=path, data={}, issues=[CVIssue(relative_path, "must contain a mapping")])
    return CVDocument(path=path, data=payload, issues=validate_cv(payload))


def section_as_yaml(value: Any) -> str:
    """Serialize one CV section for display in an editable textarea."""
    if isinstance(value, str):
        return value
    return dump_yaml(value).strip()


def parse_section_payload(section: str, raw_value: str) -> tuple[Any | None, list[CVIssue]]:
    """Parse a submitted section textarea into the Python value expected by YAML."""
    if section not in CV_SECTIONS:
        return None, [CVIssue(section, "is not a known CV section")]
    if section == "summary":
        value = raw_value.strip()
        if not value:
            return None, [CVIssue("summary", "must not be empty")]
        return value, []
    try:
        value = yaml.safe_load(raw_value) if raw_value.strip() else None
    except yaml.YAMLError as exc:
        return None, [CVIssue(section, f"invalid YAML: {exc}")]
    return value, []


def update_cv_section(data_root: Path, section: str, raw_value: str, relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Validate and persist a single CV section.

    The full document is validated before writing because each section can depend
    on schema-level requirements such as required keys or minimum array lengths.
    Only the requested top-level section is replaced in memory before the file is
    rewritten.
    """
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues
    value, issues = parse_section_payload(section, raw_value)
    if issues:
        return issues
    updated = dict(document.data)
    updated[section] = value
    issues = validate_cv(updated)
    if issues:
        return issues
    document.path.write_text(dump_yaml(updated), encoding="utf-8")
    invalidate_cv_pdfs(data_root)
    return []


def save_cv_form(data_root: Path, form: dict[str, Any], relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Build a full CV document from structured form controls and save it.

    The browser submits one form with field names that mirror the CV hierarchy
    (`contact.name`, `experience.0.positions.0.roles.0`, and so on). This helper
    translates those controls back into the nested YAML structure, validates the
    result, and only then writes the canonical CV file.
    """
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues

    payload = {
        "summary": _form_string(form, "summary"),
        "contact": {
            "name": _form_string(form, "contact.name"),
            "surname": _form_string(form, "contact.surname"),
            "phone": {
                "prefix": _form_string(form, "contact.phone.prefix"),
                "number": _form_string(form, "contact.phone.number"),
            },
            "email": _form_string(form, "contact.email"),
            "linkedin": _form_string(form, "contact.linkedin"),
        },
        "languages": [
            {
                "name": _form_string(form, f"languages.{index}.name"),
                "level": _form_string(form, f"languages.{index}.level"),
            }
            for index in _indices(form, "languages")
        ],
        "certifications": [
            {
                "name": _form_string(form, f"certifications.{index}.name"),
                "id": _form_string(form, f"certifications.{index}.id"),
                "issuer": _form_string(form, f"certifications.{index}.issuer"),
                "year": _form_int(form, f"certifications.{index}.year"),
            }
            for index in _indices(form, "certifications")
        ],
        "education": [
            _omit_empty(
                {
                    "name": _form_string(form, f"education.{index}.name"),
                    "type": _form_string(form, f"education.{index}.type"),
                    "issuer": _form_string(form, f"education.{index}.issuer"),
                    "year": _form_int(form, f"education.{index}.year"),
                }
            )
            for index in _indices(form, "education")
        ],
        "experience": [
            _experience_entry_from_form(form, index)
            for index in _indices(form, "experience")
        ],
        "projects": {
            "items": [
                _project_from_form(form, index)
                for index in _indices(form, "projects.items")
            ],
        },
    }
    for optional in ("github", "www"):
        value = _form_string(form, f"contact.{optional}")
        if value:
            payload["contact"][optional] = value
    projects_url = _form_string(form, "projects.url")
    if projects_url:
        payload["projects"]["url"] = projects_url
    for section in ("certifications", "education", "experience"):
        payload[section] = _sort_cv_list_items(section, payload[section])

    issues = validate_cv(payload)
    if issues:
        return issues

    document.path.write_text(dump_yaml(payload), encoding="utf-8")
    invalidate_cv_pdfs(data_root)
    return []


def save_cv_summary_form(data_root: Path, form: dict[str, Any], relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Save the profile summary shown directly on the editor page."""
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues
    updated = dict(document.data)
    updated["summary"] = _form_string(form, "summary")
    return _validate_and_write_cv(document.path, data_root, updated)


def save_cv_contact_form(data_root: Path, form: dict[str, Any], relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Save the candidate contact details from the contact modal."""
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues
    updated = dict(document.data)
    contact = {
        "name": _form_string(form, "contact.name"),
        "surname": _form_string(form, "contact.surname"),
        "phone": {
            "prefix": _form_string(form, "contact.phone.prefix"),
            "number": _form_string(form, "contact.phone.number"),
        },
        "email": _form_string(form, "contact.email"),
        "linkedin": _form_string(form, "contact.linkedin"),
    }
    for optional in ("github", "www"):
        value = _form_string(form, f"contact.{optional}")
        if value:
            contact[optional] = value
    updated["contact"] = contact
    return _validate_and_write_cv(document.path, data_root, updated)


def save_cv_projects_url_form(data_root: Path, form: dict[str, Any], relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Save the public projects index URL without touching project entries."""
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues
    updated = dict(document.data)
    projects = dict(updated.get("projects", {}))
    projects_url = _form_string(form, "projects.url")
    if projects_url:
        projects["url"] = projects_url
    else:
        projects.pop("url", None)
    updated["projects"] = projects
    return _validate_and_write_cv(document.path, data_root, updated)


def cv_list_items(payload: dict[str, Any], section: str) -> list[dict[str, Any]]:
    """Return one repeatable CV section as a mutable-style list.

    The public CV schema stores projects under `projects.items` while the editor
    treats projects like every other repeatable section. This small adapter keeps
    route and template code from knowing that storage quirk.
    """
    if section == "projects":
        projects = payload.get("projects", {})
        return projects.get("items", []) if isinstance(projects, dict) else []
    value = payload.get(section, [])
    return value if isinstance(value, list) else []


def save_cv_list_item_form(data_root: Path, section: str, index: int, form: dict[str, Any], relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Save one repeatable CV item from modal form controls.

    Modal edits are partial from the browser's point of view, but they still
    validate the whole CV document before writing. That prevents a local edit
    from making the canonical YAML unusable for matching or PDF generation.
    """
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues
    if section not in CV_LIST_SECTIONS:
        return [CVIssue(section, "is not an editable CV list section")]

    updated = dict(document.data)
    items = list(cv_list_items(updated, section))
    if index < 0 or index > len(items):
        return [CVIssue(section, "item index is out of range")]
    item = _list_item_from_form(section, index, form)
    if index == len(items):
        items.append(item)
    else:
        items[index] = item
    items = _sort_cv_list_items(section, items)
    _store_cv_list_items(updated, section, items)
    return _validate_and_write_cv(document.path, data_root, updated)


def delete_cv_list_item(data_root: Path, section: str, index: int, relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Delete one repeatable CV item after validating the resulting document."""
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues
    if section not in CV_MANUALLY_ORDERED_SECTIONS:
        return []

    updated = dict(document.data)
    items = list(cv_list_items(updated, section))
    if index < 0 or index >= len(items):
        return [CVIssue(section, "item index is out of range")]
    del items[index]
    _store_cv_list_items(updated, section, items)
    return _validate_and_write_cv(document.path, data_root, updated)


def move_cv_list_item(data_root: Path, section: str, index: int, direction: str, relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Move one repeatable CV item up or down after validating the result."""
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues
    if section not in CV_LIST_SECTIONS:
        return [CVIssue(section, "is not an editable CV list section")]

    updated = dict(document.data)
    items = list(cv_list_items(updated, section))
    offset = -1 if direction == "up" else 1 if direction == "down" else 0
    target = index + offset
    if offset == 0 or index < 0 or index >= len(items) or target < 0 or target >= len(items):
        return []
    items[index], items[target] = items[target], items[index]
    _store_cv_list_items(updated, section, items)
    return _validate_and_write_cv(document.path, data_root, updated)


def reorder_cv_list_items(data_root: Path, section: str, order: list[int], relative_path: str = CV_SOURCE) -> list[CVIssue]:
    """Replace a repeatable CV section's order after validating the result."""
    document = load_cv(data_root, relative_path)
    if document.is_empty:
        return [CVIssue(relative_path, "create a CV before editing sections")]
    if document.issues:
        return document.issues
    if section not in CV_LIST_SECTIONS:
        return [CVIssue(section, "is not an editable CV list section")]

    updated = dict(document.data)
    items = list(cv_list_items(updated, section))
    if sorted(order) != list(range(len(items))):
        return [CVIssue(section, "item order must reference each item exactly once")]
    _store_cv_list_items(updated, section, [items[index] for index in order])
    return _validate_and_write_cv(document.path, data_root, updated)


def validate_cv(payload: dict[str, Any]) -> list[CVIssue]:
    """Validate the CV fields used by the renderer and web editor.

    CVAI publishes a JSON Schema for external tools, but this lightweight Python
    validator gives the local app readable field-level errors without another
    runtime dependency.
    """
    issues: list[CVIssue] = []
    for section in CV_SECTIONS:
        if section not in payload:
            issues.append(CVIssue(section, "is required"))
    if issues:
        return issues

    _string(payload, "summary", issues)
    _contact(payload.get("contact"), issues)
    _languages(payload.get("languages"), issues)
    _certifications(payload.get("certifications"), issues)
    _education(payload.get("education"), issues)
    _experience(payload.get("experience"), issues)
    _projects(payload.get("projects"), issues)
    return issues


def _validate_and_write_cv(path: Path, data_root: Path, payload: dict[str, Any]) -> list[CVIssue]:
    """Validate a complete CV payload, write it, and clear any stale PDF."""
    issues = validate_cv(payload)
    if issues:
        return issues
    path.write_text(dump_yaml(payload), encoding="utf-8")
    invalidate_cv_pdfs(data_root)
    return []


def invalidate_cv_pdfs(data_root: Path) -> None:
    """Remove all cached base-CV PDFs after structured CV data changes."""
    cv_dir = data_root / "cv"
    if not cv_dir.exists():
        return
    for pdf_path in cv_dir.glob("*.pdf"):
        if pdf_path.is_file():
            pdf_path.unlink()


def _store_cv_list_items(payload: dict[str, Any], section: str, items: list[dict[str, Any]]) -> None:
    """Write an editor-facing repeatable section back into CV schema shape."""
    if section == "projects":
        projects = dict(payload.get("projects", {}))
        projects["items"] = items
        payload["projects"] = projects
        return
    payload[section] = items


def _sort_cv_list_items(section: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep naturally chronological sections ordered without manual controls."""
    if section == "certifications":
        return sorted(items, key=lambda item: item.get("year") or 0, reverse=True)
    if section == "education":
        return sorted(items, key=lambda item: item.get("year") or 0, reverse=True)
    if section == "experience":
        return sorted(items, key=_experience_sort_key, reverse=True)
    return items


def _experience_sort_key(item: dict[str, Any]) -> str:
    # Employers can contain multiple positions. Sorting by the latest position
    # start date keeps promoted/internal moves grouped under the same company.
    positions = item.get("positions", [])
    starts = [str(position.get("start", "")) for position in positions if isinstance(position, dict)]
    return max(starts) if starts else ""


def _list_item_from_form(section: str, index: int, form: dict[str, Any]) -> dict[str, Any]:
    """Build one schema item from the dotted field names used by modal forms."""
    if section == "languages":
        return {
            "name": _form_string(form, f"languages.{index}.name"),
            "level": _form_string(form, f"languages.{index}.level"),
        }
    if section == "certifications":
        return {
            "name": _form_string(form, f"certifications.{index}.name"),
            "id": _form_string(form, f"certifications.{index}.id"),
            "issuer": _form_string(form, f"certifications.{index}.issuer"),
            "year": _form_int(form, f"certifications.{index}.year"),
        }
    if section == "education":
        return _omit_empty(
            {
                "name": _form_string(form, f"education.{index}.name"),
                "type": _form_string(form, f"education.{index}.type"),
                "issuer": _form_string(form, f"education.{index}.issuer"),
                "year": _form_int(form, f"education.{index}.year"),
            }
        )
    if section == "experience":
        return _experience_entry_from_form(form, index)
    if section == "projects":
        return _project_from_form(form, index)
    return {}


def _contact(value: Any, issues: list[CVIssue]) -> None:
    if not _mapping(value, "contact", issues):
        return
    for field in ("name", "surname", "email", "linkedin"):
        _string(value, f"contact.{field}", issues)
    phone = value.get("phone")
    if _mapping(phone, "contact.phone", issues):
        _string(phone, "contact.phone.prefix", issues)
        _string(phone, "contact.phone.number", issues)


def _languages(value: Any, issues: list[CVIssue]) -> None:
    if not _list(value, "languages", issues, min_items=1):
        return
    for index, language in enumerate(value):
        if _mapping(language, f"languages[{index}]", issues):
            _string(language, f"languages[{index}].name", issues)
            _string(language, f"languages[{index}].level", issues)


def _certifications(value: Any, issues: list[CVIssue]) -> None:
    if not _list(value, "certifications", issues):
        return
    for index, certification in enumerate(value):
        path = f"certifications[{index}]"
        if _mapping(certification, path, issues):
            for field in ("name", "id", "issuer"):
                _string(certification, f"{path}.{field}", issues)
            _integer(certification, f"{path}.year", issues)


def _education(value: Any, issues: list[CVIssue]) -> None:
    if not _list(value, "education", issues):
        return
    for index, education in enumerate(value):
        path = f"education[{index}]"
        if _mapping(education, path, issues):
            _string(education, f"{path}.name", issues)
            _string(education, f"{path}.issuer", issues)
            _integer(education, f"{path}.year", issues)


def _experience(value: Any, issues: list[CVIssue]) -> None:
    if not _list(value, "experience", issues, min_items=1):
        return
    for entry_index, entry in enumerate(value):
        entry_path = f"experience[{entry_index}]"
        if not _mapping(entry, entry_path, issues):
            continue
        _string(entry, f"{entry_path}.company", issues)
        positions = entry.get("positions")
        if not _list(positions, f"{entry_path}.positions", issues, min_items=1):
            continue
        for position_index, position in enumerate(positions):
            position_path = f"{entry_path}.positions[{position_index}]"
            if _mapping(position, position_path, issues):
                _list_of_strings(position.get("roles"), f"{position_path}.roles", issues, min_items=1)
                _string(position, f"{position_path}.start", issues)
                _string(position, f"{position_path}.location", issues)
                _list_of_strings(position.get("tasks"), f"{position_path}.tasks", issues, min_items=1)
                if "keywords" in position:
                    _list_of_strings(position.get("keywords"), f"{position_path}.keywords", issues)


def _projects(value: Any, issues: list[CVIssue]) -> None:
    if not _mapping(value, "projects", issues):
        return
    if value.get("url"):
        _string(value, "projects.url", issues)
    items = value.get("items")
    if not _list(items, "projects.items", issues, min_items=1):
        return
    for index, project in enumerate(items):
        path = f"projects.items[{index}]"
        if _mapping(project, path, issues):
            for field in ("name", "summary", "url", "description"):
                _string(project, f"{path}.{field}", issues)
            if "links" in project and _list(project.get("links"), f"{path}.links", issues):
                for link_index, link in enumerate(project.get("links", [])):
                    link_path = f"{path}.links[{link_index}]"
                    if _mapping(link, link_path, issues):
                        _string(link, f"{link_path}.label", issues)
                        _string(link, f"{link_path}.url", issues)
            if "keywords" in project:
                _list_of_strings(project.get("keywords"), f"{path}.keywords", issues)


def _mapping(value: Any, path: str, issues: list[CVIssue]) -> bool:
    if not isinstance(value, dict):
        issues.append(CVIssue(path, "must be a mapping"))
        return False
    return True


def _list(value: Any, path: str, issues: list[CVIssue], min_items: int = 0) -> bool:
    if not isinstance(value, list):
        issues.append(CVIssue(path, "must be a list"))
        return False
    if len(value) < min_items:
        issues.append(CVIssue(path, f"must contain at least {min_items} item(s)"))
        return False
    return True


def _string(mapping: dict[str, Any], path: str, issues: list[CVIssue]) -> None:
    key = path.rsplit(".", 1)[-1]
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        issues.append(CVIssue(path, "must be a non-empty string"))


def _integer(mapping: dict[str, Any], path: str, issues: list[CVIssue]) -> None:
    key = path.rsplit(".", 1)[-1]
    if not isinstance(mapping.get(key), int):
        issues.append(CVIssue(path, "must be an integer"))


def _list_of_strings(value: Any, path: str, issues: list[CVIssue], min_items: int = 0) -> None:
    if not _list(value, path, issues, min_items=min_items):
        return
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            issues.append(CVIssue(f"{path}[{index}]", "must be a non-empty string"))


def _experience_entry_from_form(form: dict[str, Any], index: int) -> dict:
    entry = {
        "company": _form_string(form, f"experience.{index}.company"),
        "positions": [
            _position_from_form(form, index, position_index)
            for position_index in _indices(form, f"experience.{index}.positions")
        ],
    }
    visible = _form_string(form, f"experience.{index}.visible")
    if visible:
        entry["visible"] = visible == "true"
    return entry


def _position_from_form(form: dict[str, Any], entry_index: int, position_index: int) -> dict:
    position = {
        "roles": _string_list_from_form(form, f"experience.{entry_index}.positions.{position_index}.roles"),
        "start": _form_string(form, f"experience.{entry_index}.positions.{position_index}.start"),
        "end": _form_string(form, f"experience.{entry_index}.positions.{position_index}.end") or None,
        "location": _form_string(form, f"experience.{entry_index}.positions.{position_index}.location"),
        "tasks": _string_list_from_form(form, f"experience.{entry_index}.positions.{position_index}.tasks"),
        "keywords": _string_list_from_form(form, f"experience.{entry_index}.positions.{position_index}.keywords"),
    }
    return _omit_empty(position)


def _project_from_form(form: dict[str, Any], index: int) -> dict:
    project = {
        "name": _form_string(form, f"projects.items.{index}.name"),
        "summary": _form_string(form, f"projects.items.{index}.summary"),
        "url": _form_string(form, f"projects.items.{index}.url"),
        "description": _form_string(form, f"projects.items.{index}.description"),
        "links": [
            {
                "label": _form_string(form, f"projects.items.{index}.links.{link_index}.label"),
                "url": _form_string(form, f"projects.items.{index}.links.{link_index}.url"),
            }
            for link_index in _indices(form, f"projects.items.{index}.links")
        ],
        "keywords": _string_list_from_form(form, f"projects.items.{index}.keywords"),
    }
    visible = _form_string(form, f"projects.items.{index}.visible")
    if visible:
        project["visible"] = visible == "true"
    return _omit_empty(project)


def _string_list_from_form(form: dict[str, Any], prefix: str) -> list[str]:
    # Repeated text fields arrive as dotted keys such as
    # experience.0.positions.0.tasks.2. Empty rows are ignored so templates can
    # render spare controls without creating blank YAML values.
    return [
        value
        for index in _indices(form, prefix)
        if (value := _form_string(form, f"{prefix}.{index}"))
    ]


def _indices(form: dict[str, Any], prefix: str) -> list[int]:
    # Form indexes may be sparse after deleting rows in the browser. Discovering
    # them from submitted keys avoids trusting a separate count field.
    prefix = f"{prefix}."
    found: set[int] = set()
    for key in form:
        if not key.startswith(prefix):
            continue
        remainder = key[len(prefix) :]
        first_part = remainder.split(".", 1)[0]
        if first_part.isdigit():
            found.add(int(first_part))
    return sorted(found)


def _form_string(form: dict[str, Any], key: str) -> str:
    value = form.get(key, "")
    if value is None:
        return ""
    return str(value).strip()


def _form_int(form: dict[str, Any], key: str) -> int | None:
    # Integer fields are optional in the editor. Invalid numbers become None so
    # validate_cv can report the schema error in the same pass as other fields.
    value = _form_string(form, key)
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _omit_empty(mapping: dict[str, Any]) -> dict[str, Any]:
    # Optional CV keys are omitted rather than written as blank strings/nulls; this
    # keeps the YAML compact and matches the public schema's optional-field style.
    return {
        key: value
        for key, value in mapping.items()
        if value not in ("", [], None)
    }
