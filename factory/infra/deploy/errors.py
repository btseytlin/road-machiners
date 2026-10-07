"""Install the error service and its Caddy route after main has deployed."""

import shlex

from pyinfra.operations import files, server, systemd

from factory_infra import CODE_DIR, FACTORY_ROOT, FACTORY_USER, HOME_DIR, INFRA_DIR, settings

files_dir = INFRA_DIR / "files"

server.shell(
    name="Create the error service socket and store directories",
    commands=[
        f"install -d -o {FACTORY_USER} -g {FACTORY_USER} -m 755 {FACTORY_ROOT}/errors",
        f"install -d -o {FACTORY_USER} -g {FACTORY_USER} -m 755 {FACTORY_ROOT}/home/error-reports",
    ],
    _sudo=True,
)
server.shell(
    name="Check the current release has the error service",
    commands=[f"test -f {CODE_DIR}/factory/src/error-reports/main.ts"],
    _sudo=True,
    _sudo_user=FACTORY_USER,
)
files.template(
    name="Install error service systemd unit",
    src=str(files_dir / "roam-factory-errors.service.j2"),
    dest="/etc/systemd/system/roam-factory-errors.service", mode="644",
    service_user=FACTORY_USER, code_dir=CODE_DIR, factory_root=FACTORY_ROOT, home_dir=HOME_DIR, _sudo=True,
)
# The update unit restarts the services after each deploy through this hook.
files.put(
    name="Install service restart hook",
    src=str(files_dir / "factory-dashboard-restart.sh"), dest=f"{FACTORY_ROOT}/factory-dashboard-restart.sh", mode="755", _sudo=True,
)
systemd.service(name="Start error service", service="roam-factory-errors.service", running=True, enabled=True, daemon_reload=True, _sudo=True)
files.sync(
    name="Install error service Caddy route", src=str(INFRA_DIR / "stacks" / "caddy"),
    dest=f"{FACTORY_ROOT}/stacks/caddy", delete=True, _sudo=True,
)
server.shell(
    name="Validate Caddy route and update only Caddy",
    commands=[
        "docker exec factory-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile",
        f"cd {FACTORY_ROOT}/stacks/caddy && FACTORY_DOMAIN={shlex.quote(settings.factory_domain)} "
        "FACTORY_ITCH_URL=$(docker inspect factory-caddy --format '{{range .Config.Env}}{{println .}}{{end}}' | "
        "grep '^ITCH_URL=' | cut -d= -f2-) timeout 120 docker compose up -d --no-deps caddy",
        "docker exec factory-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile",
    ],
    _sudo=True,
)
