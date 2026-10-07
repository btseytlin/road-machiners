#!/bin/bash
# Prints the open factory incidents, one per line and without times, so the output changes only when an incident opens or closes.
# Hermes runs it every minute and wakes when the output changes.
set -euo pipefail
gh issue list -R "$FACTORY_REPO" --label factory-stuck --state open --json number,title --jq '.[] | "stuck #\(.number) \(.title)"' | sort
# Each failed job of the last day, with its first error line and log. The log name holds the start time, so each failure prints once.
jq -r '.failures // [] | .[] | "failed \(.stage)\(if .issue then " #\(.issue)" else "" end): \(.error | split("\n")[0]) (log \(.log // "none"))"' /factory/home/state/state.json
jq -r '.lastTickError // empty | "tick crash: " + (split("\n")[0])' /factory/home/state/state.json
jq -r '.devFailed // empty | "dev build failed at " + .' /factory/home/state/state.json
# factory-update could not deploy main. Its log is logs/update.log.
if [ -f /factory/home/update-failed ]; then echo "update failed: $(cat /factory/home/update-failed)"; fi
# Every tick, paused or not, writes the health file. A tick waits up to 15 minutes on the repo lock and the timer runs every minute, so 20 minutes without one means ticks stopped.
if [ -f /factory/home/health ]; then
  jq -r 'select(.freeGb < .minFreeGb) | "disk low: under \(.minFreeGb) GB free"' /factory/home/health
  # availableGb is null where the host has no /proc/meminfo, and then no memory incident opens.
  jq -r 'select(.availableGb != null and .availableGb < .minAvailableGb) | "memory low: under \(.minAvailableGb) GB available"' /factory/home/health
  jq -r 'select(now - (.at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) > 1200) | "tick stalled: no tick since \(.at)"' /factory/home/health
else
  echo "tick stalled: no health file, so no tick ran on this code"
fi
# Each drift between the stores of one card or of the release. Audit lines hold no times, so each prints once.
# A failed audit runs once more, so one ssh or GitHub error does not open an incident. Two failures print one stable line.
if audit=$(factory audit 2>/dev/null || factory audit 2>/dev/null); then
  if [ -n "$audit" ]; then printf '%s\n' "$audit" | sed 's/^/drift: /'; fi
else
  echo "audit failed"
fi
# A finished waste review waits for Hermes until Hermes deletes the file.
if [ -f /factory/home/review-pending ]; then echo "factory review ready: $(cat /factory/home/review-pending)"; fi
# Hermes repairs take minutes, so a pause older than an hour was forgotten or is stuck.
if [ -n "$(find /factory/home/paused -mmin +60 2>/dev/null)" ]; then echo "paused over an hour: $(cat /factory/home/paused)"; fi
