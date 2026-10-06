"""Writes the repo's config.yaml into the Hermes home and keeps the settings Hermes changed there itself.

Every start copies the repo config, so an edit Hermes made to its live config would be lost.
The start script runs this file instead of a plain copy. It finds Hermes's edits by comparing
the live config with the repo config written at the last start, and applies them on top of the
new repo config. When the repo changed the same setting since then, the repo value wins.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import yaml

DELETED = object()  # marks a setting Hermes removed


def flatten(config, prefix=()) -> dict:
    """Maps each setting's key path to its value. Lists and empty sections count as one value."""
    if not isinstance(config, dict) or not config:
        return {prefix: config} if prefix else {}
    flat = {}
    for key, value in config.items():
        flat.update(flatten(value, (*prefix, key)))
    return flat


def edits(base: dict, live: dict) -> dict:
    """Returns the settings that differ in live from base, with DELETED for removed ones."""
    old, new = flatten(base), flatten(live)
    changed = {path: value for path, value in new.items() if old.get(path, DELETED) != value}
    changed.update({path: DELETED for path in old if path not in new})
    return changed


def apply(config: dict, overrides: dict) -> dict:
    """Returns config with each override set or removed. Deletions go first, so a section Hermes turned into a value is replaced cleanly."""
    result = yaml.safe_load(yaml.safe_dump(config)) or {}
    for path, value in sorted(overrides.items(), key=lambda item: item[1] is not DELETED):
        node = result
        for key in path[:-1]:
            if not isinstance(node.get(key), dict):
                if value is DELETED:
                    break
                node[key] = {}
            node = node[key]
        else:
            if value is DELETED:
                node.pop(path[-1], None)
            else:
                node[path[-1]] = value
    return result


def merge(repo: dict, base: dict | None, live: dict | None) -> tuple[dict, list[str]]:
    """Returns the config to write and one log line per kept or dropped edit."""
    if base is None or live is None:
        return repo, []
    old_repo, new_repo = flatten(base), flatten(repo)
    kept, lines = {}, []
    for path, value in edits(base, live).items():
        name = ".".join(str(key) for key in path)
        shown = "removed" if value is DELETED else repr(value)
        if old_repo.get(path, DELETED) != new_repo.get(path, DELETED):
            lines.append(f"dropped Hermes's edit {name} = {shown}, since the repo changed it")
        else:
            kept[path] = value
            lines.append(f"kept Hermes's edit {name} = {shown}")
    return apply(repo, kept), lines


def _read(path: Path) -> dict | None:
    return (yaml.safe_load(path.read_text()) or {}) if path.exists() else None


def _replace(path: Path, config: dict) -> None:
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    with os.fdopen(descriptor, "w") as stream:
        yaml.safe_dump(config, stream, sort_keys=False)
    os.replace(temporary, path)


def sync(repo_path: Path, home: Path) -> list[str]:
    """Writes the merged config.yaml and records the repo config it came from in config.repo.yaml."""
    repo = _read(repo_path)
    if repo is None:
        raise FileNotFoundError(f"No repo config at {repo_path}.")
    config, lines = merge(repo, _read(home / "config.repo.yaml"), _read(home / "config.yaml"))
    _replace(home / "config.yaml", config)
    _replace(home / "config.repo.yaml", repo)
    return lines


def main() -> None:
    for line in sync(Path(sys.argv[1]), Path(os.environ["HERMES_HOME"])):
        print(f"config: {line}", file=sys.stderr)


if __name__ == "__main__":
    main()
