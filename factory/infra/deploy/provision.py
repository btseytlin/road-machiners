"""Base host provisioning for the game factory. Idempotent. Re-run it safely after changes.

Packages, Docker, Node 24, gh, butler, the firewall, the laptop power settings, the NVIDIA driver and container toolkit, the factory user and the /opt/factory dirs.
"""

# pyright: reportMissingImports=false
from io import StringIO

from pyinfra.operations import apt, files, server, systemd

from factory_infra import FACTORY_ROOT, FACTORY_UID, FACTORY_USER, HERMES_DIR, HOME_DIR, INFRA_DIR, REPO_DIR, WWW_DIR

FILES = INFRA_DIR / "files"

apt.packages(
    name="Base packages",
    packages=["ca-certificates", "curl", "git", "jq", "unzip", "ufw", "fail2ban", "unattended-upgrades"],
    update=True,
    _sudo=True,
)

daemon_json = files.put(
    name="Docker daemon.json (log rotation, published ports on 127.0.0.1 by default)",
    src=str(FILES / "daemon.json"),
    dest="/etc/docker/daemon.json",
    mode="644",
    _sudo=True,
)

# The testing gate peaks near 2.6 GB. On a 4 GB server, swap turns a spike into slowness instead of a killed run.
server.shell(
    name="4 GB swap file (skipped if present)",
    commands=[
        "swapon --show=NAME --noheadings | grep -q /swapfile || ("
        "timeout 120 fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile)",
        "grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab",
    ],
    _sudo=True,
)

server.shell(
    name="Install Docker (convenience script, skipped if present)",
    commands=["command -v docker >/dev/null || (timeout 600 sh -c 'curl -fsSL https://get.docker.com | sh')"],
    _sudo=True,
)
# The port default in daemon.json applies only after a restart.
server.shell(
    name="Restart Docker after a daemon.json change",
    commands=["timeout 120 systemctl restart docker"],
    _if=daemon_json.did_change,
    _sudo=True,
)

# NodeSource, since the factory CLI needs Node 23.6 or newer.
server.shell(
    name="Install Node 24 (skipped if present)",
    commands=[
        "node -v 2>/dev/null | grep -q '^v24' || "
        "(timeout 600 sh -c 'curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs')"
    ],
    _sudo=True,
)

server.shell(
    name="Install gh (skipped if present)",
    commands=[
        "command -v gh >/dev/null || (timeout 600 sh -c '"
        "mkdir -p -m 755 /etc/apt/keyrings && "
        "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg && "
        "chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && "
        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" '
        "> /etc/apt/sources.list.d/github-cli.list && "
        "apt-get update && apt-get install -y gh')"
    ],
    _sudo=True,
)

# butler ships from itch.io as a zip for amd64 only. Any other CPU stops here.
server.shell(
    name="Install butler (skipped if present)",
    commands=[
        "command -v butler >/dev/null || (timeout 300 sh -c '"
        '[ "$(uname -m)" = x86_64 ] || { echo "butler install needs an amd64 host" >&2; exit 1; }; '
        "curl -fsSL -o /tmp/butler.zip https://broth.itch.zone/butler/linux-amd64/LATEST/archive/default && "
        "unzip -o /tmp/butler.zip -d /usr/local/bin butler && chmod 755 /usr/local/bin/butler && rm /tmp/butler.zip')"
    ],
    _sudo=True,
)

# The Cloudflare Tunnel dials out, so ssh is the only inbound port.
server.shell(
    name="UFW: allow ssh only",
    commands=[
        "timeout 60 ufw --force default deny incoming",
        "timeout 60 ufw --force default allow outgoing",
        "timeout 60 ufw allow 22/tcp",
        "timeout 60 ufw --force enable",
    ],
    _sudo=True,
)

# The host is a laptop. A closed lid or an idle timer must not suspend it. logind reads the lid setting at the next boot, which the driver step below forces.
files.put(
    name="logind ignores the lid",
    src=StringIO("[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\n"),
    dest="/etc/systemd/logind.conf.d/factory-lid.conf",
    mode="644",
    _sudo=True,
)
server.shell(
    name="Mask sleep targets",
    commands=["timeout 60 systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target"],
    _sudo=True,
)

