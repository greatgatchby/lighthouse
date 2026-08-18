# Lighthouse — one image, three commands:
#   node server.js   (Next.js app, default)
#   node worker.js   (pg-boss worker)
#   node migrate.js  (one-shot migrations)

FROM node:24-alpine AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next needs *some* values at build; real ones come from the environment at runtime
ENV DATABASE_URL="postgres://build:build@localhost:5432/build"
ENV SESSION_SECRET="build-time-placeholder"
ENV TOKEN_ENC_KEY="0000000000000000000000000000000000000000000000000000000000000000"
RUN pnpm build && pnpm worker:build && pnpm migrate:build

FROM node:24-alpine AS runner
# pg_dump for the nightly backup job
RUN apk add --no-cache postgresql17-client
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/dist/worker.js ./worker.js
COPY --from=build /app/dist/migrate.js ./migrate.js
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/backup.sh ./scripts/backup.sh
RUN mkdir -p storage && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
