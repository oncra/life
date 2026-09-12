# Life oracle: Next.js app + worker in one image.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/src/generated ./src/generated
COPY package.json next.config.ts tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY content ./content
COPY public ./public
COPY src ./src
COPY scripts ./scripts
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
