# kravla-service — headless crawl service.
#
# Sizing note: KRAVLA_MEMORY_MBYTES (default 1024) is Crawlee's internal
# autoscaled-pool budget per crawl, NOT a container limit — set the container
# memory limit separately and leave headroom for MAX_CONCURRENT_CRAWLS
# concurrent runners plus the V8 heap itself.
FROM oven/bun:1-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY packages/service/package.json packages/service/
RUN bun install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
RUN bun run build

FROM oven/bun:1-slim
WORKDIR /app
ENV NODE_ENV=production
# Crawlee >=3.17 defaults systemInfoV2 on; its memory snapshotter spawns `ps`,
# which the slim base image lacks (procps).
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/service/package.json packages/service/
RUN bun install --frozen-lockfile --production
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/service/dist packages/service/dist

# Crawlee needs a writable scratch dir for its per-call mkdtemp storage
# (persistStorage is off; do NOT set CRAWLEE_STORAGE_DIR). /tmp is writable
# for the non-root `bun` user that ships with the base image.
USER bun
EXPOSE 8080
CMD ["bun", "packages/service/dist/index.js"]
