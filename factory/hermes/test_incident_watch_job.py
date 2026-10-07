"""Runs factory-incident-watch with a stubbed hermes that logs each call."""

import os
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).parent / "factory-incident-watch"
LISTED = "  a1b2c3 [active]\n    Name:      factory-incidents\n    Monitor:   factory-incidents.sh (agent runs only on output change)\n"


def run(tmp_path: Path, listed: str, edit_exit: int = 0, list_exit: int = 0) -> tuple[subprocess.CompletedProcess, list[list[str]]]:
    calls = tmp_path / "calls"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (tmp_path / "listed").write_text(listed)
    # Each call is one line of NUL-free args joined by a tab.
    (bin_dir / "hermes").write_text(
        "#!/bin/bash\n"
        f"(IFS=$'\\t'; echo \"$*\") >> {calls}\n"
        f"if [ \"$2\" = list ]; then cat {tmp_path / 'listed'}; exit {list_exit}; fi\n"
        f"if [ \"$2\" = edit ]; then exit {edit_exit}; fi\n"
    )
    (bin_dir / "hermes").chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FACTORY_COMMITTEE_CHAT": "-10042"}
    out = subprocess.run(["sh", str(SCRIPT)], env=env, capture_output=True, text=True)
    lines = calls.read_text().splitlines() if calls.exists() else []
    return out, [line.split("\t") for line in lines]


def test_a_new_job_sends_failures_nowhere_and_incidents_to_the_committee(tmp_path):
    out, calls = run(tmp_path, "No scheduled jobs.\n")
    assert out.returncode == 0
    assert calls[0] == ["cron", "list", "--all"]
    create = calls[1]
    assert create[:3] == ["cron", "create", "every 1m"]
    prompt = create[3]
    assert "Fix each new incident yourself, then report what you did. Never ask for permission" in prompt
    assert create[create.index("--name") + 1] == "factory-incidents"
    assert create[create.index("--monitor-script") + 1] == "factory-incidents.sh"
    assert create[create.index("--deliver") + 1] == "telegram:-10042"
    assert create[create.index("--failure-deliver") + 1] == "local"
    assert len(calls) == 2


def test_an_existing_job_is_edited_in_place_and_never_recreated_or_paused(tmp_path):
    out, calls = run(tmp_path, LISTED)
    assert out.returncode == 0
    assert calls[0] == ["cron", "list", "--all"]
    edit = calls[1]
    assert edit[:3] == ["cron", "edit", "factory-incidents"]
    assert "Never ask for permission" in edit[edit.index("--prompt") + 1]
    assert edit[edit.index("--deliver") + 1] == "telegram:-10042"
    assert edit[edit.index("--failure-deliver") + 1] == "local"
    assert len(calls) == 2


def test_a_failed_edit_is_logged_and_lets_hermes_start(tmp_path):
    out, calls = run(tmp_path, LISTED, edit_exit=1)
    assert out.returncode == 0
    assert "factory-incidents" in out.stderr
    assert [c[1] for c in calls] == ["list", "edit"]


def test_a_failed_list_creates_no_second_job_and_lets_hermes_start(tmp_path):
    out, calls = run(tmp_path, "", list_exit=1)
    assert out.returncode == 0
    assert "factory-incidents" in out.stderr
    assert calls == [["cron", "list", "--all"]]
