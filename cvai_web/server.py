from __future__ import annotations

import io
import json
import os
import re
import threading
import traceback
import urllib.parse
import urllib.request
import uuid
import html as html_lib
import ipaddress
import socket
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable

from cvai_core.llm import OpenAIAPIError, OpenAIClient
from cvai_core.repo import Repository, default_repo_root, slugify
from cvai_core.schema import assert_valid_data_root, initialize_data_root


ALLOWED_URL_SCHEMES = {"https"}

# URL intake should fail quickly on slow or blocking job boards while still
# allowing ordinary career pages enough time to respond.
URL_INTAKE_FETCH_TIMEOUT_SECONDS = 45


class TextExtractor(HTMLParser):
    # First-pass URL intake favors visible page text because many job boards put
    # readable descriptions in normal HTML even when structured metadata is sparse.
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip_depth += 1
        if self._skip_depth == 0 and tag in {"p", "div", "section", "article", "br", "li", "h1", "h2", "h3", "h4"}:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self._skip_depth > 0:
            self._skip_depth -= 1
        if self._skip_depth == 0 and tag in {"p", "div", "section", "article", "li"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth == 0:
            self._parts.append(data)

    def get_text(self) -> str:
        text = "".join(self._parts)
        lines = [line.strip() for line in text.splitlines()]
        return "\n".join(line for line in lines if line)


class JobPostingExtractor(HTMLParser):
    # Fallback extractor for sites whose visible DOM is empty in a simple fetch but
    # whose metadata still contains schema.org JobPosting or OpenGraph text.
    def __init__(self) -> None:
        super().__init__()
        self._in_json_ld = False
        self._json_ld_parts: list[str] = []
        self.meta: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): value or "" for key, value in attrs}
        if tag == "script" and attrs_dict.get("type", "").lower() == "application/ld+json":
            self._in_json_ld = True
        if tag == "meta":
            key = attrs_dict.get("property") or attrs_dict.get("name")
            content = attrs_dict.get("content", "")
            if key and content:
                self.meta[key] = content

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self._in_json_ld = False

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._json_ld_parts.append(data)

    def get_text(self) -> str:
        for raw in self._json_ld_parts:
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue
            posting = self._find_job_posting(payload)
            if posting:
                return self._format_posting(posting)
        title = self.meta.get("og:title") or self.meta.get("title", "")
        description = self.meta.get("og:description") or self.meta.get("description", "")
        if title or description:
            return "\n\n".join(part for part in (title, html_lib.unescape(description)) if part)
        return ""

    def _find_job_posting(self, payload) -> dict | None:
        # JSON-LD can appear as one object, a list, or an @graph. Recursing through
        # all three shapes handles common job-board serializers without a full
        # schema.org implementation.
        if isinstance(payload, dict):
            if payload.get("@type") == "JobPosting":
                return payload
            graph = payload.get("@graph")
            if isinstance(graph, list):
                for item in graph:
                    found = self._find_job_posting(item)
                    if found:
                        return found
        if isinstance(payload, list):
            for item in payload:
                found = self._find_job_posting(item)
                if found:
                    return found
        return None

    def _format_posting(self, posting: dict) -> str:
        location = posting.get("jobLocation") or {}
        address = location.get("address") if isinstance(location, dict) else {}
        organization = posting.get("hiringOrganization") or {}
        parts = [
            f"Title: {posting.get('title', '')}",
            f"Company: {organization.get('name', '') if isinstance(organization, dict) else ''}",
            f"Location: {address.get('addressLocality', '') if isinstance(address, dict) else ''}, {address.get('addressCountry', '') if isinstance(address, dict) else ''}".strip(" ,"),
            f"Date posted: {posting.get('datePosted', '')}",
            "",
            html_lib.unescape(re.sub(r"<[^>]+>", " ", posting.get("description", ""))),
        ]
        return normalize_visible_text("\n".join(part for part in parts if part is not None))


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Validate every redirect target before urllib follows it."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        validate_public_https_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def validate_public_https_url(source_url: str) -> None:
    """Reject URL-intake targets that could reach private infrastructure.

    SSRF protection has two layers: the URL must be HTTPS, and every resolved IP
    address must be globally routable. This rejects localhost, RFC1918 private
    ranges, link-local, multicast, and other non-public addresses before fetch.
    """
    parsed = urllib.parse.urlparse(source_url)
    if parsed.scheme not in ALLOWED_URL_SCHEMES:
        raise ValueError("URL intake only supports https:// job-posting URLs.")
    if not parsed.hostname:
        raise ValueError("URL intake requires a hostname.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve URL hostname: {parsed.hostname}") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError("URL intake rejected a non-public network address.")


