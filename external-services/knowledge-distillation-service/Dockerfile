FROM node:24-bookworm

ARG TIKA_VERSION=3.2.3
ARG TIKA_APP_URL=
ARG TIKA_APP_SHA512=5908760c8506d6d1f2c37b59b21b513c2451960b471dde0b353d0ac825a3ea6a809714e0651de9883f8257444b2a8c56c6982a55fed74b5e5840261aa893b650

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    default-jre-headless \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-eng \
    7zip \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/tika \
  && curl -fsSL "${TIKA_APP_URL:-https://repo1.maven.org/maven2/org/apache/tika/tika-app/${TIKA_VERSION}/tika-app-${TIKA_VERSION}.jar}" -o /opt/tika/tika-app.jar \
  && echo "${TIKA_APP_SHA512}  /opt/tika/tika-app.jar" | sha512sum -c -

RUN mkdir -p /var/empty \
  && groupadd --system pactkd \
  && useradd --system --gid pactkd --home-dir /var/empty --no-create-home --shell /usr/sbin/nologin pactkd

WORKDIR /app
COPY server.mjs /app/server.mjs
COPY reference-frameworks.json /app/reference-frameworks.json
COPY format-routes.json /app/format-routes.json
COPY parser-strategies.json /app/parser-strategies.json
COPY format-conversion-profiles.json /app/format-conversion-profiles.json
COPY model-distillation-profiles.json /app/model-distillation-profiles.json

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8799
ENV SERVICE_DATA_DIR=/data
ENV PACT_EXTERNAL_KD_INPUT_ROOTS=/inputs
ENV TIKA_APP_JAR=/opt/tika/tika-app.jar
ENV PACT_EXTERNAL_KD_REQUIRE_API_TOKEN=1
ENV PACT_EXTERNAL_KD_ALLOW_UNAUTHENTICATED_DEV=0

RUN mkdir -p /data /inputs \
  && chown -R pactkd:pactkd /data /inputs /app

EXPOSE 8799
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8799) + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
USER pactkd
CMD ["node", "/app/server.mjs"]
