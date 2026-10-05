"""Install only the public dashboard service, updater hook and Caddy route after main has deployed."""

import shlex
from io import StringIO

from pyinfra.operations import files, server, systemd

from factory_infra import CODE_DIR, FACTORY_ROOT, FACTORY_USER, HOME_DIR, INFRA_DIR, settings

files_dir = INFRA_DIR / "files"
config = (INFRA_DIR.parent / "dashboard" / ".env.example").read_text()
config = config.replace("DASHBOARD_SOCKET=\n", f"DASHBOARD_SOCKET={FACTORY_ROOT}/dashboard/http.sock\n")
config = config.replace("DASHBOARD_PORT=8787\n", "DASHBOARD_PORT=\n")
config = "\n".join(line for line in config.splitlines() if not line.startswith("DASHBOARD_CHANNEL_URL=")) + "\n"

server.shell(
    name="Create dashboard socket directory",
    commands=[f"install -d -o {FACTORY_USER} -g {FACTORY_USER} -m 755 {FACTORY_ROOT}/dashboard"],
    _sudo=True,
)
files.put(
    name="Install public dashboard configuration",
    src=StringIO(config),
    dest=f"{FACTORY_ROOT}/dashboard/dashboard.env",
    user=FACTORY_USER, group=FACTORY_USER, mode="600", add_deploy_dir=False, _sudo=True,
)
server.shell(
    name="Link dashboard configuration into current release",
    commands=[
        f"test -f {CODE_DIR}/factory/src/dashboard/main.ts",
        f"ln -sfn {FACTORY_ROOT}/dashboard/dashboard.env {CODE_DIR}/factory/dashboard/.env",
    ],
    _sudo=True,
    _sudo_user=FACTORY_USER,
)
files.put(
    name="Install dashboard-aware updater",
    src=str(files_dir / "factory-update.sh"), dest=f"{FACTORY_ROOT}/factory-update.sh", mode="755", _sudo=True,
)
files.put(
    name="Install dashboard restart hook",
    src=str(files_dir / "factory-dashboard-restart.sh"), dest=f"{FACTORY_ROOT}/factory-dashboard-restart.sh", mode="755", _sudo=True,
)
files.template(
    name="Install dashboard systemd unit",
    src=str(files_dir / "roam-factory-dashboard.service.j2"),
    dest="/etc/systemd/system/roam-factory-dashboard.service", mode="644",
    service_user=FACTORY_USER, code_dir=CODE_DIR, factory_root=FACTORY_ROOT, home_dir=HOME_DIR, _sudo=True,
)
files.template(
    name="Install dashboard restart on main update",
    src=str(files_dir / "roam-factory-update.service.j2"),
    dest="/etc/systemd/system/roam-factory-update.service", mode="644",
    service_user=FACTORY_USER, script=f"{FACTORY_ROOT}/factory-update.sh", factory_root=FACTORY_ROOT, home_dir=HOME_DIR, _sudo=True,
)
systemd.service(name="Start public dashboard", service="roam-factory-dashboard.service", running=True, enabled=True, daemon_reload=True, _sudo=True)
files.sync(
    name="Install dashboard Caddy route", src=str(INFRA_DIR / "stacks" / "caddy"),
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
