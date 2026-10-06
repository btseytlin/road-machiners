#!/bin/bash
# Sets up the code folders under the factory root. deploy.py runs it as root. It is safe to run again.
# Usage: factory-layout.sh <factory root> <factory user>
# The layout is repo (the git clone), releases/<sha> (one detached worktree per deployed commit), releases/current (a link to one of them) and code (a link to releases/current).
# The factory user cannot write the root, so root makes code once and the update script only swaps releases/current.
# A server that still has a real code folder is migrated. Jobs that run in it keep working, since a moved folder is still their working folder.
set -euo pipefail
root=$(cd "${1:?factory root}" && pwd -P)
user=${2:?factory user}
repo=$root/repo
releases=$root/releases
home=$root/home
env_file=$root/factory.env
code=$root/code

log() { echo "$(date +%FT%T%z) $*"; }
as_factory() { sudo -u "$user" -H "$@"; }

if [ -d "$code" ] && [ ! -L "$code" ]; then
  [ ! -e "$repo/.git" ] || { echo "both $code and $repo are git folders, move one by hand" >&2; exit 1; }
  # No tick or update starts while the folder moves. The trap starts the tick timer again, also when a step fails.
  # The installed update script is the old one and would break the links, so deploy.py starts the update timer after it pushes the new script.
  trap 'systemctl start roam-factory-tick.timer' EXIT
  systemctl stop roam-factory-tick.timer roam-factory-update.timer roam-factory-update.service
  # The old update script pauses the factory while it waits for jobs. The new code never pauses for an update, and it would read that pause as Hermes's.
  if [ -f "$home/paused" ] && grep -q '^update to' "$home/paused"; then
    log "lift the pause of the old update: $(cat "$home/paused")"
    rm "$home/paused"
  fi
  log "move the code folder to $repo"
  [ ! -d "$repo" ] || rmdir "$repo"
  mv "$code" "$repo"
  if [ -e "$repo/factory/.env" ]; then
    [ ! -e "$env_file" ] || { echo "$env_file exists, so $repo/factory/.env cannot move there" >&2; exit 1; }
    mv "$repo/factory/.env" "$env_file"
  fi
fi

mkdir -p "$releases"
chown "$user:$user" "$releases"

if [ ! -f "$home/deployed" ]; then
  as_factory git -C "$repo" rev-parse HEAD | as_factory tee "$home/deployed" > /dev/null
fi
sha=$(cat "$home/deployed")
release=$releases/$sha
if [ ! -e "$release" ]; then
  log "make the release ${sha:0:7}"
  as_factory git -C "$repo" worktree add --detach "$release" "$sha"
fi
as_factory ln -sfn "$env_file" "$release/factory/.env"
if [ ! -d "$release/factory/node_modules" ]; then
  log "npm ci"
  (cd "$release/factory" && as_factory timeout 900 npm ci)
fi

if [ ! -L "$releases/current" ]; then
  as_factory ln -sfn "$sha" "$releases/current.new"
  as_factory mv -T "$releases/current.new" "$releases/current"
fi
[ -L "$code" ] || ln -s releases/current "$code"
log "layout ready at ${sha:0:7}"
