FROM node:24-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY bin ./bin
COPY README.md README.zh-CN.md LICENSE SECURITY.md ./

ENV PACTIUM_DATA_DIR=/data \
    PACTIUM_HTTP_HOST=127.0.0.1 \
    PACTIUM_HTTP_PORT=7288 \
    PACTIUM_HTTP_MAX_BODY_BYTES=1048576

RUN mkdir -p /data && useradd --system --create-home --home-dir /home/pactium pactium && chown -R pactium:pactium /data /app

USER pactium
EXPOSE 7288
VOLUME ["/data"]

CMD ["node", "bin/pactium.mjs", "serve", "--data-dir", "/data"]