def normalize_visible_text(text: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


@dataclass
class Action:
    # Actions are durable user requests. A background job may execute an action,
    # but jobs remain an internal implementation detail.
    id: str
    kind: str
    status: str = "queued"
    log_lines: list[str] = field(default_factory=list)
    result: dict | None = None
    error: str | None = None
    action_type: str = ""
    target_type: str = ""
    target_id: str = ""
    prompt: str = ""
    input: dict = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))
    updated_at: str = ""
    completed_at: str = ""
    _persist: Callable[[], None] | None = field(default=None, repr=False, compare=False)

    def log(self, message: str) -> None:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.log_lines.append(f"[{timestamp}] {message}")
        self.touch()

    def touch(self) -> None:
        self.updated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if self._persist:
            self._persist()

    @property
    def cancelled(self) -> bool:
        return self.status == "cancelled"

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "log": "\n".join(self.log_lines),
            "log_lines": list(self.log_lines),
            "result": self.result,
            "error": self.error,
            "action_type": self.action_type,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "prompt": self.prompt,
            "input": self.input,
            "created_at": self.created_at,
            "updated_at": self.updated_at or self.created_at,
            "completed_at": self.completed_at,
        }


Operation = Action


class ActionManager:
    # ActionManager isolates thread handling from HTTP routes and persists action
    # records so the UI has an audit trail across server restarts.
    def __init__(self, repo: Repository) -> None:
        self.repo = repo
        self._actions: dict[str, Action] = {}
        self._operations = self._actions
        self._threads: dict[str, threading.Thread] = {}
        self._lock = threading.Lock()
        self._load()

    def create(
        self,
        kind: str,
        worker: Callable[[Action], None],
        *,
        action_type: str = "",
        target_type: str = "",
        target_id: str = "",
        prompt: str = "",
        input: dict | None = None,
    ) -> Action:
        action_id = f"action-{uuid.uuid4()}"
        action = Action(
            id=action_id,
            kind=kind,
            action_type=action_type or kind,
            target_type=target_type,
            target_id=target_id,
            prompt=prompt,
            input=input or {},
        )
        action._persist = self.save
        with self._lock:
            self._actions[action_id] = action
            self.save()
        thread = threading.Thread(target=self._run, args=(action, worker), daemon=True)
        with self._lock:
            self._threads[action_id] = thread
        thread.start()
        return action

    def _run(self, action: Action, worker: Callable[[Action], None]) -> None:
        try:
            action.status = "running"
            action.touch()
            worker(action)
            if action.status != "cancelled":
                action.status = "completed"
        except OpenAIAPIError as exc:
            if action.status == "cancelled":
                return
            action.status = "failed"
            action.error = str(exc)
            action.log(exc.detail)
        except Exception as exc:  # noqa: BLE001
            if action.status == "cancelled":
                return
            action.status = "failed"
            action.error = str(exc)
            action.log(traceback.format_exc())
        finally:
            if action.status in {"completed", "failed", "cancelled"} and not action.completed_at:
                action.completed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            action.touch()
            with self._lock:
                self._threads.pop(action.id, None)

    def get(self, action_id: str) -> Action | None:
        return self._actions.get(action_id)

    def cancel(self, action_id: str) -> Action | None:
        action = self.get(action_id)
        if action is None:
            return None
        if action.status in {"queued", "running"}:
            action.status = "cancelled"
            action.log("Action cancelled by user.")
        return action

    def list(self) -> list[Action]:
        return sorted(self._actions.values(), key=lambda action: action.created_at, reverse=True)

    def active_count(self) -> int:
        return sum(1 for action in self._actions.values() if action.status in {"queued", "running"})

    def wait_for_idle(self, timeout: float | None = None) -> None:
        """Wait for currently running background operations to finish.

        Production code normally lets action threads finish asynchronously while
        the UI polls. Tests use this before deleting temporary data roots so a
        final action persistence write cannot race directory cleanup.
        """
        with self._lock:
            threads = list(self._threads.values())
        for thread in threads:
            thread.join(timeout=timeout)

    def save(self) -> None:
        payload = {"actions": [action.as_dict() for action in self._actions.values()]}
        self.repo.write_data("actions.yaml", payload)

    def _load(self) -> None:
        payload = self.repo.load_data("actions.yaml", {"actions": []})
        if not isinstance(payload, dict):
            return
        for row in payload.get("actions", []):
            if not isinstance(row, dict) or not str(row.get("id", "")).startswith("action-"):
                continue
            action = Action(
                id=str(row.get("id")),
                kind=str(row.get("kind", "")),
                status=str(row.get("status", "completed")),
                log_lines=list(row.get("log_lines") or str(row.get("log", "")).splitlines()),
                result=row.get("result"),
                error=row.get("error"),
                action_type=str(row.get("action_type", "")),
                target_type=str(row.get("target_type", "")),
                target_id=str(row.get("target_id", "")),
                prompt=str(row.get("prompt", "")),
                input=row.get("input") if isinstance(row.get("input"), dict) else {},
                created_at=str(row.get("created_at", "")) or datetime.now(timezone.utc).isoformat(timespec="seconds"),
                updated_at=str(row.get("updated_at", "")),
                completed_at=str(row.get("completed_at", "")),
            )
            if action.status in {"queued", "running"}:
                action.status = "failed"
                action.error = "Action interrupted by server restart."
                action.log_lines.append(f"[{datetime.now(timezone.utc).isoformat(timespec='seconds')}] Action interrupted by server restart.")
                action.completed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
            action._persist = self.save
            self._actions[action.id] = action
        if self._actions:
            self.save()


