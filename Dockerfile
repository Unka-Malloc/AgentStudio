# ==============================================================================
# Pact Dockerfile
#
# Base image: node:24-bookworm-slim
# Minimum supported: Node.js 22+  |  Recommended: Node.js 24
#
# Production Deployment Notes:
#   This image exposes plain HTTP on port 7228. For production use:
#   1) Terminate TLS via a reverse proxy (Caddy, Nginx, Traefik, or Ingress)
#   2) Deploy within an isolated network segment (VPC/private subnet)
#   3) Inject secrets via environment variables or external KMS/Vault
#   4) Enable Operation Ledger archival for audit compliance
#   5) Implement regular backups for /data volume
# ==============================================================================
FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json vite.config.ts ./
COPY server ./server
COPY server-web ./server-web

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm ci
RUN npm run build:renderer:raw
RUN npm prune --omit=dev

# ── runtime-deps stage ────────────────────────────────────────────────────────
# Download JRE (Temurin 21) and Apache Tika once so they are baked into the image.
# Versions are pinned here; update them whenever setup-local-runtime.mjs changes.
FROM debian:bookworm-slim AS runtime-deps

ARG JRE_VERSION=21.0.10+7
ARG JRE_FILENAME=OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz
ARG JRE_URL=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/${JRE_FILENAME}
ARG REQUIRE_RUNTIME_CHECKSUMS=0
ARG JRE_SHA256=
ARG TIKA_VERSION=3.2.3
ARG TIKA_URL=https://repo.maven.apache.org/maven2/org/apache/tika/tika-app/${TIKA_VERSION}/tika-app-${TIKA_VERSION}.jar
ARG TIKA_SHA256=

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Download and unpack JRE
# Strict checksum check runs BEFORE download to avoid wasting time.
RUN mkdir -p /modules/jre /modules/tika \
    && if [ "${REQUIRE_RUNTIME_CHECKSUMS}" = "1" ] && [ -z "${JRE_SHA256}" ]; then echo "ERROR: REQUIRE_RUNTIME_CHECKSUMS=1 but JRE_SHA256 is empty" && exit 1; fi \
    && curl -fsSL --retry 3 "${JRE_URL}" -o /tmp/jre.tar.gz \
    && if [ -n "${JRE_SHA256}" ]; then echo "${JRE_SHA256}  /tmp/jre.tar.gz" | sha256sum -c || exit 1; fi \
    && tar -xzf /tmp/jre.tar.gz -C /modules/jre --strip-components=1 \
    && rm /tmp/jre.tar.gz

# Download Tika jar
# Strict checksum check runs BEFORE download to avoid wasting time.
RUN if [ "${REQUIRE_RUNTIME_CHECKSUMS}" = "1" ] && [ -z "${TIKA_SHA256}" ]; then echo "ERROR: REQUIRE_RUNTIME_CHECKSUMS=1 but TIKA_SHA256 is empty" && exit 1; fi \
    && curl -fsSL --retry 3 "${TIKA_URL}" -o /modules/tika/tika-app-${TIKA_VERSION}.jar \
    && if [ -n "${TIKA_SHA256}" ]; then echo "${TIKA_SHA256}  /modules/tika/tika-app-${TIKA_VERSION}.jar" | sha256sum -c || exit 1; fi

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PACT_SERVER_HOST=0.0.0.0 \
    PACT_SERVER_PORT=7228 \
    PACT_SERVER_DATA_DIR=/data \
    PACT_SERVER_WITH_UI=1 \
    CODEX_HOME=/codex-home \
    PATH=/app/node_modules/.bin:$PATH

RUN groupadd --system --gid 10001 pact \
    && useradd --system --uid 10001 --gid pact --home-dir /home/pact --create-home --shell /usr/sbin/nologin pact

WORKDIR /app

COPY --chown=pact:pact --from=build /app/package.json /app/package-lock.json ./
COPY --chown=pact:pact --from=build /app/node_modules ./node_modules
COPY --chown=pact:pact --from=build /app/build/dist ./build/dist
COPY --chown=pact:pact --from=build /app/server ./server
COPY --chown=pact:pact --from=runtime-deps /modules ./server/modules

RUN mkdir -p /data /codex-home \
    && chown -R pact:pact /data /codex-home

USER pact

EXPOSE 7228

CMD ["node", "server/scripts/start-server.mjs", "--with-ui", "--host", "0.0.0.0", "--port", "7228", "--data-dir", "/data"]
