from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime
import shutil
from pathlib import Path
from typing import Any
from uuid import UUID

import yaml

from .yaml_format import dump_yaml


# The validator is deliberately ordinary Python instead of JSON Schema. Junior
# contributors should read it as the executable data contract: each helper below
# explains one rule the YAML database must follow before the web app will trust it.
ROLE_ID_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_")
ROLE_STATUS = {"draft", "submitted", "interviewing", "accepted", "rejected", "closed", "inactive", "unknown"}
TASK_STATUS = {"open", "completed", "wont_do"}
EVENT_TYPES = {"captured", "submitted", "interviewing", "accepted", "rejected", "closed", "decision", "note"}
VERDICTS = {
    "CLEAR_FIT",
    "FIT",
    "FIT_WITH_TARGETED_UPSKILLING",
    "OVERQUALIFIED",
    "POSSIBLE_FIT",
    "STRETCH",
    "WEAK_FIT",
    "UNFIT",
    "NOT_A_GOOD_FIT",
}
REQUIREMENT_CATEGORIES = {"hard_requirement", "soft_requirement", "inferred_requirement"}
REQUIREMENT_FULFILLMENT = {"met", "partial", "unmet", "unknown"}
ROOT_FILES = {
    "roles.yaml": {"roles": []},
    "role_states.yaml": {"role_states": []},
    "tasks.yaml": {"tasks": []},
    "events.yaml": {"events": []},
}
ROOT_DIRECTORIES = ("roles", "cv", "context", "library", "pdf", "pdf/templates")
PROJECTION_FILES = {
    "context/context.yaml": {
        "version": 1,
        "constraints": [],
        "preferences": [],
        "metrics": [],
        "portfolio": [],
    },
    "library/evidence.yaml": {
        "version": 1,
        "skills": [],
        "stories": [],
        "cover_letter_blocks": [],
    },
}
PUBLIC_SCHEMA_FILES = {
    # Keep a copy under the repository-level `schemas/` directory for direct
    # publication, and under `cvai_core/schemas/` for installed packages. The
    # initializer prefers the public file during source checkouts and falls back
    # to the package resource in wheel/container installs.
    "cv/cv-schema.json": (
        Path(__file__).resolve().parents[1] / "schemas" / "cv.schema.json",
        Path(__file__).resolve().parent / "schemas" / "cv.schema.json",
    ),
}


@dataclass(frozen=True)
class ValidationIssue:
    # A validation issue points at the closest YAML path we can name. Tests assert
    # against these strings, so messages should stay stable and user-readable.
    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path}: {self.message}"


class SchemaValidationError(RuntimeError):
    def __init__(self, issues: list[ValidationIssue]) -> None:
        self.issues = issues
        super().__init__(format_issues(issues))


def initialize_data_root(root: Path) -> list[Path]:
    """Create the minimal writable data directory expected by CVAI.

    Deployment mounts a private, initially empty location as `CVAI_DATA`. The web
    package owns the schema, so initialization lives here and writes only missing
    files. Existing user data is never overwritten.
    """
    root.mkdir(parents=True, exist_ok=True)
    created: list[Path] = []
    for directory in ROOT_DIRECTORIES:
        path = root / directory
        if not path.exists():
            path.mkdir(parents=True)
            created.append(path)
    for relative_path, payload in {**ROOT_FILES, **PROJECTION_FILES}.items():
        path = root / relative_path
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(dump_yaml(payload), encoding="utf-8")
            created.append(path)
    for relative_path, sources in PUBLIC_SCHEMA_FILES.items():
        path = root / relative_path
        source = next((candidate for candidate in sources if candidate.exists()), None)
        if not path.exists() and source is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, path)
            created.append(path)
    return created


