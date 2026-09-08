# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Solo copiar manifests para cache de capas
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Fuente
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# git + openssh para auto-update
RUN apk add --no-cache git openssh-client ca-certificates

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY --from=build /app/dist ./dist
# entrypoint fuera del volumen /app para sobrevivir al montaje de sharkai-code
COPY docker-entrypoint.sh /opt/docker-entrypoint.sh

RUN chmod +x /opt/docker-entrypoint.sh

CMD ["/opt/docker-entrypoint.sh"]