from __future__ import annotations

import html as html_lib
import os
import re
import subprocess
from datetime import date
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Form, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from cvai_core.cv import (
    cv_list_items,
    delete_cv_list_item,
    load_cv,
    move_cv_list_item,
    save_cv_contact_form,
    save_cv_form,
    save_cv_list_item_form,
    save_cv_projects_url_form,
    save_cv_summary_form,
)
from cvai_core.llm import OpenAIClient
from cvai_core.repo import Repository, default_repo_root
from cvai_core.schema import assert_valid_data_root, initialize_data_root
from .server import WebApp, load_repo_env, validate_public_https_url
from .view_helpers import (
    category_label,
    dashboard_status_badge,
    fulfillment_class,
    fulfillment_label,
    status_sentence,
    task_eta_class,
    task_eta_label,
    task_status_class,
    task_status_label,
    verdict_class,
)


# This module is the HTTP boundary of the application. It should stay thin:
# validate form inputs, call the service/repository layer, and choose a template or
# redirect. Business rules belong in cvai_core or WebApp workflow methods.
def create_fastapi_app(repo: Repository | None = None, llm: OpenAIClient | None = None) -> FastAPI:
    """Create the ASGI app with repository, workflow, and template dependencies."""
    if repo is None:
        # Production startup owns data-directory initialization. Tests pass a
        # Repository directly so they can point at temporary fixtures.
        repo_root = default_repo_root()
        load_repo_env(repo_root)
        initialize_data_root(repo_root)
        assert_valid_data_root(repo_root)
        repo = Repository(repo_root)
    service = WebApp(repo, llm or OpenAIClient())
    app = FastAPI(title="CVAI Web")
    app.state.service = service
    app.state.templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent / "jinja_templates"))
    app.mount("/static", StaticFiles(directory=str(Path(__file__).resolve().parent / "static")), name="static")
    _register_template_helpers(app.state.templates)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        # Container platforms and CI smoke tests need a cheap endpoint that does
        # not touch LLMs or render templates.
        return {"status": "ok"}

    @app.get("/", response_class=HTMLResponse)
    async def dashboard(request: Request) -> Response:
        # The roles page is a pure read: data comes from YAML, never from an LLM.
        roles = service.repo.list_dashboard_roles()
        return _template(
            app,
            request,
            "dashboard.html.j2",
            {
                "title": "Roles",
                "roles": roles,
                "dashboard_status_badge": dashboard_status_badge,
            },
        )

    @app.get("/intake", response_class=HTMLResponse)
    async def intake(request: Request) -> Response:
        return _template(app, request, "intake.html.j2", {"title": "Ingest Role"})

    @app.get("/tasks", response_class=HTMLResponse)
    async def tasks(request: Request) -> Response:
        return _template(app, request, "tasks.html.j2", {"title": "Tasks", "tasks": [task for task in service.repo.list_tasks() if task.status == "open"]})

    @app.get("/tasks/{task_id}", response_class=HTMLResponse)
    async def task_detail(request: Request, task_id: str) -> Response:
        task = service.repo.get_task(task_id)
        if task is None:
            return _error(app, request, "Task not found", "No task matched that ID.", 404)
        return _template(app, request, "task.html.j2", {"title": task.title, "task": task, "role_states": service.repo.task_usage(task_id)})

    @app.get("/cv", response_class=HTMLResponse)
    async def cv_redirect() -> Response:
        # The canonical CV editor URL keeps the trailing slash so relative form
        # actions resolve consistently in browsers and tests.
        return _redirect("/cv/")

    @app.get("/cv/", response_class=HTMLResponse)
    async def cv_editor(request: Request) -> Response:
        # CV data is read directly from structured YAML. The LLM is not needed to
        # display or edit a valid CV.
        return _cv_response(app, request)

    @app.post("/cv/")
    async def update_cv_form(request: Request) -> Response:
        # The main CV editor is one form made of structured controls. It posts all
        # fields at once, then the core CV helper validates before writing YAML.
        form = dict(await request.form())
        issues = save_cv_form(service.repo.root, form)
        if issues:
            return _cv_response(app, request, issues=issues, status_code=400, form_data=form)
        return _redirect("/cv/")

    @app.post("/cv/summary")
    async def update_cv_summary(request: Request) -> Response:
        # The summary is edited directly on the CV page. Contact and repeatable
        # data use modal subforms so their controls stay focused and compact.
        form = dict(await request.form())
        issues = save_cv_summary_form(service.repo.root, form)
        if issues:
            return _cv_response(app, request, issues=issues, status_code=400, form_data=form)
        return _redirect("/cv/")

    @app.get("/cv/contact/edit", response_class=HTMLResponse)
    async def edit_cv_contact(request: Request) -> Response:
        return _cv_contact_modal(app, request)

    @app.post("/cv/contact")
    async def update_cv_contact(request: Request) -> Response:
        form = dict(await request.form())
        issues = save_cv_contact_form(service.repo.root, form)
        if issues:
            return _cv_contact_modal(app, request, issues=issues, status_code=400)
        return _hx_redirect_or_normal(request, "/cv/")

    @app.post("/cv/projects-url")
    async def update_cv_projects_url(request: Request) -> Response:
        form = dict(await request.form())
        issues = save_cv_projects_url_form(service.repo.root, form)
        if issues:
            return _cv_response(app, request, issues=issues, status_code=400, form_data=form)
        return _redirect("/cv/")

    @app.get("/cv/{section}/new", response_class=HTMLResponse)
    async def new_cv_item(request: Request, section: str) -> Response:
        return _cv_item_modal(app, request, section, None)

    @app.get("/cv/{section}/{index}/edit", response_class=HTMLResponse)
    async def edit_cv_item(request: Request, section: str, index: int) -> Response:
        return _cv_item_modal(app, request, section, index)

    @app.post("/cv/{section}/{index}")
    async def save_cv_item(request: Request, section: str, index: int) -> Response:
        # A modal save submits only one list item. The core helper merges that
        # item into the full CV and validates the complete document before write.
        form = dict(await request.form())
        issues = save_cv_list_item_form(service.repo.root, section, index, form)
        if issues:
            return _cv_item_modal(app, request, section, index, issues=issues, form_data=form, status_code=400)
        return _hx_redirect_or_normal(request, "/cv/")

    @app.post("/cv/{section}/{index}/delete")
    async def delete_cv_item(request: Request, section: str, index: int) -> Response:
        issues = delete_cv_list_item(service.repo.root, section, index)
        if issues:
            return _cv_response(app, request, issues=issues, status_code=400)
        return _hx_redirect_or_normal(request, "/cv/")

    @app.post("/cv/{section}/{index}/move")
    async def move_cv_item(request: Request, section: str, index: int, direction: str = Form("")) -> Response:
        issues = move_cv_list_item(service.repo.root, section, index, direction)
        if issues:
            return _cv_response(app, request, issues=issues, status_code=400)
        if request.headers.get("hx-request") == "true":
            return Response(status_code=204)
        return _hx_redirect_or_normal(request, "/cv/")

    @app.post("/tasks/{task_id}/status")
    async def update_task_status(task_id: str, status: str = Form("open"), detail: str = Form("")) -> Response:
        service.repo.update_task_status(task_id, status, detail)
        return _redirect(f"/tasks/{task_id}")

    @app.post("/tasks/{task_id}/reassess")
    async def reassess_task(request: Request, task_id: str) -> Response:
        task = service.repo.get_task(task_id)
        if task is None:
            return _error(app, request, "Task not found", "No task matched that ID.", 404)
        operation = service.operations.create(
            "task reassessment",
            lambda current_operation: service._run_task_reassessment(current_operation, task_id),
        )
        return _operation_response(app, request, operation.as_dict())

    @app.get("/favicon.svg")
    async def favicon() -> Response:
        return FileResponse(Path(__file__).resolve().parent / "static" / "cvai-v.svg", media_type="image/svg+xml")

    @app.post("/ingestions/url")
    async def ingest_url(request: Request, source_url: str = Form(""), quick_analysis: str = Form("")) -> Response:
        # URL ingestion can be slow or fail on remote sites, so it runs as a
        # background operation and the browser polls status in place.
        source_url = source_url.strip()
        if not source_url:
            return _error(app, request, "Missing URL", "A role URL is required for URL ingestion.")
        try:
            validate_public_https_url(source_url)
        except ValueError as exc:
            return _error(app, request, "Blocked URL", str(exc), 400)
        if quick_analysis:
            operation = service.operations.create(
                "quick analysis",
                lambda current_operation: service._run_url_quick_analysis(current_operation, source_url),
            )
            return _operation_modal_or_redirect(app, request, operation.as_dict())
        else:
            operation = service.operations.create(
                "url",
                lambda current_operation: service._run_url_ingestion(current_operation, source_url),
            )
            return _operation_response(app, request, operation.as_dict())

    @app.post("/ingestions/text")
    async def ingest_text(
        request: Request,
        source_text: str = Form(""),
        source_url: str = Form(""),
        company: str = Form(""),
        location: str = Form(""),
        role: str = Form(""),
        quick_analysis: str = Form(""),
    ) -> Response:
        source_text = source_text.strip()
        if not source_text:
            return _error(app, request, "Missing text", "Paste the job description text before starting text ingestion.")
        overrides = {
            key: value.strip()
            for key, value in {"company": company, "location": location, "role": role}.items()
            if value.strip()
        }
        if quick_analysis:
            operation = service.operations.create(
                "quick analysis",
                lambda current_operation: service._run_text_quick_analysis(current_operation, source_text, source_url.strip(), overrides),
            )
            return _operation_modal_or_redirect(app, request, operation.as_dict())
        else:
            operation = service.operations.create(
                "text",
                lambda current_operation: service._run_text_ingestion(current_operation, source_text, source_url.strip(), overrides),
            )
            return _operation_response(app, request, operation.as_dict())

    @app.get("/operations", response_class=HTMLResponse)
    async def operations(request: Request) -> Response:
        return _template(
            app,
            request,
            "operations.html.j2",
            {
                "title": "Operations",
                "operations": [operation.as_dict() for operation in service.operations.list()],
            },
        )

    @app.get("/operations/{operation_id}", response_class=HTMLResponse)
    async def operation_status(request: Request, operation_id: str) -> Response:
        operation = service.operations.get(operation_id)
        if operation is None:
            return _error(app, request, "Operation not found", "That operation does not exist.", 404)
        return _template(app, request, "operation.html.j2", _operation_context(request, operation.as_dict()))

    @app.get("/operations/{operation_id}/fragment", response_class=HTMLResponse)
    async def operation_status_fragment(request: Request, operation_id: str) -> Response:
        # HTMX polls this small fragment while a background operation runs.
        operation = service.operations.get(operation_id)
        if operation is None:
            return HTMLResponse(
                '<section id="operation-status" class="flash error">Operation not found.</section>',
                status_code=404,
            )
        return _operation_fragment_response(app, request, operation.as_dict())

    @app.get("/operations/{operation_id}/notice", response_class=HTMLResponse)
    async def operation_notice(request: Request, operation_id: str) -> Response:
        operation = service.operations.get(operation_id)
        if operation is None:
            return HTMLResponse(
                '<div id="operation-notice-root" class="flash error">Operation not found.</div>',
                status_code=404,
            )
        return _operation_notice_response(app, request, operation.as_dict())

    @app.get("/operations/{operation_id}/modal", response_class=HTMLResponse)
    async def operation_modal(request: Request, operation_id: str) -> Response:
        operation = service.operations.get(operation_id)
        if operation is None:
            return _operation_modal_empty_response(app, request)
        return _operation_modal_response(app, request, operation.as_dict())

    @app.post("/operations/{operation_id}/continue-ingestion")
    async def continue_ingestion(request: Request, operation_id: str) -> Response:
        preview_operation = service.operations.get(operation_id)
        if preview_operation is None or not preview_operation.result or not preview_operation.result.get("intake"):
            return _error(app, request, "Operation not found", "That quick analysis operation cannot be continued.", 404)
        intake = dict(preview_operation.result["intake"])
        operation = service.operations.create(
            "full ingestion",
            lambda current_operation: service._run_full_ingestion_from_preview(current_operation, intake),
        )
        if request.headers.get("hx-request") == "true":
            return _operation_modal_empty_with_notice_response(app, request, operation.as_dict())
        return _operation_response(app, request, operation.as_dict())

    @app.post("/operations/{operation_id}/abandon")
    async def abandon_ingestion(request: Request, operation_id: str) -> Response:
        preview_operation = service.operations.get(operation_id)
        if preview_operation is None or not preview_operation.result or not preview_operation.result.get("quick_analysis"):
            return _error(app, request, "Operation not found", "That quick analysis operation cannot be abandoned.", 404)
        preview_operation.result["abandoned"] = True
        preview_operation.log("Quick analysis abandoned. No role files were written.")
        if request.headers.get("hx-request") == "true":
            return _operation_modal_empty_response(app, request)
        return _redirect(f"/operations/{operation_id}")

    @app.post("/operations/{operation_id}/cancel")
    async def cancel_operation(request: Request, operation_id: str) -> Response:
        operation = service.operations.cancel(operation_id)
        if operation is None:
            return _operation_modal_empty_response(app, request)
        if request.headers.get("hx-request") == "true":
            return _operation_modal_empty_response(app, request)
        return _redirect("/intake")

    @app.get("/roles/{canonical_slug}", response_class=HTMLResponse)
    async def role_detail(request: Request, canonical_slug: str) -> Response:
        role = service.repo.get_role(canonical_slug)
        if role is None:
            return _error(app, request, "Role not found", "No canonical role matched that ID.", 404)
        task_titles = {task.id: task.title for task in service.repo.list_tasks()}
        return _template(
            app,
            request,
            "role.html.j2",
            {
                "title": f"{role.company} · {role.role}",
                "section_title": "Roles",
                "role": role,
                "task_titles": task_titles,
            },
        )

    @app.post("/roles/{canonical_slug}/status")
    async def update_role_status(
        request: Request,
        canonical_slug: str,
        event_type: str = Form(""),
        exact_date: str = Form(""),
        note: str = Form(""),
    ) -> Response:
        role = service.repo.get_role(canonical_slug)
        if role is None:
            return _error(app, request, "Role not found", "No canonical role matched that ID.", 404)
        artifacts = []
        if event_type.strip() == "submitted":
            # Manual submission events preserve the generated application artifacts
            # that were actually sent, so the timeline links back to the evidence.
            artifacts = [artifact for artifact in role.artifacts if artifact.endswith(("resume.md", "cover_letter.md"))]
        service.repo.record_status(canonical_slug, event_type.strip(), exact_date.strip() or date.today().isoformat(), note.strip(), artifacts=artifacts)
        return _redirect(f"/roles/{canonical_slug}")

    @app.post("/roles/{canonical_slug}/update-prompt")
    async def update_role_from_prompt(request: Request, canonical_slug: str, prompt: str = Form("")) -> Response:
        # Free-text updates always go through the LLM. Even short prompts can imply
        # multiple durable changes across role notes, tasks, events, or status.
        prompt = prompt.strip()
        if not prompt:
            return _error(app, request, "Missing prompt", "Enter an update prompt before submitting.")
        role = service.repo.get_role(canonical_slug)
        if role is None:
            return _error(app, request, "Role not found", "No canonical role matched that ID.", 404)
        operation = service.operations.create(
            "update",
            lambda current_operation: service._run_prompt_update(current_operation, canonical_slug, prompt),
        )
        return _operation_response(app, request, operation.as_dict())

    @app.post("/roles/{canonical_slug}/reassess")
    async def reassess_role(request: Request, canonical_slug: str) -> Response:
        role = service.repo.get_role(canonical_slug)
        if role is None:
            return _error(app, request, "Role not found", "No canonical role matched that ID.", 404)
        operation = service.operations.create(
            "role reassessment",
            lambda current_operation: service._run_role_reassessment(current_operation, canonical_slug),
        )
        return _operation_response(app, request, operation.as_dict())

    @app.get("/download/generic-cv")
    async def download_generic_cv(request: Request) -> Response:
        try:
            return FileResponse(service.repo.ensure_generic_cv(), media_type="application/pdf", filename="cv.pdf")
        except FileNotFoundError as exc:
            return _error(app, request, "CV PDF unavailable", str(exc), 404)
        except subprocess.CalledProcessError:
            return _error(app, request, "CV PDF unavailable", "Typst could not build the CV PDF. Check the selected template and CV YAML.", 500)

    @app.get("/download/file")
    async def download_file(request: Request, path: str = Query("")) -> Response:
        # Repository.file_info validates that the requested path stays inside
        # CVAI_DATA before FastAPI streams it back to the browser.
        if not path:
            # This route is normally used by links, so a plain response is enough
            # when callers omit the required query string.
            return HTMLResponse("No repository file path was provided.", status_code=400)
        if not _is_downloadable_artifact(path):
            return _error(app, request, "File unavailable", "Only generated artifacts can be downloaded from the web app.", 403)
        file_path, mime = service.repo.file_info(path)
        return FileResponse(file_path, media_type=mime, filename=file_path.name)

    @app.get("/preview/file", response_class=HTMLResponse)
    async def preview_file(request: Request, path: str = Query("")) -> Response:
        if not path:
            return HTMLResponse("No repository file path was provided.", status_code=400)
        if not _is_downloadable_artifact(path) or not path.endswith(".md"):
            return _error(app, request, "Preview unavailable", "Only generated Markdown artifacts can be previewed.", 403)
        file_path, _ = service.repo.file_info(path)
        return app.state.templates.TemplateResponse(
            request=request,
            name="artifact_preview.html.j2",
            context={
                "request": request,
                "path": path,
                "filename": file_path.name,
                "content_html": _render_basic_markdown(service.repo.read_text(path)),
                "flash": None,
            },
        )

    return app


