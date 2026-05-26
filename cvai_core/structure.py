from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Iterable

import yaml

from .yaml_format import CVAIYamlDumper, dump_yaml


# This module contains one-way projection helpers for human-authored notes. The web
# app reads YAML projections, while these utilities can rebuild projections from
# Markdown notes when maintainers intentionally refresh the source material.
NoAliasDumper = CVAIYamlDumper

# Story IDs combine situation and evidence reference. Limiting the source string
# keeps generated slugs readable while preserving enough text to avoid collisions.
STORY_ID_SOURCE_CHARS = 80


def slugify(value: str) -> str:
    """Create stable IDs for rows extracted from human-readable tables."""
    value = value.strip().lower().replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "_", value)
    return re.sub(r"_+", "_", value).strip("_") or "item"


def load_yaml(path: Path, default: dict | None = None) -> dict:
    """Read a YAML mapping, returning a caller-provided default for missing files."""
    if not path.exists():
        return default or {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or default or {}


def write_yaml(path: Path, payload: dict) -> None:
    """Write YAML in the same stable style used by the rest of CVAI data."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_yaml(payload), encoding="utf-8")


def build_job_data(*, role: dict, job_text: str, analysis: dict) -> dict:
    """Build job.yaml from role metadata, captured posting text, and analysis rows."""
    llm_context = analysis.get("llm_context") or {}
    return {
        "version": 1,
        "role_id": role.get("id", ""),
        "company": role.get("company", ""),
        "title": role.get("title", ""),
        "location": role.get("location", ""),
        "source_url": role.get("source_url", ""),
        "captured_on": role.get("captured_on", ""),
        "priority_rank": role.get("priority_rank"),
        "active": role.get("active", True),
        "posting": {
            "raw_text": job_text.strip(),
        },
        "extracted": {
            "responsibilities": list(llm_context.get("responsibilities") or []),
            "hard_requirements": list(llm_context.get("must_haves") or []),
            "soft_requirements": list(llm_context.get("nice_to_haves") or []),
            "inferred_requirements": list(llm_context.get("inferred_requirements") or []),
            "skills": list(llm_context.get("skills") or []),
            "interview_focus": list(llm_context.get("interview_focus") or []),
        },
        "requirements": [
            {
                "id": requirement.get("id", ""),
                "text": requirement.get("text", ""),
                "category": requirement.get("category", "inferred_requirement"),
                "fulfillment": requirement.get("fulfillment", "unknown"),
                "evidence": list(requirement.get("evidence") or []),
                "gap": requirement.get("gap", ""),
                "task_refs": list(requirement.get("task_refs") or []),
            }
            for requirement in analysis.get("requirements", [])
        ],
    }


def write_role_job_yaml(role_dir: Path) -> bool:
    role = load_yaml(role_dir / "role.yaml")
    analysis = load_yaml(role_dir / "analysis.yaml")
    job_path = role_dir / "job.md"
    if not role or not job_path.exists():
        return False
    payload = build_job_data(role=role, job_text=job_path.read_text(encoding="utf-8"), analysis=analysis)
    write_yaml(role_dir / "job.yaml", payload)
    return True


def write_all_role_job_yaml(root: Path) -> int:
    count = 0
    roles_root = root / "roles"
    if not roles_root.exists():
        return 0
    for role_dir in sorted(roles_root.iterdir()):
        if role_dir.is_dir() and write_role_job_yaml(role_dir):
            count += 1
    return count


def build_context_data(root: Path) -> dict:
    # Candidate context includes constraints and portfolio facts that matching
    # workflows may use. It is kept separate from role-specific role process state.
    context_root = root / "context"
    constraints = _key_value_bullets(context_root / "constraints.md")
    preferences = _key_value_bullets(context_root / "preferences.md")
    metrics = [
        {
            "id": slugify(row.get("Metric", "")),
            "metric": row.get("Metric", ""),
            "value": row.get("Value", ""),
            "context": row.get("Context", ""),
            "source": _normalize_source(row.get("Source", "")),
            "status": row.get("Status", ""),
        }
        for row in _markdown_table(context_root / "metrics.md")
    ]
    portfolio_rows = _markdown_table(context_root / "portfolio_inventory.md")
    portfolio = {
        "public_surfaces": _list_items_after_heading(context_root / "portfolio_inventory.md", "Canonical public surfaces"),
        "projects": [
            {
                "id": slugify(row.get("Project", "").strip("`")),
                "name": row.get("Project", "").strip("`"),
                "public_link": row.get("Public Link", ""),
                "proves": row.get("What It Proves", ""),
                "relevance": row.get("Relevance", ""),
                "notes": row.get("Notes", ""),
            }
            for row in portfolio_rows
        ],
    }
    return {
        "version": 1,
        "constraints": constraints,
        "preferences": preferences,
        "metrics": metrics,
        "portfolio": portfolio,
    }


def build_library_data(root: Path) -> dict:
    # The evidence library stores reusable proof points and writing blocks. LLM
    # prompts can cite this structured data without re-reading Markdown tables.
    library_root = root / "library"
    skills = [
        {
            "id": slugify(row.get("Skill Keyword", "")),
            "keyword": row.get("Skill Keyword", ""),
            "evidence_pointer": row.get("Evidence Pointer", ""),
            "proof_strength": row.get("Proof Strength", ""),
            "notes": row.get("Notes", ""),
        }
        for row in _markdown_table(library_root / "skills_map.md")
    ]
    stories = [
        {
            "id": slugify(" ".join([row.get("Situation", ""), row.get("Evidence Ref", "")])[:STORY_ID_SOURCE_CHARS]),
            "situation": row.get("Situation", ""),
            "task": row.get("Task", ""),
            "action": row.get("Action", ""),
            "result": row.get("Result", ""),
            "evidence_ref": _normalize_source(row.get("Evidence Ref", "")),
        }
        for row in _markdown_table(library_root / "story_snippets.md")
    ]
    return {
        "version": 1,
        "skills": skills,
        "story_snippets": stories,
        "cover_letter_blocks": _heading_blocks(library_root / "cover_letter_blocks.md"),
    }


def write_structured_context_and_library(root: Path) -> None:
    write_yaml(root / "context" / "context.yaml", build_context_data(root))
    write_yaml(root / "library" / "evidence.yaml", build_library_data(root))


def _key_value_bullets(path: Path) -> dict:
    result: dict[str, str] = {}
    if not path.exists():
        return result
    for item in _list_items(path.read_text(encoding="utf-8")):
        if ":" in item:
            key, value = item.split(":", 1)
            result[slugify(key)] = value.strip()
    return result


def _list_items(text: str) -> list[str]:
    items = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("- "):
            items.append(stripped[2:].strip())
    return items


def _list_items_after_heading(path: Path, heading: str) -> list[str]:
    if not path.exists():
        return []
    text = path.read_text(encoding="utf-8")
    start = text.find(f"{heading}:")
    if start == -1:
        return []
    tail = text[start + len(heading) + 1 :]
    before_table = tail.split("|", 1)[0]
    return _list_items(before_table)


def _markdown_table(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    rows = []
    headers: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line.startswith("|"):
            continue
        cells = [_clean_cell(cell) for cell in line.strip("|").split("|")]
        if not headers:
            headers = cells
            continue
        if all(set(cell) <= {"-", ":"} for cell in cells):
            continue
        if len(cells) == len(headers):
            rows.append(dict(zip(headers, cells, strict=True)))
    return rows


def _heading_blocks(path: Path) -> dict[str, list[str]]:
    if not path.exists():
        return {}
    blocks: dict[str, list[str]] = {}
    current = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("## "):
            current = slugify(line[3:])
            blocks[current] = []
        elif current and line.startswith("- "):
            blocks[current].append(line[2:].strip())
    return blocks


def _clean_cell(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _normalize_source(value: str) -> str:
    return value.replace("`", "").strip()


def main(argv: list[str]) -> int:
    root = Path(argv[1] if len(argv) > 1 else "tests/fixture_data/demo-db")
    role_count = write_all_role_job_yaml(root)
    write_structured_context_and_library(root)
    print(f"Wrote {role_count} role job.yaml files")
    print("Wrote context/context.yaml and library/evidence.yaml")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
