/**
 * 专题 / 关卡目录（API.md §4）：登录后每次启动上传一次，内容没变时服务器不写库。
 * buildCatalog 是纯函数；由 index.ts 传入 ALL_TOPICS 和 LEVELS。
 */
import type { CatalogBody } from './api.ts';

const ID_RE = /^[A-Za-z0-9_-]+$/;
const name40 = (s: string) => Array.from(s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()).slice(0, 40).join('') || '未命名';
const gradeOk = (g: number) => g === 3 || g === 4 || g === 5 || g === 6;

export function buildCatalog(
  topics: readonly { id: string; grade: number; name: string }[],
  levels: readonly { id: string; grade: number; name: string; topicIds: readonly string[]; boss: boolean }[],
): CatalogBody {
  const seenT = new Set<string>();
  const outT: CatalogBody['topics'] = [];
  for (const t of topics) {
    if (!ID_RE.test(t.id) || t.id.length > 40 || seenT.has(t.id) || !gradeOk(t.grade)) continue;
    seenT.add(t.id);
    outT.push({ id: t.id, grade: t.grade, name: name40(t.name) });
    if (outT.length >= 400) break;
  }
  const seenL = new Set<string>();
  const outL: CatalogBody['levels'] = [];
  for (const l of levels) {
    if (!ID_RE.test(l.id) || l.id.length > 16 || seenL.has(l.id) || !gradeOk(l.grade)) continue;
    seenL.add(l.id);
    outL.push({
      id: l.id,
      grade: l.grade,
      name: name40(l.name),
      topicIds: l.topicIds.filter((x) => ID_RE.test(x) && x.length <= 40).slice(0, 60),
      boss: l.boss === true,
    });
    if (outL.length >= 400) break;
  }
  return { topics: outT, levels: outL };
}
