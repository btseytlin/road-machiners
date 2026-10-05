"""Read-only host status for the game factory. Facts only, nothing is changed.

Run: `uv run pyinfra -y inventory.py deploy/status.py`
"""

# pyright: reportMissingImports=false
from pyinfra import host
from pyinfra.facts.server import Command

from factory_infra import FACTORY_ENV, FACTORY_ROOT, FACTORY_USER, HOME_DIR

# Every check ends in a success exit. pyinfra drops the output of a failed fact command,
# so a check that reports a fault would go blank when the fault appears.
checks = {
    "tools": "timeout 20 sh -c 'docker --version; node -v; gh --version | head -1; butler -V' 2>&1 || true",
    "tick timer": "timeout 20 sh -c 'systemctl is-active roam-factory-tick.timer; systemctl is-enabled roam-factory-tick.timer;"
    " systemctl list-timers roam-factory-tick.timer --no-pager --no-legend' 2>&1 || true",
    "last tick result": "timeout 20 systemctl show roam-factory-tick.service -p Result -p ExecMainStatus -p ExecMainExitTimestamp 2>&1 || true",
    "last tick log lines": f"timeout 20 tail -n 20 {HOME_DIR}/logs/tick.log 2>&1 || true",
    "running job and state": f"timeout 20 sh -c 'jq -c .job {HOME_DIR}/state/state.json' 2>&1 || true",
    "inbox": f"timeout 20 sh -c 'stat -c \"%A %U:%G\" {HOME_DIR}/inbox; ls {HOME_DIR}/inbox | wc -l' 2>&1 || true",
    "committee": f"timeout 20 sh -c 'stat -c \"%A %U:%G\" {HOME_DIR}/committee; ls {HOME_DIR}/committee' 2>&1 || true",
    # gh signs in with GH_TOKEN from the factory env, as the tick does. gh masks the token in its output.
    "gh auth": f"timeout 30 sudo -H -u {FACTORY_USER} sh -c 'GH_TOKEN=$(grep ^GH_TOKEN= {FACTORY_ENV} | cut -d= -f2-) gh auth status' 2>&1 | head -6 || true",
    "containers": "timeout 30 docker ps --format '{{.Names}}\t{{.Status}}' 2>&1 || true",
    "hermes health": "timeout 30 docker inspect --format '{{.Name}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{end}}' factory-hermes 2>&1 || true",
    "agent image": "timeout 30 docker images --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}' 2>&1 | head -10 || true",
    "web root": f"timeout 20 sh -c 'ls {FACTORY_ROOT}/www | head -20' 2>&1 || true",
    "published ports": "timeout 30 docker ps --format '{{.Names}}\t{{.Ports}}' 2>&1 || true",
    "firewall": "timeout 20 ufw status 2>&1 | head -1 || true",
    "tunnel": "timeout 30 docker inspect --format '{{.Name}}\t{{.State.Status}}\t{{.RestartCount}} restarts' factory-tunnel 2>&1 || true",
    "gpu": "timeout 30 nvidia-smi --query-gpu=name,driver_version,temperature.gpu,utilization.gpu,memory.used --format=csv 2>&1 || true",
    "disk": "timeout 20 df -h / 2>&1 || true",
}

for label, command in checks.items():
    print(f"\n=== {label} ===")
    print(host.get_fact(Command, command=command, _sudo=True))
