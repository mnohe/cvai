from __future__ import annotations

import mimetypes
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import yaml

from .pdf import PDFRenderer
from .templates import TemplatePack, list_template_packs
from .yaml_format import dump_yaml


TERMINAL_STATUS_MARKERS = ("rejected", "accepted", "closed", "inactive")
VERDICT_LABELS = {
    "CLEAR_FIT": "Clear fit",
    "FIT": "Good fit",
    "OVERQUALIFIED": "Overqualified fit",
    "STRETCH": "Stretch fit",
    "WEAK_FIT": "Weak fit",
    "UNFIT": "Not a fit",
}
STATUS_LABELS = {
    "draft": "Not submitted",
    "submitted": "Submitted",
    "interviewing": "Interviewing",
    "accepted": "Accepted",
    "rejected": "Rejected",
    "closed": "Closed",
    "inactive": "Inactive",
}

# Role cards need a compact rationale; mirror summaries may contain more bullets,
# but only the first few belong in the persisted one-line state summary.
ROLE_STATE_RATIONALE_BULLETS = 2

# Cached CV PDF filenames use an initial plus surname, which keeps generated
# filenames compact while avoiding a bare template name.
CV_FILENAME_INITIAL_CHARS = 1


@dataclass
class RoleEvent:
    # Events are the append-only history shown on a role detail page. The current
    # role process state lives in role_states.yaml; events explain how that state
    # changed over time.
    type: str
    date: str
    detail: str


@dataclass
class RoleRecord:
    canonical_slug: str
    company: str
    location: str
    role: str
    job_file: str
    source_url: str
    captured_on: str
    verdict: str
    verdict_label: str
    status: str
    status_date: str
    status_detail: str
    status_artifacts: list[str]
    rationale: str
    report_path: Path
    output_dir: Path | None
    mirror_path: Path | None
    artifacts: list[str]
    decision_events: list[RoleEvent]
    report_file: str = ""
    role_matrix_file: str = ""
    report_content: str = ""
    role_matrix_content: str = ""
    analysis: dict | None = None

    @property
    def status_key(self) -> str:
        return self.status or "unknown"

    @property
    def role_status(self) -> str:
        return status_sentence(self.status, self.status_date, self.status_detail, self.status_artifacts)

    @property
    def is_active(self) -> bool:
        return self.status_key not in TERMINAL_STATUS_MARKERS


@dataclass
class DashboardRole:
    role: RoleRecord
    rank: int | None
    open_task_count: int


@dataclass
class TaskRecord:
    id: str
    title: str
    description: str
    status: str
    kind: str
    estimated_days: int | None
    feasible_within_one_week: bool | None
    acceptance_criteria: list[str]
    evidence_refs: list[str]
    status_detail: str
    role_id: str | None = None

    @property
    def is_gap_evidence(self) -> bool:
        return self.kind == "gap_evidence"


def slugify(value: str) -> str:
    """Turn a human title into the stable lowercase ID format used by role IDs."""
    value = value.strip().lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "_", value)
    value = re.sub(r"_+", "_", value).strip("_")
    return value or "role"


def normalize_whitespace(text: str) -> str:
    """Collapse copy-pasted prose into a single display-safe sentence."""
    return re.sub(r"[ \t]+", " ", text).strip()


def status_key_for_event(event_type: str) -> str:
    """Map a user-facing event type to the canonical application status enum."""
    if event_type in {"submitted", "interviewing", "accepted", "rejected", "closed"}:
        return event_type
    return "unknown"


def verdict_label(verdict: str) -> str:
    """Convert stored verdict enums into labels suitable for badges and headings."""
    normalized = verdict.strip().upper()
    return VERDICT_LABELS.get(normalized, verdict.replace("_", " ").title() or "Needs review")


