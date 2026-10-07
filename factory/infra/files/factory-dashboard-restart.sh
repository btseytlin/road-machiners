#!/bin/bash
set -euo pipefail
root=${1:?factory root}
marker=$root/home/dashboard-restart
[ -f "$marker" ] || exit 0
# Each long-running service runs the current release's code, so a deploy restarts every one that is installed.
for unit in roam-factory-dashboard.service roam-factory-errors.service; do
  if systemctl is-enabled --quiet "$unit"; then systemctl restart "$unit"; fi
done
rm -f "$marker"
