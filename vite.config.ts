import { defineConfig } from 'vite';

// base: './' —— 构建产物使用相对路径，可以部署到 NAS 上的任意子目录（例如 http://nas.local/games/suanjing/）
export default defineConfig({
  base: './',
});
