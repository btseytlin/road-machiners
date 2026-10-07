"""Runs factory-incidents.sh on a temp factory home, with gh and factory stubbed."""

import json
import os
import re
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

SCRIPT = Path(__file__).parent / "factory-incidents.sh"


def run(tmp_path: Path, health: dict | None, pause_age_minutes: int | None = None, audit: str = "exit 0", review: str | None = None, gh: str = "exit 0") -> list[str]:
    home = tmp_path / "home"
    (home / "state").mkdir(parents=True)
    (home / "state" / "state.json").write_text(json.dumps({"failures": [], "lastTickError": None, "devFailed": None}))
    if review is not None:
        (home / "review-pending").write_text(review)
    if health is not None:
        (home / "health").write_text(json.dumps(health))
    if pause_age_minutes is not None:
        paused = home / "paused"
        paused.write_text("Hermes fixing #5")
        old = time.time() - pause_age_minutes * 60
        os.utime(paused, (old, old))
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    # gh runs its own --jq, so the stub prints finished lines. The factory wrapper runs `factory audit`. Each stub runs what the test gives.
    stub(bin_dir, "gh", gh)
    stub(bin_dir, "factory", audit)
    script = tmp_path / "factory-incidents.sh"
    script.write_text(SCRIPT.read_text().replace("/factory/home", str(home)))
    return watch(tmp_path)


def stub(bin_dir: Path, name: str, body: str) -> None:
    (bin_dir / name).write_text(f"#!/bin/sh\n{body}\n")
    (bin_dir / name).chmod(0o755)


def watch(tmp_path: Path) -> list[str]:
    """Runs the script that run() set up once more, with short time limits so a slow stub times out fast."""
    env = {**os.environ, "PATH": f"{tmp_path / 'bin'}:{os.environ['PATH']}", "FACTORY_REPO": "o/r", "FACTORY_WATCH_GH_SECONDS": "1", "FACTORY_WATCH_AUDIT_SECONDS": "1"}
    out = subprocess.run(["bash", str(tmp_path / "factory-incidents.sh")], env=env, capture_output=True, text=True, check=True)
    return out.stdout.splitlines()


def age(tmp_path: Path, name: str, minutes: int) -> None:
    """Moves the first failure of a source back in time."""
    down = tmp_path / "factory-incidents.saved" / f"{name}.down"
    old = time.time() - minutes * 60
    os.utime(down, (old, old))


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


SINCE = r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"
STUCK = "echo 'stuck #9 Tow fee'; echo 'stuck #7 Broken truck'"
DRIFT = "echo '#5 testPhase checks but column Design'"


def test_a_healthy_run_prints_every_source_in_order(tmp_path):
    assert run(tmp_path, health(), gh=STUCK, audit=DRIFT) == ["stuck #7 Broken truck", "stuck #9 Tow fee", "drift: #5 testPhase checks but column Design"]


def test_a_failed_audit_with_no_known_answer_prints_one_stable_line(tmp_path):
    lines = run(tmp_path, health(), audit="echo boom >&2; exit 1")
    assert len(lines) == 1 and re.fullmatch(f"audit failed since {SINCE}", lines[0])
    assert watch(tmp_path) == lines


def test_a_slow_github_with_no_known_answer_prints_one_stable_line_and_the_rest(tmp_path):
    lines = run(tmp_path, health(), gh="sleep 5", audit=DRIFT)
    assert len(lines) == 2 and re.fullmatch(f"stuck list failed since {SINCE}", lines[0])
    assert lines[1] == "drift: #5 testPhase checks but column Design"


def test_a_slow_or_failed_source_repeats_its_last_answer_so_no_incident_closes(tmp_path):
    healthy = run(tmp_path, health(), gh=STUCK, audit=DRIFT)
    stub(tmp_path / "bin", "gh", "sleep 5")
    stub(tmp_path / "bin", "factory", "exit 1")
    assert watch(tmp_path) == healthy


def test_a_source_down_past_the_grace_time_adds_one_stable_line(tmp_path):
    healthy = run(tmp_path, health(), gh=STUCK, audit=DRIFT)
    stub(tmp_path / "bin", "factory", "sleep 5")
    assert watch(tmp_path) == healthy
    age(tmp_path, "audit", 11)
    down = watch(tmp_path)
    assert down[:3] == healthy and len(down) == 4 and re.fullmatch(f"audit failed since {SINCE}", down[3])
    assert watch(tmp_path) == down
    stub(tmp_path / "bin", "factory", "exit 0")
    assert watch(tmp_path) == healthy[:2]


def test_a_timed_out_audit_is_not_retried(tmp_path):
    calls = tmp_path / "audit-calls"
    run(tmp_path, health(), audit=f"echo x >> {calls}; sleep 5; exit 1")
    assert calls.read_text().splitlines() == ["x"]


def test_one_failed_audit_is_retried_and_opens_no_incident(tmp_path):
    flag = tmp_path / "first-run-done"
    audit = f"if [ -f {flag} ]; then echo '#5 testPhase checks but column Design'; else touch {flag}; exit 1; fi"
    assert run(tmp_path, health(), audit=audit) == ["drift: #5 testPhase checks but column Design"]


def test_a_pending_review_wakes_hermes_until_the_file_goes(tmp_path):
    assert run(tmp_path / "ready", health(), review="#301 https://github.com/o/r/issues/301\n") == ["factory review ready: #301 https://github.com/o/r/issues/301"]
    assert run(tmp_path / "handled", health()) == []
