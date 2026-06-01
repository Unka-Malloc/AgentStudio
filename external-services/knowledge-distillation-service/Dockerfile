FROM node:24-bookworm

ARG TIKA_VERSION=3.2.3
ARG TIKA_APP_URL=

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
  && curl -fsSL "${TIKA_APP_URL:-https://repo1.maven.org/maven2/org/apache/tika/tika-app/${TIKA_VERSION}/tika-app-${TIKA_VERSION}.jar}" -o /opt/tika/tika-app.jar

WORKDIR /app
COPY server.mjs /app/server.mjs
COPY reference-frameworks.json /app/reference-frameworks.json
COPY format-routes.json /app/format-routes.json

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8799
ENV SERVICE_DATA_DIR=/data
ENV TIKA_APP_JAR=/opt/tika/tika-app.jar

RUN mkdir -p /data

EXPOSE 8799
CMD ["node", "/app/server.mjs"]
