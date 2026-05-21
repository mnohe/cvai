from __future__ import annotations

import shutil
from pathlib import Path

from cvai_core.schema import initialize_data_root


FIXTURE_ROOT = Path(__file__).resolve().parent / "fixture_data"


def create_sample_data_root(root: Path) -> Path:
    """Create a sample CVAI data directory for tests.

    The public `cvai` repository must not depend on a private sibling
    `cvai-data` checkout. Tests therefore copy a small file-based data fixture
    into a temporary directory that looks like a real `CVAI_DATA` root.
    """
    initialize_data_root(root)
    copy_fixture_tree("sample-data", root)
    return root


def copy_fixture_tree(name: str, destination: Path) -> None:
    """Copy one fixture directory over an initialized data root."""
    source = FIXTURE_ROOT / name
    if not source.is_dir():
        raise FileNotFoundError(f"Unknown fixture tree: {name}")
    shutil.copytree(source, destination, dirs_exist_ok=True)
