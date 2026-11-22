/**
 * 家长管理页面（单文件，内联 CSS/JS，无外部资源）。
 * 页面源码放在同目录的 admin.html 里，避免在 TypeScript 模板字符串里转义反斜杠、反引号和 ${。
 * Docker 镜像会复制整个 server/src，所以这个文件一定在。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ADMIN_HTML: string = readFileSync(join(import.meta.dirname, 'admin.html'), 'utf8');
