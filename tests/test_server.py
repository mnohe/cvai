import unittest
from pathlib import Path
import socket
import sys
from types import SimpleNamespace
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cvai_core.llm import OpenAIAPIError
from cvai_web.server import (
    IntakeJob,
    JobManager,
    JobPostingExtractor,
    TextExtractor,
    WebApp,
    validate_public_https_url,
)


class ServerUtilityTests(unittest.TestCase):
    def test_text_extractor_ignores_invisible_page_content(self) -> None:
        parser = TextExtractor()
        parser.feed(
            """
            <html><body>
              <style>.hidden { display: none; }</style>
              <script>window.secret = "ignore";</script>
              <h1>Visible role</h1>
              <p>Build services.</p>
              <noscript>Also ignored.</noscript>
            </body></html>
            """
        )

        text = parser.get_text()
        self.assertIn("Visible role", text)
        self.assertIn("Build services.", text)
        self.assertNotIn("window.secret", text)
        self.assertNotIn("Also ignored", text)

    def test_job_posting_extractor_reads_json_ld(self) -> None:
        parser = JobPostingExtractor()
        parser.feed(
            """
            <html><head>
            <script type="application/ld+json">
            {
              "@context": "http://schema.org",
              "@type": "JobPosting",
              "title": "Backend Software Engineer III",
              "datePosted": "2026-05-13",
              "hiringOrganization": {"name": "CrowdStrike Ireland Limited"},
              "jobLocation": {"address": {"addressLocality": "Dublin", "addressCountry": "Ireland"}},
              "description": "Build &amp; maintain backend services."
            }
            </script>
            </head></html>
            """
        )

        text = parser.get_text()
        self.assertIn("Title: Backend Software Engineer III", text)
        self.assertIn("Company: CrowdStrike Ireland Limited", text)
        self.assertIn("Location: Dublin, Ireland", text)
        self.assertIn("Build & maintain backend services.", text)

    def test_job_posting_extractor_reads_graph_and_meta_fallbacks(self) -> None:
        # Some job boards nest JobPosting objects inside @graph, while others
        # only expose OpenGraph metadata. Both forms should yield useful text.
        graph_parser = JobPostingExtractor()
        graph_parser.feed(
            """
            <script type="application/ld+json">{"@graph": [{"@type": "Thing"}, {"@type": "JobPosting", "title": "Graph Role"}]}</script>
            """
        )
        self.assertIn("Graph Role", graph_parser.get_text())

        meta_parser = JobPostingExtractor()
        meta_parser.feed(
            """
            <meta property="og:title" content="Meta Role">
            <meta property="og:description" content="Work on APIs &amp; integrations.">
            <script type="application/ld+json">{not json}</script>
            """
        )
        text = meta_parser.get_text()
        self.assertIn("Meta Role", text)
        self.assertIn("Work on APIs & integrations.", text)

    def test_url_intake_rejects_non_https_urls(self) -> None:
        with self.assertRaisesRegex(ValueError, "https://"):
            validate_public_https_url("http://example.test/job")

    def test_url_intake_rejects_localhost_targets(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-public"):
            validate_public_https_url("https://127.0.0.1/job")

    def test_url_intake_rejects_missing_and_unresolved_hosts(self) -> None:
        with self.assertRaisesRegex(ValueError, "hostname"):
            validate_public_https_url("https:///missing")

        with mock.patch("cvai_web.server.socket.getaddrinfo", side_effect=socket.gaierror("no dns")):
            with self.assertRaisesRegex(ValueError, "Could not resolve"):
                validate_public_https_url("https://example.invalid/job")

    def test_job_manager_records_success_and_failure_states(self) -> None:
        manager = JobManager()
        success = IntakeJob(id="job-success", kind="unit")
        failure = IntakeJob(id="job-failure", kind="unit")
        api_failure = IntakeJob(id="job-api", kind="unit")

        manager._run(success, lambda job: setattr(job, "result", {"ok": True}))
        manager._run(failure, lambda job: (_ for _ in ()).throw(RuntimeError("boom")))
        manager._run(
            api_failure,
            lambda job: (_ for _ in ()).throw(OpenAIAPIError(429, "rate_limit", "Slow down", "Rate limit detail")),
        )

        self.assertEqual(success.status, "completed")
        self.assertEqual(success.result, {"ok": True})
        self.assertEqual(failure.status, "failed")
        self.assertIn("boom", failure.error)
        self.assertIn("Traceback", failure.as_dict()["log"])
        self.assertEqual(api_failure.status, "failed")
        self.assertEqual(api_failure.error, "Slow down")
        self.assertIn("Rate limit detail", api_failure.as_dict()["log"])

    def test_complete_ingestion_writes_structured_bundle(self) -> None:
        repo = mock.Mock()
        repo.create_job_markdown.return_value = "# Job\n"
        repo.read_text.side_effect = lambda path: f"content for {path}"
        repo.exists.return_value = True
        repo.write_bundle.return_value = {"application": "roles/example/state.yaml"}
        llm = mock.Mock()
        llm.generate_bundle.return_value = {
            "job": {"company": "Example"},
            "analysis": {"requirements": []},
            "application": {"status": "draft"},
        }
        app = WebApp(repo, llm)
        job = IntakeJob(id="job-1", kind="text")

        app._complete_ingestion(
            job,
            "Visible job text",
            "https://example.com/job",
            {"company": "Example Co", "location": "Remote", "role": "Senior Engineer"},
        )

        self.assertEqual(job.status, "queued")
        self.assertEqual(job.result["canonical_slug"], "example_co_remote_senior_engineer")
        repo.create_job_markdown.assert_called_once()
        llm.generate_bundle.assert_called_once()
        repo.write_bundle.assert_called_once()

    def test_quick_analysis_uses_structured_candidate_context_without_writing_bundle(self) -> None:
        repo = mock.Mock()
        repo.exists.side_effect = lambda path: path == "cv/cv.yaml"
        repo.read_text.return_value = "summary: Platform engineer"
        repo.load_data.side_effect = lambda path, default=None: {
            "context/context.yaml": {"preferences": {"locations": ["Remote"]}},
            "library/evidence.yaml": {"evidence": [{"id": "je-platform"}]},
        }.get(path, default or {})
        repo.list_tasks.return_value = [
            SimpleNamespace(
                id="task-go",
                title="Go services",
                description="Close Go gap",
                status="open",
                estimated_days=3,
                acceptance_criteria=["Build a small service"],
                evidence_refs=[],
            )
        ]
        llm = mock.Mock()
        llm.is_configured.return_value = True
        llm.quick_analyze_role.return_value = {
            "clear": True,
            "summary": "Promising platform fit.",
            "fit_level": "good",
            "key_matching_abilities": ["Python platform ownership"],
            "important_gaps": [
                {
                    "requirement": "Go services",
                    "category": "hard_requirement",
                    "fulfillment": "partial",
                    "estimated_effort": "3 days",
                }
            ],
            "recommendation": "continue",
            "rationale": "Most gaps are closeable.",
        }
        app = WebApp(repo, llm)

        job = IntakeJob(id="job-quick", kind="quick analysis")
        app._run_text_quick_analysis(job, "Build distributed systems in Go.", "https://example.test/job", {"company": "Example"})

        self.assertEqual(job.result["quick_analysis"]["recommendation"], "continue")
        self.assertEqual(job.result["intake"]["kind"], "text")
        self.assertEqual(job.result["intake"]["overrides"], {"company": "Example"})
        llm.quick_analyze_role.assert_called_once()
        self.assertEqual(llm.quick_analyze_role.call_args.kwargs["cv_yaml"], "summary: Platform engineer")
        self.assertEqual(llm.quick_analyze_role.call_args.kwargs["tasks"][0]["id"], "task-go")
        repo.write_bundle.assert_not_called()

    def test_continue_from_quick_analysis_runs_full_ingestion(self) -> None:
        repo = mock.Mock()
        repo.create_job_markdown.return_value = "# Job\n"
        repo.read_text.side_effect = lambda path: f"content for {path}"
        repo.exists.return_value = False
        repo.write_bundle.return_value = {"analysis": "roles/example/analysis.yaml"}
        llm = mock.Mock()
        llm.is_configured.return_value = True
        llm.extract_role.return_value = {
            "clear": True,
            "company": "Example",
            "location": "Remote",
            "role": "Staff Engineer",
        }
        llm.generate_bundle.return_value = {
            "metadata": {
                "company": "Example",
                "location": "Remote",
                "role": "Staff Engineer",
                "source_url": "https://example.test/job",
                "captured_on": "2026-05-22",
                "company_slug": "example",
                "location_slug": "remote",
                "role_slug": "staff_engineer",
                "canonical_slug": "example_remote_staff_engineer",
            },
            "mirror_summary": {"verdict": "FIT", "bullets": ["Good fit."]},
            "job": {"requirements": [{"text": "Python", "category": "hard_requirement", "fulfillment": "met"}]},
            "analysis": {"requirements": [{"text": "Python", "category": "hard_requirement", "fulfillment": "met"}]},
            "suitability_report": "# Report",
            "role_matrix": "# Matrix",
            "interview_prep": {
                "story_bank_md": "# Stories",
                "system_design_bank_md": "# Systems",
                "security_bank_md": "# Security",
                "coding_plan_md": "# Coding",
            },
        }
        app = WebApp(repo, llm)
        job = IntakeJob(id="job-full", kind="full ingestion")

        app._run_full_ingestion_from_preview(
            job,
            {
                "kind": "url",
                "source_url": "https://example.test/job",
                "source_text": "Example needs Python.",
                "overrides": {},
            },
        )

        llm.extract_role.assert_called_once()
        llm.generate_bundle.assert_called_once()
        repo.write_bundle.assert_called_once()
        self.assertEqual(job.result["canonical_slug"], "example_remote_staff_engineer")

    def test_prompt_and_task_reassessment_use_llm_when_needed(self) -> None:
        # Ambiguous status updates and task reassessment still use the LLM, but
        # the durable writes remain structured repository operations.
        role = SimpleNamespace(
            company="Example",
            role="Engineer",
            location="Remote",
            role_status="Submitted.",
            artifacts=["resume.md", "notes.txt"],
        )
        task = SimpleNamespace(
            id="task-python",
            title="Python APIs",
            description="Prove API experience",
            status="open",
            acceptance_criteria=["Build a service"],
            evidence_refs=[],
        )
        related_app = SimpleNamespace(
            canonical_slug="example_remote_engineer",
            company="Example",
            role="Engineer",
            location="Remote",
            analysis={"requirements": [{"id": "req-1", "task_refs": ["task-python"]}]},
        )
        repo = mock.Mock()
        repo.get_role.return_value = role
        repo.get_task.return_value = task
        repo.task_usage.return_value = [related_app]
        repo.exists.return_value = True
        repo.read_text.return_value = "name: Example"
        llm = mock.Mock()
        llm.is_configured.return_value = True
        llm.interpret_status_update.return_value = {
            "clear": True,
            "event_type": "interviewing",
            "exact_date": "2026-05-20",
            "note": "Recruiter screen booked.",
            "internal_notes": ["Prepare a recent technical project story."],
        }
        llm.assess_gap_task.return_value = {
            "clear": True,
            "status": "completed",
            "detail": "Evidence now exists.",
            "evidence_refs": ["pp-api"],
        }
        app = WebApp(repo, llm)

        update_job = IntakeJob(id="job-update", kind="update")
        app._run_prompt_update(update_job, "example_remote_engineer", "They wrote back")
        task_job = IntakeJob(id="job-task", kind="task")
        app._run_task_reassessment(task_job, "task-python")

        repo.record_status.assert_called_once_with(
            "example_remote_engineer",
            "interviewing",
            "2026-05-20",
            "Recruiter screen booked.",
            artifacts=[],
        )
        repo.append_analysis_notes.assert_called_once_with(
            "example_remote_engineer",
            ["Prepare a recent technical project story."],
        )
        repo.update_task_status.assert_called_once_with("task-python", "completed", "Evidence now exists. Evidence: pp-api")
        self.assertEqual(update_job.result["canonical_slug"], "example_remote_engineer")
        self.assertEqual(task_job.result["paths"], {"task": "tasks.yaml"})

    def test_prompt_update_can_apply_llm_returned_operations(self) -> None:
        role = SimpleNamespace(
            company="Example",
            role="Engineer",
            location="Remote",
            role_status="Submitted.",
            artifacts=[],
        )
        repo = mock.Mock()
        repo.get_role.return_value = role
        repo.exists.return_value = True
        repo.read_text.return_value = "old: content\n"
        llm = mock.Mock()
        llm.is_configured.return_value = True
        llm.interpret_status_update.return_value = {
            "clear": True,
            "event_type": "interviewing",
            "exact_date": "2026-05-20",
            "note": "Ignored because operations are authoritative.",
            "operations": [
                {
                    "op": "record_status",
                    "role_id": "example_remote_engineer",
                    "event_type": "interviewing",
                    "exact_date": "2026-05-20",
                    "note": "Recruiter screen booked.",
                },
                {
                    "op": "append_analysis_notes",
                    "role_id": "example_remote_engineer",
                    "notes": ["Prepare a recent project story."],
                }
            ],
        }
        app = WebApp(repo, llm)
        job = IntakeJob(id="job-update", kind="update")

        app._run_prompt_update(job, "example_remote_engineer", "Update the role and notes.")

        repo.record_status.assert_called_once_with(
            "example_remote_engineer",
            "interviewing",
            "2026-05-20",
            "Recruiter screen booked.",
            artifacts=[],
        )
        repo.append_analysis_notes.assert_called_once_with(
            "example_remote_engineer",
            ["Prepare a recent project story."],
        )
        repo.write_text.assert_not_called()
        self.assertEqual(job.result["paths"], {"operations": ["record_status", "append_analysis_notes"]})

    def test_prompt_update_treats_current_operation_role_id_as_route_role(self) -> None:
        role = SimpleNamespace(
            company="Example",
            role="Engineer",
            location="Remote",
            role_status="Submitted.",
            artifacts=[],
        )
        repo = mock.Mock()
        repo.get_role.return_value = role
        llm = mock.Mock()
        llm.is_configured.return_value = True
        llm.interpret_status_update.return_value = {
            "clear": True,
            "event_type": "interviewing",
            "exact_date": "2026-05-22",
            "note": "Ignored because operations are authoritative.",
            "operations": [
                {
                    "op": "record_status",
                    "role_id": "current",
                    "event_type": "interviewing",
                    "exact_date": "2026-05-22",
                    "note": "Hiring manager screen booked.",
                }
            ],
        }
        app = WebApp(repo, llm)
        job = IntakeJob(id="job-update", kind="update")

        app._run_prompt_update(job, "example_remote_engineer", "Hiring manager screen booked.")

        repo.record_status.assert_called_once_with(
            "example_remote_engineer",
            "interviewing",
            "2026-05-22",
            "Hiring manager screen booked.",
            artifacts=[],
        )
        self.assertEqual(job.result["paths"], {"operations": ["record_status"]})


if __name__ == "__main__":
    unittest.main()
