#!/bin/bash
# Deploys GitHub's main when main moved. roam-factory-update.timer runs it as the factory user.
# Usage: factory-update.sh <factory root>
# It builds the new commit in its own folder, releases/<sha>, then swaps the link releases/current. It never stops a job and never waits for one.
# A tick and its jobs stay in the release they started in. After the swap, the script removes each old release that no process works in.
# It records the deployed commit in $home/deployed. A failure leaves the reason in $home/update-failed, which Hermes's incident watch prints, and leaves releases/current alone.
set -euo pipefail
root=$(cd "${1:?factory root}" && pwd -P)
repo=$root/repo
releases=$root/releases
home=$root/home
env_file=$root/factory.env
failed=$home/update-failed
building=

log() { echo "$(date +%FT%T%z) $*"; }
# The reason has no time, so a retry that fails the same way does not wake Hermes again.
fail() {
  log "failed: $*"
  echo "$*" >"$failed"
  if [ -n "$building" ]; then
    git -C "$repo" worktree remove --force "$building" || log "could not remove $building, the next deploy retries"
  fi
  exit 1
}

# The folders of all running processes, one path per line. Only the factory user's own processes matter, and they include every job.
# FACTORY_CWD_LIST names a file with such a list, for tests on a host without /proc.
cwds() {
  if [ -n "${FACTORY_CWD_LIST:-}" ]; then
    cat "$FACTORY_CWD_LIST"
    return
  fi
  readlink /proc/self/cwd >/dev/null
  # One readlink per process, since the server's uutils readlink stops at the first unreadable link, like a root process.
  local link
  for link in /proc/[0-9]*/cwd; do
    readlink "$link" 2>/dev/null || true
  done
}

# Succeeds when one of the folders in $2 is $1 or lies inside it.
in_use() {
  local line
  while IFS= read -r line; do
    case $line in "$1" | "$1"/*) return 0 ;; esac
  done <<<"$2"
  return 1
}

# Removes every release but the current and the previous one that no process works in. A release it cannot remove stays for the next deploy.
# The previous release stays one more deploy, since a tick that resolved the link just before the swap may not have entered it yet.
prune() {
  local busy dir
  if ! busy=$(cwds); then
    log "prune skipped, the process folders are unreadable"
    return
  fi
  for dir in "$releases"/*; do
    [ -d "$dir" ] && [ ! -L "$dir" ] || continue
    [ "$dir" != "$releases/$(readlink "$releases/current")" ] && [ "$dir" != "$releases/$deployed" ] || continue
    if in_use "$dir" "$busy"; then
      log "keep ${dir##*/}, a process works in it"
    else
      git -C "$repo" worktree remove --force "$dir" && log "removed ${dir##*/}" || log "could not remove ${dir##*/}, the next deploy retries"
    fi
  done
  git -C "$repo" worktree prune
}

cd "$repo"
timeout 120 git fetch --quiet origin main
target=$(git rev-parse origin/main)
deployed=$(cat "$home/deployed")
[ "$target" != "$deployed" ] || exit 0

# A hand edit in the running release would be left behind, so the update stops and leaves it for Hermes.
edits=$(git -C "$releases/current" status --porcelain)
[ -z "$edits" ] || fail "the code checkout has local edits, so main ${target:0:7} is not deployed: $(echo "$edits" | head -n 3 | tr '\n' ' ')"

release=$releases/$target
if [ "$(readlink "$releases/current")" != "$target" ]; then
  changed=$(git diff --name-only "$deployed" "$target")
  # A release left by a failed run is never current, so it is safe to build again.
  [ ! -e "$release" ] || git worktree remove --force "$release"
  building=$release
  git worktree add --quiet --detach "$release" "$target"
  ln -sfn "$env_file" "$release/factory/.env"
  if [ -d "$release/factory/dashboard" ]; then
    ln -sfn "$root/dashboard/dashboard.env" "$release/factory/dashboard/.env"
  fi
  log "built ${target:0:7}"
  log "npm ci"
  (cd "$release/factory" && timeout 900 npm ci) || fail "npm ci failed at ${target:0:7}"
  image=$(grep '^FACTORY_IMAGE=' "$release/factory/settings.env" | cut -d= -f2-)
  if grep -qE '^factory/docker/' <<<"$changed"; then
    log "build agent and proxy images"
    timeout 1800 docker build -q -t "$image" "$release/factory/docker" || fail "agent image build failed at ${target:0:7}"
    timeout 600 docker build -q -t "$image-proxy" "$release/factory/docker/proxy" || fail "proxy image build failed at ${target:0:7}"
  fi
  if grep -qE '^factory/(hermes/|settings\.env$)' <<<"$changed"; then
    log "rebuild Hermes"
    (cd "$release" && FACTORY_HERMES_DIR=$root/hermes FACTORY_UID=$(id -u) FACTORY_CODE_SOURCE=$root FACTORY_CODE_TARGET=$root \
      timeout 900 docker compose -f factory/hermes/compose.yaml --env-file factory/settings.env --env-file factory/.env \
      up -d --build --remove-orphans --wait --wait-timeout 180) || fail "Hermes rebuild failed at ${target:0:7}"
  fi
  building=
  # The temp link and mv -T replace the link in one step, so a reader sees the old release or the new one.
  ln -sfn "$target" "$releases/current.new"
  mv -T "$releases/current.new" "$releases/current"
  log "switched to ${target:0:7}"
  touch "$home/dashboard-restart"
fi

echo "$target" >"$home/deployed"
rm -f "$failed"
log "deployed ${target:0:7}"
prune
