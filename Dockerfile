# Orrery: a living 3D observatory for your Proxmox homelab.
# The server is plain Python 3 (standard library only), so the image is tiny.
FROM python:3.12-alpine

LABEL org.opencontainers.image.title="Orrery" \
      org.opencontainers.image.description="A living, 3D observatory for your Proxmox homelab" \
      org.opencontainers.image.source="https://github.com/prognar/Orrery" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

RUN adduser -D -u 1000 orrery && mkdir -p /data && chown orrery:orrery /data
WORKDIR /app
COPY VERSION templates.json ./
COPY app ./app

ENV ORRERY_DATA=/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
USER orrery
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO /dev/null http://127.0.0.1:${ORRERY_PORT:-8080}/api/next/setup/state || exit 1
CMD ["python3", "/app/app/server.py"]