def _redirect(location: str) -> RedirectResponse:
    return RedirectResponse(location, status_code=302)


def _hx_redirect_or_normal(request: Request, location: str) -> Response:
    # HTMX requests should navigate after successful partial writes so the page
    # reloads with fresh row order and validation state. Plain form posts keep the
    # normal redirect behavior for no-JavaScript fallback.
    if request.headers.get("hx-request") == "true":
        return Response(status_code=204, headers={"HX-Redirect": location})
    return _redirect(location)


def _template(app: FastAPI, request: Request, name: str, context: dict, status_code: int = 200) -> Response:
    # All full-page renders share the same baseline context so templates do not
    # have to repeat flash-message plumbing.
    service: WebApp = request.app.state.service
    return app.state.templates.TemplateResponse(
        request=request,
        name=name,
        context={
            "request": request,
            "flash": None,
            "active_operation_count": service.operations.active_count(),
            **context,
        },
        status_code=status_code,
    )


def _error(app: FastAPI, request: Request, title: str, message: str, status_code: int = 400) -> Response:
    return _template(
        app,
        request,
        "error.html.j2",
        {"title": title, "error_title": title, "message": message, "flash": ("error", message)},
        status_code,
    )


def _is_downloadable_artifact(path: str) -> bool:
    # Database YAML and internal Markdown are not exposed directly. Downloads are
    # limited to built CV PDFs and generated role artifacts.
    normalized = path.strip().lstrip("/")
    if normalized.startswith("cv/") and normalized.endswith(".pdf"):
        return True
    return normalized.startswith("roles/") and "/artifacts/" in normalized


