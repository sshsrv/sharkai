# Build stage: clona el repo de GitHub y compila (auto-update en cada build)
FROM node:20-alpine AS build
ARG GIT_REPO=https://github.com/sshsrv/sharkai.git
ARG GIT_BRANCH=main
WORKDIR /app
RUN apk add --no-cache git && \
    git clone --depth 1 -b ${GIT_BRANCH} ${GIT_REPO} . && \
    npm ci || npm install && \
    npm run build

# Runtime stage
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
RUN apk add --no-cache git openssh-client ca-certificates
# copiar node_modules sin dev deps + dist compilado
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh /opt/docker-entrypoint.sh
RUN chmod +x /opt/docker-entrypoint.sh
CMD ["/opt/docker-entrypoint.sh"]