# ubuntu-drivers picks the driver Ubuntu recommends for the installed card. The full driver, not the headless one, since the playtest needs its GL libraries.
# The driver loads only after a reboot, and only with Secure Boot off. The check stops provision until both hold.
server.shell(
    name="NVIDIA driver (skipped if present)",
    commands=["command -v nvidia-smi >/dev/null || (apt-get install -y ubuntu-drivers-common && timeout 1200 ubuntu-drivers install)"],
    _sudo=True,
)
server.shell(
    name="NVIDIA driver loaded",
    commands=["timeout 60 nvidia-smi -L || { echo 'The NVIDIA driver is not loaded. Turn Secure Boot off, reboot the host, then run provision again.' >&2; exit 1; }"],
    _sudo=True,
)
# A driver update replaces the libraries but keeps the old module loaded, and every GPU container fails until a reboot. A kernel update can pull a new driver module with it.
# So unattended upgrades skip both. Update them by hand with a reboot right after.
files.put(
    name="Unattended upgrades skip the NVIDIA driver and the kernel",
    src=StringIO('Unattended-Upgrade::Package-Blacklist {\n    ".*nvidia.*";\n    "linux-.*";\n};\n'),
    dest="/etc/apt/apt.conf.d/51factory-hold-driver",
    mode="644",
    _sudo=True,
)
# The toolkit lets `docker run --gpus` hand the card to a container.
server.shell(
    name="NVIDIA container toolkit (skipped if present)",
    commands=[
        "command -v nvidia-ctk >/dev/null || (timeout 600 sh -c '"
        "curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor --yes -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg && "
        "curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | "
        "sed \"s#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g\" "
        "> /etc/apt/sources.list.d/nvidia-container-toolkit.list && "
        "apt-get update && apt-get install -y nvidia-container-toolkit && systemctl restart docker')"
    ],
    _sudo=True,
)
# The toolkit's device list names the persistence daemon's socket. Ubuntu stops the daemon when no unit needs it, and then every GPU container fails to start.
nvidia_persistence = files.put(
    name="nvidia-persistenced always runs",
    src=StringIO("[Unit]\nStopWhenUnneeded=false\n\n[Install]\nWantedBy=multi-user.target\n"),
    dest="/etc/systemd/system/nvidia-persistenced.service.d/factory.conf",
    mode="644",
    create_remote_dir=True,
    _sudo=True,
)
systemd.service(
    name="nvidia-persistenced running + enabled",
    service="nvidia-persistenced",
    running=True,
    enabled=True,
    daemon_reload=nvidia_persistence.did_change,
    _sudo=True,
)
server.shell(
    name="A container sees the GPU",
    commands=["timeout 600 docker run --rm --gpus all ubuntu:24.04 nvidia-smi -L"],
    _sudo=True,
)

systemd.service(
    name="fail2ban running + enabled",
    service="fail2ban",
    running=True,
    enabled=True,
    _sudo=True,
)

# The docker group is root on this host. The factory user needs it to start agent containers.
server.user(
    name="factory system user in the docker group",
    user=FACTORY_USER,
    uid=FACTORY_UID,
    system=True,
    home=f"/home/{FACTORY_USER}",
    create_home=True,
    shell="/bin/bash",
    groups=["docker"],
    append=True,
    _sudo=True,
)

# The factory user owns the clone. Git refuses it for root without this entry, and that breaks admin commands run over ssh as root.
server.shell(
    name="git trusts the factory clone for every user",
    commands=[f"git config --system --get-all safe.directory | grep -qxF {REPO_DIR} || git config --system --add safe.directory {REPO_DIR}"],
    _sudo=True,
)

files.directory(name=f"dir {FACTORY_ROOT}", path=FACTORY_ROOT, mode="755", present=True, _sudo=True)
for path in [REPO_DIR, HOME_DIR, WWW_DIR, f"{HOME_DIR}/logs", f"{HOME_DIR}/state"]:
    files.directory(name=f"dir {path}", path=path, user=FACTORY_USER, group=FACTORY_USER, mode="755", present=True, _sudo=True)

# Hermes runs as the factory user, so the factory user owns its state and every folder it writes.
for name in ("inbox", "committee"):
    files.directory(name=f"dir {HOME_DIR}/{name}", path=f"{HOME_DIR}/{name}", user=FACTORY_USER, group=FACTORY_USER, mode="750", present=True, _sudo=True)
files.directory(name=f"dir {HERMES_DIR}", path=HERMES_DIR, user=FACTORY_USER, group=FACTORY_USER, mode="700", present=True, _sudo=True)
for path in [f"{FACTORY_ROOT}/caddy/data", f"{FACTORY_ROOT}/caddy/config"]:
    files.directory(name=f"dir {path}", path=path, present=True, _sudo=True)

files.template(
    name="logrotate for the tick log",
    src=str(FILES / "roam-factory.logrotate.j2"),
    dest="/etc/logrotate.d/roam-factory",
    mode="644",
    home_dir=HOME_DIR,
    _sudo=True,
)
