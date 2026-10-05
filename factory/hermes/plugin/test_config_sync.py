import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from config_sync import merge, sync  # noqa: E402

REPO = {"display": {"busy_input_mode": "queue", "memory_notifications": "on"}, "model": {"default": "a"}}


def test_first_start_writes_the_repo_config():
    assert merge(REPO, None, {"display": {"memory_notifications": "off"}}) == (REPO, [])


def test_keeps_an_edit_hermes_made():
    live = {"display": {"busy_input_mode": "queue", "memory_notifications": "off"}, "model": {"default": "a"}}
    new_repo = {**REPO, "cron": {"wrap_response": False}}
    config, lines = merge(new_repo, REPO, live)
    assert config["display"]["memory_notifications"] == "off"
    assert config["cron"] == {"wrap_response": False}
    assert lines == ["kept Hermes's edit display.memory_notifications = 'off'"]


def test_keeps_an_added_and_a_removed_setting():
    live = {"display": {"busy_input_mode": "queue", "memory_notifications": "on", "streaming": False}}
    config, _ = merge(REPO, REPO, live)
    assert config["display"]["streaming"] is False
    assert config["model"] == {}


def test_the_repo_wins_a_setting_it_changed():
    live = {"display": {"busy_input_mode": "queue", "memory_notifications": "verbose"}, "model": {"default": "a"}}
    new_repo = {"display": {"busy_input_mode": "queue", "memory_notifications": "off"}, "model": {"default": "a"}}
    config, lines = merge(new_repo, REPO, live)
    assert config["display"]["memory_notifications"] == "off"
    assert lines == ["dropped Hermes's edit display.memory_notifications = 'verbose', since the repo changed it"]


def test_an_edit_survives_many_starts(tmp_path):
    repo = tmp_path / "repo.yaml"
    repo.write_text(yaml.safe_dump(REPO))
    home = tmp_path / "home"
    home.mkdir()
    sync(repo, home)
    live = yaml.safe_load((home / "config.yaml").read_text())
    live["model"]["default"] = "b"
    (home / "config.yaml").write_text(yaml.safe_dump(live))
    sync(repo, home)
    assert sync(repo, home) == ["kept Hermes's edit model.default = 'b'"]
    assert yaml.safe_load((home / "config.yaml").read_text())["model"]["default"] == "b"
    assert yaml.safe_load((home / "config.repo.yaml").read_text()) == REPO
