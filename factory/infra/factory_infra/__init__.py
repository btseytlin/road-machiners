"""Typed config for provisioning and deploy, loaded once from prod.env.

pyinfra's inventory and deploy scripts import `settings` from here instead of reading os.environ.
The factory's server-only env is a separate file (`factory_env_file`) that deploy pushes as it is. Its other settings are in the tracked factory/settings.env.
"""

from pathlib import Path

from dotenv import dotenv_values
from pydantic_settings import BaseSettings, SettingsConfigDict

INFRA_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = INFRA_DIR.parent.parent

FACTORY_USER = "factory"
# Agent containers run as pwuser, uid 1001 in the Playwright image. They write into work clones the factory user owns, so both share the uid.
# Hermes runs as this uid too, since it edits the factory home.
FACTORY_UID = 1001
FACTORY_ROOT = "/opt/factory"
# repo is the git clone and releases holds one worktree per deployed commit. code is a link to the current release.
REPO_DIR = f"{FACTORY_ROOT}/repo"
RELEASES_DIR = f"{FACTORY_ROOT}/releases"
CODE_DIR = f"{FACTORY_ROOT}/code"
# The server-only env lives outside every release. Each release links factory/.env to it.
FACTORY_ENV = f"{FACTORY_ROOT}/factory.env"
HOME_DIR = f"{FACTORY_ROOT}/home"
WWW_DIR = f"{FACTORY_ROOT}/www"
HERMES_DIR = f"{FACTORY_ROOT}/hermes"
# Git tracks the factory settings. The server-only .env holds secrets, committee ids and host paths.
SETTINGS_FILE = REPO_ROOT / "factory" / "settings.env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file="prod.env", extra="ignore")

    factory_host: str
    factory_ssh_user: str = "root"
    factory_ssh_key: str | None = None
    factory_domain: str
    factory_tunnel_token: str
    factory_env_file: str
    factory_gh_token: str


settings = Settings()  # pyright: ignore[reportCallIssue] -- required values come from prod.env


def read_factory_env(path: str | Path, settings_path: str | Path = SETTINGS_FILE) -> dict[str, str]:
    """Read the server-only factory .env with the tracked settings.env and check them against the server layout. Raises on any mismatch."""
    local = _values(path)
    tracked = _values(settings_path)
    values = {**tracked, **local}
    expected = {"FACTORY_HOME": HOME_DIR, "FACTORY_WEB_ROOT": WWW_DIR}
    wrong = [f"{key} must be {want}, got {values.get(key)!r}" for key, want in expected.items() if values.get(key) != want]
    wrong += [f"{key} is in both {path} and {settings_path}" for key in sorted(local.keys() & tracked.keys())]
    for key in ("FACTORY_TICK_MINUTES", "FACTORY_COMMITTEE_BOOTSTRAP", "FACTORY_COMMITTEE_BOOTSTRAP_GITHUB", "FACTORY_COMMITTEE_CHAT", "TELEGRAM_BOT_TOKEN", "FACTORY_IMAGE"):
        if not values.get(key, "").strip():
            wrong.append(f"{key} is missing")
    tick = values.get("FACTORY_TICK_MINUTES", "")
    if tick and not (tick.isdigit() and int(tick) > 0):
        wrong.append(f"FACTORY_TICK_MINUTES must be a positive whole number, got {tick!r}")
    if wrong:
        raise ValueError(f"{path}: " + "; ".join(wrong))
    return values


def _values(path: str | Path) -> dict[str, str]:
    return {key: value for key, value in dotenv_values(path).items() if value is not None}
