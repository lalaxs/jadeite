FROM node:24.20.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM dependencies AS static
COPY public ./public
COPY shared ./shared
COPY scripts/build-static.mjs ./scripts/build-static.mjs
ARG APP_VERSION
RUN APP_VERSION=${APP_VERSION} node scripts/build-static.mjs

FROM caddy:2.11.4-alpine AS web
COPY --from=static /app/dist/static /srv
COPY ops/Caddyfile /etc/caddy/Caddyfile

FROM node:24.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json server.js ./
COPY public ./public
COPY server ./server
COPY shared ./shared
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
