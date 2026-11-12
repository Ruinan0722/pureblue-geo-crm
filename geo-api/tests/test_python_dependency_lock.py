from pathlib import Path

from scripts.sync_python_dependencies import check, direct_dependency_items

ROOT = Path(__file__).resolve().parents[1]


def test_python_dependencies_are_exactly_pinned() -> None:
    assert all("==" in dependency for dependency in direct_dependency_items())


def test_generated_dependency_artifacts_are_aligned() -> None:
    assert check() == 0


def test_container_installs_the_hashed_lock_file() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "COPY requirements.lock" in dockerfile
    assert "pip install --require-hashes -r requirements.lock" in dockerfile
