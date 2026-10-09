#!/bin/bash
# Prints the open factory incidents, one per line and without times, so the output changes only when an incident opens or closes.
# Hermes runs it every minute and wakes when the output changes.
set -euo pipefail
# GitHub and the factory server can hang, so each call to them runs under a time limit. A whole run then ends well inside the one-minute schedule.
gh_seconds=${FACTORY_WATCH_GH_SECONDS:-20}
audit_seconds=${FACTORY_WATCH_AUDIT_SECONDS:-30}
# A source that keeps failing this long while its last answer repeats gets an incident line of its own.
down_minutes=10
saved="${0%.sh}.saved"
mkdir -p "$saved"

# Prints the lines of one source and saves them. A failed or timed-out source prints its saved lines instead.
# Hermes diffs the whole output, so a dropped line would read as a closed incident.
# With no saved lines, or after down_minutes of failures, it adds "<name> failed since <time>". The time holds until the source answers, so Hermes wakes once per outage.
from_source() {
  local name=$1 out
  shift
  if out=$("$@"); then
    if [ -n "$out" ]; then printf '%s\n' "$out"; fi
    printf '%s' "${out:+$out$'\n'}" > "$saved/$name.tmp"
    mv "$saved/$name.tmp" "$saved/$name"
    rm -f "$saved/$name.down"
    return
  fi
  if [ ! -f "$saved/$name.down" ]; then date -u +%Y-%m-%dT%H:%M:%SZ > "$saved/$name.down"; fi
  if [ -f "$saved/$name" ]; then cat "$saved/$name"; fi
  if [ ! -f "$saved/$name" ] || [ -n "$(find "$saved/$name.down" -mmin +"$down_minutes")" ]; then
    echo "$name failed since $(cat "$saved/$name.down")"
  fi
}

# Every open stuck issue, past gh's default of 30, with the stuck sweep's kind from the state. The kind holds for one incident,
# so a line changes only when a new failure comes or the sweep leaves the card to Hermes.
stuck() {
  local list
  list=$(timeout -k 5 "$gh_seconds" gh issue list -R "$FACTORY_REPO" --label factory-stuck --state open --limit 1000 --json number,title) || return
  jq -r --slurpfile state /factory/home/state/state.json '.[] | ($state[0].stuck // {})[.number | tostring].kind as $kind | "stuck #\(.number) \(.title)" + (if $kind then " (sweep: \($kind))" else "" end)' <<<"$list" | sort
}

# Each drift between the stores of one card or of the release. Audit lines hold no times, so each prints once.
# A quick failure, like one ssh or GitHub error, runs once more. A timeout does not, so the run keeps inside its minute.
drift() {
  local audit status=0
  audit=$(timeout -k 5 "$audit_seconds" factory audit 2>/dev/null) || status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 124 ] && [ "$status" -ne 137 ]; then
    status=0
    audit=$(timeout -k 5 "$audit_seconds" factory audit 2>/dev/null) || status=$?
  fi
  if [ "$status" -ne 0 ]; then return "$status"; fi
  if [ -n "$audit" ]; then printf '%s\n' "$audit" | sed 's/^/drift: /'; fi
}

from_source "stuck list" stuck
# Each failed job of the last day, with its first error line and log. The log name holds the start time, so each failure prints once.
jq -r '.failures // [] | .[] | "failed \(.stage)\(if .issue then " #\(.issue)" else "" end): \(.error | split("\n")[0]) (log \(.log // "none"))"' /factory/home/state/state.json
jq -r '.lastTickError // empty | "tick crash: " + (split("\n")[0])' /factory/home/state/state.json
jq -r '.sweepError // empty | "stuck sweep failed: " + (split("\n")[0])' /factory/home/state/state.json
# The line names the commit and the first line of what broke, so Hermes fixes dev or reverts the merge that broke it.
jq -r 'select(.devFailed != null) | "dev build failed at \(.devFailed)" + (if .devError then ": " + (.devError | split("\n")[0]) else "" end)' /factory/home/state/state.json
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
from_source audit drift
# A shipped release waits for Hermes's draft of its public post. The line goes once the draft is in the committee chat.
jq -r '.releasePost // empty | select(.postId == null) | "release post due: release \(.day)"' /factory/home/state/state.json
# A finished waste review waits for Hermes until Hermes deletes the file.
if [ -f /factory/home/review-pending ]; then echo "factory review ready: $(cat /factory/home/review-pending)"; fi
# The error service writes one line per cap it hits, with the day, and Hermes deletes the file once handled.
if [ -f /factory/home/error-reports/alert ]; then cat /factory/home/error-reports/alert; fi
# Hermes repairs take minutes, so a pause older than an hour was forgotten or is stuck.
if [ -n "$(find /factory/home/paused -mmin +60 2>/dev/null)" ]; then echo "paused over an hour: $(cat /factory/home/paused)"; fi
