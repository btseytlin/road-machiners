"""Runs factory-incidents.sh on a temp factory home, with gh stubbed to list no stuck issue."""

import json
import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT = Path(__file__).parent / "factory-incidents.sh"


def run(tmp_path: Path, health: dict | None, pause_age_minutes: int | None = None, audit: str = "exit 0") -> list[str]:
    home = tmp_path / "home"
    (home / "state").mkdir(parents=True)
    (home / "state" / "state.json").write_text(json.dumps({"failures": [], "lastTickError": None, "devFailed": None}))
    if health is not None:
        (home / "health").write_text(json.dumps(health))
    if pause_age_minutes is not None:
        paused = home / "paused"
        paused.write_text("Hermes fixing #5")
        old = time.time() - pause_age_minutes * 60
        os.utime(paused, (old, old))
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "gh").write_text("#!/bin/sh\n")
    (bin_dir / "gh").chmod(0o755)
    # The factory wrapper runs `factory audit`. The stub prints what the test gives.
    (bin_dir / "factory").write_text(f"#!/bin/sh\n{audit}\n")
    (bin_dir / "factory").chmod(0o755)
    script = tmp_path / "factory-incidents.sh"
    script.write_text(SCRIPT.read_text().replace("/factory/home", str(home)))
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FACTORY_REPO": "o/r"}
    out = subprocess.run(["bash", str(script)], env=env, capture_output=True, text=True, check=True)
    return out.stdout.splitlines()


def at(minutes_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%S.123Z")


def health(minutes_ago: int = 1, free_gb: float = 20.5, available_gb: float | None = 6.0) -> dict:
    return {"at": at(minutes_ago), "freeGb": free_gb, "minFreeGb": 5, "availableGb": available_gb, "minAvailableGb": 1}


def test_fresh_health_with_room_prints_nothing(tmp_path):
    assert run(tmp_path, health()) == []


def test_low_disk_prints_a_stable_line(tmp_path):
    assert run(tmp_path, health(free_gb=3.2)) == ["disk low: under 5 GB free"]


def test_low_memory_prints_a_stable_line(tmp_path):
    assert run(tmp_path, health(available_gb=0.4)) == ["memory low: under 1 GB available"]


def test_a_host_without_a_memory_reading_opens_no_memory_incident(tmp_path):
    assert run(tmp_path, health(available_gb=None)) == []


def test_old_health_means_ticks_stopped(tmp_path):
    stale = health(minutes_ago=30)
    assert run(tmp_path, stale) == [f"tick stalled: no tick since {stale['at']}"]


def test_missing_health_is_a_stall(tmp_path):
    assert run(tmp_path, None) == ["tick stalled: no health file, so no tick ran on this code"]


def test_only_a_pause_over_an_hour_is_reported(tmp_path):
    fresh = health()
    assert run(tmp_path / "new", fresh, pause_age_minutes=10) == []
    assert run(tmp_path / "old", fresh, pause_age_minutes=90) == ["paused over an hour: Hermes fixing #5"]


def test_each_audit_line_is_a_drift_line(tmp_path):
    lines = run(tmp_path, health(), audit="echo '#5 testPhase checks but column Design'; echo 'pending ship but no current candidate post'")
    assert lines == ["drift: #5 testPhase checks but column Design", "drift: pending ship but no current candidate post"]


def test_a_failed_audit_prints_one_stable_line(tmp_path):
    assert run(tmp_path, health(), audit="echo boom >&2; exit 1") == ["audit failed"]


def test_one_failed_audit_is_retried_and_opens_no_incident(tmp_path):
    flag = tmp_path / "first-run-done"
    audit = f"if [ -f {flag} ]; then echo '#5 testPhase checks but column Design'; else touch {flag}; exit 1; fi"
    assert run(tmp_path, health(), audit=audit) == ["drift: #5 testPhase checks but column Design"]
