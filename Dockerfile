# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@11.1.3 --activate

WORKDIR /app

FROM base AS build-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM build-dependencies AS build

COPY . .
RUN pnpm build
ENV CATALOG_DATABASE_PATH=/app/image-data/catalog.sqlite \
    CONVERSATION_DATABASE_PATH=/app/image-data/conversations.sqlite \
    LEGACY_DATABASE_PATH=/app/image-data/role-player.sqlite
RUN node --disable-warning=ExperimentalWarning \
    dist/server/initialize-deployment-databases.js

FROM base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM base AS runtime

ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=3001 \
    CLIENT_ORIGIN=http://localhost:3001 \
    SERVE_STATIC=true \
    STATIC_CLIENT_PATH=dist/client \
    CATALOG_DATABASE_PATH=/app/data/catalog.sqlite \
    CONVERSATION_DATABASE_PATH=/app/data/conversations.sqlite \
    LEGACY_DATABASE_PATH=/app/data/role-player.sqlite

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/image-data ./data
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

USER node

VOLUME ["/app/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "const secure=Boolean(process.env.TLS_CERT_PATH);const client=require(secure?'node:https':'node:http');const request=client.get({host:'127.0.0.1',port:process.env.SERVER_PORT||3001,path:'/api/health',rejectUnauthorized:false},response=>process.exit(response.statusCode===200?0:1));request.on('error',()=>process.exit(1));request.setTimeout(4000,()=>request.destroy());"]

ENTRYPOINT ["./docker-entrypoint.sh"]
