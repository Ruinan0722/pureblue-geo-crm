"""Generate and verify Python dependency artifacts from pyproject.toml."""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "pyproject.toml"
REQUIREMENTS = ROOT / "requirements.txt"
LOCK = ROOT / "requirements.lock"
HEADER = (
    "# AUTO-GENERATED from pyproject.toml [project.dependencies].\n"
    "# Do not edit by hand; run: .venv/bin/python scripts/sync_python_dependencies.py\n"
)


def dependency_fingerprint() -> str:
    payload = "\n".join(direct_dependency_items()).encode()
    return hashlib.sha256(payload).hexdigest()


def direct_dependency_items() -> list[str]:
    data = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))
    return data["project"]["dependencies"]


def direct_requirements() -> str:
    return HEADER + "".join(f"{item}\n" for item in direct_dependency_items())


def generate() -> None:
    REQUIREMENTS.write_text(direct_requirements(), encoding="utf-8")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "piptools",
            "compile",
            "--generate-hashes",
            "--no-emit-index-url",
            "--strip-extras",
            "--output-file",
            "requirements.lock",
            "pyproject.toml",
        ],
        cwd=ROOT,
        check=True,
    )
    lock_text = LOCK.read_text(encoding="utf-8")
    LOCK.write_text(
        f"# project-dependencies-sha256: {dependency_fingerprint()}\n{lock_text}",
        encoding="utf-8",
    )


def check() -> int:
    errors: list[str] = []
    if REQUIREMENTS.read_text(encoding="utf-8") != direct_requirements():
        errors.append("requirements.txt 与 pyproject.toml 不一致")
    lock_text = LOCK.read_text(encoding="utf-8") if LOCK.exists() else ""
    if "--hash=sha256:" not in lock_text:
        errors.append("requirements.lock 缺失或未包含哈希")
    fingerprint = f"# project-dependencies-sha256: {dependency_fingerprint()}"
    if fingerprint not in lock_text:
        errors.append("requirements.lock 与 pyproject.toml 直接依赖已漂移")
    if errors:
        print("\n".join(f"ERROR: {message}" for message in errors))
        return 1
    print("Python dependency artifacts are aligned")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        return check()
    generate()
    return check()


if __name__ == "__main__":
    raise SystemExit(main())
