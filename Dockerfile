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
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

CMD ["./docker-entrypoint.sh"]