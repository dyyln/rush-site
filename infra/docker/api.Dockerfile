# syntax=docker/dockerfile:1.7
# Multi-stage build for apps/api from the pnpm workspace root.
# Build context is the repo root.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_HOME=/corepack
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Root manifests. pnpm version comes from packageManager in package.json.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
RUN corepack install

# Full dependency install. Workspace packages build themselves in prepare, so sources are needed here.
FROM manifests AS build
COPY tsconfig*.json ./
COPY packages packages
COPY apps/api apps/api
# Sibling manifests keep the frozen lockfile consistent.
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@rushsite/api..."
RUN pnpm --filter "@rushsite/api..." run --if-present build
# Collect build output without dev node_modules.
RUN mkdir -p /out \
 && tar -cf - --exclude=node_modules packages apps/api | tar -xf - -C /out

# Production dependencies only. Scripts are skipped since build tools are absent.
FROM manifests AS prod-deps
COPY packages packages
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@rushsite/api..." \
 && find packages -mindepth 2 -maxdepth 2 ! -name node_modules ! -name package.json -exec rm -rf {} +

FROM manifests AS runner
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0
COPY --from=prod-deps /app ./
COPY --from=build /out ./
RUN chmod -R a+rX /corepack && chown -R node:node /app
USER node
WORKDIR /app/apps/api
# Commit stamp shown in /admin. Last so a new commit only changes this layer.
ARG BUILD_SHA=
ARG BUILD_SUBJECT=
ARG BUILD_TIME=
ENV BUILD_SHA=$BUILD_SHA BUILD_SUBJECT=$BUILD_SUBJECT BUILD_TIME=$BUILD_TIME
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
# Runs pending drizzle migrations on boot when DB_MIGRATE_ON_START is true.
CMD ["node", "dist/server.js"]
