# 달빛사주 웹 — 정적 빌드 + nginx (SPA fallback, /api 프록시)
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_API_BASE_URL=/api/v1
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY package.json package-lock.json ./
COPY packages/saju-core/package.json packages/saju-core/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @saju/web --include-workspace-root --ignore-scripts
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
RUN npm run build -w @saju/web

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