class DataValidator:
    # DataValidator walks the database in dependency order. It reads the global
    # indexes first, stores IDs in dictionaries, and then checks every per-role file
    # against those indexes so broken cross references are caught early.
    def __init__(self, root: Path) -> None:
        self.root = root
        self.issues: list[ValidationIssue] = []
        self.roles: dict[str, dict] = {}
        self.role_states: dict[str, dict] = {}
        self.tasks: dict[str, dict] = {}

    def validate(self) -> list[ValidationIssue]:
        self._validate_root_indexes()
        self._validate_role_folders()
        return self.issues

    def _validate_root_indexes(self) -> None:
        """Validate global index files before checking per-role cross references."""
        roles_payload = self._load_mapping("roles.yaml")
        roles = self._list_field(roles_payload, "roles.yaml", "roles")
        seen_roles: set[str] = set()
        for index, role in enumerate(roles):
            path = f"roles.yaml.roles[{index}]"
            if not isinstance(role, dict):
                self._error(path, "must be a mapping")
                continue
            role_id = self._required_string(role, path, "id")
            if role_id:
                self._role_id(path, role_id)
                if role_id in seen_roles:
                    self._error(path, f"duplicate role id {role_id!r}")
                seen_roles.add(role_id)
                self.roles[role_id] = role
            for field in ("company", "title", "location"):
                self._required_string(role, path, field)
            self._optional_string(role, path, "source_url")
            self._optional_iso8601(role, path, "captured_on")
            self._optional_int(role, path, "priority_rank")
            self._optional_bool(role, path, "active")

        role_states_payload = self._load_mapping("role_states.yaml")
        role_states = self._list_field(role_states_payload, "role_states.yaml", "role_states")
        seen_role_states: set[str] = set()
        for index, state in enumerate(role_states):
            path = f"role_states.yaml.role_states[{index}]"
            if not isinstance(state, dict):
                self._error(path, "must be a mapping")
                continue
            role_id = self._required_string(state, path, "role_id")
            if role_id:
                if role_id not in self.roles:
                    self._error(path, f"role_id {role_id!r} is not present in roles.yaml")
                if role_id in seen_role_states:
                    self._error(path, f"duplicate role state role_id {role_id!r}")
                seen_role_states.add(role_id)
                self.role_states[role_id] = state
            self._enum(state, path, "status", ROLE_STATUS, required=True)
            self._optional_iso8601(state, path, "status_date")
            self._optional_string(state, path, "status_detail")
            self._list_of_strings(state, path, "status_artifacts")
            self._enum(state, path, "verdict", VERDICTS, required=True)
            self._optional_string(state, path, "verdict_label")
            self._optional_string(state, path, "rationale")

        tasks_payload = self._load_mapping("tasks.yaml")
        tasks = self._list_field(tasks_payload, "tasks.yaml", "tasks")
        seen_tasks: set[str] = set()
        for index, task in enumerate(tasks):
            path = f"tasks.yaml.tasks[{index}]"
            if not isinstance(task, dict):
                self._error(path, "must be a mapping")
                continue
            task_id = self._required_string(task, path, "id")
            if task_id:
                if task_id in seen_tasks:
                    self._error(path, f"duplicate task id {task_id!r}")
                seen_tasks.add(task_id)
                self.tasks[task_id] = task
            role_id = task.get("role_id")
            if role_id is not None:
                self._string(task, path, "role_id", required=False)
                if isinstance(role_id, str) and role_id not in self.roles:
                    self._error(path, f"role_id {role_id!r} is not present in roles.yaml")
            self._enum(task, path, "status", TASK_STATUS, required=True)
            self._required_string(task, path, "kind")
            self._required_string(task, path, "title")
            self._required_string(task, path, "description")
            self._optional_int(task, path, "estimated_days")
            self._optional_bool(task, path, "feasible_within_one_week")
            self._list_of_strings(task, path, "acceptance_criteria")
            self._list_of_strings(task, path, "evidence_refs")
            self._optional_string(task, path, "status_detail")

        self._validate_events("events.yaml", self._load_mapping("events.yaml"), role_required=False)

    def _validate_role_folders(self) -> None:
        for role_id, role in self.roles.items():
            # Each role has both global index rows and a folder-local mirror. The
            # mirror makes a role portable as a directory, while the indexes keep
            # dashboard reads cheap.
            role_dir = self.root / "roles" / role_id
            if not role_dir.is_dir():
                self._error(f"roles/{role_id}", "role directory is missing")
                continue
            role_yaml = self._load_mapping(f"roles/{role_id}/role.yaml")
            app_yaml = self._load_mapping(f"roles/{role_id}/state.yaml")
            job_yaml = self._load_mapping(f"roles/{role_id}/job.yaml")
            analysis_yaml = self._load_mapping(f"roles/{role_id}/analysis.yaml")
            artifacts_yaml = self._load_mapping(f"roles/{role_id}/artifacts.yaml")
            tasks_yaml = self._load_mapping(f"roles/{role_id}/tasks.yaml")
            events_yaml = self._load_mapping(f"roles/{role_id}/events.yaml")

            self._same("roles.yaml", role, f"roles/{role_id}/role.yaml", role_yaml, "id")
            for field in ("company", "title", "location", "source_url", "captured_on"):
                self._same("roles.yaml", role, f"roles/{role_id}/role.yaml", role_yaml, field, optional=True)
            self._same("role_states.yaml", self.role_states.get(role_id, {}), f"roles/{role_id}/state.yaml", app_yaml, "role_id")
            self._same("role_states.yaml", self.role_states.get(role_id, {}), f"roles/{role_id}/state.yaml", app_yaml, "status")
            self._same("role_states.yaml", self.role_states.get(role_id, {}), f"roles/{role_id}/state.yaml", app_yaml, "verdict")

            self._validate_job(role_id, job_yaml)
            self._validate_analysis(role_id, analysis_yaml)
            self._validate_artifacts(role_id, artifacts_yaml)
            self._list_field(tasks_yaml, f"roles/{role_id}/tasks.yaml", "tasks")
            self._validate_events(f"roles/{role_id}/events.yaml", events_yaml, role_required=False, expected_role_id=role_id)

    def _validate_job(self, role_id: str, payload: dict) -> None:
        path = f"roles/{role_id}/job.yaml"
        self._same_value(path, payload.get("role_id"), role_id, "role_id")
        for field in ("company", "title", "location"):
            self._required_string(payload, path, field)
        self._optional_string(payload, path, "source_url")
        self._optional_iso8601(payload, path, "captured_on")
        posting = self._mapping_field(payload, path, "posting")
        if posting:
            self._required_string(posting, f"{path}.posting", "raw_text")
            self._optional_iso8601(posting, f"{path}.posting", "date_posted")
            self._optional_string(posting, f"{path}.posting", "employment_type")
            self._optional_string(posting, f"{path}.posting", "location_mode")
            self._optional_string(posting, f"{path}.posting", "posting_id")
        extracted = self._mapping_field(payload, path, "extracted")
        if extracted:
            for field in ("responsibilities", "hard_requirements", "soft_requirements", "inferred_requirements", "skills", "interview_focus"):
                self._list_of_strings(extracted, f"{path}.extracted", field)
            if "tech_stack" in extracted:
                self._error(f"{path}.extracted.tech_stack", "has been replaced by extracted.skills")
        self._validate_requirements(path, payload.get("requirements"))

    def _validate_analysis(self, role_id: str, payload: dict) -> None:
        path = f"roles/{role_id}/analysis.yaml"
        self._same_value(path, payload.get("role_id"), role_id, "role_id")
        summary = self._mapping_field(payload, path, "summary")
        if summary:
            self._enum(summary, f"{path}.summary", "verdict", VERDICTS, required=True)
            self._optional_string(summary, f"{path}.summary", "verdict_label")
            self._required_string(summary, f"{path}.summary", "rationale")
            self._list_of_strings(summary, f"{path}.summary", "notes")
            recommendation = summary.get("recommendation")
            if recommendation is not None and not isinstance(recommendation, dict):
                self._error(f"{path}.summary.recommendation", "must be a mapping when present")
        self._validate_requirements(path, payload.get("requirements"))
        for field in ("strengths", "gaps", "work_items", "timeline", "comments"):
            self._list_field(payload, path, field)
        self._mapping_field(payload, path, "gap_tasks")
        self._mapping_field(payload, path, "llm_context")

    def _validate_requirements(self, path: str, requirements: Any) -> None:
        """Validate requirement coverage rows used by both job.yaml and analysis.yaml."""
        if not isinstance(requirements, list) or not requirements:
            self._error(f"{path}.requirements", "must be a non-empty list")
            return
        seen: set[str] = set()
        for index, req in enumerate(requirements):
            req_path = f"{path}.requirements[{index}]"
            if not isinstance(req, dict):
                self._error(req_path, "must be a mapping")
                continue
            req_id = self._required_string(req, req_path, "id")
            if req_id:
                if req_id in seen:
                    self._error(req_path, f"duplicate requirement id {req_id!r}")
                seen.add(req_id)
            self._required_string(req, req_path, "text")
            self._enum(req, req_path, "category", REQUIREMENT_CATEGORIES, required=True)
            fulfillment = self._enum(req, req_path, "fulfillment", REQUIREMENT_FULFILLMENT, required=True)
            self._list_field(req, req_path, "evidence")
            self._optional_string(req, req_path, "gap")
            # task_refs are the bridge from a requirement gap to actionable work.
            # Met requirements should not point at gap work, because that would
            # leave the dashboard telling the user to close already-covered gaps.
            task_refs = req.get("task_refs")
            if task_refs is None:
                self._error(f"{req_path}.task_refs", "is required")
            elif not isinstance(task_refs, list) or not all(isinstance(item, str) for item in task_refs):
                self._error(f"{req_path}.task_refs", "must be a list of strings")
            else:
                if fulfillment == "met" and task_refs:
                    self._error(f"{req_path}.task_refs", "must be empty when fulfillment is met")
                for task_id in task_refs:
                    if task_id not in self.tasks:
                        self._error(f"{req_path}.task_refs", f"unknown task id {task_id!r}")

    def _validate_artifacts(self, role_id: str, payload: dict) -> None:
        rows = self._list_field(payload, f"roles/{role_id}/artifacts.yaml", "artifacts")
        for index, artifact in enumerate(rows):
            path = f"roles/{role_id}/artifacts.yaml.artifacts[{index}]"
            if not isinstance(artifact, dict):
                self._error(path, "must be a mapping")
                continue
            self._required_string(artifact, path, "kind")
            artifact_path = self._required_string(artifact, path, "path")
            if artifact_path:
                if not artifact_path.startswith(f"roles/{role_id}/artifacts/"):
                    self._error(path, "path must point inside this role's artifacts directory")
                elif not (self.root / artifact_path).exists():
                    self._error(path, f"artifact path {artifact_path!r} does not exist")

    def _validate_events(self, path: str, payload: dict, *, role_required: bool, expected_role_id: str | None = None) -> None:
        events = self._list_field(payload, path, "events")
        for index, event in enumerate(events):
            event_path = f"{path}.events[{index}]"
            if not isinstance(event, dict):
                self._error(event_path, "must be a mapping")
                continue
            event_id = self._required_string(event, event_path, "id")
            self._event_id(event_path, event_id)
            self._enum(event, event_path, "type", EVENT_TYPES, required=True)
            self._optional_iso8601(event, event_path, "date")
            self._required_string(event, event_path, "detail")
            if "text" in event:
                self._error(f"{event_path}.text", "has been replaced by detail")
            self._list_of_strings(event, event_path, "artifacts")
            role_id = event.get("role_id")
            if role_required and not isinstance(role_id, str):
                self._error(f"{event_path}.role_id", "is required")
            if isinstance(role_id, str) and role_id not in self.roles:
                self._error(f"{event_path}.role_id", f"{role_id!r} is not present in roles.yaml")
            if expected_role_id and isinstance(role_id, str) and role_id != expected_role_id:
                self._error(f"{event_path}.role_id", f"must be {expected_role_id!r}")

    def _load_mapping(self, relative_path: str) -> dict:
        path = self.root / relative_path
        if not path.exists():
            self._error(relative_path, "file is missing")
            return {}
        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            self._error(relative_path, f"invalid YAML: {exc}")
            return {}
        if not isinstance(payload, dict):
            self._error(relative_path, "top-level value must be a mapping")
            return {}
        return payload

    def _list_field(self, payload: dict, path: str, field: str) -> list:
        value = payload.get(field)
        if not isinstance(value, list):
            self._error(f"{path}.{field}", "must be a list")
            return []
        return value

    def _mapping_field(self, payload: dict, path: str, field: str) -> dict:
        value = payload.get(field)
        if not isinstance(value, dict):
            self._error(f"{path}.{field}", "must be a mapping")
            return {}
        return value

    def _required_string(self, payload: dict, path: str, field: str) -> str:
        return self._string(payload, path, field, required=True)

    def _optional_string(self, payload: dict, path: str, field: str) -> str:
        return self._string(payload, path, field, required=False)

    def _string(self, payload: dict, path: str, field: str, *, required: bool) -> str:
        value = payload.get(field)
        if value is None:
            if required:
                self._error(f"{path}.{field}", "is required")
            return ""
        if not isinstance(value, str):
            self._error(f"{path}.{field}", "must be a string")
            return ""
        if required and not value.strip():
            self._error(f"{path}.{field}", "must not be empty")
        return value

    def _optional_iso8601(self, payload: dict, path: str, field: str) -> None:
        value = self._string(payload, path, field, required=False)
        if value:
            self._iso8601(f"{path}.{field}", value)

    def _iso8601(self, path: str, value: str) -> None:
        # Dates such as 2026-05-19 and datetimes such as
        # 2026-05-19T10:20:00+00:00 are both valid ISO8601 values.
        normalized = value.replace("Z", "+00:00")
        try:
            if "T" in normalized:
                datetime.fromisoformat(normalized)
            else:
                date.fromisoformat(normalized)
        except ValueError:
            self._error(path, "must be an ISO8601 date or datetime")

    def _optional_int(self, payload: dict, path: str, field: str) -> None:
        value = payload.get(field)
        if value is not None and (not isinstance(value, int) or isinstance(value, bool)):
            self._error(f"{path}.{field}", "must be an integer or null")

    def _optional_bool(self, payload: dict, path: str, field: str) -> None:
        value = payload.get(field)
        if value is not None and not isinstance(value, bool):
            self._error(f"{path}.{field}", "must be a boolean or null")

    def _list_of_strings(self, payload: dict, path: str, field: str) -> None:
        value = payload.get(field)
        if value is None:
            self._error(f"{path}.{field}", "is required")
            return
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            self._error(f"{path}.{field}", "must be a list of strings")

    def _enum(self, payload: dict, path: str, field: str, allowed: set[str], *, required: bool) -> str:
        value = payload.get(field)
        if value is None:
            if required:
                self._error(f"{path}.{field}", "is required")
            return ""
        if not isinstance(value, str):
            self._error(f"{path}.{field}", "must be a string")
            return ""
        if value not in allowed:
            self._error(f"{path}.{field}", f"must be one of {', '.join(sorted(allowed))}")
        return value

    def _role_id(self, path: str, role_id: str) -> None:
        if not role_id or any(char not in ROLE_ID_CHARS for char in role_id):
            self._error(f"{path}.id", "must use lower-case slug characters: a-z, 0-9, underscore")

    def _event_id(self, path: str, event_id: str) -> None:
        if not event_id.startswith("event-"):
            self._error(f"{path}.id", "must start with 'event-'")
            return
        try:
            UUID(event_id.removeprefix("event-"))
        except ValueError:
            self._error(f"{path}.id", "must use the format event-<uuid>")

    def _same(self, left_path: str, left: dict, right_path: str, right: dict, field: str, *, optional: bool = False) -> None:
        # Mirror checks intentionally compare only stable identity/status fields.
        # Rich per-role files can contain extra derived data without bloating the
        # global indexes.
        left_value = left.get(field)
        right_value = right.get(field)
        if optional and (left_value is None or right_value is None):
            return
        if left_value != right_value:
            self._error(f"{right_path}.{field}", f"must match {left_path}.{field}")

    def _same_value(self, path: str, actual: Any, expected: Any, field: str) -> None:
        if actual != expected:
            self._error(f"{path}.{field}", f"must be {expected!r}")

    def _error(self, path: str, message: str) -> None:
        self.issues.append(ValidationIssue(path, message))


def validate_data_root(root: Path) -> list[ValidationIssue]:
    return DataValidator(root).validate()


def format_issues(issues: list[ValidationIssue]) -> str:
    if not issues:
        return "schema validation passed"
    shown = "\n".join(str(issue) for issue in issues[:50])
    remaining = len(issues) - 50
    if remaining > 0:
        shown += f"\n... and {remaining} more issue(s)"
    return shown


def assert_valid_data_root(root: Path) -> None:
    issues = validate_data_root(root)
    if issues:
        raise SchemaValidationError(issues)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate or initialize a CVAI YAML data directory.")
    parser.add_argument("data_root", type=Path, help="Path to the private CVAI data directory")
    parser.add_argument("--init", action="store_true", help="create missing root files before validation")
    args = parser.parse_args(argv)
    if args.init:
        created = initialize_data_root(args.data_root)
        for path in created:
            print(f"created {path}")
    issues = validate_data_root(args.data_root)
    if issues:
        print(format_issues(issues))
        return 1
    print(f"{args.data_root}: schema validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