def _render_basic_markdown(markdown: str) -> str:
    """Render the small Markdown subset used by generated artifacts."""
    # Artifact previews are intentionally dependency-light. This renderer supports
    # only the block shapes CVAI generates and escapes everything before adding the
    # minimal inline code markup.
    blocks: list[str] = []
    list_items: list[str] = []
    in_code = False
    code_lines: list[str] = []

    def flush_list() -> None:
        if list_items:
            blocks.append("<ul>" + "".join(list_items) + "</ul>")
            list_items.clear()

    def inline(text: str) -> str:
        escaped = html_lib.escape(text)
        return re.sub(r"`([^`]+)`", r"<code>\1</code>", escaped)

    for raw_line in markdown.splitlines():
        line = raw_line.rstrip()
        if line.startswith("```"):
            if in_code:
                blocks.append("<pre><code>" + html_lib.escape("\n".join(code_lines)) + "</code></pre>")
                code_lines.clear()
                in_code = False
            else:
                flush_list()
                in_code = True
            continue
        if in_code:
            code_lines.append(line)
            continue
        if not line.strip():
            flush_list()
            continue
        if line.startswith("### "):
            flush_list()
            blocks.append(f"<h4>{inline(line[4:])}</h4>")
        elif line.startswith("## "):
            flush_list()
            blocks.append(f"<h3>{inline(line[3:])}</h3>")
        elif line.startswith("# "):
            flush_list()
            blocks.append(f"<h2>{inline(line[2:])}</h2>")
        elif line.startswith("- "):
            list_items.append(f"<li>{inline(line[2:])}</li>")
        else:
            flush_list()
            blocks.append(f"<p>{inline(line)}</p>")
    flush_list()
    if in_code:
        blocks.append("<pre><code>" + html_lib.escape("\n".join(code_lines)) + "</code></pre>")
    return "\n".join(blocks)


