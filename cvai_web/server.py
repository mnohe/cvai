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
class IntakeJob:
    # Intake jobs are in-memory background runs. They are intentionally session
    # scoped: if the web process restarts, durable role data remains in CVAI_DATA
    # while transient job logs disappear.
    id: str
    kind: str
    status: str = "queued"
    log_lines: list[str] = field(default_factory=list)
    result: dict | None = None
    error: str | None = None

    def log(self, message: str) -> None:
        timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        self.log_lines.append(f"[{timestamp}] {message}")

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "log": "\n".join(self.log_lines),
            "result": self.result,
            "error": self.error,
        }


class JobManager:
    # JobManager isolates thread handling from HTTP routes. Routes create jobs and
    # then poll their status; worker methods write durable data through Repository.
    def __init__(self) -> None:
        self._jobs: dict[str, IntakeJob] = {}
        self._lock = threading.Lock()

    def create(self, kind: str, worker: Callable[[IntakeJob], None]) -> IntakeJob:
        job_id = f"job-{uuid.uuid4()}"
        job = IntakeJob(id=job_id, kind=kind)
        with self._lock:
            self._jobs[job_id] = job
        thread = threading.Thread(target=self._run, args=(job, worker), daemon=True)
        thread.start()
        return job

    def _run(self, job: IntakeJob, worker: Callable[[IntakeJob], None]) -> None:
        job.status = "running"
        try:
            worker(job)
            job.status = "completed"
        except OpenAIAPIError as exc:
            job.status = "failed"
            job.error = str(exc)
            job.log(exc.detail)
        except Exception as exc:  # noqa: BLE001
            job.status = "failed"
            job.error = str(exc)
            job.log(traceback.format_exc())

    def get(self, job_id: str) -> IntakeJob | None:
        return self._jobs.get(job_id)

    def list(self) -> list[IntakeJob]:
        return sorted(self._jobs.values(), key=lambda job: job.id, reverse=True)


