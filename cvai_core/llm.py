from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass
class LLMConfig:
    # Configuration is kept in one dataclass so tests can inject fake endpoints and
    # runtime code can read environment variables in exactly one place.
    api_key: str
    model: str
    base_url: str


@dataclass
class OpenAIAPIError(RuntimeError):
    # The UI shows user_message. Logs and job pages can include detail when the
    # caller needs a more technical explanation of what the API returned.
    status_code: int | None
    error_code: str | None
    user_message: str
    detail: str

    def __str__(self) -> str:
        return self.user_message


class OpenAIClient:
    # OpenAIClient is the adapter between CVAI workflows and an OpenAI-compatible
    # chat-completions API. Methods return plain dictionaries because the repository
    # layer owns validation before anything is written to YAML.
    def __init__(self, config: LLMConfig | None = None) -> None:
        self.config = config or LLMConfig(
            api_key=os.environ.get("LLM_API_KEY", ""),
            model=os.environ.get("LLM_MODEL", "gpt-5"),
            base_url=os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1"),
        )

    def is_configured(self) -> bool:
        return bool(self.config.api_key)

    def extract_role(
        self,
        *,
        source_kind: str,
        source_url: str,
        source_text: str,
        strict: bool,
        overrides: dict[str, str] | None = None,
    ) -> dict:
        # This first pass only decides whether the posting has enough metadata to
        # proceed. Strict URL intake should fail instead of guessing company/title.
        system = (
            "You extract structured job metadata for a job-application repository. "
            "Be conservative. If company, role title, or location are not clearly recoverable, mark the result as unclear."
        )
        user = {
            "source_kind": source_kind,
            "source_url": source_url,
            "strict": strict,
            "manual_overrides": overrides or {},
            "source_text": source_text[:24000],
            "required_fields": ["company", "role", "location"],
            "output_schema": {
                "clear": True,
                "company": "string",
                "role": "string",
                "location": "string",
                "reason": "string",
                "confidence_notes": ["string"],
            },
        }
        return self._json_chat(system, user, max_tokens=1600)

    def generate_bundle(
        self,
        *,
        metadata: dict[str, str],
        workflow_text: str,
        cv_yaml: str,
        claims_text: str,
        job_markdown: str,
        examples: dict[str, str],
    ) -> dict:
        # Bundle generation is the main ingestion call. The prompt asks for
        # structured source-of-truth objects and separately asks for Markdown
        # artifacts, so page rendering never has to parse prose.
        system = (
            "You generate disciplined job-application repository artifacts. "
            "Base all claims only on the provided CV YAML and claims register. "
            "Do not invent experience. Keep wording factual and explicit about gaps. "
            "Return structured JSON source-of-truth objects first; Markdown artifacts are secondary."
        )
        user = {
            "metadata": metadata,
            "workflow": workflow_text,
            "cv_yaml": cv_yaml,
            "claims_register": claims_text,
            "job_markdown": job_markdown,
            "examples": examples,
            "required_output": {
                "metadata": metadata,
                "job": {
                    "version": 1,
                    "role_id": metadata.get("canonical_slug", ""),
                    "company": metadata.get("company", ""),
                    "title": metadata.get("role", ""),
                    "location": metadata.get("location", ""),
                    "source_url": metadata.get("source_url", ""),
                    "captured_on": metadata.get("captured_on", ""),
                    "priority_rank": None,
                    "active": True,
                    "posting": {
                        "raw_text": "original captured job posting text",
                        "date_posted": "YYYY-MM-DD or empty",
                        "employment_type": "string or empty",
                        "location_mode": "remote | hybrid | onsite | unknown",
                        "posting_id": "string or empty",
                    },
                    "extracted": {
                        "responsibilities": ["responsibilities that are not necessarily evidence-addressable requirements"],
                        "hard_requirements": ["explicit must-have requirements"],
                        "soft_requirements": ["explicit nice-to-have or signal requirements"],
                        "inferred_requirements": ["non-explicit requirements worth checking"],
                        "skills": ["role-relevant skills, tools, domains, methods, or technologies named by the posting"],
                        "interview_focus": ["likely interview focus areas"],
                    },
                    "requirements": [
                        {
                            "id": "req_001",
                            "text": "requirement text",
                            "category": "hard_requirement | soft_requirement | inferred_requirement",
                            "fulfillment": "met | partial | unmet | unknown",
                            "evidence": [{"text": "evidence summary", "refs": ["je-dynatrace"]}],
                            "gap": "gap text, empty when met",
                            "task_refs": ["task_go_coroutines"],
                        }
                    ],
                },
                "analysis": {
                    "version": 1,
                    "role_id": metadata.get("canonical_slug", ""),
                    "summary": {
                        "verdict": "CLEAR_FIT | FIT | FIT_WITH_TARGETED_UPSKILLING | OVERQUALIFIED | WEAK_FIT | UNFIT",
                        "verdict_label": "display label",
                        "recommendation": {"value": "APPLY_NOW | APPLY_AFTER_TARGETED_PREP | HOLD | DO_NOT_APPLY", "reason": "short reason"},
                        "rationale": "factual suitability rationale",
                        "notes": ["short machine-readable or human-readable notes"],
                    },
                    "strengths": [{"title": "strength title", "evidence": [{"text": "evidence", "refs": ["je-dynatrace"]}]}],
                    "gaps": [{"description": "gap", "task_refs": ["task_go_coroutines"], "feasible": True}],
                    "work_items": [{"title": "work item", "detail": "short detail"}],
                    "timeline": [{"period": "Week 1", "items": ["item"]}],
                    "requirements": "same list as job.requirements",
                    "gap_tasks": {
                        "task_go_coroutines": {
                            "title": "Go coroutines",
                            "estimated_days": 7,
                            "feasible_within_one_week": True,
                            "description": "what evidence this task would produce",
                            "acceptance_criteria": ["criterion"],
                            "evidence_refs": [],
                        }
                    },
                    "comments": [{"title": "comment title", "items": ["item"], "text": "optional text"}],
                    "llm_context": {
                        "responsibilities": ["responsibility"],
                        "must_haves": ["must-have"],
                        "nice_to_haves": ["nice-to-have"],
                        "interview_focus": ["focus"],
                    },
                },
                "suitability_report": "markdown",
                "role_matrix": "markdown",
                "interview_prep": {
                    "story_bank_md": "markdown",
                    "system_design_bank_md": "markdown",
                    "security_bank_md": "markdown",
                    "coding_plan_md": "markdown",
                },
                "mirror_summary": {
                    "verdict": "OVERQUALIFIED | CLEAR_FIT | FIT_WITH_TARGETED_UPSKILLING | NOT_A_GOOD_FIT",
                    "bullets": ["3 concise bullets"],
                },
                "claim_updates": [
                    {
                        "claim": "string",
                        "origin": "string",
                        "tag": "SAFE | NEEDS_CONFIRMATION | DO_NOT_USE",
                        "notes": "string",
                    }
                ],
                "todo_updates": ["string"],
            },
            "requirements": [
                "Match the repository tone in the examples.",
                "The structured job and analysis objects are source of truth. They must be complete enough for the web app to render without parsing Markdown.",
                "If you cannot populate job.requirements and analysis.requirements from the job posting and CV evidence, return an explicit JSON error object instead of relying on Markdown.",
                "Every analysis.requirements row must use category hard_requirement, soft_requirement, or inferred_requirement.",
                "Every analysis.requirements row must use fulfillment met, partial, unmet, or unknown.",
                "Only attach task_refs to requirements with actual gaps; met requirements should normally have no task_refs.",
                "Responsibilities that are not CV-answerable requirements belong in job.extracted.responsibilities and analysis.llm_context.responsibilities, not in requirements.",
                "Use evidence refs like je-dynatrace, je-symantec, je-scytl, pp-itur, or pp-portfolio only when supported by the provided CV YAML or claims register.",
                "Include an Role status line of Not submitted inside the suitability report role snapshot.",
                "Do not generate role-specific resume, cover letter, or LinkedIn artifacts unless the user explicitly requested them.",
                "For claim_updates and todo_updates, return an empty list unless there is a concrete addition worth making.",
            ],
        }
        return self._json_chat(system, user, max_tokens=12000)

    def interpret_status_update(self, *, role: dict[str, str], prompt: str, today: str) -> dict:
        # Free-form role updates are LLM interpreted because even terse user input
        # may imply coordinated changes across role state, notes, tasks, and events.
        system = (
            "You convert a user's role update prompt into structured CVAI data operations. "
            "Use only the prompt and role metadata. "
            "If the prompt is not clearly about role data, mark it unclear. "
            "Only respond about role data changes."
        )
        user = {
            "role": role,
            "today": today,
            "prompt": prompt,
            "allowed_event_types": ["submitted", "interviewing", "accepted", "rejected", "closed"],
            # Operations keep prompt updates compact while still allowing one
            # user message to affect status, durable notes, and task state.
            "allowed_operations": ["record_status", "append_analysis_notes", "update_task_status"],
            "output_schema": {
                "clear": True,
                "event_type": "submitted | interviewing | accepted | rejected | closed",
                "exact_date": "YYYY-MM-DD",
                "note": "short note or rationale, without duplicating the date/status",
                "internal_notes": ["durable internal notes extracted from pasted email or recruiter message"],
                "operations": [
                    {
                        "op": "record_status | append_analysis_notes | update_task_status",
                        "role_id": "role id, normally the current role",
                        "event_type": "for record_status",
                        "exact_date": "for record_status",
                        "note": "for record_status",
                        "notes": ["for append_analysis_notes"],
                        "task_id": "for update_task_status",
                        "status": "open | completed | wont_do, for update_task_status",
                        "detail": "for update_task_status",
                    }
                ],
                "reason": "string",
            },
            "operation_rules": [
                "Prefer operations whenever the prompt implies more than one durable change.",
                "Use record_status for status, date, event, and current role-state changes.",
                "Use append_analysis_notes for durable internal notes, logistics, preparation notes, or interview focus.",
                "Use update_task_status only when the prompt clearly asks to open, complete, or won't-do a named task.",
                "Return operations as an empty list if the scalar status fields and internal_notes are sufficient.",
            ],
            "date_rules": [
                "Return dates in ISO YYYY-MM-DD format.",
                "If the prompt says today, use the provided today value.",
                "If no date is present but the status is clear, use the provided today value.",
                "For slash dates, infer day/month/year when the first number is greater than 12; otherwise preserve the most likely interpretation from the user's wording.",
            ],
            "note_rules": [
                "Summarize pasted emails or long recruiter messages into a concise current-status note.",
                "Do not copy the raw email body into note.",
                "Do not prefix note with the event type or exact_date.",
                "For scheduled interviews, include the interview stage, scheduled date/time, timezone, and format when present.",
            ],
            "internal_note_rules": [
                "Use internal_notes for preparation details, logistics, interview focus, or process guidance that should not clutter the displayed current status.",
                "Return an empty list when the prompt does not contain durable internal notes.",
                "Keep each internal note concise and self-contained.",
            ],
        }
        return self._json_chat(system, user, max_tokens=2000)

    def assess_gap_task(self, *, task: dict, cv_yaml: str, roles: list[dict]) -> dict:
        system = (
            "You reassess whether a gap-evidence task is now closed using only structured repository data. "
            "Be conservative. Mark completed only when every acceptance criterion is satisfied by explicit evidence. "
            "Do not infer unstated experience. If the task should remain open or intentionally remain a gap, say so."
        )
        user = {
            "task": task,
            "cv_yaml": cv_yaml,
            "roles_using_task": roles,
            "allowed_statuses": ["open", "completed", "wont_do"],
            "output_schema": {
                "clear": True,
                "status": "open | completed | wont_do",
                "detail": "short rationale for the assessment",
                "evidence_refs": ["structured evidence references that prove closure, if completed"],
                "reason": "string",
            },
            "rules": [
                "Use completed only if all acceptance criteria are satisfied.",
                "Use open if evidence is incomplete or ambiguous.",
                "Use wont_do only if the available data or user-authored task state clearly indicates this gap will remain open.",
                "Return evidence refs only for claims that are explicitly supported by the provided data.",
            ],
        }
        return self._json_chat(system, user, max_tokens=1600)

    def reassess_role_analysis(
        self,
        *,
        role: dict,
        application: dict,
        job: dict,
        current_analysis: dict,
        tasks: list[dict],
        cv_yaml: str,
        context: dict,
        evidence_library: dict,
    ) -> dict:
        # Reassessment rewrites only structured analysis. It receives Markdown-free
        # context so the model works from the same YAML contracts the app validates.
        system = (
            "You reassess a role's requirement coverage using structured repository data. "
            "The existing YAML is source data, including comments and notes fields; do not parse Markdown artifacts. "
            "Base all claims only on the provided CV YAML, structured context, evidence library, tasks, job YAML, and current analysis. "
            "Return valid JSON only."
        )
        user = {
            "role": role,
            "application": application,
            "job": job,
            "current_analysis": current_analysis,
            "tasks": tasks,
            "cv_yaml": cv_yaml,
            "context": context,
            "evidence_library": evidence_library,
            "required_output": {
                "clear": True,
                "analysis": {
                    "version": 1,
                    "role_id": role.get("id", ""),
                    "summary": {
                        "verdict": "CLEAR_FIT | FIT | FIT_WITH_TARGETED_UPSKILLING | OVERQUALIFIED | WEAK_FIT | UNFIT",
                        "verdict_label": "display label",
                        "recommendation": {"value": "APPLY_NOW | APPLY_AFTER_TARGETED_PREP | HOLD | DO_NOT_APPLY", "reason": "short reason"},
                        "rationale": "factual suitability rationale",
                        "notes": ["short notes"],
                    },
                    "strengths": [{"title": "strength title", "evidence": [{"text": "evidence", "refs": ["je-dynatrace"]}]}],
                    "gaps": [{"description": "gap", "task_refs": ["task_go_coroutines"], "feasible": True}],
                    "work_items": [{"title": "work item", "detail": "short detail"}],
                    "timeline": [{"period": "Week 1", "items": ["item"]}],
                    "requirements": [
                        {
                            "id": "req_001",
                            "text": "requirement text",
                            "category": "hard_requirement | soft_requirement | inferred_requirement",
                            "fulfillment": "met | partial | unmet | unknown",
                            "evidence": [{"text": "evidence summary", "refs": ["je-dynatrace"]}],
                            "gap": "gap text, empty when met",
                            "task_refs": ["task_go_coroutines"],
                        }
                    ],
                    "gap_tasks": {
                        "task_go_coroutines": {
                            "title": "Go coroutines",
                            "estimated_days": 7,
                            "feasible_within_one_week": True,
                            "description": "what evidence this task would produce",
                            "acceptance_criteria": ["criterion"],
                            "evidence_refs": [],
                        }
                    },
                    "comments": [{"title": "comment title", "items": ["item"], "text": "optional text"}],
                    "llm_context": {
                        "responsibilities": ["responsibility"],
                        "must_haves": ["must-have"],
                        "nice_to_haves": ["nice-to-have"],
                        "interview_focus": ["focus"],
                    },
                },
                "reason": "string",
            },
            "rules": [
                "Return clear=false only if the structured data is too incomplete to reassess safely.",
                "Keep responsibilities that are not CV-answerable out of requirements; put them in llm_context or comments.",
                "Use category for requirement force: hard_requirement, soft_requirement, or inferred_requirement.",
                "Use fulfillment for coverage: met, partial, unmet, or unknown.",
                "Met requirements should not have task_refs.",
                "Only reference task IDs that exist in tasks unless the analysis.gap_tasks object defines a new concrete task.",
                "Use evidence refs only when supported by the provided CV YAML, context, or evidence library.",
                "Preserve useful comments and notes from current_analysis when they still apply.",
            ],
        }
        return self._json_chat(system, user, max_tokens=8000)

    def _json_chat(self, system: str, user_payload: dict, max_tokens: int) -> dict:
        if not self.is_configured():
            raise RuntimeError("LLM_API_KEY is not configured.")

        if "json" not in system.lower():
            system = f"{system} Return valid JSON only."

        # The client deliberately uses the small chat-completions surface directly.
        # Keeping this adapter dependency-free makes the web app easy to run in a
        # local container and keeps tests free to inject fake OpenAI-compatible URLs.
        payload = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
            "response_format": {"type": "json_object"},
            "max_completion_tokens": max_tokens,
        }
        request = urllib.request.Request(
            url=f"{self.config.base_url.rstrip('/')}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            details = exc.read().decode("utf-8", errors="replace")
            raise self._build_api_error(exc.code, details) from exc
        except urllib.error.URLError as exc:
            raise OpenAIAPIError(
                status_code=None,
                error_code=None,
                user_message="The configured LLM API could not be reached. Check LLM_BASE_URL and network access from the container, then try again.",
                detail=f"LLM API request failed: {exc.reason}",
            ) from exc

        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected OpenAI API response: {body}") from exc
        # response_format requests a JSON object, but parsing here is still the
        # final guard before repository code applies any model-produced changes.
        return json.loads(content)

    def _build_api_error(self, status_code: int, details: str) -> OpenAIAPIError:
        # OpenAI-compatible providers vary in their error bodies. Extract the
        # common fields when present, then map them to messages that make sense in
        # a background job log rather than exposing raw provider JSON to the page.
        error_code = None
        error_type = None
        error_message = ""
        try:
            payload = json.loads(details)
        except json.JSONDecodeError:
            payload = {}

        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                error_code = error.get("code")
                error_type = error.get("type")
                message = error.get("message")
                if isinstance(message, str):
                    error_message = message.strip()

        if status_code == 401:
            user_message = "The LLM API key was rejected. Check LLM_API_KEY and confirm the key is still valid."
        elif status_code == 429 and error_code == "insufficient_quota":
            user_message = "LLM project quota is exhausted. Add billing or available credits for this API project, then retry the intake job."
        elif status_code == 429:
            user_message = "The LLM API rate-limited this request. Wait a moment and retry the intake job."
        else:
            user_message = f"LLM API request failed with HTTP {status_code}."
            if error_message:
                user_message = f"{user_message} {error_message}"
            elif error_type:
                user_message = f"{user_message} Error type: {error_type}."

        return OpenAIAPIError(
            status_code=status_code,
            error_code=error_code,
            user_message=user_message,
            detail=f"LLM API request failed: {status_code} {details}",
        )
