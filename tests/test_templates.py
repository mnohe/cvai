import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    from fastapi.testclient import TestClient
except ModuleNotFoundError:  # pragma: no cover - exercised only outside the web venv
    TestClient = None

from cvai_core.llm import LLMConfig, OpenAIClient
from cvai_core.repo import Repository
from fixtures import create_sample_data_root


@unittest.skipIf(TestClient is None, "FastAPI test dependency is not installed")
class TemplateRouteTests(unittest.TestCase):
    def client(self) -> TestClient:
        temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(temp_dir.cleanup)
        root = create_sample_data_root(Path(temp_dir.name))
        from cvai_web.asgi import create_fastapi_app

        app = create_fastapi_app(
            repo=Repository(root),
            llm=OpenAIClient(LLMConfig(api_key="", model="test", base_url="https://example.test/v1")),
        )
        return TestClient(app)

    def test_dashboard_lists_roles_with_update_dialogs(self) -> None:
        html = self.client().get("/").text

        self.assertEqual(html.count("class=\"role-row\""), 2)
        self.assertEqual(html.count("<dialog class=\"dialog\""), 1)
        self.assertIn(">Backend Engineer</a>", html)
        self.assertIn(">Submitted</span>", html)
        self.assertIn("<div class=\"role-subtitle\">Example, Dublin</div>", html)
        self.assertIn("Submitted on 2026-05-19.", html)
        self.assertIn("1 open task", html)
        self.assertIn("/roles/example_dublin_backend_engineer/update-prompt", html)
        self.assertIn("/static/cvai-h.svg", html)
        self.assertIn("/favicon.svg", html)
        self.assertIn('class="nav-tab" href="/"', html)
        self.assertIn(">CV</a>", html)
        self.assertNotIn("CV YAML", html)

    def test_application_page_uses_jinja_sections(self) -> None:
        html = self.client().get("/roles/sample_remote_platform_engineer").text

        self.assertIn("Fixture rationale.", html)
        self.assertNotIn("Rationale:", html)
        self.assertIn("Possible fit", html)
        self.assertIn("<h3 style=\"margin:0;\">Requirement coverage</h3>", html)
        self.assertIn("Backend systems", html)
        self.assertIn("Must-have", html)
        self.assertIn("Partially met", html)
        self.assertIn("task_platform_story", html)
        self.assertIn("href=\"/tasks/task_platform_story\"", html)
        self.assertNotIn("Job file", html)
        self.assertNotIn("Open source", html)
        self.assertIn("action=\"/roles/sample_remote_platform_engineer/update-prompt\"", html)
        self.assertIn("<h3>Event log</h3>", html)

    def test_task_pages_show_catalog_and_detail_state(self) -> None:
        client = self.client()
        list_html = client.get("/tasks").text
        detail_html = client.get("/tasks/task_platform_story").text

        self.assertIn("href=\"/tasks/task_platform_story\"", list_html)
        self.assertIn("2 days", list_html)
        self.assertIn("Prepare platform ownership evidence.", list_html)
        self.assertIn('<h1 class="header-title">Platform story</h1>', detail_html)
        self.assertIn("Evidence references one platform project.", detail_html)
        self.assertIn("Won't do", detail_html)
        self.assertIn("action=\"/tasks/task_platform_story/status\"", detail_html)
        self.assertIn("action=\"/tasks/task_platform_story/reassess\"", detail_html)
        self.assertIn("Used by requirements", detail_html)


if __name__ == "__main__":
    unittest.main()
