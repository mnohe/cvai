from __future__ import annotations

import contextlib
import re
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
import sys

import httpx
import uvicorn

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cvai_core.repo import Repository
from cvai_core.yaml_format import dump_yaml
from cvai_web.asgi import create_fastapi_app
from fixtures import create_sample_data_root
from test_cv import valid_cv


class FakeLLM:
    # The integration server should exercise the real HTTP routes and repository
    # writes, but it must not call a paid or networked LLM. This fake implements
    # the same methods used by WebApp's intake workflow.
    def __init__(self) -> None:
        self.generated_bundles: list[dict] = []
        self.quick_analyses: list[dict] = []

    def is_configured(self) -> bool:
        return True

    def extract_role(self, **kwargs) -> dict:
        return {
            "clear": True,
            "company": "FakeCorp",
            "role": "Staff Engineer",
            "location": "Remote",
        }

    def generate_bundle(self, **kwargs) -> dict:
        metadata = kwargs["metadata"]
        bundle = {
            "metadata": metadata,
            "mirror_summary": {
                "verdict": "FIT",
                "bullets": ["Good platform fit."],
            },
            "job": {
                "version": 1,
                "posting": {"raw_text": kwargs["job_markdown"]},
                "extracted": {
                    "responsibilities": ["Build platform services."],
                    "hard_requirements": ["Python"],
                    "soft_requirements": ["Observability"],
                    "inferred_requirements": [],
                    "skills": ["Python", "Distributed systems"],
                    "interview_focus": ["Platform ownership"],
                },
                "requirements": [
                    {
                        "id": "req_python",
                        "text": "Python backend services",
                        "category": "hard_requirement",
                        "fulfillment": "met",
                        "evidence": [{"text": "Existing backend experience.", "refs": ["je-example"]}],
                        "gap": "",
                        "task_refs": [],
                    }
                ],
            },
            "analysis": {
                "version": 1,
                "summary": {
                    "verdict": "FIT",
                    "verdict_label": "Good fit",
                    "recommendation": {"value": "APPLY_NOW", "reason": "Strong enough fit."},
                    "rationale": "Structured integration analysis.",
                    "notes": [],
                },
                "requirements": [
                    {
                        "id": "req_python",
                        "text": "Python backend services",
                        "category": "hard_requirement",
                        "fulfillment": "met",
                        "evidence": [{"text": "Existing backend experience.", "refs": ["je-example"]}],
                        "gap": "",
                        "task_refs": [],
                    }
                ],
                "llm_context": {"responsibilities": ["Build platform services."]},
            },
            "suitability_report": "# Report\n\nStructured integration analysis.",
            "role_matrix": "# Matrix\n\nPython backend services.",
            "interview_prep": {
                "story_bank_md": "# Stories",
                "system_design_bank_md": "# Systems",
                "security_bank_md": "# Security",
                "coding_plan_md": "# Coding",
            },
        }
        self.generated_bundles.append(bundle)
        return bundle

    def quick_analyze_role(self, **kwargs) -> dict:
        self.quick_analyses.append(kwargs)
        return {
            "clear": True,
            "summary": "FakeCorp is a good platform fit for the current CV.",
            "fit_level": "good",
            "key_matching_abilities": ["Python platform services", "Distributed systems ownership"],
            "important_gaps": [
                {
                    "requirement": "Production Go services",
                    "category": "soft_requirement",
                    "fulfillment": "partial",
                    "estimated_effort": "2 days",
                }
            ],
            "recommendation": "continue",
            "rationale": "The important gaps are closeable before applying.",
        }

    def interpret_status_update(self, **kwargs) -> dict:
        return {
            "clear": True,
            "event_type": "rejected",
            "exact_date": "2026-05-20",
            "note": "Integration duplicate.",
            "internal_notes": [],
        }