def status_sentence(status: str, exact_date: str = "", detail: str = "", artifacts: Iterable[str] | None = None) -> str:
    """Build the short status sentence displayed on dashboards and detail pages."""
    status = status or "unknown"
    detail = normalize_whitespace(detail)
    label = STATUS_LABELS.get(status, "Needs review")
    if status == "draft":
        if exact_date and detail:
            return f"Not submitted as of {exact_date}; {detail}"
        if detail:
            return f"Not submitted; {detail}"
        return "Not submitted"
    if status == "interviewing" and detail:
        return detail
    if status == "submitted" and exact_date:
        return f"Submitted on {exact_date}"
    if exact_date:
        sentence = f"{label} on {exact_date}"
    else:
        sentence = label
    if detail:
        sentence += f" ({detail})"
    return sentence


class Repository:
    # Repository is the only object allowed to read or write CVAI data files. Route
    # handlers call this class instead of opening YAML files directly, which keeps
    # path safety, mirroring, and validation-sensitive write shapes in one place.
    def __init__(self, root: Path) -> None:
        self.root = root

    def resolve(self, relative_path: str) -> Path:
        # Every file path accepted from the web layer is relative to CVAI_DATA. The
        # parent check prevents /download/file?path=../../private-key style escapes.
        path = (self.root / relative_path).resolve()
        if self.root.resolve() not in path.parents and path != self.root.resolve():
            raise ValueError(f"Path escapes data root: {relative_path}")
        return path

    def read_text(self, relative_path: str) -> str:
        return self.resolve(relative_path).read_text(encoding="utf-8")

    def write_text(self, relative_path: str, content: str) -> Path:
        path = self.resolve(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content.rstrip() + "\n", encoding="utf-8")
        return path

    def file_info(self, relative_path: str) -> tuple[Path, str]:
        path = self.resolve(relative_path)
        mime_type, _ = mimetypes.guess_type(path.name)
        return path, mime_type or "application/octet-stream"

    def exists(self, relative_path: str) -> bool:
        return self.resolve(relative_path).exists()

    def load_data(self, relative_path: str, default: dict | None = None) -> dict:
        path = self.resolve(relative_path)
        if not path.exists():
            return default or {}
        return yaml.safe_load(path.read_text(encoding="utf-8")) or {}

    def write_data(self, relative_path: str, payload: dict) -> Path:
        # YAML is the durable database format. sort_keys=False preserves the schema
        # order humans expect when they review or edit the files.
        path = self.resolve(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(dump_yaml(payload), encoding="utf-8")
        return path

    def list_roles(self) -> list[RoleRecord]:
        # Global indexes provide the fast dashboard view. Per-role files provide the
        # larger detail payload, so this method joins both layers into one record.
        roles = self.load_data("roles.yaml", {"roles": []}).get("roles", [])
        role_states = {
            state["role_id"]: state
            for state in self.load_data("role_states.yaml", {"role_states": []}).get("role_states", [])
        }
        events = self.load_data("events.yaml", {"events": []}).get("events", [])
        records: list[RoleRecord] = []
        for role in roles:
            role_id = role["id"]
            state = role_states.get(role_id, {})
            role_dir = f"roles/{role_id}"
            report_file = f"{role_dir}/suitability_report.md"
            matrix_file = f"{role_dir}/role_matrix.md"
            analysis_file = f"{role_dir}/analysis.yaml"
            job_file = f"{role_dir}/job.md"
            artifact_rows = self.load_data(f"{role_dir}/artifacts.yaml", {"artifacts": []}).get("artifacts", [])
            event_rows = [
                RoleEvent(
                    type=event.get("type") or "decision",
                    date=event.get("date") or "",
                    detail=event.get("detail") or "",
                )
                for event in events
                if event.get("role_id") == role_id
            ]
            if role.get("captured_on"):
                event_rows.insert(
                    0,
                    RoleEvent(
                        type="captured",
                        date=role.get("captured_on", ""),
                        detail="Role captured from source.",
                    ),
                )
            records.append(
                RoleRecord(
                    canonical_slug=role_id,
                    company=role.get("company", ""),
                    location=role.get("location", ""),
                    role=role.get("title", ""),
                    job_file=job_file if self.exists(job_file) else "",
                    source_url=role.get("source_url", ""),
                    captured_on=role.get("captured_on", ""),
                    verdict=state.get("verdict", ""),
                    verdict_label=state.get("verdict_label") or verdict_label(state.get("verdict", "")),
                    status=state.get("status", "draft"),
                    status_date=state.get("status_date") or "",
                    status_detail=state.get("status_detail") or "",
                    status_artifacts=state.get("status_artifacts") or [],
                    rationale=state.get("rationale", ""),
                    report_path=self.resolve(report_file),
                    output_dir=self.resolve(f"{role_dir}/artifacts") if self.exists(f"{role_dir}/artifacts") else None,
                    mirror_path=None,
                    artifacts=[artifact["path"] for artifact in artifact_rows if artifact.get("path")],
                    decision_events=event_rows,
                    report_file=report_file if self.exists(report_file) else "",
                    role_matrix_file=matrix_file if self.exists(matrix_file) else "",
                    report_content=self.read_text(report_file) if self.exists(report_file) else "",
                    role_matrix_content=self.read_text(matrix_file) if self.exists(matrix_file) else "",
                    analysis=self.load_data(analysis_file, {}) if self.exists(analysis_file) else {},
                )
            )
        return records

    def get_role(self, canonical_slug: str) -> RoleRecord | None:
        for role in self.list_roles():
            if role.canonical_slug == canonical_slug:
                return role
        return None

    def list_dashboard_roles(self) -> list[DashboardRole]:
        # The dashboard only shows active roles. Open task counts are joined
        # from tasks.yaml so users can see follow-up burden without opening details.
        task_rows = self.load_data("tasks.yaml", {"tasks": []}).get("tasks", [])
        task_counts: dict[str, int] = {}
        for task in task_rows:
            if task.get("status") == "open" and task.get("role_id"):
                task_counts[task["role_id"]] = task_counts.get(task["role_id"], 0) + 1
        ranks = {
            role["id"]: role.get("priority_rank")
            for role in self.load_data("roles.yaml", {"roles": []}).get("roles", [])
        }
        roles = [
            DashboardRole(role=role, rank=ranks.get(role.canonical_slug), open_task_count=task_counts.get(role.canonical_slug, 0))
            for role in self.list_roles()
            if role.is_active
        ]
        return sorted(
            roles,
            key=lambda role: (
                role.rank if role.rank is not None else 10_000,
                role.role.company.lower(),
                role.role.role.lower(),
            ),
        )

    def list_tasks(self) -> list[TaskRecord]:
        # Tasks are ordered by shortest estimated effort first because the list is
        # used to decide which evidence gaps are quickest to close.
        rows = self.load_data("tasks.yaml", {"tasks": []}).get("tasks", [])
        tasks = [self._task_record(row) for row in rows]
        return sorted(
            tasks,
            key=lambda task: (
                task.estimated_days if task.estimated_days is not None else 10_000,
                task.title.lower(),
                task.id,
            ),
        )

    def get_task(self, task_id: str) -> TaskRecord | None:
        for task in self.list_tasks():
            if task.id == task_id:
                return task
        return None

    def task_usage(self, task_id: str) -> list[RoleRecord]:
        used_by = []
        for role in self.list_roles():
            analysis = role.analysis or {}
            for requirement in analysis.get("requirements", []):
                if task_id in (requirement.get("task_refs") or []):
                    used_by.append(role)
                    break
        return sorted(used_by, key=lambda role: (role.company.lower(), role.role.lower()))

    def update_task_status(self, task_id: str, status: str, detail: str = "") -> None:
        # Closing a task can create a new reusable evidence reference. That evidence
        # is later available to LLM reassessment when requirements cite this task.
        if status not in {"open", "completed", "wont_do"}:
            raise ValueError(f"Unsupported task status: {status}")
        payload = self.load_data("tasks.yaml", {"tasks": []})
        for row in payload.setdefault("tasks", []):
            if row.get("id") == task_id:
                row["status"] = status
                row["status_detail"] = normalize_whitespace(detail)
                if status == "completed" and detail:
                    evidence_refs = row.setdefault("evidence_refs", [])
                    if detail not in evidence_refs:
                        evidence_refs.append(detail)
                self.write_data("tasks.yaml", payload)
                return
        raise FileNotFoundError(f"Unknown task: {task_id}")

    def _task_record(self, row: dict) -> TaskRecord:
        estimated = row.get("estimated_days")
        try:
            estimated_days = int(estimated) if estimated is not None else None
        except (TypeError, ValueError):
            estimated_days = None
        return TaskRecord(
            id=row.get("id", ""),
            title=row.get("title", row.get("id", "")),
            description=row.get("description", ""),
            status=row.get("status", "open"),
            kind=row.get("kind", ""),
            estimated_days=estimated_days,
            feasible_within_one_week=row.get("feasible_within_one_week"),
            acceptance_criteria=list(row.get("acceptance_criteria") or []),
            evidence_refs=list(row.get("evidence_refs") or []),
            status_detail=row.get("status_detail", ""),
            role_id=row.get("role_id"),
        )

    def create_job_markdown(
        self,
        company: str,
        role: str,
        location: str,
        source_url: str,
        source_text: str,
        captured_on: str,
    ) -> str:
        heading = f"# {company} - {role} ({location})"
        source_block = [
            "## Source",
            "",
            f"- URL: {source_url or 'N/A'}",
            f"- Captured on: {captured_on}",
            "",
            "## Description",
            "",
        ]
        return "\n".join([heading, "", *source_block]) + source_text.strip() + "\n"

    def write_bundle(
        self,
        canonical_slug: str,
        company_slug: str,
        location_slug: str,
        role_slug: str,
        job_markdown: str,
        generated: dict,
    ) -> dict[str, str]:
        # A bundle is the complete durable representation of a new role: global
        # indexes, per-role state, extracted job facts, analysis, and artifacts.
        role_dir = f"roles/{canonical_slug}"
        if self.exists(f"{role_dir}/role.yaml"):
            raise FileExistsError(f"Role already exists at {role_dir}")

        metadata = generated["metadata"]
        role_data = {
            "id": canonical_slug,
            "company": metadata["company"],
            "title": metadata["role"],
            "location": metadata["location"],
            "source_url": metadata.get("source_url", ""),
            "captured_on": metadata["captured_on"],
            "priority_rank": None,
            "active": True,
        }
        state_data = {
            "role_id": canonical_slug,
            "status": "draft",
            "status_date": None,
            "status_detail": "",
            "status_artifacts": [],
            "verdict": generated["mirror_summary"]["verdict"],
            "verdict_label": verdict_label(generated["mirror_summary"]["verdict"]),
            "rationale": " ".join(generated["mirror_summary"]["bullets"][:ROLE_STATE_RATIONALE_BULLETS]),
        }
        self.write_data(f"{role_dir}/role.yaml", role_data)
        self.write_data(f"{role_dir}/state.yaml", state_data)
        self.write_text(f"{role_dir}/job.md", job_markdown)
        self.write_text(f"{role_dir}/suitability_report.md", generated["suitability_report"])
        self.write_text(f"{role_dir}/role_matrix.md", generated["role_matrix"])

        analysis_data = self._structured_analysis(canonical_slug=canonical_slug, generated=generated, state_data=state_data)
        self.write_data(f"{role_dir}/analysis.yaml", analysis_data)
        job_data = self._structured_job(
            generated=generated,
            role_data=role_data,
            job_markdown=job_markdown,
            analysis_data=analysis_data,
        )
        self.write_data(f"{role_dir}/job.yaml", job_data)
        prep = generated["interview_prep"]
        artifact_paths = []
        for relative, content in {
            "interview_prep/story_bank.md": prep["story_bank_md"],
            "interview_prep/system_design_bank.md": prep["system_design_bank_md"],
            "interview_prep/security_bank.md": prep["security_bank_md"],
            "interview_prep/coding_plan.md": prep["coding_plan_md"],
        }.items():
            path = f"{role_dir}/artifacts/{relative}"
            self.write_text(path, content)
            artifact_paths.append({"kind": Path(relative).stem, "path": path})
        self.write_data(f"{role_dir}/artifacts.yaml", {"artifacts": artifact_paths})
        self.write_data(f"{role_dir}/tasks.yaml", {"tasks": []})
        self.write_data(f"{role_dir}/events.yaml", {"events": []})
        self._upsert_global_row("roles.yaml", "roles", role_data, "id")
        self._upsert_global_row("role_states.yaml", "role_states", state_data, "role_id")
        return {
            "job_file": f"{role_dir}/job.md",
            "job_data": f"{role_dir}/job.yaml",
            "analysis": f"{role_dir}/analysis.yaml",
            "report": f"{role_dir}/suitability_report.md",
            "role_matrix": f"{role_dir}/role_matrix.md",
            "output_dir": f"{role_dir}/artifacts",
        }

    def _structured_analysis(self, canonical_slug: str, generated: dict, state_data: dict) -> dict:
        # The LLM must return structured analysis directly. This normalizer only
        # fills defaults and enforces enum-safe shapes; it does not parse prose.
        analysis = generated.get("analysis")
        if not isinstance(analysis, dict) or not isinstance(analysis.get("requirements"), list):
            raise ValueError("LLM bundle response must include structured analysis with a requirements list.")
        analysis = dict(analysis)
        analysis["version"] = analysis.get("version") or 1
        analysis["role_id"] = canonical_slug
        summary = dict(analysis.get("summary") or {})
        summary["verdict"] = summary.get("verdict") or state_data.get("verdict", "")
        summary["verdict_label"] = summary.get("verdict_label") or verdict_label(summary.get("verdict", ""))
        summary["recommendation"] = summary.get("recommendation") or {"value": "", "reason": ""}
        summary["rationale"] = normalize_whitespace(summary.get("rationale", "") or state_data.get("rationale", ""))
        summary["notes"] = list(summary.get("notes") or [])
        analysis["summary"] = summary
        requirements = []
        for index, requirement in enumerate(analysis.get("requirements") or [], start=1):
            if not isinstance(requirement, dict):
                continue
            requirements.append(self._structured_requirement(requirement, index))
        analysis["requirements"] = requirements
        if not requirements:
            raise ValueError("LLM bundle response analysis.requirements must not be empty.")
        for key, default in {
            "strengths": [],
            "gaps": [],
            "work_items": [],
            "timeline": [],
            "gap_tasks": {},
            "comments": [],
            "llm_context": {},
        }.items():
            analysis[key] = analysis.get(key) if isinstance(analysis.get(key), type(default)) else default
        return analysis

    def _structured_job(self, generated: dict, role_data: dict, job_markdown: str, analysis_data: dict) -> dict:
        # job.yaml stores the original posting plus extracted facts. The web app and
        # reassessment code read this file instead of asking an LLM to interpret text.
        job = generated.get("job")
        if not isinstance(job, dict):
            raise ValueError("LLM bundle response must include structured job data.")
        job = dict(job)
        job["version"] = job.get("version") or 1
        job["role_id"] = role_data["id"]
        job["company"] = role_data["company"]
        job["title"] = role_data["title"]
        job["location"] = role_data["location"]
        job["source_url"] = role_data.get("source_url", "")
        job["captured_on"] = role_data.get("captured_on", "")
        job["priority_rank"] = role_data.get("priority_rank")
        job["active"] = role_data.get("active", True)
        posting = dict(job.get("posting") or {})
        posting["raw_text"] = posting.get("raw_text") or job_markdown
        job["posting"] = posting
        extracted = dict(job.get("extracted") or {})
        if "skills" not in extracted and "tech_stack" in extracted:
            extracted["skills"] = extracted.get("tech_stack") or []
        extracted.pop("tech_stack", None)
        for key in ("responsibilities", "hard_requirements", "soft_requirements", "inferred_requirements", "skills", "interview_focus"):
            extracted[key] = list(extracted.get(key) or [])
        job["extracted"] = extracted
        job["requirements"] = [
            self._structured_requirement(requirement, index)
            for index, requirement in enumerate(job.get("requirements") or analysis_data.get("requirements") or [], start=1)
            if isinstance(requirement, dict)
        ]
        if not job["requirements"]:
            raise ValueError("LLM bundle response job.requirements must not be empty.")
        return job

    def _structured_requirement(self, requirement: dict, index: int) -> dict:
        # Requirements are CV-answerable criteria. Responsibilities that cannot be
        # answered by evidence should stay in job.extracted or analysis comments.
        category = requirement.get("category") or "inferred_requirement"
        if category not in {"hard_requirement", "soft_requirement", "inferred_requirement"}:
            category = "inferred_requirement"
        fulfillment = requirement.get("fulfillment") or "unknown"
        if fulfillment not in {"met", "partial", "unmet", "unknown"}:
            fulfillment = "unknown"
        task_refs = list(requirement.get("task_refs") or [])
        if fulfillment == "met":
            task_refs = []
        return {
            "id": requirement.get("id") or f"req_{index:03d}",
            "text": normalize_whitespace(requirement.get("text", "")),
            "category": category,
            "fulfillment": fulfillment,
            "evidence": list(requirement.get("evidence") or []),
            "gap": normalize_whitespace(requirement.get("gap", "")),
            "patch_plan": normalize_whitespace(requirement.get("patch_plan", "")),
            "task_refs": task_refs,
            "feasible": requirement.get("feasible", True),
        }

    def role_reassessment_context(self, canonical_slug: str) -> dict:
        role = self.get_role(canonical_slug)
        if role is None:
            raise FileNotFoundError(f"Unknown role: {canonical_slug}")
        role_dir = f"roles/{canonical_slug}"
        return {
            "role": self.load_data(f"{role_dir}/role.yaml", {"id": canonical_slug}),
            "role_state": self.load_data(f"{role_dir}/state.yaml", {"role_id": canonical_slug}),
            "job": self.load_data(f"{role_dir}/job.yaml", {}),
            "current_analysis": self.load_data(f"{role_dir}/analysis.yaml", {}),
            "tasks": self.load_data("tasks.yaml", {"tasks": []}).get("tasks", []),
            "cv_yaml": self.read_text("cv/cv.yaml") if self.exists("cv/cv.yaml") else "",
            "context": self.load_data("context/context.yaml", {}),
            "evidence_library": self.load_data("library/evidence.yaml", {}),
        }

    def write_reassessed_analysis(self, canonical_slug: str, analysis: dict) -> None:
        role = self.get_role(canonical_slug)
        if role is None:
            raise FileNotFoundError(f"Unknown role: {canonical_slug}")
        state_data = self.load_data(f"roles/{canonical_slug}/state.yaml", {"role_id": canonical_slug})
        analysis_data = self._structured_analysis(
            canonical_slug=canonical_slug,
            generated={"analysis": analysis},
            state_data=state_data,
        )
        self.write_data(f"roles/{canonical_slug}/analysis.yaml", analysis_data)

        summary = analysis_data.get("summary") or {}
        if summary.get("verdict"):
            state_data["verdict"] = summary["verdict"]
            state_data["verdict_label"] = summary.get("verdict_label") or verdict_label(summary["verdict"])
        if summary.get("rationale"):
            state_data["rationale"] = summary["rationale"]
        self.write_data(f"roles/{canonical_slug}/state.yaml", state_data)
        self._upsert_global_row("role_states.yaml", "role_states", state_data, "role_id")

    def append_analysis_notes(self, canonical_slug: str, notes: Iterable[str]) -> None:
        normalized_notes = [normalize_whitespace(note) for note in notes if normalize_whitespace(note)]
        if not normalized_notes:
            return
        role = self.get_role(canonical_slug)
        if role is None:
            raise FileNotFoundError(f"Unknown role: {canonical_slug}")

        analysis_data = self.load_data(f"roles/{canonical_slug}/analysis.yaml", {})
        summary = dict(analysis_data.get("summary") or {})
        existing_notes = list(summary.get("notes") or [])
        for note in normalized_notes:
            if note not in existing_notes:
                existing_notes.append(note)
        summary["notes"] = existing_notes
        analysis_data["summary"] = summary
        self.write_data(f"roles/{canonical_slug}/analysis.yaml", analysis_data)

    def record_status(
        self,
        canonical_slug: str,
        event_type: str,
        exact_date: str,
        note: str,
        artifacts: Iterable[str] | None = None,
    ) -> None:
        # Status updates modify the current role process row and append an event. The
        # row answers "where is this role process now?"; the event answers "what happened?"
        role = self.get_role(canonical_slug)
        if role is None:
            raise FileNotFoundError(f"Unknown role: {canonical_slug}")

        artifact_list = list(artifacts or [])
        state_data = self.load_data(f"roles/{canonical_slug}/state.yaml")
        state_data.update(
            {
                "status": status_key_for_event(event_type),
                "status_date": exact_date,
                "status_detail": normalize_whitespace(note),
                "status_artifacts": artifact_list,
            }
        )
        self.write_data(f"roles/{canonical_slug}/state.yaml", state_data)
        self._upsert_global_row("role_states.yaml", "role_states", state_data, "role_id")

        event = {
            "id": f"event-{uuid.uuid4()}",
            "role_id": canonical_slug,
            "type": event_type,
            "date": exact_date,
            "detail": self._decision_line_for_event(role, event_type, exact_date, note, artifact_list),
            "artifacts": artifact_list,
        }
        self._append_global_row("events.yaml", "events", event)
        role_events = self.load_data(f"roles/{canonical_slug}/events.yaml", {"events": []})
        role_events.setdefault("events", []).append(event)
        self.write_data(f"roles/{canonical_slug}/events.yaml", role_events)

    def record_note_event(self, canonical_slug: str, exact_date: str, detail: str) -> None:
        role = self.get_role(canonical_slug)
        if role is None:
            raise FileNotFoundError(f"Unknown role: {canonical_slug}")
        detail = normalize_whitespace(detail)
        if not detail:
            return
        event = {
            "id": f"event-{uuid.uuid4()}",
            "role_id": canonical_slug,
            "type": "note",
            "date": exact_date,
            "detail": detail,
            "artifacts": [],
        }
        self._append_global_row("events.yaml", "events", event)
        role_events = self.load_data(f"roles/{canonical_slug}/events.yaml", {"events": []})
        role_events.setdefault("events", []).append(event)
        self.write_data(f"roles/{canonical_slug}/events.yaml", role_events)

    def ensure_generic_cv(self) -> Path:
        # The web app serves the PDF from CVAI_DATA. If it is missing, the bundled
        # Typst renderer builds it on demand from the structured CV YAML.
        return self.ensure_cv_pdf("demo")

    def list_pdf_templates(self) -> list[TemplatePack]:
        """List installed PDF templates from the data directory."""
        return list_template_packs(self.root)

    def cv_pdf_filename(self, template: str) -> str:
        """Build the deterministic cached PDF filename for a template."""
        cv = self.load_data("cv/cv.yaml", {})
        contact = cv.get("contact") if isinstance(cv, dict) else {}
        if not isinstance(contact, dict):
            contact = {}
        first_name = str(contact.get("name") or "").strip()
        last_name = str(contact.get("surname") or "").strip()
        initial = slugify(first_name[:CV_FILENAME_INITIAL_CHARS] or "cv")
        surname = slugify(last_name or "cv")
        template_slug = slugify(template)
        return f"{initial}{surname}-{template_slug}.pdf"

    def ensure_cv_pdf(self, template: str) -> Path:
        """Build or return the cached base-CV PDF for one installed template."""
        output_path = self.resolve(f"cv/{self.cv_pdf_filename(template)}")
        if output_path.exists():
            return output_path
        return PDFRenderer(self.resolve("pdf/templates")).build_cv(
            source=self.resolve("cv/cv.yaml"),
            output=output_path,
            template=template,
        )

    def _upsert_global_row(self, relative_path: str, key: str, row: dict, id_field: str) -> None:
        # Mirrors are keyed by their natural ID. Upsert keeps writes idempotent when
        # a role state or role summary is updated.
        payload = self.load_data(relative_path, {key: []})
        rows = payload.setdefault(key, [])
        for index, existing in enumerate(rows):
            if existing.get(id_field) == row.get(id_field):
                rows[index] = row
                break
        else:
            rows.append(row)
        self.write_data(relative_path, payload)

    def _append_global_row(self, relative_path: str, key: str, row: dict) -> None:
        # Event logs are append-only; each event gets a UUID so insert order is not
        # encoded into the ID and concurrent writers are less likely to collide.
        payload = self.load_data(relative_path, {key: []})
        payload.setdefault(key, []).append(row)
        self.write_data(relative_path, payload)

    def _status_line_for_event(
        self,
        event_type: str,
        exact_date: str,
        note: str,
        artifacts: Iterable[str] | None,
    ) -> str:
        note = normalize_whitespace(note)
        if event_type == "submitted":
            if artifacts:
                artifact_text = ", ".join(f"`{artifact}`" for artifact in artifacts)
                extra = f" using {artifact_text}"
            else:
                extra = ""
            return f"Submitted on {exact_date}{extra}"
        if event_type == "interviewing":
            return f"Interviewing on {exact_date}" + (f" ({note})" if note else "")
        if event_type == "accepted":
            return f"Accepted on {exact_date}" + (f" ({note})" if note else "")
        if event_type == "rejected":
            return f"Rejected on {exact_date}" + (f" ({note})" if note else "")
        if event_type == "closed":
            return f"Closed on {exact_date}" + (f" ({note})" if note else "")
        raise ValueError(f"Unsupported event type: {event_type}")

    def _decision_line_for_event(
        self,
        role: RoleRecord,
        event_type: str,
        exact_date: str,
        note: str,
        artifacts: Iterable[str] | None,
    ) -> str:
        note = normalize_whitespace(note)
        if event_type == "submitted":
            return f"{role.company} `{role.role}` role was submitted."
        if event_type == "interviewing":
            return f"{role.company} `{role.role}` role is in interview stage." + (f" {note}" if note else "")
        if event_type == "accepted":
            return f"{role.company} `{role.role}` role was accepted." + (f" {note}" if note else "")
        if event_type == "rejected":
            return f"{role.company} `{role.role}` role was rejected." + (f" {note}" if note else "")
        if event_type == "closed":
            return f"{role.company} `{role.role}` role was closed." + (f" {note}" if note else "")
        raise ValueError(f"Unsupported event type: {event_type}")


def default_repo_root() -> Path:
    """Find the data directory for local development or deployed runtime."""
    configured = os.environ.get("CVAI_DATA")
    if configured:
        return Path(configured).resolve()
    return (Path(__file__).resolve().parents[1] / "tests" / "fixture_data" / "demo-db").resolve()
