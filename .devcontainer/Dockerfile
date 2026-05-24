FROM alpine:3.23

ARG USERNAME=vscode
ARG USER_UID=1000
ARG USER_GID=1000
ARG TYPST_VERSION=0.14.2

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV SHELL=/bin/bash

RUN apk add --no-cache \
    bash \
    bubblewrap \
    ca-certificates \
    curl \
    docker-cli \
    fontconfig \
    freetype \
    gcompat \
    git \
    harfbuzz \
    jq \
    make \
    nss \
    openssh-client \
    perl \
    py3-pip \
    python3 \
    ripgrep \
    shadow \
    tar \
    xz \
  && update-ca-certificates

RUN groupadd -g "${USER_GID}" "${USERNAME}" \
  && useradd -m -u "${USER_UID}" -g "${USER_GID}" -s /bin/bash "${USERNAME}"

RUN arch="$(uname -m)" \
  && case "${arch}" in \
      x86_64) typst_arch="x86_64-unknown-linux-musl" ;; \
      aarch64) typst_arch="aarch64-unknown-linux-musl" ;; \
      *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;; \
    esac \
  && curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${typst_arch}.tar.xz" -o /tmp/typst.tar.xz \
  && mkdir -p /tmp/typst \
  && tar -xJf /tmp/typst.tar.xz -C /tmp/typst --strip-components=1 \
  && install -m 0755 /tmp/typst/typst /usr/local/bin/typst \
  && rm -rf /tmp/typst /tmp/typst.tar.xz

COPY requirements.txt /tmp/webui-requirements.txt

RUN pip3 install --break-system-packages --no-cache-dir -r /tmp/webui-requirements.txt \
  && rm -f /tmp/webui-requirements.txt

WORKDIR /workspaces/cvai
