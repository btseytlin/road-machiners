"""Runs factory-layout.sh and factory-update.sh against a temp factory root and a local bare git origin.

Shims on PATH stand in for npm, docker, systemctl, sudo, chown, timeout and GNU `mv -T`, and log each call to shim.log.
Process working folders come from the file FACTORY_CWD_LIST, since macOS has no /proc.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

FILES = Path(__file__).parent.parent / "files"
LAYOUT = FILES / "factory-layout.sh"
UPDATE = FILES / "factory-update.sh"

SHIMS = {
    "npm": '''#!/bin/bash
echo "npm $PWD $*" >> "$SHIM_LOG"
[ "$1" != ci ] || [ -z "${NPM_FAIL:-}" ] || exit 1
[ "$1" != ci ] || mkdir -p node_modules
''',
    "docker": '''#!/bin/bash
echo "docker $PWD $* | FACTORY_CODE_SOURCE=${FACTORY_CODE_SOURCE:-} FACTORY_CODE_TARGET=${FACTORY_CODE_TARGET:-}" >> "$SHIM_LOG"
''',
    "systemctl": '''#!/bin/bash
echo "systemctl $*" >> "$SHIM_LOG"
''',
    "sudo": '''#!/bin/bash
while [ "${1:-}" = -u ] || [ "${1:-}" = -H ]; do
  if [ "$1" = -u ]; then shift 2; else shift; fi
done
exec "$@"
''',
    "chown": "#!/bin/bash\nexit 0\n",
    "timeout": '''#!/bin/bash
shift
exec "$@"
''',
    # BSD mv has no -T. Both modes replace the target name itself, even when it is a symlink to a folder.
    "mv": '''#!/bin/bash
if [ "$1" = -T ]; then
  exec python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' "$2" "$3"
fi
exec /bin/mv "$@"
''',
}


class Factory:
    def __init__(self, tmp_path: Path):
        self.root = (tmp_path / "factory-root").resolve()
        self.origin = tmp_path / "origin.git"
        self.work = tmp_path / "work"
        self.shim_log = tmp_path / "shim.log"
        self.cwd_list = tmp_path / "cwds.txt"
        shims = tmp_path / "shims"
        shims.mkdir()
        for name, text in SHIMS.items():
            (shims / name).write_text(text)
            (shims / name).chmod(0o755)
        self.shim_log.write_text("")
        self.cwd_list.write_text("")
        self.env = {
            **os.environ,
            "PATH": f"{shims}:{os.environ['PATH']}",
            "SHIM_LOG": str(self.shim_log),
            "FACTORY_CWD_LIST": str(self.cwd_list),
            "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
            "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
        }
        (self.root / "home").mkdir(parents=True)
        self.git("init", "-q", "--bare", "-b", "main", str(self.origin), cwd=tmp_path)
        self.git("clone", "-q", str(self.origin), str(self.work), cwd=tmp_path)
        self.push({".gitignore": ".env\nnode_modules\n", "factory/package.json": "{}", "factory/settings.env": "FACTORY_IMAGE=img\n", "factory/docker/Dockerfile": "FROM x\n"}, "first")

    def git(self, *args: str, cwd: Path | None = None) -> str:
        return subprocess.run(["git", *args], cwd=cwd or self.work, env=self.env, text=True, capture_output=True, check=True).stdout.strip()

    def push(self, files: dict[str, str], message: str) -> str:
        for name, text in files.items():
            path = self.work / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        self.git("push", "-q", "origin", "HEAD:main")
        return self.git("rev-parse", "HEAD")

    def clone_repo(self) -> None:
        self.git("clone", "-q", str(self.origin), str(self.root / "repo"), cwd=self.root)

    def run(self, script: Path, *args: str, **env: str) -> subprocess.CompletedProcess:
        return subprocess.run(["bash", str(script), str(self.root), *args], env={**self.env, **env}, text=True, capture_output=True)

    def layout(self, **env: str) -> subprocess.CompletedProcess:
        return self.run(LAYOUT, "factory", **env)

    def update(self, **env: str) -> subprocess.CompletedProcess:
        return self.run(UPDATE, **env)

    def release(self, sha: str) -> Path:
        return self.root / "releases" / sha

    def current(self) -> str:
        return os.readlink(self.root / "releases" / "current")

    def deployed(self) -> str:
        return (self.root / "home" / "deployed").read_text().strip()

    def shim_calls(self) -> list[str]:
        return self.shim_log.read_text().splitlines()

    def busy_in(self, *paths: Path) -> None:
        self.cwd_list.write_text("".join(f"{path}\n" for path in paths))


@pytest.fixture
def factory(tmp_path: Path) -> Factory:
    return Factory(tmp_path)


@pytest.fixture
def laid_out(factory: Factory) -> tuple[Factory, str]:
    """A fresh server: a clone in repo, the server env, and the layout made for the first main."""
    factory.clone_repo()
    (factory.root / "factory.env").write_text("SECRET=1\n")
    first = factory.git("rev-parse", "HEAD")
    done = factory.layout()
    assert done.returncode == 0, done.stdout + done.stderr
    return factory, first


def test_layout_on_a_fresh_server_builds_the_first_release_and_both_links(laid_out):
    factory, first = laid_out
    assert factory.deployed() == first
    assert factory.current() == first
    assert os.readlink(factory.root / "code") == "releases/current"
    assert (factory.root / "code" / "factory" / "package.json").is_file()
    assert os.readlink(factory.release(first) / "factory" / ".env") == str(factory.root / "factory.env")
    assert (factory.root / "code" / "factory" / ".env").read_text() == "SECRET=1\n"
    assert (factory.release(first) / "factory" / "node_modules").is_dir()
    assert not any(call.startswith("systemctl") for call in factory.shim_calls())


def test_layout_twice_changes_nothing(laid_out):
    factory, first = laid_out
    calls = factory.shim_calls()
    again = factory.layout()
    assert again.returncode == 0, again.stdout + again.stderr
    assert factory.current() == first
    assert factory.shim_calls() == calls


def test_layout_moves_a_real_code_folder_to_repo_and_keeps_the_timers_off_meanwhile(factory):
    factory.git("clone", "-q", str(factory.origin), str(factory.root / "code"), cwd=factory.root)
    (factory.root / "code" / "factory" / ".env").write_text("SECRET=live\n")
    deployed = factory.git("rev-parse", "HEAD")
    (factory.root / "home" / "deployed").write_text(deployed + "\n")
    second = factory.push({"factory/more.txt": "x"}, "second")
    done = factory.layout()
    assert done.returncode == 0, done.stdout + done.stderr
    assert (factory.root / "repo" / ".git").is_dir()
    assert (factory.root / "factory.env").read_text() == "SECRET=live\n"
    assert not (factory.root / "repo" / "factory" / ".env").exists()
    assert os.readlink(factory.root / "code") == "releases/current"
    assert factory.current() == deployed
    assert deployed != second
    assert not (factory.root / "code" / "factory" / "more.txt").exists()
    assert (factory.root / "code" / "factory" / ".env").read_text() == "SECRET=live\n"
    calls = factory.shim_calls()
    stop = next(i for i, call in enumerate(calls) if call.startswith("systemctl stop") and "roam-factory-tick.timer" in call)
    npm = next(i for i, call in enumerate(calls) if call.startswith("npm "))
    start = next(i for i, call in enumerate(calls) if call.startswith("systemctl start") and "roam-factory-tick.timer" in call)
    assert stop < npm < start


def test_layout_lifts_the_pause_of_the_old_update_and_stops_its_service_but_keeps_a_hermes_pause(factory):
    for reason, kept in [("update to 1086eba, waiting for the running jobs\n", False), ("Hermes repairs #4\n", True)]:
        shutil.rmtree(factory.root / "repo", ignore_errors=True)
        shutil.rmtree(factory.root / "releases", ignore_errors=True)
        (factory.root / "code").unlink(missing_ok=True)
        (factory.root / "factory.env").unlink(missing_ok=True)
        factory.git("clone", "-q", str(factory.origin), str(factory.root / "code"), cwd=factory.root)
        (factory.root / "home" / "deployed").write_text(factory.git("rev-parse", "HEAD") + "\n")
        (factory.root / "home" / "paused").write_text(reason)
        done = factory.layout()
        assert done.returncode == 0, done.stdout + done.stderr
        assert (factory.root / "home" / "paused").exists() == kept
        assert any(call.startswith("systemctl stop") and "roam-factory-update.service" in call for call in factory.shim_calls())


def test_layout_refuses_a_second_env_file_during_the_move(factory):
    factory.git("clone", "-q", str(factory.origin), str(factory.root / "code"), cwd=factory.root)
    (factory.root / "code" / "factory" / ".env").write_text("old\n")
    (factory.root / "factory.env").write_text("new\n")
    (factory.root / "home" / "deployed").write_text(factory.git("rev-parse", "HEAD") + "\n")
    done = factory.layout()
    assert done.returncode != 0
    assert "factory.env" in done.stdout + done.stderr
    assert any(call.startswith("systemctl start") and "roam-factory-tick.timer" in call for call in factory.shim_calls())


def test_update_deploys_the_new_main_beside_the_old_release_and_prunes_it(laid_out):
    factory, first = laid_out
    second = factory.push({"factory/src.ts": "x"}, "second")
    done = factory.update()
    assert done.returncode == 0, done.stdout + done.stderr
    assert factory.current() == second
    assert factory.deployed() == second
    assert (factory.release(second) / "factory" / "node_modules").is_dir()
    assert (factory.root / "code" / "factory" / "src.ts").is_file()
    assert not (factory.root / "home" / "update-failed").exists()
    assert not (factory.root / "home" / "paused").exists()
    assert "systemctl" not in "\n".join(factory.shim_calls())
    # The previous release stays one deploy, for a tick that resolved the link just before the swap.
    assert sorted(path.name for path in (factory.root / "releases").iterdir()) == sorted(["current", first, second])
    third = factory.push({"factory/src.ts": "y"}, "third")
    assert factory.update().returncode == 0
    assert sorted(path.name for path in (factory.root / "releases").iterdir()) == sorted(["current", second, third])


def test_update_does_nothing_when_main_is_deployed(laid_out):
    factory, first = laid_out
    calls = factory.shim_calls()
    done = factory.update()
    assert done.returncode == 0
    assert factory.current() == first
    assert factory.shim_calls() == calls


def test_update_keeps_a_release_a_process_still_works_in_and_prunes_it_after_the_process_ends(laid_out):
    factory, first = laid_out
    factory.busy_in(factory.release(first) / "factory")
    second = factory.push({"factory/a.ts": "a"}, "second")
    assert factory.update().returncode == 0
    assert factory.current() == second
    assert (factory.release(first) / "factory" / "package.json").is_file()
    factory.busy_in()
    third = factory.push({"factory/b.ts": "b"}, "third")
    assert factory.update().returncode == 0
    assert factory.current() == third
    assert not factory.release(first).exists()
    assert sorted(path.name for path in (factory.root / "releases").iterdir()) == sorted(["current", second, third])
    assert first not in factory.git("worktree", "list", cwd=factory.root / "repo")


def test_update_never_prunes_the_current_release_even_when_a_process_works_elsewhere(laid_out):
    factory, first = laid_out
    factory.busy_in(factory.root / "home")
    second = factory.push({"factory/a.ts": "a"}, "second")
    assert factory.update().returncode == 0
    assert factory.release(second).is_dir()


def test_failed_npm_ci_leaves_current_and_deployed_and_names_the_failure(laid_out):
    factory, first = laid_out
    second = factory.push({"factory/package.json": '{"a":1}'}, "second")
    done = factory.update(NPM_FAIL="1")
    assert done.returncode == 1
    assert factory.current() == first
    assert factory.deployed() == first
    assert "npm ci failed" in (factory.root / "home" / "update-failed").read_text()
    assert not factory.release(second).exists()
    assert factory.release(first).is_dir()
    retry = factory.update()
    assert retry.returncode == 0, retry.stdout + retry.stderr
    assert factory.current() == second
    assert not (factory.root / "home" / "update-failed").exists()


def test_local_edits_in_the_current_release_stop_the_update(laid_out):
    factory, first = laid_out
    (factory.release(first) / "factory" / "package.json").write_text("edited")
    factory.push({"factory/a.ts": "a"}, "second")
    done = factory.update()
    assert done.returncode == 1
    assert "local edits" in (factory.root / "home" / "update-failed").read_text()
    assert factory.current() == first
    assert factory.deployed() == first


def test_images_and_hermes_rebuild_only_when_their_paths_changed(laid_out):
    factory, first = laid_out
    factory.push({"factory/a.ts": "a"}, "plain")
    assert factory.update().returncode == 0
    assert not any(call.startswith("docker") for call in factory.shim_calls())
    factory.push({"factory/docker/Dockerfile": "FROM y\n"}, "image")
    assert factory.update().returncode == 0
    builds = [call for call in factory.shim_calls() if call.startswith("docker") and " build " in call]
    assert len(builds) == 2
    assert not any("compose" in call for call in factory.shim_calls())
    factory.push({"factory/hermes/compose.yaml": "x"}, "hermes")
    assert factory.update().returncode == 0
    compose = [call for call in factory.shim_calls() if "compose" in call]
    assert len(compose) == 1
    assert f"FACTORY_CODE_SOURCE={factory.root} FACTORY_CODE_TARGET={factory.root}" in compose[0]
    assert compose[0].startswith(f"docker {factory.release(factory.deployed())} compose")
