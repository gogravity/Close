# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
# Install production + dev deps needed for the Next.js build.
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---------- runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for the container.
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# The Next.js standalone build drops a tiny self-contained server here, plus
# static assets and the public dir. pdf-parse + pdfjs-dist are externalized
# (see next.config.ts) so copy node_modules/pdf-parse explicitly.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone        ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static            ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public                  ./public
COPY --from=build --chown=nextjs:nodejs /app/node_modules/pdf-parse  ./node_modules/pdf-parse
COPY --from=build --chown=nextjs:nodejs /app/node_modules/pdfjs-dist ./node_modules/pdfjs-dist

# Writable data dir for encrypted settings + local master key. In Azure
# Container Apps, mount an Azure Files volume here so settings survive
# container restarts. Locally, Docker will create an anonymous volume.
RUN mkdir -p /app/.data && chown -R nextjs:nodejs /app/.data
VOLUME ["/app/.data"]

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
