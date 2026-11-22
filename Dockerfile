# 算境突围：一个容器同时提供游戏网页和存档/登录接口
# ---- 第一阶段：构建游戏网页 ----
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json ./
COPY vite.config.* ./
COPY public ./public
COPY src ./src
COPY scripts ./scripts
# scripts/online 的单元测试引用了 server/src/save.ts，构建前的类型检查（tsc --noEmit）需要它
COPY server/src ./server/src
RUN npm run build

# ---- 第二阶段：运行（服务端只用 Node 内置模块，不需要安装依赖）----
FROM node:26-alpine
WORKDIR /app/server
COPY server/package.json ./
COPY server/src ./src
COPY --from=build /app/dist /app/dist
# TZ 决定"今天""本周"和可玩时间段；默认北京时间，可在 docker run / compose 里覆盖
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data STATIC_DIR=/app/dist TZ=Asia/Shanghai
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "src/main.ts"]
