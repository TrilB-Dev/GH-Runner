FROM node:24-alpine AS backend-builder
WORKDIR /backend
COPY backend/package.json backend/tsconfig.json ./
RUN npm install
COPY backend/src ./src
RUN npm run build && npm prune --production

FROM node:24-alpine AS ui-builder
WORKDIR /ui
COPY ui/package.json ui/package-lock.json ui/vite.config.ts ui/tsconfig.json ui/tsconfig.node.json ui/index.html ./
COPY ui/public ./public
COPY ui/src ./src
RUN npm ci
RUN npm run build

FROM node:24-alpine
RUN apk add --no-cache docker-cli
WORKDIR /app
COPY --from=backend-builder /backend/dist /backend
COPY --from=backend-builder /backend/node_modules /backend/node_modules
COPY --from=ui-builder /ui/dist /ui
LABEL org.opencontainers.image.title="GH Runner" \
    org.opencontainers.image.description="GH Runner is a Docker extension for managing Multiple Self-Hosted Github Repository Runners" \
    org.opencontainers.image.vendor="TrilB.Dev" \
    com.docker.desktop.extension.api.version="0.4.2" \
    com.docker.extension.screenshots="" \
    com.docker.desktop.extension.icon="https://trilb.dev/wp-content/uploads/2026/07/GH-Runner-Logo-Icon.svg" \
    com.docker.extension.detailed-description="" \
    com.docker.extension.publisher-url="https://trilb.dev/" \
    com.docker.extension.additional-urls="" \
    com.docker.extension.categories="" \
    com.docker.extension.changelog=""
COPY docker-compose.yaml /docker-compose.yaml
COPY metadata.json /metadata.json
COPY GH-Runner-Logo-Icon.svg /GH-Runner-Logo-Icon.svg
##COPY GH-Runner-Logo.svg /GH-Runner-Logo.svg
COPY Assets /Assets
CMD ["node", "/backend/server.js", "--socket", "/run/guest-services/backend.sock"]
