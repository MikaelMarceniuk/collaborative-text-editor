# Build context is the repo root (pnpm workspace): flyctl deploy . --config apps/server/fly.toml

FROM node:24-slim AS base
RUN npm install -g pnpm@12.15.0
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --filter @collaborative-text-editor/server...
COPY apps/server apps/server
RUN pnpm --filter @collaborative-text-editor/server build

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod --filter @collaborative-text-editor/server...

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# pnpm links apps/server/node_modules into the root node_modules/.pnpm store, so both are needed
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY apps/server/package.json ./apps/server/
WORKDIR /app/apps/server
USER node
EXPOSE 3333

# Env comes from Fly (secrets + [env]), not from a .env file
CMD ["node", "dist/server.js"]