class WebApp:
    # WebApp is the service object behind the FastAPI routes. It owns workflow
    # methods and the action/job manager; HTTP rendering lives in Jinja routes.
    def __init__(self, repo: Repository, llm: OpenAIClient) -> None:
        self.repo = repo
        self.llm = llm
        self.actions = ActionManager(repo)
        self.operations = self.actions

    def _run_url_ingestion(self, operation: Operation, source_url: str) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before intake operations can run.")
        operation.log(f"Fetching role page: {source_url}")
        source_text = self._fetch_url_text(source_url)
        if operation.cancelled:
            return
        operation.log(f"Fetched {len(source_text)} characters of visible page text.")
        extracted = self.llm.extract_role(
            source_kind="url",
            source_url=source_url,
            source_text=source_text,
            strict=True,
        )
        if not extracted.get("clear"):
            reason = extracted.get("reason") or "The role metadata was not fully clear from the page."
            raise RuntimeError(reason + " Please use pasted-text intake instead.")
        self._complete_ingestion(operation, source_text, source_url, extracted)

    def _run_url_quick_analysis(self, operation: Operation, source_url: str) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before quick analysis can run.")
        operation.log(f"Fetching role page: {source_url}")
        source_text = self._fetch_url_text(source_url)
        if operation.cancelled:
            return
        operation.log(f"Fetched {len(source_text)} characters of visible page text.")
        analysis = self._quick_analyze_source(source_kind="url", source_url=source_url, source_text=source_text)
        if operation.cancelled:
            return
        operation.result = {
            "quick_analysis": analysis,
            "intake": {
                "kind": "url",
                "source_url": source_url,
                "source_text": source_text,
                "overrides": {},
            },
        }
        operation.log("Quick analysis completed. Continue or close this preview from the action page.")

    def _run_text_ingestion(
        self,
        operation: Operation,
        source_text: str,
        source_url: str,
        overrides: dict[str, str],
    ) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before intake operations can run.")
        operation.log("Extracting metadata from pasted text.")
        extracted = self.llm.extract_role(
            source_kind="text",
            source_url=source_url,
            source_text=source_text,
            strict=False,
            overrides=overrides,
        )
        if not extracted.get("clear"):
            reason = extracted.get("reason") or "The pasted text still did not provide a clear company, role, and location."
            raise RuntimeError(reason)
        if operation.cancelled:
            return
        self._complete_ingestion(operation, source_text, source_url, extracted)

    def _run_text_quick_analysis(
        self,
        operation: Operation,
        source_text: str,
        source_url: str,
        overrides: dict[str, str],
    ) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before quick analysis can run.")
        operation.log("Running quick fit analysis for pasted text.")
        analysis = self._quick_analyze_source(source_kind="text", source_url=source_url, source_text=source_text)
        if operation.cancelled:
            return
        operation.result = {
            "quick_analysis": analysis,
            "intake": {
                "kind": "text",
                "source_url": source_url,
                "source_text": source_text,
                "overrides": overrides,
            },
        }
        operation.log("Quick analysis completed. Continue or close this preview from the action page.")

    def _quick_analyze_source(self, *, source_kind: str, source_url: str, source_text: str) -> dict:
        analysis = self.llm.quick_analyze_role(
            source_kind=source_kind,
            source_url=source_url,
            source_text=source_text,
            cv_yaml=self.repo.read_text("cv/cv.yaml") if self.repo.exists("cv/cv.yaml") else "",
            context=self.repo.load_data("context/context.yaml", {}),
            evidence_library=self.repo.load_data("library/evidence.yaml", {}),
            tasks=[
                {
                    "id": task.id,
                    "title": task.title,
                    "description": task.description,
                    "status": task.status,
                    "estimated_days": task.estimated_days,
                    "acceptance_criteria": task.acceptance_criteria,
                    "evidence_refs": task.evidence_refs,
                }
                for task in self.repo.list_tasks()
                if task.status == "open"
            ],
        )
        if not isinstance(analysis, dict):
            raise RuntimeError("Quick analysis did not return structured data.")
        if not analysis.get("clear", True):
            raise RuntimeError(analysis.get("reason") or "The quick analysis was not clear enough to show.")
        return {
            "summary": normalize_visible_text(str(analysis.get("summary", ""))),
            "fit_level": str(analysis.get("fit_level", "unknown")),
            "key_matching_abilities": list(analysis.get("key_matching_abilities") or []),
            "important_gaps": list(analysis.get("important_gaps") or []),
            "recommendation": str(analysis.get("recommendation", "review")),
            "rationale": normalize_visible_text(str(analysis.get("rationale", ""))),
        }

    def _run_full_ingestion_from_preview(self, operation: Operation, intake: dict) -> None:
        source_kind = intake.get("kind", "text")
        source_url = intake.get("source_url", "")
        source_text = intake.get("source_text", "")
        overrides = intake.get("overrides") or {}
        if source_kind == "url":
            operation.log("Continuing full ingestion from quick URL analysis.")
            extracted = self.llm.extract_role(
                source_kind="url",
                source_url=source_url,
                source_text=source_text,
                strict=True,
            )
            if not extracted.get("clear"):
                reason = extracted.get("reason") or "The role metadata was not fully clear from the page."
                raise RuntimeError(reason + " Please use pasted-text intake instead.")
            if operation.cancelled:
                return
            self._complete_ingestion(operation, source_text, source_url, extracted)
            return

        operation.log("Continuing full ingestion from quick pasted-text analysis.")
        self._run_text_ingestion(operation, source_text, source_url, overrides)

    def _complete_ingestion(self, operation: Operation, source_text: str, source_url: str, extracted: dict) -> None:
        # The slug is the durable role identity. It is computed once from extracted
        # metadata and then used consistently across indexes and role-local files.
        metadata = {
            "company": extracted["company"].strip(),
            "location": extracted["location"].strip(),
            "role": extracted["role"].strip(),
            "source_url": source_url,
            "captured_on": date.today().isoformat(),
        }
        metadata["company_slug"] = slugify(metadata["company"])
        metadata["location_slug"] = slugify(metadata["location"])
        metadata["role_slug"] = slugify(metadata["role"])
        metadata["canonical_slug"] = (
            f"{metadata['company_slug']}_{metadata['location_slug']}_{metadata['role_slug']}"
        )
        operation.log(f"Resolved role: {metadata['company']} / {metadata['location']} / {metadata['role']}")
        job_markdown = self.repo.create_job_markdown(
            company=metadata["company"],
            role=metadata["role"],
            location=metadata["location"],
            source_url=source_url,
            source_text=source_text,
            captured_on=metadata["captured_on"],
        )
        operation.log("Generating repository bundle with the configured LLM API.")
        generated = self.llm.generate_bundle(
            metadata=metadata,
            workflow_text=self.repo.read_text("README.md"),
            cv_yaml=self.repo.read_text("cv/cv.yaml"),
            claims_text=self.repo.read_text("library/skills_map.md") if self.repo.exists("library/skills_map.md") else "",
            job_markdown=job_markdown,
            examples={
                "suitability_report": "",
                "role_matrix": "",
            },
        )
        if operation.cancelled:
            return
        operation.log("Writing generated files into the repository.")
        paths = self.repo.write_bundle(
            canonical_slug=metadata["canonical_slug"],
            company_slug=metadata["company_slug"],
            location_slug=metadata["location_slug"],
            role_slug=metadata["role_slug"],
            job_markdown=job_markdown,
            generated=generated,
        )
        operation.result = {"canonical_slug": metadata["canonical_slug"], "paths": paths}
        operation.log("Ingestion completed.")

    def _run_prompt_update(self, operation: Operation, canonical_slug: str, prompt: str) -> None:
        role = self.repo.get_role(canonical_slug)
        if role is None:
            raise FileNotFoundError(f"Unknown role: {canonical_slug}")
        operation.log(f"Interpreting update prompt for {role.company} / {role.role}.")
        today = date.today().isoformat()
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before update prompts can run.")
        # Prompt updates are intentionally constrained to data operations. The LLM
        # decides implications, but Repository methods decide exactly which files
        # can change and how those changes are shaped.
        interpreted = self.llm.interpret_status_update(
            role={
                "canonical_slug": canonical_slug,
                "company": role.company,
                "role": role.role,
                "location": role.location,
                "current_status": role.role_status,
                "related_open_tasks": self._related_open_task_context(canonical_slug),
            },
            prompt=prompt,
            today=today,
        )
        interpreted["_prompt"] = prompt
        if not interpreted.get("clear"):
            reason = interpreted.get("reason") or "The prompt was not clear enough to apply as a tracked status update."
            raise RuntimeError(reason)
        paths = self._apply_interpreted_update(canonical_slug, role, interpreted)
        self.repo.record_note_event(canonical_slug, today, f"Update prompt: {prompt}")
        operation.result = {"canonical_slug": canonical_slug, "paths": paths}
        if paths.get("operations"):
            operation.log(f"Applied {len(paths['operations'])} LLM-returned operation(s).")
        else:
            operation.log(f"Applied {interpreted['event_type']} status dated {interpreted['exact_date']}.")

    def _run_datastore_prompt_action(self, operation: Operation, prompt: str) -> None:
        operation.log("Interpreting datastore prompt.")
        today = date.today().isoformat()
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before prompt actions can run.")
        interpreted = self.llm.interpret_datastore_action(
            prompt=prompt,
            today=today,
            roles=[
                {
                    "canonical_slug": dashboard_role.role.canonical_slug,
                    "company": dashboard_role.role.company,
                    "role": dashboard_role.role.role,
                    "location": dashboard_role.role.location,
                    "status": dashboard_role.role.status,
                    "status_date": dashboard_role.role.status_date,
                    "current_status": dashboard_role.role.role_status,
                    "status_detail": dashboard_role.role.status_detail,
                }
                for dashboard_role in self.repo.list_dashboard_roles()
            ],
            tasks=[
                {
                    "id": task.id,
                    "title": task.title,
                    "description": task.description,
                    "status": task.status,
                    "status_detail": task.status_detail,
                }
                for task in self.repo.list_tasks()
            ],
        )
        if not interpreted.get("clear"):
            reason = interpreted.get("reason") or "The prompt was not clear enough to apply as CVAI data changes."
            raise RuntimeError(reason)
        operations = interpreted.get("operations") or []
        if not operations:
            raise RuntimeError("The prompt did not produce any supported data changes.")
        applied = []
        for update_operation in operations:
            role_id = update_operation.get("role_id") if isinstance(update_operation, dict) else ""
            role = self.repo.get_role(role_id) if isinstance(role_id, str) else None
            if self._apply_update_operation(role_id if isinstance(role_id, str) else "", role, update_operation):
                applied.append(update_operation.get("op", "unknown"))
        if not applied:
            raise RuntimeError("The prompt did not produce any supported data changes.")
        operation.result = {"paths": {"actions": "actions.yaml"}, "operations": applied}
        operation.log(f"Applied {len(applied)} LLM-returned operation(s).")

    def _apply_interpreted_update(self, canonical_slug: str, role, interpreted: dict) -> dict:
        operations = self._enriched_update_operations(canonical_slug, role, interpreted)
        if operations:
            # Prefer explicit operations over scalar fallback fields. This lets the
            # LLM express multi-file consequences without rewriting whole YAML files.
            applied = []
            for operation in operations:
                if self._apply_update_operation(canonical_slug, role, operation):
                    applied.append(operation.get("op", "unknown"))
            return {"operations": applied}

        # Backward-compatible scalar path for simple status-only LLM responses.
        event_type = interpreted["event_type"]
        exact_date = interpreted["exact_date"]
        note = interpreted.get("note", "")
        artifacts = []
        if event_type == "submitted":
            artifacts = [artifact for artifact in role.artifacts if artifact.endswith(("resume.md", "cover_letter.md"))]
        self.repo.record_status(canonical_slug, event_type, exact_date, note, artifacts=artifacts)
        internal_notes = interpreted.get("internal_notes") or []
        if isinstance(internal_notes, str):
            internal_notes = [internal_notes]
        if internal_notes:
            self.repo.append_analysis_notes(canonical_slug, internal_notes)
        paths = {"role_state": f"roles/{canonical_slug}/state.yaml"}
        if internal_notes:
            paths["analysis"] = f"roles/{canonical_slug}/analysis.yaml"
        return paths

    def _enriched_update_operations(self, canonical_slug: str, role, interpreted: dict) -> list[dict]:
        operations = list(interpreted.get("operations") or [])
        raw_prompt = interpreted.get("_prompt", "")
        if not raw_prompt:
            return operations
        scheduling_update = self._interview_availability_update(raw_prompt)
        if scheduling_update is None:
            return operations

        status_ops = [
            operation
            for operation in operations
            if isinstance(operation, dict) and operation.get("op") == "record_status"
        ]
        for operation in status_ops:
            if operation.get("event_type") == "submitted":
                operation["event_type"] = "interviewing"
                operation["exact_date"] = operation.get("exact_date") or scheduling_update["date"]
                operation["note"] = scheduling_update["note"]

        if not status_ops:
            operations.insert(
                0,
                {
                    "op": "record_status",
                    "role_id": canonical_slug,
                    "event_type": "interviewing",
                    "exact_date": scheduling_update["date"],
                    "note": scheduling_update["note"],
                },
            )

        if scheduling_update["internal_note"] and not any(
            operation.get("op") == "append_analysis_notes" for operation in operations if isinstance(operation, dict)
        ):
            operations.append(
                {
                    "op": "append_analysis_notes",
                    "role_id": canonical_slug,
                    "notes": [scheduling_update["internal_note"]],
                }
            )

        if not any(operation.get("op") == "update_task_status" for operation in operations if isinstance(operation, dict)):
            related_task = self._related_scheduling_task(canonical_slug)
            if related_task is not None:
                operations.append(
                    {
                        "op": "update_task_status",
                        "task_id": related_task.id,
                        "status": "open",
                        "detail": scheduling_update["detail"],
                    }
                )
        return operations

    def _related_scheduling_task(self, canonical_slug: str):
        for task in self._repo_tasks():
            if task.role_id != canonical_slug or task.status != "open":
                continue
            text = f"{task.title} {task.description}".lower()
            if task.kind == "follow_up" and ("interview" in text or "schedul" in text or "availability" in text):
                return task
        return None

    def _related_open_task_context(self, canonical_slug: str) -> list[dict]:
        return [
            {
                "id": task.id,
                "title": task.title,
                "description": task.description,
                "kind": task.kind,
                "status": task.status,
                "status_detail": task.status_detail,
            }
            for task in self._repo_tasks()
            if task.role_id == canonical_slug and task.status == "open"
        ]

    def _repo_tasks(self) -> list:
        try:
            tasks = self.repo.list_tasks()
            return list(tasks)
        except (AttributeError, TypeError):
            return []

    def _interview_availability_update(self, prompt: str) -> dict | None:
        text = prompt.lower()
        if "interview" not in text or "availability" not in text:
            return None
        if not any(marker in text for marker in ("requested", "provided", "supplied", "sent", "gave")):
            return None
        if "waiting" not in text and "confirmed" in text and "no slot" not in text and "not confirmed" not in text:
            return None

        exact_date = self._date_from_prompt(prompt) or date.today().isoformat()
        position_match = re.search(r'position\s+"([^"]+)"', prompt, flags=re.IGNORECASE)
        position = position_match.group(1).strip() if position_match else ""
        stage = "final interview loop" if "final interview loop" in text or "final loop" in text else "interview"
        role_phrase = f" for {position}" if position else ""
        note = f"Availability provided for a new {stage}{role_phrase}; awaiting confirmation."
        internal_note = ""
        if any(marker in text for marker in ("didn't apply", "did not apply", "internal repositioning", "redirected")):
            internal_note = f"Possible internal repositioning or requisition mismatch: new {stage}{role_phrase} was requested."
        return {"date": exact_date, "note": note, "detail": note, "internal_note": internal_note}

    @staticmethod
    def _date_from_prompt(prompt: str) -> str | None:
        iso_match = re.search(r"\b(20\d{2})-(\d{2})-(\d{2})\b", prompt)
        if iso_match:
            return iso_match.group(0)
        month_match = re.search(
            r"\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+([0-3]?\d)\b",
            prompt,
            flags=re.IGNORECASE,
        )
        if not month_match:
            return None
        month_names = {
            "january": 1,
            "february": 2,
            "march": 3,
            "april": 4,
            "may": 5,
            "june": 6,
            "july": 7,
            "august": 8,
            "september": 9,
            "october": 10,
            "november": 11,
            "december": 12,
        }
        month = month_names[month_match.group(1).lower()]
        day = int(month_match.group(2))
        return date(date.today().year, month, day).isoformat()

    def _apply_update_operation(self, canonical_slug: str, role, operation: dict) -> bool:
        if not isinstance(operation, dict):
            return False
        op = operation.get("op")
        role_id = self._operation_role_id(canonical_slug, operation.get("role_id"))
        effective_role = self.repo.get_role(role_id) or role
        # Dispatch only through repository methods so path/layout details stay in
        # one place even though the LLM chooses which data operation is needed.
        if op == "record_status":
            event_type = operation.get("event_type")
            if not role_id or event_type not in {"submitted", "interviewing", "accepted", "rejected", "closed"}:
                return False
            exact_date = operation.get("exact_date") or date.today().isoformat()
            note = operation.get("note", "")
            artifacts = []
            if effective_role is not None and event_type == "submitted":
                artifacts = [artifact for artifact in effective_role.artifacts if artifact.endswith(("resume.md", "cover_letter.md"))]
            self.repo.record_status(role_id, event_type, exact_date, note, artifacts=artifacts)
            return True
        if op == "append_analysis_notes":
            if not role_id:
                return False
            notes = operation.get("notes") or []
            if isinstance(notes, str):
                notes = [notes]
            if not notes:
                return False
            self.repo.append_analysis_notes(role_id, notes)
            return True
        if op == "update_task_status":
            status = operation.get("status", "")
            if status not in {"open", "completed", "wont_do"}:
                return False
            self.repo.update_task_status(
                operation.get("task_id", ""),
                status,
                operation.get("detail", ""),
            )
            return True
        return False

    @staticmethod
    def _operation_role_id(canonical_slug: str, role_id: object) -> str:
        if not isinstance(role_id, str):
            return canonical_slug
        normalized = role_id.strip()
        if not normalized or normalized.lower() in {"current", "current role", "this role"}:
            return canonical_slug
        return normalized

    def _run_role_reassessment(self, operation: Operation, canonical_slug: str) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before role reassessment can run.")
        operation.log(f"Reassessing role {canonical_slug} from structured YAML.")
        context = self.repo.role_reassessment_context(canonical_slug)
        result = self.llm.reassess_role_analysis(**context)
        if not result.get("clear"):
            raise RuntimeError(result.get("reason") or "The role reassessment was not clear enough to apply.")
        analysis = result.get("analysis")
        if not isinstance(analysis, dict):
            raise RuntimeError("Role reassessment did not return structured analysis.")
        self.repo.write_reassessed_analysis(canonical_slug, analysis)
        operation.result = {"canonical_slug": canonical_slug, "paths": {"analysis": f"roles/{canonical_slug}/analysis.yaml"}}
        operation.log("Updated structured role analysis.")

    def _run_task_reassessment(self, operation: Operation, task_id: str) -> None:
        task = self.repo.get_task(task_id)
        if task is None:
            raise FileNotFoundError(f"Unknown task: {task_id}")
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before task reassessment can run.")
        operation.log(f"Reassessing task {task.id}.")
        usage = self.repo.task_usage(task_id)
        result = self.llm.assess_gap_task(
            task={
                "id": task.id,
                "title": task.title,
                "description": task.description,
                "status": task.status,
                "acceptance_criteria": task.acceptance_criteria,
                "evidence_refs": task.evidence_refs,
            },
            cv_yaml=self.repo.read_text("cv/cv.yaml") if self.repo.exists("cv/cv.yaml") else "",
            roles=[
                {
                    "role_id": role.canonical_slug,
                    "company": role.company,
                    "role": role.role,
                    "location": role.location,
                    "requirements": [
                        req
                        for req in (role.analysis or {}).get("requirements", [])
                        if task_id in (req.get("task_refs") or [])
                    ],
                }
                for role in usage
            ],
        )
        if not result.get("clear"):
            raise RuntimeError(result.get("reason") or "The task reassessment was not clear enough to apply.")
        status = result.get("status", "open")
        detail = result.get("detail", "")
        evidence_refs = ", ".join(result.get("evidence_refs") or [])
        if evidence_refs:
            detail = f"{detail} Evidence: {evidence_refs}".strip()
        self.repo.update_task_status(task_id, status, detail)
        operation.result = {"canonical_slug": "", "paths": {"task": "tasks.yaml"}}
        operation.log(f"Task marked {status}.")

    def _fetch_url_text(self, source_url: str) -> str:
        validate_public_https_url(source_url)
        request = urllib.request.Request(
            source_url,
            headers={
                "User-Agent": "cvai-webui/1.0 (+local repo intake)",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        opener = urllib.request.build_opener(SafeRedirectHandler)
        with opener.open(request, timeout=URL_INTAKE_FETCH_TIMEOUT_SECONDS) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            html_text = response.read().decode(charset, errors="replace")
        parser = TextExtractor()
        parser.feed(html_text)
        text = parser.get_text()
        if not text.strip():
            # Some boards render the body client-side but still ship structured
            # metadata. Try that before asking the user to paste the posting text.
            posting_parser = JobPostingExtractor()
            posting_parser.feed(html_text)
            text = posting_parser.get_text()
        if not text.strip():
            raise RuntimeError("The role page did not yield visible text.")
        return text


def load_repo_env(repo_root: Path) -> None:
    # Local development reads .env from the data/repo root, but real environment
    # variables win so deployment secrets cannot be shadowed by a checked-out file.
    env_path = repo_root / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip().strip("'\"")
        os.environ[key] = value


def create_app() -> WebApp:
    repo_root = default_repo_root()
    load_repo_env(repo_root)
    initialize_data_root(repo_root)
    assert_valid_data_root(repo_root)
    return WebApp(Repository(repo_root), OpenAIClient())


def main() -> None:
    from .asgi import main as asgi_main

    asgi_main()


if __name__ == "__main__":
    main()
