FROM node:22-slim

WORKDIR /app

COPY server.mjs /app/server.mjs
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 8788

ENTRYPOINT ["/app/start.sh"]
