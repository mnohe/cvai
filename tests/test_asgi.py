import unittest
import io
import zipfile
from pathlib import Path
import sys
import tempfile
import subprocess
import time
import re
from unittest import mock

import anyio
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import fastapi  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover - exercised only outside the web venv
    FASTAPI_AVAILABLE = False
else:
    FASTAPI_AVAILABLE = True

from cvai_core.llm import LLMConfig, OpenAIClient
from cvai_core.repo import Repository
from cvai_core.yaml_format import dump_yaml
from cvai_web.server import Action
from fixtures import create_sample_data_root
from test_cv import valid_cv


class ASGITestClient:
    """Synchronous wrapper around HTTPX's ASGI transport for route tests.

    Starlette's TestClient uses an AnyIO blocking portal. In the Codex sandbox
    used for these tests that portal can stall before the ASGI app receives the
    request. HTTPX's ASGI transport exercises the same app in-process without
    that thread handoff.
    """

    def __init__(self, app) -> None:
        self.app = app
        self._transport = httpx.ASGITransport(app=app)

    def get(self, path: str, **kwargs) -> httpx.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> httpx.Response:
        return self.request("POST", path, **kwargs)

    def patch(self, path: str, **kwargs) -> httpx.Response:
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs) -> httpx.Response:
        return self.request("DELETE", path, **kwargs)

    def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        return anyio.run(self._request, method, path, kwargs)

    async def _request(self, method: str, path: str, kwargs: dict) -> httpx.Response:
        async with httpx.AsyncClient(transport=self._transport, base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)


