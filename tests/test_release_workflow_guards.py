"""Contract tests for release-tag gating in publish workflows."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

import pytest
import yaml

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
RELEASE_WORKFLOWS = {
    "docker": (
        REPOSITORY_ROOT / ".github" / "workflows" / "docker-release.yml",
        "build-and-push",
    ),
    "pypi": (
        REPOSITORY_ROOT / ".github" / "workflows" / "pypi-release.yml",
        "build-and-publish",
    ),
}


def _workflow(publication: str) -> tuple[dict, str]:
    workflow_path, publish_job_name = RELEASE_WORKFLOWS[publication]
    with workflow_path.open(encoding="utf-8") as file:
        return yaml.safe_load(file), publish_job_name


def _validator_script(publication: str) -> str:
    document, _ = _workflow(publication)
    validator = document["jobs"]["validate-release-tag"]
    return validator["steps"][0]["run"]


@pytest.mark.parametrize("publication", RELEASE_WORKFLOWS)
def test_non_version_release_tags_skip_publication(publication: str) -> None:
    document, publish_job_name = _workflow(publication)
    validator = document["jobs"]["validate-release-tag"]

    assert validator["if"] == "startsWith(github.event.release.tag_name, 'v')"
    assert document["jobs"][publish_job_name]["needs"] == "validate-release-tag"


@pytest.mark.parametrize(
    ("publication", "tag"),
    [
        ("docker", "v1.2.3"),
        ("docker", "v1.2.3rc1"),
        ("docker", "v1.2.3+build.1"),
        ("pypi", "v1.2.3"),
        ("pypi", "v1.2.3rc1"),
        ("pypi", "v1.2.3+build.1"),
    ],
)
def test_version_release_tags_pass_the_guard(publication: str, tag: str) -> None:
    result = subprocess.run(
        [sys.executable, "-c", _validator_script(publication)],
        env={"RELEASE_TAG": tag, "PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("publication", "tag"),
    [
        ("docker", "vmain"),
        ("docker", "v1.2"),
        ("docker", "v1.2.x"),
        ("pypi", "vmain"),
        ("pypi", "v1.2"),
        ("pypi", "v1.2.x"),
    ],
)
def test_malformed_version_tags_fail_the_guard(publication: str, tag: str) -> None:
    result = subprocess.run(
        [sys.executable, "-c", _validator_script(publication)],
        env={"RELEASE_TAG": tag, "PATH": os.environ["PATH"]},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert repr(tag) in result.stderr
