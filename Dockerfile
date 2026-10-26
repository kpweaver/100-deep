# 100 Deep server image: the native Angband engine + WebSocket bridge +
# built client, in hosted (multi-session) mode.
#
#   docker build -t 100-deep .
#   docker run -p 8787:8787 -v 100-deep-data:/data 100-deep
#
# Requires the engine/upstream submodule to be checked out in the build
# context (git submodule update --init).

# ---- build: engine (C) and client (Vite) ---------------------------------
FROM node:24-bookworm AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake build-essential libncurses-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json package-lock.json ./
COPY shared/protocol/package.json shared/protocol/
COPY bridge/package.json bridge/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund
COPY . .
RUN test -f engine/upstream/src/game-world.c \
    || (echo "engine/upstream is missing: run 'git submodule update --init' before building" && exit 1)
RUN sh scripts/build-engine.sh && npm run build:client
# Runtime needs only the bridge's production dependencies
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---- runtime ---------------------------------------------------------------
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    LANG=C.UTF-8 \
    THANG_MODE=hosted \
    THANG_HOST=0.0.0.0 \
    THANG_PORT=8787 \
    THANG_DATA=/data \
    THANG_ENGINE=/app/build/engine/angband-headless \
    THANG_LIB=/app/lib \
    THANG_CLIENT_DIR=/app/client/dist
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/shared ./shared
COPY --from=build /src/bridge ./bridge
COPY --from=build /src/build/engine/angband-headless ./build/engine/angband-headless
# The game's data (engine/lib, our fork of Angband's) and the Gervais tiles
COPY --from=build /src/engine/lib ./lib
COPY --from=build /src/engine/upstream/docs/copying.rst ./engine/upstream/docs/copying.rst
COPY --from=build /src/client/dist ./client/dist
COPY LICENSES.md README.md ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bridge/src/index.ts"]
