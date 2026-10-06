#!/bin/bash
set -euo pipefail
root=${1:?factory root}
marker=$root/home/dashboard-restart
[ -f "$marker" ] || exit 0
systemctl is-enabled --quiet roam-factory-dashboard.service || exit 0
systemctl restart roam-factory-dashboard.service
rm -f "$marker"
