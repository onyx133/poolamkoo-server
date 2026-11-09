# syntax=docker/dockerfile:1

# ---- build: install all deps, generate the Prisma client, compile TypeScript ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY prisma.config.ts tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
RUN npm run build
# Drop dev dependencies. The generated client (src/generated) is compiled into dist/.
RUN npm prune --omit=dev

# ---- migrate: full dependencies incl. the prisma CLI; runs `prisma migrate deploy` ----
# Used by the one-shot `migrate` service in docker-compose.yml (owner role, not the app role).
FROM node:24-alpine AS migrate
ENV NODE_ENV=production
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime (default target; keep it last) ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
