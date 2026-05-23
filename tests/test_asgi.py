import unittest
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
from cvai_web.server import Operation
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

    def test_operation_page_uses_htmx_status_fragment(self) -> None:
        client = self.client()
        operation = Operation(id="operation-test", kind="url", status="running")
        operation.log_lines.append("[00:00:00] Started")
        client.app.state.service.operations._operations[operation.id] = operation

        page = client.get("/operations/operation-test")
        fragment = client.get("/operations/operation-test/fragment")

        self.assertEqual(page.status_code, 200)
        self.assertIn('hx-get="/operations/operation-test/fragment"', page.text)
        self.assertIn("Started", fragment.text)

    def test_missing_typst_returns_clean_pdf_error_page(self) -> None:
        client = self.client()
        client.app.state.service.repo.ensure_generic_cv = lambda: (_ for _ in ()).throw(FileNotFoundError("Typst is not installed."))

        response = client.get("/download/generic-cv")

        self.assertEqual(response.status_code, 404)
        self.assertIn("CV PDF unavailable", response.text)
        self.assertIn("Typst is not installed.", response.text)

    def test_typst_subprocess_failure_returns_clean_pdf_error_page(self) -> None:
        client = self.client()
        client.app.state.service.repo.ensure_generic_cv = lambda: (_ for _ in ()).throw(
            subprocess.CalledProcessError(1, ["typst"])
        )

        response = client.get("/download/generic-cv")

        self.assertEqual(response.status_code, 500)
        self.assertIn("Typst could not build", response.text)

    def test_ingest_url_rejects_missing_and_private_targets(self) -> None:
        client = self.client()

        missing = client.post("/ingestions/url", data={"source_url": ""})
        private = client.post("/ingestions/url", data={"source_url": "http://127.0.0.1/role"})

        self.assertEqual(missing.status_code, 400)
        self.assertIn("Missing URL", missing.text)
        self.assertEqual(private.status_code, 400)
        self.assertIn("Blocked URL", private.text)

    def test_ingest_text_rejects_missing_text(self) -> None:
        response = self.client().post("/ingestions/text", data={"source_text": ""})

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
            "/ingestions/text",
            data={
                "quick_analysis": "1",
                "source_text": "Example needs a platform engineer for Python APIs.",
                "source_url": "https://example.test/job",
            },
            follow_redirects=False,
        )
        operation_path = response.headers["location"]
        fragment = ""
        deadline = time.time() + 5
        while time.time() < deadline:
            fragment = client.get(f"{operation_path}/fragment").text
            if "Quick analysis completed" in fragment or "failed" in fragment:
                break
            time.sleep(0.05)

        self.assertEqual(response.status_code, 302)
        self.assertIn("Quick analysis", fragment)
        self.assertIn("Return to the intake page", fragment)
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
            "/ingestions/text",
            data={
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
        self.assertNotIn("<code>operation-", response.text)
        self.assertIn("/operations/operation-", response.text)
        operation_match = re.search(r"/operations/(operation-[^\"]+)/modal", response.text)
        self.assertIsNotNone(operation_match)
        operation_path = f"/operations/{operation_match.group(1)}"
        modal = ""
        deadline = time.time() + 5
        while time.time() < deadline:
            modal = client.get(f"{operation_path}/modal").text
            if "Quick analysis" in modal or "failed" in modal:
                break
            time.sleep(0.05)

        self.assertIn("Quick analysis", modal)
        self.assertIn("Continue full ingestion", modal)
        self.assertIn("Promising fit.", modal)

    def test_hx_operation_cancel_closes_modal_and_marks_cancelled(self) -> None:
        client = self.client()
        operation = Operation(id="operation-cancel", kind="quick analysis", status="running")
        client.app.state.service.operations._operations[operation.id] = operation

        response = client.post("/operations/operation-cancel/cancel", headers={"HX-Request": "true"})

        self.assertEqual(response.status_code, 200)
        self.assertIn('<div id="operation-modal-root"></div>', response.text)
        self.assertIn('id="active-operation-count"', response.text)
        self.assertEqual(operation.status, "cancelled")

    def test_missing_operation_modal_poll_closes_without_console_error(self) -> None:
        response = self.client().get("/operations/operation-missing/modal")

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

    def test_role_update_prompt_uses_llm_operation_to_record_status(self) -> None:
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
            "/roles/ledgerly_remote_staff_backend_engineer_payments/update-prompt",
            data={"prompt": "Rejected on 2026-05-20 with this rationale: duplicate role."},
            follow_redirects=False,
        )
        operation_path = response.headers["location"]
        fragment = ""
        deadline = time.time() + 5
        while time.time() < deadline:
            fragment = client.get(f"{operation_path}/fragment").text
            if "Applied rejected status dated 2026-05-20" in fragment or "failed" in fragment:
                break
            time.sleep(0.05)
        role = client.app.state.service.repo.get_role("ledgerly_remote_staff_backend_engineer_payments")

        self.assertEqual(response.status_code, 302)
        self.assertIn("Applied rejected status dated 2026-05-20", fragment)
        self.assertEqual(role.status, "rejected")
        self.assertIn("duplicate role", role.status_detail)
        llm.interpret_status_update.assert_called_once()

    def test_download_file_rejects_missing_path(self) -> None:
        response = self.client().get("/download/file")

        self.assertEqual(response.status_code, 400)
        self.assertIn("No repository file path", response.text)

    def test_download_file_rejects_database_files(self) -> None:
        response = self.client().get("/download/file", params={"path": "roles.yaml"})

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
        (root / "cv" / "cv.pdf").write_bytes(b"%PDF")
        valid = client.get("/cv/")
        self.assertEqual(valid.status_code, 200)
        self.assertIn("Ada Lovelace", valid.text)
        self.assertIn("Download current PDF", valid.text)
        self.assertIn("cv.pdf", valid.text)
        self.assertIn("action=\"/cv/summary\"", valid.text)
        self.assertIn('hx-get="/cv/contact/edit"', valid.text)
        self.assertIn('hx-get="/cv/experience/0/edit"', valid.text)
        self.assertIn("<table class=\"cv-table\">", valid.text)
        self.assertIn("<td class=\"cv-table-description\">", valid.text)
        self.assertNotIn("cv-table-head", valid.text)
        self.assertNotIn("YAML</label>", valid.text)

        contact_modal = client.get("/cv/contact/edit")
        modal = client.get("/cv/experience/0/edit")
        self.assertEqual(contact_modal.status_code, 200)
        self.assertIn("Edit Contact", contact_modal.text)
        self.assertIn("name=\"contact.email\"", contact_modal.text)
        self.assertEqual(modal.status_code, 200)
        self.assertIn("<dialog", modal.text)
        self.assertIn("Analytical Engines", modal.text)

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

    def test_cv_move_posts_without_htmx_redirect(self) -> None:
        client = self.client()
        root = client.app.state.service.repo.root
        cv = valid_cv()
        cv["languages"].append({"name": "French", "level": "Basic"})
        (root / "cv" / "cv.yaml").write_text(dump_yaml(cv), encoding="utf-8")

        response = client.post(
            "/cv/languages/1/move",
            data={"direction": "up"},
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
