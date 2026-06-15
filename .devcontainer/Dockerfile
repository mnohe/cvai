FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# ── System packages ───────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    bubblewrap \
    ripgrep \
    jq \
    openjdk-21-jdk \
    python3-pip \
    python3-venv \
    curl \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# ── Go ────────────────────────────────────────────────────────────────────────
# Upgrade: bump GO_VERSION. Downloads: https://go.dev/dl/
ARG GO_VERSION=1.26.4
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://dl.google.com/go/go${GO_VERSION}.linux-${ARCH}.tar.gz" \
        -o /tmp/go.tar.gz && \
    tar -C /usr/local -xzf /tmp/go.tar.gz && \
    rm /tmp/go.tar.gz
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOPATH="/home/vscode/go"
ENV PATH="${GOPATH}/bin:${PATH}"

# ── Node.js ───────────────────────────────────────────────────────────────────
# Upgrade: bump NODE_VERSION. Downloads: https://nodejs.org/en/download/
ARG NODE_VERSION=24.16.0
RUN ARCH=$(dpkg --print-architecture) && \
    case "${ARCH}" in \
        amd64) NODE_ARCH="x64" ;; \
        arm64) NODE_ARCH="arm64" ;; \
        *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
        -o /tmp/node.tar.xz && \
    tar -C /usr/local --strip-components=1 -xJf /tmp/node.tar.xz && \
    rm /tmp/node.tar.xz

# ── GitHub CLI ────────────────────────────────────────────────────────────────
# Upgrade: bump GH_VERSION. Releases: https://github.com/cli/cli/releases
ARG GH_VERSION=2.94.0
RUN ARCH=$(dpkg --print-architecture) && \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH}.tar.gz" \
        -o /tmp/gh.tar.gz && \
    tar -C /tmp -xzf /tmp/gh.tar.gz && \
    mv "/tmp/gh_${GH_VERSION}_linux_${ARCH}/bin/gh" /usr/local/bin/gh && \
    rm -rf /tmp/gh.tar.gz "/tmp/gh_${GH_VERSION}_linux_${ARCH}"

# ── Google Cloud CLI ──────────────────────────────────────────────────────────
# Upgrade: bump GCLOUD_VERSION. Release notes: https://cloud.google.com/sdk/docs/release-notes
ARG GCLOUD_VERSION=572.0.0
RUN ARCH=$(dpkg --print-architecture) && \
    case "${ARCH}" in \
        amd64) GCLOUD_ARCH="x86_64" ;; \
        arm64) GCLOUD_ARCH="arm" ;; \
        *) echo "Unsupported architecture: ${ARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-${GCLOUD_VERSION}-linux-${GCLOUD_ARCH}.tar.gz" \
        -o /tmp/gcloud.tar.gz && \
    tar -xf /tmp/gcloud.tar.gz -C /opt && \
    /opt/google-cloud-sdk/install.sh --quiet --path-update=false && \
    ln -s /opt/google-cloud-sdk/bin/gcloud /usr/local/bin/gcloud && \
    ln -s /opt/google-cloud-sdk/bin/gsutil /usr/local/bin/gsutil && \
    rm /tmp/gcloud.tar.gz

# ── Global npm tools ──────────────────────────────────────────────────────────
# Upgrade: bump versions. Runs as root so /usr/local/lib/node_modules is writable.
ARG FIREBASE_TOOLS_VERSION=15.20.0
ARG CLAUDE_CODE_VERSION=2.1.177
ARG CODEX_VERSION=0.139.0
ARG TYPESCRIPT_VERSION=5.9.3
RUN npm install -g \
    "firebase-tools@${FIREBASE_TOOLS_VERSION}" \
    "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    "@openai/codex@${CODEX_VERSION}" \
    "typescript@${TYPESCRIPT_VERSION}"