class LiveServer:
    # LiveServer starts the ASGI app exactly like production does, but on a random
    # localhost port. Tests talk to it through HTTP so redirects, cookies, forms,
    # background operations, and template rendering all cross the real network boundary.
    def __init__(self, repo: Repository, llm: FakeLLM | None = None) -> None:
        self.port = self._free_port()
        app = create_fastapi_app(repo=repo, llm=llm or FakeLLM())
        self.config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=self.port,
            log_level="critical",
            access_log=False,
        )
        self.server = uvicorn.Server(self.config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def __enter__(self) -> LiveServer:
        self.thread.start()
        deadline = time.time() + 10
        while time.time() < deadline:
            if self.server.started:
                return self
            time.sleep(0.05)
        raise RuntimeError("Integration server did not start in time")

    def __exit__(self, *exc_info) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=10)

    def _free_port(self) -> int:
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]


class IntegrationTests(unittest.TestCase):
    def data_root(self) -> Path:
        # Each integration test gets a fresh, initialized data directory so writes made by
        # forms and background operations can be asserted without affecting fixtures.
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = create_sample_data_root(Path(temp_dir.name))
        # Ingestion sends workflow guidance to the LLM. Real private data roots
        # contain this file, so the integration fixture provides a tiny equivalent.
        (root / "README.md").write_text("Use structured YAML for generated role data.\n", encoding="utf-8")
        cv_dir = root / "cv"
        cv_dir.mkdir(exist_ok=True)
        (cv_dir / "cv.yaml").write_text(dump_yaml(valid_cv()), encoding="utf-8")
        return root

    def test_user_can_manage_existing_application_cv_and_tasks_over_http(self) -> None:
        root = self.data_root()
        with LiveServer(Repository(root)) as server, httpx.Client(base_url=server.base_url, follow_redirects=False) as client:
            health = client.get("/healthz")
            dashboard = client.get("/")
            cv_page = client.get("/cv/")
            cv_save = client.post("/cv/", data=self.cv_form_data(summary="Integration updated summary."))
            task_update = client.post(
                "/tasks/task_control_plane_case_study/status",
                data={"status": "completed", "detail": "pp-e2e-platform"},
            )
            status_update = client.post(
                "/roles/ledgerly_remote_staff_backend_engineer_payments/update-prompt",
                data={"prompt": "Rejected on 2026-05-20 with this rationale: Integration duplicate."},
            )
            status_fragment = self._poll_operation_fragment(client, status_update.headers["location"])
            restricted_download = client.get("/download/file", params={"path": "roles.yaml"})

            updated_cv = client.get("/cv/")
            updated_task = client.get("/tasks/task_control_plane_case_study")
            updated_role = client.get("/roles/ledgerly_remote_staff_backend_engineer_payments")

        self.assertEqual(health.json(), {"status": "ok"})
        self.assertIn("/roles/", dashboard.text)
        self.assertIn(">CV</a>", dashboard.text)
        self.assertIn("Ada Lovelace", cv_page.text)
        self.assertEqual(cv_save.status_code, 302)
        self.assertEqual(cv_save.headers["location"], "/cv/")
        self.assertIn("Integration updated summary.", updated_cv.text)
        self.assertEqual(task_update.headers["location"], "/tasks/task_control_plane_case_study")
        self.assertIn("Completed", updated_task.text)
        self.assertIn("pp-e2e-platform", updated_task.text)
        self.assertTrue(status_update.headers["location"].startswith("/operations/"))
        self.assertIn("Applied rejected status dated 2026-05-20", status_fragment)
        self.assertIn("Rejected", updated_role.text)
        self.assertIn("Integration duplicate", updated_role.text)
        self.assertIn("Update prompt: Rejected on 2026-05-20 with this rationale: Integration duplicate.", updated_role.text)
        self.assertEqual(restricted_download.status_code, 403)

    def test_hx_operation_launch_stays_on_page_and_updates_notice(self) -> None:
        root = self.data_root()
        fake_llm = FakeLLM()
        with LiveServer(Repository(root), llm=fake_llm) as server, httpx.Client(
            base_url=server.base_url,
            follow_redirects=False,
            timeout=10,
        ) as client:
            response = client.post(
                "/roles/ledgerly_remote_staff_backend_engineer_payments/update-prompt",
                data={"prompt": "Rejected on 2026-05-20 with this rationale: Integration duplicate."},
                headers={"HX-Request": "true"},
            )
            operation_match = re.search(r'href="(/operations/operation-[^"]+)"', response.text)
            self.assertIsNotNone(operation_match)
            operation_path = operation_match.group(1)
            notice = self._poll_operation_notice(client, operation_path)
            operation_page = client.get(operation_path)
            updated_role = client.get("/roles/ledgerly_remote_staff_backend_engineer_payments")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("location", response.headers)
        self.assertIn('id="operation-notice-root"', response.text)
        self.assertIn("completed", notice)
        self.assertIn("COMPLETED", operation_page.text)
        self.assertIn("finished with status completed", operation_page.text)
        self.assertIn("Update prompt: Rejected on 2026-05-20 with this rationale: Integration duplicate.", updated_role.text)

    def test_hx_quick_analysis_result_appears_in_ingestion_modal(self) -> None:
        root = self.data_root()
        fake_llm = FakeLLM()
        with LiveServer(Repository(root), llm=fake_llm) as server, httpx.Client(
            base_url=server.base_url,
            follow_redirects=False,
            timeout=10,
        ) as client:
            response = client.post(
                "/ingestions/text",
                data={
                    "quick_analysis": "1",
                    "source_text": "FakeCorp needs a Staff Engineer to build Python platform services.",
                    "source_url": "https://example.test/fakecorp-staff-engineer",
                },
                headers={"HX-Request": "true"},
            )
            operation_match = re.search(r"/operations/(operation-[^\"]+)/modal", response.text)
            self.assertIsNotNone(operation_match)
            operation_path = f"/operations/{operation_match.group(1)}"
            modal = self._poll_operation_modal(client, operation_path, markers=("Quick analysis", "failed"))

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("location", response.headers)
        self.assertIn('id="operation-modal-root"', response.text)
        self.assertIn("<dialog", response.text)
        self.assertIn("Quick analysis", modal)
        self.assertIn("FakeCorp is a good platform fit", modal)
        self.assertIn("Continue full ingestion", modal)
        self.assertIn("Abandon", modal)

    def test_text_ingestion_runs_background_operation_and_creates_role(self) -> None:
        root = self.data_root()
        fake_llm = FakeLLM()
        with LiveServer(Repository(root), llm=fake_llm) as server, httpx.Client(
            base_url=server.base_url,
            follow_redirects=False,
            timeout=10,
        ) as client:
            response = client.post(
                "/ingestions/text",
                data={
                    "source_text": "FakeCorp needs a Staff Engineer to build Python platform services.",
                    "source_url": "https://example.test/fakecorp-staff-engineer",
                },
            )
            self.assertEqual(response.status_code, 302)
            operation_path = response.headers["location"]

            fragment = self._poll_operation_fragment(client, operation_path)
            role_page = client.get("/roles/fakecorp_remote_staff_engineer")

        self.assertEqual(len(fake_llm.generated_bundles), 1)
        self.assertIn("Ingestion completed", fragment)
        self.assertIn("Open role", fragment)
        self.assertEqual(role_page.status_code, 200)
        self.assertIn("FakeCorp", role_page.text)
        self.assertIn("Python backend services", role_page.text)
        self.assertTrue((root / "roles" / "fakecorp_remote_staff_engineer" / "analysis.yaml").exists())

    def test_quick_text_ingestion_can_be_abandoned_without_creating_role(self) -> None:
        root = self.data_root()
        fake_llm = FakeLLM()
        with LiveServer(Repository(root), llm=fake_llm) as server, httpx.Client(
            base_url=server.base_url,
            follow_redirects=False,
            timeout=10,
        ) as client:
            response = client.post(
                "/ingestions/text",
                data={
                    "quick_analysis": "1",
                    "source_text": "FakeCorp needs a Staff Engineer to build Python platform services.",
                    "source_url": "https://example.test/fakecorp-staff-engineer",
                },
            )
            self.assertEqual(response.status_code, 302)
            operation_path = response.headers["location"]

            fragment = self._poll_operation_fragment(client, operation_path, markers=("Quick analysis completed", "failed"))
            abandon = client.post(f"{operation_path}/abandon")
            abandoned_fragment = self._poll_operation_fragment(
                client,
                operation_path,
                markers=("Quick analysis abandoned", "failed"),
            )

        self.assertEqual(len(fake_llm.quick_analyses), 1)
        self.assertEqual(len(fake_llm.generated_bundles), 0)
        self.assertIn("Quick analysis completed", fragment)
        self.assertEqual(abandon.status_code, 302)
        self.assertIn("Quick analysis abandoned", abandoned_fragment)
        self.assertFalse((root / "roles" / "fakecorp_remote_staff_engineer").exists())

    def test_quick_text_ingestion_can_continue_to_full_ingestion(self) -> None:
        root = self.data_root()
        fake_llm = FakeLLM()
        with LiveServer(Repository(root), llm=fake_llm) as server, httpx.Client(
            base_url=server.base_url,
            follow_redirects=False,
            timeout=10,
        ) as client:
            response = client.post(
                "/ingestions/text",
                data={
                    "quick_analysis": "1",
                    "source_text": "FakeCorp needs a Staff Engineer to build Python platform services.",
                    "source_url": "https://example.test/fakecorp-staff-engineer",
                },
            )
            self.assertEqual(response.status_code, 302)
            preview_operation_path = response.headers["location"]

            preview_fragment = self._poll_operation_fragment(
                client,
                preview_operation_path,
                markers=("Quick analysis completed", "failed"),
            )
            continue_response = client.post(f"{preview_operation_path}/continue-ingestion")
            self.assertEqual(continue_response.status_code, 302)
            full_operation_path = continue_response.headers["location"]
            full_fragment = self._poll_operation_fragment(client, full_operation_path)
            role_page = client.get("/roles/fakecorp_remote_staff_engineer")

        self.assertEqual(len(fake_llm.quick_analyses), 1)
        self.assertEqual(len(fake_llm.generated_bundles), 1)
        self.assertIn("Quick analysis completed", preview_fragment)
        self.assertIn("Ingestion completed", full_fragment)
        self.assertIn("Open role", full_fragment)
        self.assertEqual(role_page.status_code, 200)
        self.assertIn("FakeCorp", role_page.text)
        self.assertTrue((root / "roles" / "fakecorp_remote_staff_engineer" / "analysis.yaml").exists())

    def _poll_operation_fragment(self, client: httpx.Client, operation_path: str, markers: tuple[str, ...] | None = None) -> str:
        # Background operations complete quickly with FakeLLM, but polling keeps the test
        # faithful to the browser flow and catches regressions in the fragment URL.
        markers = markers or ("Ingestion completed", "Applied ", "failed")
        deadline = time.time() + 10
        fragment_path = f"{operation_path}/fragment"
        latest = ""
        while time.time() < deadline:
            response = client.get(fragment_path)
            latest = response.text
            if any(marker in latest for marker in markers):
                return latest
            time.sleep(0.1)
        self.fail(f"Background operation did not finish. Last fragment: {latest}")

    def _poll_operation_notice(self, client: httpx.Client, operation_path: str, markers: tuple[str, ...] | None = None) -> str:
        markers = markers or ("completed", "failed")
        deadline = time.time() + 10
        latest = ""
        while time.time() < deadline:
            response = client.get(f"{operation_path}/notice")
            latest = response.text
            if any(marker in latest for marker in markers):
                return latest
            time.sleep(0.1)
        self.fail(f"Background operation notice did not finish. Last notice: {latest}")

    def _poll_operation_modal(self, client: httpx.Client, operation_path: str, markers: tuple[str, ...] | None = None) -> str:
        markers = markers or ("completed", "failed")
        deadline = time.time() + 10
        latest = ""
        while time.time() < deadline:
            response = client.get(f"{operation_path}/modal")
            latest = response.text
            if any(marker in latest for marker in markers):
                return latest
            time.sleep(0.1)
        self.fail(f"Background operation modal did not finish. Last modal: {latest}")

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
