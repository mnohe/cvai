#!/usr/bin/env python3
"""
Documentation tooling for CVAI.

Currently: generate guide screenshots for docs/GUIDE.adoc.

Requires the devcontainer (which includes Playwright and its Chromium).
Run from the repo root:

    CVAI_DATA=tests/fixture_data/demo-db python3 scripts/docs.py

Screenshots are saved to docs/images/.
The server is started automatically and stopped when the script exits.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from playwright.sync_api import Page

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_IMAGES = REPO_ROOT / "docs" / "images"
CVAI_DATA = os.environ.get("CVAI_DATA", str(REPO_ROOT / "tests" / "fixture_data" / "demo-db"))
PORT = 8765
BASE_URL = f"http://localhost:{PORT}"
DOCS_VENV = REPO_ROOT / ".venv-docs"

# Role slugs chosen from demo-db for their visual richness:
#   ledgerly — submitted, has requirement coverage + artifacts
#   northstar — interviewing, good event timeline
ROLE_SUBMITTED = "ledgerly_remote_staff_backend_engineer_payments"
ROLE_INTERVIEWING = "northstar_dublin_engineering_manager_identity"

WINDOW_WIDTH = 900
WINDOW_HEIGHT = 600


def ensure_playwright() -> None:
    """Install Playwright's Python package and Chromium on first use."""
    try:
        import playwright.sync_api  # noqa: F401
    except ModuleNotFoundError:
        if os.environ.get("CVAI_DOCS_VENV") != "1":
            venv_python = _ensure_docs_venv()
            env = {**os.environ, "CVAI_DOCS_VENV": "1", "PYTHONPATH": str(REPO_ROOT)}
            os.execve(str(venv_python), [str(venv_python), str(Path(__file__).resolve())], env)
        raise RuntimeError("Playwright is not installed in the docs virtual environment.")
    subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)


def _ensure_docs_venv() -> Path:
    venv_python = DOCS_VENV / "bin" / "python"
    if not venv_python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(DOCS_VENV)], check=True)
    subprocess.run(
        [
            str(venv_python),
            "-m",
            "pip",
            "install",
            "-r",
            str(REPO_ROOT / "requirements.txt"),
            "playwright",
        ],
        check=True,
    )
    return venv_python


def wait_for_server(timeout: int = 30) -> None:
    import urllib.error
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(f"{BASE_URL}/healthz", timeout=2)
            return
        except (urllib.error.URLError, OSError):
            time.sleep(0.5)
    raise RuntimeError(f"Server did not start within {timeout}s")


def screenshot(page: "Page", name: str, url: str, *, scroll_bottom: bool = False) -> None:
    page.goto(url)
    page.wait_for_load_state("networkidle")
    if scroll_bottom:
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(300)
    path = DOCS_IMAGES / f"{name}.png"
    page.screenshot(path=str(path))
    print(f"  saved {path.relative_to(REPO_ROOT)}")


def main() -> None:
    DOCS_IMAGES.mkdir(parents=True, exist_ok=True)
    ensure_playwright()
    from playwright.sync_api import sync_playwright

    env = {**os.environ, "CVAI_DATA": CVAI_DATA, "PORT": str(PORT), "PYTHONPATH": str(REPO_ROOT)}
    proc = subprocess.Popen(
        [sys.executable, "-m", "cvai_web", "serve"],
        env=env,
        cwd=str(REPO_ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        print("Waiting for server…")
        wait_for_server()
        print(f"Server ready at {BASE_URL}")

        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            page = browser.new_page(viewport={"width": WINDOW_WIDTH, "height": WINDOW_HEIGHT})

            try:
                print("Taking screenshots…")

                screenshot(page, "dashboard", f"{BASE_URL}/")
                screenshot(page, "intake", f"{BASE_URL}/intake")
                screenshot(page, "tasks", f"{BASE_URL}/tasks")
                screenshot(page, "operations", f"{BASE_URL}/actions")

                # CV editor: open the first experience entry modal to show the editing UI
                page.goto(f"{BASE_URL}/cv/")
                page.wait_for_load_state("networkidle")
                page.locator("[data-edit-button]").first.click()
                page.wait_for_selector("#cv-modal", state="visible")
                page.wait_for_load_state("networkidle")
                path = DOCS_IMAGES / "cv-editor.png"
                page.screenshot(path=str(path))
                print(f"  saved {path.relative_to(REPO_ROOT)}")

                screenshot(page, "role-submitted", f"{BASE_URL}/roles/{ROLE_SUBMITTED}")

                # Scroll to requirement coverage table on the submitted role page
                page.goto(f"{BASE_URL}/roles/{ROLE_SUBMITTED}")
                page.wait_for_load_state("networkidle")
                page.evaluate(
                    "document.querySelector('table.event-table')?.scrollIntoView({block:'center'});"
                )
                page.wait_for_timeout(300)
                path = DOCS_IMAGES / "role-requirements.png"
                page.screenshot(path=str(path))
                print(f"  saved {path.relative_to(REPO_ROOT)}")

                screenshot(page, "role-interviewing", f"{BASE_URL}/roles/{ROLE_INTERVIEWING}", scroll_bottom=True)

            finally:
                browser.close()

    finally:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=5)

    print("Done.")


if __name__ == "__main__":
    main()
