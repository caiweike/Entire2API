FROM node:24-bookworm-slim
WORKDIR /app
ARG TARGETARCH
RUN set -eu; \
    apt-get update; apt-get install -y --no-install-recommends ca-certificates curl; \
    case "${TARGETARCH:-amd64}" in \
      amd64) digest=bfc5c8d5b599f328775b89b735db020c963e307b6a324fc30ce371fe8fa789e8 ;; \
      arm64) digest=f08a1b8c6352d3f78076268dc67b0b273d7f62dbab94b15aec028e7b4257ad0c ;; \
      *) exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/entireio/cli/releases/download/v0.12.2/entire_linux_${TARGETARCH:-amd64}.tar.gz" -o /tmp/entire.tgz; \
    echo "$digest  /tmp/entire.tgz" | sha256sum -c -; \
    mkdir /tmp/entire; tar -xzf /tmp/entire.tgz -C /tmp/entire; \
    find /tmp/entire -type f -name entire -exec cp '{}' /usr/local/bin/entire \;; \
    chmod 755 /usr/local/bin/entire; \
    mkdir -p /data/state /data/entire; chown -R node:node /data
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
USER node
ENV HOST=0.0.0.0 PORT=8080 ENTIRE2API_CONFIG=/data/config.json STATE_DIR=/data/state \
    ENTIRE_CLI=/usr/local/bin/entire ENTIRE_CONFIG_DIR=/data/entire ENTIRE_TOKEN_STORE=file
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--use-env-proxy", "src/main.mjs"]