def _cv_response(
    app: FastAPI,
    request: Request,
    *,
    issues: list | None = None,
    status_code: int = 200,
    flash: tuple[str, str] | None = None,
    form_data: dict | None = None,
) -> Response:
    # The CV page has three states: onboarding for a missing CV, validation errors
    # for malformed YAML, and the editor for a valid document.
    service: WebApp = request.app.state.service
    document = load_cv(service.repo.root)
    display_issues = issues if issues is not None else document.issues
    pdf_dir = service.repo.resolve("cv")
    pdfs = sorted(path for path in pdf_dir.glob("*.pdf") if path.is_file())
    return _template(
        app,
        request,
        "cv_compact.html.j2",
        {
            "title": "CV",
            "document": document,
            "issues": display_issues,
            "pdfs": pdfs,
            "form_data": form_data,
            "flash": flash,
        },
        status_code=status_code,
    )


def _cv_item_modal(
    app: FastAPI,
    request: Request,
    section: str,
    index: int | None,
    *,
    issues: list | None = None,
    form_data: dict | None = None,
    status_code: int = 200,
) -> Response:
    # Modal fragments are intentionally small: the main CV page owns the list
    # summaries, while this endpoint owns the focused edit form for one item.
    service: WebApp = request.app.state.service
    document = load_cv(service.repo.root)
    if document.is_empty:
        return HTMLResponse('<div id="modal-root"></div>', status_code=404)
    if document.issues:
        return HTMLResponse('<div id="modal-root"></div>', status_code=400)
    items = cv_list_items(document.data, section)
    if index is None:
        index = len(items)
        item = {}
        mode = "new"
    elif index < 0 or index >= len(items):
        return HTMLResponse('<div id="modal-root"></div>', status_code=404)
    else:
        item = items[index]
        mode = "edit"
    return app.state.templates.TemplateResponse(
        request=request,
        name="cv_item_modal.html.j2",
        context={
            "request": request,
            "title": "CV item",
            "section": section,
            "index": index,
            "item": item,
            "cv": document.data,
            "issues": issues or [],
            "form_data": form_data or {},
            "mode": mode,
            "flash": None,
        },
        status_code=status_code,
    )


