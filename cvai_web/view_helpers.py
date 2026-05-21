from __future__ import annotations

from cvai_core.repo import RoleRecord, TaskRecord


def dashboard_status_badge(role: RoleRecord) -> tuple[str, str]:
    """Return the dashboard badge label and CSS class for a role."""
    status = role.role_status.lower()
    if "hold" in status or "pause" in status:
        return ("On hold", "draft")
    if role.status_key == "submitted":
        return ("Submitted", "submitted")
    if role.status_key == "interviewing":
        return ("Interviewing", "interviewing")
    if role.status_key == "draft":
        return ("Not submitted", "draft")
    if role.status_key == "accepted":
        return ("Accepted", "accepted")
    if role.status_key == "rejected":
        return ("Rejected", "rejected")
    if role.status_key in {"closed", "inactive"}:
        return ("Closed", "closed")
    return ("Needs review", "draft")


def status_sentence(status: str) -> str:
    """Normalize a status detail into a display sentence."""
    status = status.strip()
    if not status:
        return "Needs review."
    if status.endswith((".", "!", "?")):
        return status
    return f"{status}."


def verdict_class(verdict: str) -> str:
    """Return the CSS tone for a suitability verdict badge."""
    normalized = verdict.strip().upper()
    if normalized == "UNFIT":
        return "bad"
    if normalized in {"OVERQUALIFIED", "STRETCH", "WEAK_FIT"}:
        return "warn"
    return ""


def category_label(value: str) -> str:
    """Return a human label for a requirement category."""
    labels = {
        "hard_requirement": "Must-have",
        "soft_requirement": "Nice-to-have",
        "inferred_requirement": "Inferred",
    }
    return labels.get(str(value), str(value).replace("_", " ").title())


def fulfillment_label(value: str) -> str:
    """Return a human label for requirement coverage."""
    labels = {
        "met": "Met",
        "partial": "Partially met",
        "unmet": "Unmet",
        "unknown": "Unknown",
    }
    return labels.get(str(value), str(value).replace("_", " ").title())


def fulfillment_class(value: str) -> str:
    """Return the CSS tone for requirement coverage."""
    value = str(value)
    if value == "met":
        return "submitted"
    if value == "unmet":
        return "rejected"
    if value == "partial":
        return "draft"
    return ""


def task_status_label(status: str) -> str:
    """Return a human label for a task status value."""
    return {"open": "Open", "completed": "Completed", "wont_do": "Won't do"}.get(status, status.replace("_", " ").title())


def task_status_class(status: str) -> str:
    """Return the CSS tone for a task status badge."""
    if status == "completed":
        return "submitted"
    if status == "wont_do":
        return "closed"
    return "draft"


def task_eta_label(task: TaskRecord) -> str:
    """Return a compact ETA label for a task."""
    if task.estimated_days is None:
        return "No ETA"
    if task.estimated_days == 1:
        return "1 day"
    return f"{task.estimated_days} days"


def task_eta_class(task: TaskRecord) -> str:
    """Return the CSS tone for a task ETA badge."""
    if task.estimated_days is None:
        return ""
    return "submitted" if task.feasible_within_one_week else "rejected"


def job_summary(job: dict) -> dict:
    """Keep only fields needed by the dashboard's recent-job list."""
    return {key: value for key, value in job.items() if key in {"id", "kind", "status"}}