@unittest.skipIf(not FASTAPI_AVAILABLE, "FastAPI test dependency is not installed")
class FastAPIRouteTests(unittest.TestCase):
    def data_root(self) -> Path:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        return create_sample_data_root(Path(temp_dir.name))

    def client(self, llm: OpenAIClient | None = None) -> ASGITestClient:
        from cvai_web.asgi import create_fastapi_app

        app = create_fastapi_app(
            repo=Repository(self.data_root()),
            llm=llm or OpenAIClient(LLMConfig(api_key="", model="test", base_url="https://example.test/v1")),
        )
        return ASGITestClient(app)

    def test_dashboard_route_uses_fastapi(self) -> None:
        response = self.client().get("/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("CVAI", response.text)
        self.assertIn("/roles/", response.text)
        self.assertIn('class="nav-tab active" href="/"', response.text)
        self.assertIn('aria-current="page">Roles</a>', response.text)
        self.assertIn('<span class="nav-current">Roles</span>', response.text)
        self.assertIn("New&nbsp;role", response.text)
        self.assertNotIn("Ingest&nbsp;role", response.text)

    def test_detail_routes_highlight_their_parent_nav_section(self) -> None:
        client = self.client()
        task_response = client.get("/tasks/task_control_plane_case_study")

        self.assertEqual(task_response.status_code, 200)
        self.assertIn('class="nav-tab active" href="/tasks"', task_response.text)
        self.assertIn('<span class="nav-current">Tasks</span>', task_response.text)

    def test_health_endpoint_is_available_for_container_smoke_tests(self) -> None:
        response = self.client().get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_role_detail_route_returns_not_found_page(self) -> None:
        response = self.client().get("/roles/not_a_real_role")

        self.assertEqual(response.status_code, 404)
        self.assertIn("Role not found", response.text)

    def test_jinja_environment_is_configured(self) -> None:
        client = self.client()

        self.assertTrue(hasattr(client.app.state, "templates"))

    def test_static_stylesheet_is_served(self) -> None:
        static_root = Path(__file__).resolve().parents[1] / "cvai_web" / "static"

        self.assertIn(".cv-form", (static_root / "app.css").read_text(encoding="utf-8"))
        self.assertIn("<svg", (static_root / "cvai-h.svg").read_text(encoding="utf-8"))
        self.assertIn("<svg", (static_root / "cvai-v.svg").read_text(encoding="utf-8"))

    def test_action_page_uses_htmx_status_fragment(self) -> None:
        client = self.client()
        action = Action(id="action-test", kind="url", status="running")
        action.log_lines.append("[00:00:00] Started")
        client.app.state.service.actions._actions[action.id] = action

        actions = client.get("/actions")
        page = client.get("/actions/action-test")
        fragment = client.get("/actions/action-test/fragment")

        self.assertEqual(actions.status_code, 200)
        self.assertIn("New action", actions.text)
        self.assertIn('name="prompt"', actions.text)
        self.assertIn("/actions/action-test", actions.text)
        self.assertEqual(page.status_code, 200)
        self.assertIn('hx-get="/actions/action-test/fragment"', page.text)
        self.assertIn("Started", fragment.text)

    def test_missing_typst_returns_clean_pdf_error_page(self) -> None:
        client = self.client()
        client.app.state.service.repo.ensure_cv_pdf = lambda layout: (_ for _ in ()).throw(FileNotFoundError("Typst is not installed."))

        response = client.get("/cv/", params={"layout": "demo", "mime": "application/pdf"})

        self.assertEqual(response.status_code, 404)
        self.assertIn("CV PDF unavailable", response.text)
        self.assertIn("Typst is not installed.", response.text)

    def test_typst_subprocess_failure_returns_clean_pdf_error_page(self) -> None:
        client = self.client()
        client.app.state.service.repo.ensure_cv_pdf = lambda layout: (_ for _ in ()).throw(
            subprocess.CalledProcessError(1, ["typst"])
        )

        response = client.get("/cv/", params={"layout": "demo", "mime": "application/pdf"})

        self.assertEqual(response.status_code, 500)
        self.assertIn("Typst could not build", response.text)

    def test_ingest_url_rejects_missing_and_private_targets(self) -> None:
        client = self.client()

        missing = client.post("/roles/", data={"source_kind": "url", "source_url": ""})
        private = client.post("/roles/", params={"url": "http://127.0.0.1/role"})

        self.assertEqual(missing.status_code, 400)
        self.assertIn("Missing URL", missing.text)
        self.assertEqual(private.status_code, 400)
        self.assertIn("Blocked URL", private.text)

    def test_ingest_text_rejects_missing_text(self) -> None:
        response = self.client().post("/roles/", data={"source_kind": "text", "source_text": ""})

        self.assertEqual(response.status_code, 400)
        self.assertIn("Missing text", response.text)

    def test_intake_page_enables_quick_analysis_by_default(self) -> None:
        response = self.client().get("/intake")

        self.assertEqual(response.status_code, 200)
        self.assertIn('name="quick_analysis"', response.text)
        self.assertIn("checked", response.text)

    def test_text_ingestion_quick_analysis_stops_before_role_write(self) -> None:
        llm = mock.Mock()
        llm.is_configured.return_value = True
        llm.quick_analyze_role.return_value = {
            "clear": True,
            "summary": "Promising fit.",
            "fit_level": "good",
            "key_matching_abilities": ["Python platform work"],
            "important_gaps": [],
            "recommendation": "continue",
            "rationale": "Enough overlap to inspect fully.",
        }
        client = self.client(llm=llm)

        response = client.post(
            "/roles/",
            data={
                "source_kind": "text",
                "quick_analysis": "1",
                "source_text": "Example needs a platform engineer for Python APIs.",
                "source_url": "https://example.test/job",
            },
            follow_redirects=False,
        )
        action_path = response.headers["location"]
        fragment = ""
        deadline = time.time() + 5
        while time.time() < deadline:
            fragment = client.get(f"{action_path}/fragment").text
            if "Quick analysis completed" in fragment or "failed" in fragment:
                break
            time.sleep(0.05)

        self.assertEqual(response.status_code, 302)
        self.assertIn("Quick analysis", fragment)
        self.assertIn("Continue full ingestion", fragment)
        self.assertFalse((client.app.state.service.repo.root / "roles" / "example_remote_platform_engineer").exists())
        llm.quick_analyze_role.assert_called_once()
        llm.generate_bundle.assert_not_called()

    def test_hx_quick_analysis_launches_modal_without_redirect(self) -> None:
        llm = mock.Mock()
        llm.is_configured.return_value = True
        llm.quick_analyze_role.return_value = {
            "clear": True,
            "summary": "Promising fit.",
            "fit_level": "good",
            "key_matching_abilities": [],
            "important_gaps": [],
            "recommendation": "continue",
            "rationale": "Enough overlap to inspect fully.",
        }
        client = self.client(llm=llm)

        response = client.post(
            "/roles/",
            data={
                "source_kind": "text",
                "quick_analysis": "1",
                "source_text": "Example needs a platform engineer for Python APIs.",
                "source_url": "https://example.test/job",
            },
            headers={"HX-Request": "true"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("location", response.headers)
        self.assertIn('id="operation-modal-root"', response.text)
        self.assertIn("<dialog", response.text)
        self.assertIn("Quick analysis", response.text)
        self.assertNotIn("operation-page-status", response.text)
        self.assertNotIn("<code>action-", response.text)
        self.assertIn("/actions/action-", response.text)
        action_match = re.search(r"/actions/(action-[^\"]+)/modal", response.text)
        self.assertIsNotNone(action_match)
        action_path = f"/actions/{action_match.group(1)}"
        modal = ""
        deadline = time.time() + 5
        while time.time() < deadline:
            modal = client.get(f"{action_path}/modal").text
            if "Promising fit." in modal or "failed" in modal:
                break
            time.sleep(0.05)

        self.assertIn("Quick analysis", modal)
        self.assertIn("Continue full ingestion", modal)
        self.assertIn("Promising fit.", modal)

    def test_hx_action_cancel_closes_modal_and_marks_cancelled(self) -> None:
        client = self.client()
        action = Action(id="action-cancel", kind="quick analysis", status="running")
        client.app.state.service.actions._actions[action.id] = action

        response = client.patch("/actions/action-cancel", data={"status": "cancelled"}, headers={"HX-Request": "true"})

        self.assertEqual(response.status_code, 200)
        self.assertIn('<div id="operation-modal-root"></div>', response.text)
        self.assertIn('id="active-operation-count"', response.text)
        self.assertEqual(action.status, "cancelled")

    def test_missing_action_modal_poll_closes_without_console_error(self) -> None:
        response = self.client().get("/actions/action-missing/modal")

        self.assertEqual(response.status_code, 200)
        self.assertIn('<div id="operation-modal-root"></div>', response.text)

    def test_task_status_post_updates_task(self) -> None:
        client = self.client()

        response = client.post(
            "/tasks/task_control_plane_case_study/status",
            data={"status": "completed", "detail": "pp-platform"},
            follow_redirects=False,
        )
        task = client.app.state.service.repo.get_task("task_control_plane_case_study")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["location"], "/tasks/task_control_plane_case_study")
        self.assertEqual(task.status, "completed")
        self.assertEqual(task.evidence_refs, ["pp-platform"])

    def test_role_update_prompt_uses_llm_action_to_record_status(self) -> None:
        llm = mock.Mock()
        llm.is_configured.return_value = True
        llm.interpret_status_update.return_value = {
            "clear": True,
            "event_type": "rejected",
            "exact_date": "2026-05-20",
            "note": "duplicate role",
            "internal_notes": [],
        }
        client = self.client(llm=llm)

        response = client.post(
            "/actions",
            data={
                "action_type": "role_update_prompt",
                "target_type": "role",
                "target_id": "ledgerly_remote_staff_backend_engineer_payments",
                "prompt": "Rejected on 2026-05-20 with this rationale: duplicate role.",
            },
            follow_redirects=False,
        )
        action_path = response.headers["location"]
        fragment = ""
        deadline = time.time() + 5
        while time.time() < deadline:
            fragment = client.get(f"{action_path}/fragment").text
            if "Applied rejected status dated 2026-05-20" in fragment or "failed" in fragment:
                break
            time.sleep(0.05)
        role = client.app.state.service.repo.get_role("ledgerly_remote_staff_backend_engineer_payments")
        actions = client.app.state.service.repo.load_data("actions.yaml", {"actions": []})["actions"]

        self.assertEqual(response.status_code, 302)
        self.assertTrue(response.headers["location"].startswith("/actions/action-"))
        self.assertIn("Applied rejected status dated 2026-05-20", fragment)
        self.assertEqual(role.status, "rejected")
        self.assertIn("duplicate role", role.status_detail)
        self.assertEqual(actions[-1]["action_type"], "role_update_prompt")
        self.assertEqual(actions[-1]["status"], "completed")
        llm.interpret_status_update.assert_called_once()

    def test_role_file_route_rejects_missing_artifact(self) -> None:
        response = self.client().get("/roles/ledgerly_remote_staff_backend_engineer_payments/files/missing.md")

        self.assertEqual(response.status_code, 404)
        self.assertIn("generated artifact does not exist", response.text)

    def test_role_file_route_rejects_database_files(self) -> None:
        response = self.client().get("/roles/ledgerly_remote_staff_backend_engineer_payments/files/%2E%2E/%2E%2E/roles.yaml")

        self.assertEqual(response.status_code, 403)
        self.assertIn("Only generated artifacts", response.text)

    def test_cv_page_handles_missing_malformed_and_valid_documents(self) -> None:
        client = self.client()
        root = client.app.state.service.repo.root
        (root / "cv" / "cv.yaml").unlink()

        missing = client.get("/cv/")
        self.assertEqual(missing.status_code, 200)
        self.assertIn("Start your CV", missing.text)

        cv_path = root / "cv" / "cv.yaml"
        cv_path.write_text("summary: [broken\n", encoding="utf-8")
        malformed = client.get("/cv/")
        self.assertEqual(malformed.status_code, 200)
        self.assertIn("Fix CV data", malformed.text)
        self.assertIn("invalid YAML", malformed.text)

        cv_path.write_text(dump_yaml(valid_cv()), encoding="utf-8")
        (root / "cv" / "alovelace-demo.pdf").write_bytes(b"%PDF")
        valid = client.get("/cv/")
        self.assertEqual(valid.status_code, 200)
        self.assertIn("Ada Lovelace", valid.text)
        self.assertIn("PDF downloads", valid.text)
        self.assertIn("Download", valid.text)
        self.assertIn("Remove", valid.text)
        self.assertIn("alovelace-demo.pdf", valid.text)
        self.assertIn('hx-get="/cv/templates/demo/modals/remove-confirm"', valid.text)
        self.assertIn('name="template_zip"', valid.text)
        self.assertIn("action=\"/cv/summary\"", valid.text)
        self.assertIn('hx-get="/cv/contact/modals/edit"', valid.text)
        self.assertIn('hx-get="/cv/experience/0/modals/edit"', valid.text)
        self.assertIn("<table class=\"cv-table\">", valid.text)
        self.assertIn("<td class=\"cv-table-description\">", valid.text)
        self.assertNotIn("cv-table-head", valid.text)
        self.assertNotIn("YAML</label>", valid.text)

        contact_modal = client.get("/cv/contact/modals/edit")
        modal = client.get("/cv/experience/0/modals/edit")
        self.assertEqual(contact_modal.status_code, 200)
        self.assertIn("Edit Contact", contact_modal.text)
        self.assertIn("name=\"contact.email\"", contact_modal.text)
        self.assertEqual(modal.status_code, 200)
        self.assertIn("<dialog", modal.text)
        self.assertIn("Analytical Engines", modal.text)

    def test_cv_template_download_and_remove_routes(self) -> None:
        client = self.client()
        root = client.app.state.service.repo.root
        (root / "cv" / "cv.yaml").write_text(dump_yaml(valid_cv()), encoding="utf-8")
        pdf_path = root / "cv" / "alovelace-demo.pdf"
        pdf_path.write_bytes(b"%PDF")
        modal = client.get("/cv/templates/demo/modals/remove-confirm")
        removed = client.delete("/cv/templates/demo", headers={"HX-Request": "true"})

        self.assertEqual(modal.status_code, 200)
        self.assertIn("Remove Template", modal.text)
        self.assertIn("/cv/templates/demo", modal.text)
        self.assertEqual(removed.status_code, 204)
        self.assertEqual(removed.headers["HX-Redirect"], "/cv/")
        self.assertFalse((root / "pdf" / "templates" / "demo").exists())

    def test_cv_template_zip_upload_imports_template(self) -> None:
        client = self.client()
        root = client.app.state.service.repo.root
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as zip_file:
            zip_file.writestr(
                "compact/template.yaml",
                "id: compact\nname: Compact\nversion: 1\nentrypoint: cv.typ\n",
            )
            zip_file.writestr("compact/cv.typ", "#set text()\n")
        archive.seek(0)

        response = client.post(
            "/cv/templates",
            files={"template_zip": ("compact.zip", archive.getvalue(), "application/zip")},
            follow_redirects=False,
        )

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response.headers["location"], "/cv/")
        self.assertTrue((root / "pdf" / "templates" / "compact" / "cv.typ").exists())

    def test_cv_section_updates_validate_and_persist(self) -> None:
        client = self.client()
        root = client.app.state.service.repo.root
        cv_path = root / "cv" / "cv.yaml"
        cv_path.write_text(dump_yaml(valid_cv()), encoding="utf-8")

        invalid_form = self.cv_form_data(summary="Invalid profile.")
        invalid_form.pop("languages.0.name")
        invalid_form.pop("languages.0.level")
        invalid = client.post("/cv/", data=invalid_form)
        valid = client.post("/cv/", data=self.cv_form_data(summary="Updated profile."), follow_redirects=False)
        saved_after_form = cv_path.read_text(encoding="utf-8")

        self.assertEqual(invalid.status_code, 400)
        self.assertIn("languages", invalid.text)
        self.assertEqual(valid.status_code, 302)
        self.assertEqual(valid.headers["location"], "/cv/")
        self.assertIn("Updated profile.", saved_after_form)

    def test_cv_modal_item_updates_validate_and_persist(self) -> None:
        client = self.client()
        root = client.app.state.service.repo.root
        cv_path = root / "cv" / "cv.yaml"
        cv_path.write_text(dump_yaml(valid_cv()), encoding="utf-8")

        invalid = client.post(
            "/cv/languages/0",
            data={"languages.0.name": "", "languages.0.level": "Native"},
            headers={"HX-Request": "true"},
        )
        valid = client.post(
            "/cv/languages/0",
            data={"languages.0.name": "English", "languages.0.level": "Professional"},
            headers={"HX-Request": "true"},
        )
        saved_after_modal = cv_path.read_text(encoding="utf-8")

        self.assertEqual(invalid.status_code, 400)
        self.assertIn("must be a non-empty string", invalid.text)
        self.assertEqual(valid.status_code, 204)
        self.assertEqual(valid.headers["HX-Redirect"], "/cv/")
        self.assertIn("Professional", saved_after_modal)

    def test_cv_reorder_patches_without_htmx_redirect(self) -> None:
        client = self.client()
        root = client.app.state.service.repo.root
        cv = valid_cv()
        cv["languages"].append({"name": "French", "level": "Basic"})
        (root / "cv" / "cv.yaml").write_text(dump_yaml(cv), encoding="utf-8")

        response = client.patch(
            "/cv/languages",
            data={"items": ["1", "0"]},
            headers={"HX-Request": "true"},
        )
        updated = (root / "cv" / "cv.yaml").read_text(encoding="utf-8")

        self.assertEqual(response.status_code, 204)
        self.assertNotIn("HX-Redirect", response.headers)
        self.assertLess(updated.index("French"), updated.index("English"))

    def cv_form_data(self, *, summary: str) -> dict[str, str]:
        return {
            "summary": summary,
            "contact.name": "Ada",
            "contact.surname": "Lovelace",
            "contact.phone.prefix": "+44",
            "contact.phone.number": "123456",
            "contact.email": "ada@example.test",
            "contact.linkedin": "ada",
            "languages.0.name": "English",
            "languages.0.level": "Native",
            "education.0.name": "Maths",
            "education.0.issuer": "Example University",
            "education.0.year": "1843",
            "experience.0.company": "Analytical Engines",
            "experience.0.positions.0.roles.0": "Programmer",
            "experience.0.positions.0.start": "1842",
            "experience.0.positions.0.location": "London",
            "experience.0.positions.0.tasks.0": "Designed an algorithm.",
            "projects.url": "https://example.test",
            "projects.items.0.name": "Notes",
            "projects.items.0.summary": "Published notes.",
            "projects.items.0.url": "https://example.test/notes",
            "projects.items.0.description": "Explained computation.",
        }


if __name__ == "__main__":
    unittest.main()