def _cv_contact_modal(
    app: FastAPI,
    request: Request,
    *,
    issues: list | None = None,
    status_code: int = 200,
) -> Response:
    # Contact details are a single object rather than a repeatable list item, but
    # the browser interaction is the same focused modal pattern used elsewhere.
    service: WebApp = request.app.state.service
    document = load_cv(service.repo.root)
    if document.is_empty:
        return HTMLResponse('<div id="modal-root"></div>', status_code=404)
    if document.issues:
        return HTMLResponse('<div id="modal-root"></div>', status_code=400)
    return app.state.templates.TemplateResponse(
        request=request,
        name="cv_contact_modal.html.j2",
        context={
            "request": request,
            "title": "Contact",
            "contact": document.data.get("contact", {}),
            "issues": issues or [],
            "flash": None,
        },
        status_code=status_code,
    )


def _register_template_helpers(templates: Jinja2Templates) -> None:
    # Jinja filters keep display-only transformations out of route functions.
    env = templates.env
    env.filters["status_sentence"] = status_sentence
    env.filters["verdict_class"] = verdict_class
    env.filters["category_label"] = category_label
    env.filters["fulfillment_label"] = fulfillment_label
    env.filters["fulfillment_class"] = fulfillment_class
    env.filters["task_status_label"] = task_status_label
    env.filters["task_status_class"] = task_status_class
    env.filters["task_eta_label"] = task_eta_label
    env.filters["task_eta_class"] = task_eta_class


