# syntax=docker/dockerfile:1
# Hermes with the factory config, identity, plugin and a start script. All of them are in the image, so a deploy that changes one rebuilds and restarts Hermes.
# They live in /opt/hermes-factory, because the server mounts its factory folder at /opt/factory and that mount would hide them.
# v2026.9.24 is the first release with gpt-6-sol on the Codex provider.
FROM nousresearch/hermes-agent:v2026.9.24

# Hermes starts as root, fixes the ownership of its state and drops to uid 10000.
USER root

# Hermes manages the factory, so it needs gh and jq besides the git the image has.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gh jq \
 && apt-get clean

# The idle session reset plugin, at the commit the Hermes plugin catalog pins (v0.2.0). The start script copies it into the Hermes home.
ARG SESSION_RESET_POLICY_REF=bb618e0
RUN git clone https://github.com/fastfinge/hermes-session-reset-policy.git /opt/hermes-factory/hermes-session-reset-policy \
 && git -C /opt/hermes-factory/hermes-session-reset-policy checkout --detach "$SESSION_RESET_POLICY_REF" \
 && rm -rf /opt/hermes-factory/hermes-session-reset-policy/.git

COPY config.yaml /opt/hermes-factory/config.yaml
COPY SOUL.md /opt/hermes-factory/SOUL.md
COPY --chmod=755 factory-incidents.sh /opt/hermes-factory/factory-incidents.sh
COPY plugin /opt/hermes-factory/plugin
COPY --chmod=755 factory-host /usr/local/bin/factory-host

# The image supervises the gateway with s6, and the gateway reads its env from $HERMES_HOME/.env.
# So the start script writes the repo's config, identity and committee allow list there, then hands over.
COPY --chmod=755 <<'EOF2' /usr/local/bin/factory-start
#!/bin/sh
set -eu
cp /opt/hermes-factory/SOUL.md "$HERMES_HOME/SOUL.md"
mkdir -p "$HERMES_HOME/scripts"
cp /opt/hermes-factory/factory-incidents.sh "$HERMES_HOME/scripts/factory-incidents.sh"
# A fresh copy each start, so no file of an older plugin stays behind.
rm -rf "$HERMES_HOME/plugins/factory"
mkdir -p "$HERMES_HOME/plugins"
cp -r /opt/hermes-factory/plugin "$HERMES_HOME/plugins/factory"
rm -rf "$HERMES_HOME/plugins/hermes-session-reset-policy"
cp -r /opt/hermes-factory/hermes-session-reset-policy "$HERMES_HOME/plugins/hermes-session-reset-policy"
# The repo config, with the settings Hermes changed itself kept on top.
python3 "$HERMES_HOME/plugins/factory/config_sync.py" /opt/hermes-factory/config.yaml
python3 "$HERMES_HOME/plugins/factory/allowlist.py"
# Hermes never passes GH_TOKEN to its shell, since a model provider uses that name. So gh saves the login in the Hermes home, and git asks gh.
printenv GH_TOKEN | env -u GH_TOKEN gh auth login --with-token
env -u GH_TOKEN gh auth setup-git
git config --global user.name "ROAM Factory Hermes"
git config --global user.email "hermes@roam.invalid"
# The incident watch wakes Hermes when the list of open incidents changes. SOUL.md holds what to do, so the job itself never changes.
if ! hermes cron list --all | grep -q factory-incidents; then
  hermes cron create "every 1m" "The list of open factory incidents changed. The monitor diff shows how. Follow the Incidents section of your instructions. If the change is only an incident going away, respond with [SILENT]." \
    --name factory-incidents --monitor-script factory-incidents.sh --deliver "telegram:$FACTORY_COMMITTEE_CHAT" --failure-deliver "telegram:$FACTORY_COMMITTEE_CHAT"
fi
exec hermes gateway run
EOF2