class WebApp:
    # WebApp is the service object behind the FastAPI routes. It owns workflow
    # methods and the in-memory job manager; HTTP rendering lives in Jinja routes.
    def __init__(self, repo: Repository, llm: OpenAIClient) -> None:
        self.repo = repo
        self.llm = llm
        self.jobs = JobManager()

    def _run_url_ingestion(self, job: IntakeJob, source_url: str) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before intake jobs can run.")
        job.log(f"Fetching role page: {source_url}")
        source_text = self._fetch_url_text(source_url)
        job.log(f"Fetched {len(source_text)} characters of visible page text.")
        extracted = self.llm.extract_role(
            source_kind="url",
            source_url=source_url,
            source_text=source_text,
            strict=True,
        )
        if not extracted.get("clear"):
            reason = extracted.get("reason") or "The role metadata was not fully clear from the page."
            raise RuntimeError(reason + " Please use pasted-text intake instead.")
        self._complete_ingestion(job, source_text, source_url, extracted)

    def _run_url_quick_analysis(self, job: IntakeJob, source_url: str) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before quick analysis can run.")
        job.log(f"Fetching role page: {source_url}")
        source_text = self._fetch_url_text(source_url)
        job.log(f"Fetched {len(source_text)} characters of visible page text.")
        analysis = self._quick_analyze_source(source_kind="url", source_url=source_url, source_text=source_text)
        job.result = {
            "quick_analysis": analysis,
            "intake": {
                "kind": "url",
                "source_url": source_url,
                "source_text": source_text,
                "overrides": {},
            },
        }
        job.log("Quick analysis completed. Continue or abandon this role from the job page.")

    def _run_text_ingestion(
        self,
        job: IntakeJob,
        source_text: str,
        source_url: str,
        overrides: dict[str, str],
    ) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before intake jobs can run.")
        job.log("Extracting metadata from pasted text.")
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
        self._complete_ingestion(job, source_text, source_url, extracted)

    def _run_text_quick_analysis(
        self,
        job: IntakeJob,
        source_text: str,
        source_url: str,
        overrides: dict[str, str],
    ) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before quick analysis can run.")
        job.log("Running quick fit analysis for pasted text.")
        analysis = self._quick_analyze_source(source_kind="text", source_url=source_url, source_text=source_text)
        job.result = {
            "quick_analysis": analysis,
            "intake": {
                "kind": "text",
                "source_url": source_url,
                "source_text": source_text,
                "overrides": overrides,
            },
        }
        job.log("Quick analysis completed. Continue or abandon this role from the job page.")

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

    def _run_full_ingestion_from_preview(self, job: IntakeJob, intake: dict) -> None:
        source_kind = intake.get("kind", "text")
        source_url = intake.get("source_url", "")
        source_text = intake.get("source_text", "")
        overrides = intake.get("overrides") or {}
        if source_kind == "url":
            job.log("Continuing full ingestion from quick URL analysis.")
            extracted = self.llm.extract_role(
                source_kind="url",
                source_url=source_url,
                source_text=source_text,
                strict=True,
            )
            if not extracted.get("clear"):
                reason = extracted.get("reason") or "The role metadata was not fully clear from the page."
                raise RuntimeError(reason + " Please use pasted-text intake instead.")
            self._complete_ingestion(job, source_text, source_url, extracted)
            return

        job.log("Continuing full ingestion from quick pasted-text analysis.")
        self._run_text_ingestion(job, source_text, source_url, overrides)

    def _complete_ingestion(self, job: IntakeJob, source_text: str, source_url: str, extracted: dict) -> None:
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
        job.log(f"Resolved role: {metadata['company']} / {metadata['location']} / {metadata['role']}")
        job_markdown = self.repo.create_job_markdown(
            company=metadata["company"],
            role=metadata["role"],
            location=metadata["location"],
            source_url=source_url,
            source_text=source_text,
            captured_on=metadata["captured_on"],
        )
        job.log("Generating repository bundle with the configured LLM API.")
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
        job.log("Writing generated files into the repository.")
        paths = self.repo.write_bundle(
            canonical_slug=metadata["canonical_slug"],
            company_slug=metadata["company_slug"],
            location_slug=metadata["location_slug"],
            role_slug=metadata["role_slug"],
            job_markdown=job_markdown,
            generated=generated,
        )
        job.result = {"canonical_slug": metadata["canonical_slug"], "paths": paths}
        job.log("Ingestion completed.")

    def _run_prompt_update(self, job: IntakeJob, canonical_slug: str, prompt: str) -> None:
        role = self.repo.get_role(canonical_slug)
        if role is None:
            raise FileNotFoundError(f"Unknown role: {canonical_slug}")
        job.log(f"Interpreting update prompt for {role.company} / {role.role}.")
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
            },
            prompt=prompt,
            today=today,
        )
        if not interpreted.get("clear"):
            reason = interpreted.get("reason") or "The prompt was not clear enough to apply as a tracked status update."
            raise RuntimeError(reason)
        paths = self._apply_interpreted_update(canonical_slug, role, interpreted)
        job.result = {"canonical_slug": canonical_slug, "paths": paths}
        if paths.get("operations"):
            job.log(f"Applied {len(paths['operations'])} LLM-returned operation(s).")
        else:
            job.log(f"Applied {interpreted['event_type']} status dated {interpreted['exact_date']}.")

    def _apply_interpreted_update(self, canonical_slug: str, role, interpreted: dict) -> dict:
        operations = interpreted.get("operations") or []
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

    def _apply_update_operation(self, canonical_slug: str, role, operation: dict) -> bool:
        if not isinstance(operation, dict):
            return False
        op = operation.get("op")
        role_id = self._operation_role_id(canonical_slug, operation.get("role_id"))
        # Dispatch only through repository methods so path/layout details stay in
        # one place even though the LLM chooses which data operation is needed.
        if op == "record_status":
            event_type = operation.get("event_type")
            exact_date = operation.get("exact_date") or date.today().isoformat()
            note = operation.get("note", "")
            artifacts = []
            if role_id == canonical_slug and event_type == "submitted":
                artifacts = [artifact for artifact in role.artifacts if artifact.endswith(("resume.md", "cover_letter.md"))]
            self.repo.record_status(role_id, event_type, exact_date, note, artifacts=artifacts)
            return True
        if op == "append_analysis_notes":
            notes = operation.get("notes") or []
            if isinstance(notes, str):
                notes = [notes]
            self.repo.append_analysis_notes(role_id, notes)
            return True
        if op == "update_task_status":
            self.repo.update_task_status(
                operation.get("task_id", ""),
                operation.get("status", ""),
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

    def _run_role_reassessment(self, job: IntakeJob, canonical_slug: str) -> None:
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before role reassessment can run.")
        job.log(f"Reassessing role {canonical_slug} from structured YAML.")
        context = self.repo.role_reassessment_context(canonical_slug)
        result = self.llm.reassess_role_analysis(**context)
        if not result.get("clear"):
            raise RuntimeError(result.get("reason") or "The role reassessment was not clear enough to apply.")
        analysis = result.get("analysis")
        if not isinstance(analysis, dict):
            raise RuntimeError("Role reassessment did not return structured analysis.")
        self.repo.write_reassessed_analysis(canonical_slug, analysis)
        job.result = {"canonical_slug": canonical_slug, "paths": {"analysis": f"roles/{canonical_slug}/analysis.yaml"}}
        job.log("Updated structured role analysis.")

    def _run_task_reassessment(self, job: IntakeJob, task_id: str) -> None:
        task = self.repo.get_task(task_id)
        if task is None:
            raise FileNotFoundError(f"Unknown task: {task_id}")
        if not self.llm.is_configured():
            raise RuntimeError("LLM_API_KEY is required before task reassessment can run.")
        job.log(f"Reassessing task {task.id}.")
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
        job.result = {"canonical_slug": "", "paths": {"task": "tasks.yaml"}}
        job.log(f"Task marked {status}.")

    def _fetch_url_text(self, source_url: str) -> str:
        validate_public_https_url(source_url)
        request = urllib.request.Request(
            source_url,
            headers={
                "User-Agent": "jobtracker-webui/1.0 (+local repo intake)",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        opener = urllib.request.build_opener(SafeRedirectHandler)
        with opener.open(request, timeout=45) as response:
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
