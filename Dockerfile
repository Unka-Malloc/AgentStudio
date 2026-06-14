# ==============================================================================
# Pact Dockerfile
#
# Deployment preset index: server/config/deployment/index.json
# Base image: node:24-bookworm-slim
# Minimum supported: Node.js 22+  |  Recommended: Node.js 24
#
# Production Deployment Notes:
#   This image exposes plain HTTP on port 7228. For production use:
#   1) Terminate TLS via a reverse proxy (Caddy, Nginx, Traefik, or Ingress)
#   2) Deploy within an isolated network segment (VPC/private subnet)
#   3) Inject secrets via environment variables or external KMS/Vault
#   4) Enable Operation Ledger archival for audit compliance
#   5) Implement regular backups for /opt/pact/data volume
# ==============================================================================
ARG NODE_BASE_IMAGE=node:24-bookworm-slim
FROM ${NODE_BASE_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json vite.config.ts ./

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN npm config set registry "${NPM_REGISTRY}" \
    && npm_config_build_from_source=true npm_config_nodedir=/usr/local npm ci --foreground-scripts --loglevel=info \
      --fetch-retries=5 \
      --fetch-retry-factor=2 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=300000 \
      --fetch-timeout=600000

COPY server ./server
COPY server-web ./server-web

RUN npm run build:renderer:raw
RUN npm prune --omit=dev

# ── runtime-deps stage ────────────────────────────────────────────────────────
# Download JRE (Temurin 21) and Apache Tika once so they are baked into the image.
# Versions are pinned here; update them whenever setup-local-runtime.mjs changes.
FROM ${NODE_BASE_IMAGE} AS runtime-deps

ARG JRE_VERSION=21.0.10+7
ARG TARGETARCH
ARG JRE_URL=
ARG JRE_URL_AMD64=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_x64_linux_hotspot_21.0.10_7.tar.gz
ARG JRE_URL_ARM64=https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.10%2B7/OpenJDK21U-jre_aarch64_linux_hotspot_21.0.10_7.tar.gz
ARG REQUIRE_RUNTIME_CHECKSUMS=0
ARG JRE_SHA256=
ARG JRE_SHA256_AMD64=
ARG JRE_SHA256_ARM64=
ARG TIKA_VERSION=3.2.3
ARG TIKA_URL=https://repo.maven.apache.org/maven2/org/apache/tika/tika-app/${TIKA_VERSION}/tika-app-${TIKA_VERSION}.jar
ARG TIKA_SHA256=

# Download and unpack JRE
# Strict checksum check runs BEFORE download to avoid wasting time.
RUN set -eux; \
    mkdir -p /modules/jre /modules/tika; \
    selected_jre_url="${JRE_URL}"; \
    selected_jre_sha="${JRE_SHA256}"; \
    if [ -z "${selected_jre_url}" ]; then \
      case "${TARGETARCH}" in \
        amd64) selected_jre_url="${JRE_URL_AMD64}"; selected_jre_sha="${JRE_SHA256:-${JRE_SHA256_AMD64}}";; \
        arm64) selected_jre_url="${JRE_URL_ARM64}"; selected_jre_sha="${JRE_SHA256:-${JRE_SHA256_ARM64}}";; \
        *) echo "ERROR: unsupported Docker TARGETARCH for JRE: ${TARGETARCH}" && exit 1;; \
      esac; \
    fi; \
    if [ "${REQUIRE_RUNTIME_CHECKSUMS}" = "1" ] && [ -z "${selected_jre_sha}" ]; then echo "ERROR: REQUIRE_RUNTIME_CHECKSUMS=1 but JRE_SHA256 is empty" && exit 1; fi; \
    if [ "${REQUIRE_RUNTIME_CHECKSUMS}" = "1" ] && [ -z "${TIKA_SHA256}" ]; then echo "ERROR: REQUIRE_RUNTIME_CHECKSUMS=1 but TIKA_SHA256 is empty" && exit 1; fi; \
    node -e "const fs=require('node:fs');const url=process.argv[1];const out=process.argv[2];(async()=>{let last;for(let attempt=1;attempt<=3;attempt+=1){try{const response=await fetch(url);if(!response.ok)throw new Error('HTTP '+response.status+' '+response.statusText);const body=Buffer.from(await response.arrayBuffer());fs.writeFileSync(out,body);return}catch(error){last=error;if(attempt<3)console.error('download retry '+attempt+': '+error.message)}}throw last})()" "${selected_jre_url}" /tmp/jre.tar.gz; \
    if [ -n "${selected_jre_sha}" ]; then echo "${selected_jre_sha}  /tmp/jre.tar.gz" | sha256sum -c || exit 1; fi; \
    tar -xzf /tmp/jre.tar.gz -C /modules/jre --strip-components=1; \
    /modules/jre/bin/java -version; \
    rm /tmp/jre.tar.gz

# Download Tika jar
# Strict checksum check runs BEFORE download to avoid wasting time.
RUN node -e "const fs=require('node:fs');const url=process.argv[1];const out=process.argv[2];(async()=>{let last;for(let attempt=1;attempt<=3;attempt+=1){try{const response=await fetch(url);if(!response.ok)throw new Error('HTTP '+response.status+' '+response.statusText);const body=Buffer.from(await response.arrayBuffer());fs.writeFileSync(out,body);return}catch(error){last=error;if(attempt<3)console.error('download retry '+attempt+': '+error.message)}}throw last})()" "${TIKA_URL}" /modules/tika/tika-app-${TIKA_VERSION}.jar \
    && if [ -n "${TIKA_SHA256}" ]; then echo "${TIKA_SHA256}  /modules/tika/tika-app-${TIKA_VERSION}.jar" | sha256sum -c || exit 1; fi

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM ${NODE_BASE_IMAGE} AS runtime

ENV NODE_ENV=production \
    CODEX_HOME=/codex-home \
    PATH=/app/node_modules/.bin:$PATH

RUN groupadd --system --gid 10001 pact \
    && useradd --system --uid 10001 --gid pact --home-dir /home/pact --create-home --shell /usr/sbin/nologin pact

WORKDIR /app

COPY --chown=pact:pact --from=build /app/package.json /app/package-lock.json ./
COPY --chown=pact:pact --from=build /app/node_modules ./node_modules
COPY --chown=pact:pact --from=build /app/build/dist ./build/dist
COPY --chown=pact:pact --from=build /app/server ./server
COPY --chown=pact:pact --from=runtime-deps /modules/jre ./server/platform/modules/knowledge/runtime/jre/current
COPY --chown=pact:pact --from=runtime-deps /modules/tika ./server/platform/modules/knowledge/tika

RUN node -e "const fs=require('node:fs');const config=JSON.parse(fs.readFileSync('./server/config/runtime/default-settings.json','utf8'));if(config.javaBinPath!=='/app/server/platform/modules/knowledge/runtime/jre/current/bin/java')throw new Error('bad javaBinPath');if(config.tikaJarPath!=='/app/server/platform/modules/knowledge/tika/tika-app-3.2.3.jar')throw new Error('bad tikaJarPath');"

RUN mkdir -p /opt/pact/data /codex-home \
    && chown -R pact:pact /opt/pact /codex-home

USER pact

EXPOSE 7228

VOLUME ["/opt/pact/data"]

CMD ["node", "server/scripts/start-server.mjs", "--with-ui", "--host", "0.0.0.0", "--port", "7228", "--data-dir", "/opt/pact/data", "--allow-public-console"]