def _operation_response(app: FastAPI, request: Request, operation: dict) -> Response:
    if request.headers.get("hx-request") == "true":
        return _operation_notice_response(app, request, operation)
    return _redirect(f"/operations/{operation['id']}")


def _operation_modal_or_redirect(app: FastAPI, request: Request, operation: dict) -> Response:
    if request.headers.get("hx-request") == "true":
        return _operation_modal_response(app, request, operation)
    return _redirect(f"/operations/{operation['id']}")


def _operation_notice_response(app: FastAPI, request: Request, operation: dict) -> Response:
    return app.state.templates.TemplateResponse(
        request=request,
        name="operation_notice.html.j2",
        context=_operation_context(request, operation, fragment=True),
    )


def _operation_modal_response(app: FastAPI, request: Request, operation: dict) -> Response:
    return app.state.templates.TemplateResponse(
        request=request,
        name="operation_modal.html.j2",
        context=_operation_context(request, operation, fragment=True),
    )


def _operation_modal_empty_response(app: FastAPI, request: Request) -> Response:
    service: WebApp = request.app.state.service
    return app.state.templates.TemplateResponse(
        request=request,
        name="operation_modal_empty.html.j2",
        context={
            "request": request,
            "flash": None,
            "active_operation_count": service.operations.active_count(),
        },
    )


def _operation_modal_empty_with_notice_response(app: FastAPI, request: Request, operation: dict) -> Response:
    return app.state.templates.TemplateResponse(
        request=request,
        name="operation_modal_empty_with_notice.html.j2",
        context=_operation_context(request, operation, fragment=True),
    )


def _operation_fragment_response(app: FastAPI, request: Request, operation: dict) -> Response:
    return app.state.templates.TemplateResponse(
        request=request,
        name="operation_fragment.html.j2",
        context=_operation_context(request, operation, fragment=True),
    )


def _operation_context(request: Request, operation: dict, *, fragment: bool = False) -> dict:
    # Full operation pages can display flash errors. HTMX fragments skip flash
    # wrappers so replacing operation-status does not duplicate page-level messages.
    service: WebApp = request.app.state.service
    return {
        "request": request,
        "title": "Operation",
        "section_title": "Operations",
        "operation": operation,
        "finished": operation["status"] in {"completed", "failed", "cancelled"},
        "flash": ("error", operation["error"]) if not fragment and operation.get("error") else None,
        "active_operation_count": service.operations.active_count(),
    }


def main() -> None:
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    uvicorn.run(create_fastapi_app(), host=host, port=port)


app = create_fastapi_app()
