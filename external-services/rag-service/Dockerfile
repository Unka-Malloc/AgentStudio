ARG NODE_BASE_IMAGE=node:24-bookworm-slim
FROM ${NODE_BASE_IMAGE}

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8788
ENV RAG_BACKEND_URL=

RUN mkdir -p /var/empty \
  && groupadd --system pactrag \
  && useradd --system --gid pactrag --home-dir /var/empty --no-create-home --shell /usr/sbin/nologin pactrag

WORKDIR /app
COPY external-service.config.json /app/external-service.config.json
COPY server.mjs /app/server.mjs

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8788) + '/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

USER pactrag

CMD ["node", "/app/server.mjs"]
