# Agent image: Claude Code with the ultrapack plugin, an entry script that links the game's project skills, plus the browser tooling the game's tests and builds need.
# The Playwright tag matches the playwright version in game/package-lock.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

# ffmpeg serves the game's sound scripts. Pillow serves the compare sheets of the Blender image skill. The X and GL libraries let Blender load in background mode.
# Graphviz renders the factory's process diagrams, which a factory change updates.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates xz-utils ffmpeg python3-pil graphviz \
    libgl1 libegl1 libx11-6 libxext6 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libice6 \
 && apt-get clean

# Blender builds the game's models from tools/blender/. The version matches the one the models were made with.
ARG BLENDER_VERSION=5.2.2
RUN curl -fsSL "https://download.blender.org/release/Blender${BLENDER_VERSION%.*}/blender-${BLENDER_VERSION}-linux-x64.tar.xz" | tar -xJ -C /opt \
 && ln -s "/opt/blender-${BLENDER_VERSION}-linux-x64/blender" /usr/local/bin/blender \
 && blender --background --factory-startup --version

RUN npm install -g @anthropic-ai/claude-code

COPY --chmod=755 factory-agent /usr/local/bin/factory-agent
COPY --chmod=755 factory-status /usr/local/bin/factory-status
COPY --chmod=755 factory-job /usr/local/bin/factory-job

# Everything below runs as the image's non-root user.
# Claude Code reaches only the Anthropic API, so the egress allowlist needs no telemetry hosts.
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

USER pwuser

# The mounted clone belongs to the host user, so git must trust it.
RUN git config --global user.name "ROAM Factory" \
 && git config --global user.email "factory@roam.invalid" \
 && git config --global --add safe.directory /work

# The Blender image skill is vendored at a pinned commit, see its SOURCE.md. Claude Code loads user skills from ~/.claude/skills.
COPY --chown=pwuser:pwuser skills/ /home/pwuser/.claude/skills/

RUN claude plugin marketplace add https://github.com/btseytlin/ultrapack.git \
 && claude plugin install up@ultrapack

# Factory commits carry no Claude co-author trailer.
RUN node -e 'const f=require("os").homedir()+"/.claude/settings.json";const fs=require("fs");const s=fs.existsSync(f)?JSON.parse(fs.readFileSync(f,"utf8")):{};s.attribution={commit:"",pr:""};s.includeCoAuthoredBy=false;fs.writeFileSync(f,JSON.stringify(s,null,2))'

WORKDIR /work
