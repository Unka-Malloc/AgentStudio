# ==============================================================================
# Pact Dockerfile
#
# Node 版本口径 (Node.js Version Specification):
#   - 最低支持版本 (Minimum supported): Node.js 22+
#   - 推荐/Docker 运行环境 (Recommended / Docker runtime): Node.js 24 (本镜像基于 node:24-bookworm-slim)
#
# 生产部署安全警告 (Production Deployment Warning):
#   - 生产门禁未关闭前不建议对外宣称生产可用。
#   - 生产环境不得直接复用本机 HTTP 配置，必须采取以下加固策略：
#     1) HTTPS 反向代理 (Caddy/Nginx/Ingress 终止并启用 HTTPS)
#     2) 受控网段 (隔离直接端口访问)
#     3) 密钥管理 (外部环境变量或安全 Key 注入)
#     4) 审计归档 (Operation Ledger 日志审计与导出)
#     5) 备份恢复策略 (元数据库与存储灾备)
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
