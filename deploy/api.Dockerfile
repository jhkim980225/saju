# 달빛사주 API — 운영 이미지
# 빌드: docker build -f deploy/api.Dockerfile -t dalbitsaju-api .
FROM node:22-bookworm-slim AS build
# better-sqlite3 네이티브 모듈 컴파일용 (빌드 단계에만)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/saju-core/package.json packages/saju-core/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @saju/api --include-workspace-root --ignore-scripts && npm rebuild better-sqlite3
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @saju/api

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 HOST=0.0.0.0 DATABASE_PATH=/data/saju.db
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/api/package.json apps/api/package.json
WORKDIR /app/apps/api
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
