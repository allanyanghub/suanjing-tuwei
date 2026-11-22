/**
 * 专题 / 关卡目录。服务器不引用客户端代码，目录由客户端启动时上传（PUT /api/catalog），存成一行 JSON。
 * 没上传过目录时，所有功能照常工作，只是名字显示为原始 id。
 */
import { HttpError, cleanText, isObj, type Env, type Route } from '../http.ts';

export interface CatalogTopic {
  id: string;
  grade: number;
  name: string;
}
export interface CatalogLevel {
  id: string;
  grade: number;
  name: string;
  topicIds: string[];
  boss: boolean;
}
export interface Catalog {
  topics: CatalogTopic[];
  levels: CatalogLevel[];
  updatedAt: number;
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_ITEMS = 400;

function validGradeStrict(v: unknown): number {
  if (v === 3 || v === 4 || v === 5 || v === 6) return v;
  throw new HttpError(400, '目录里的年级不正确');
}

function validName(v: unknown): string {
  if (typeof v !== 'string') throw new HttpError(400, '目录里的名字不正确');
  const s = cleanText(v, false);
  if (!s || Array.from(s).length > 40) throw new HttpError(400, '目录里的名字不正确');
  return s;
}

function validId(v: unknown): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, '目录里的编号不正确');
  return v;
}

export function parseCatalog(b: Record<string, unknown>): Omit<Catalog, 'updatedAt'> {
  if (!Array.isArray(b.topics) || !Array.isArray(b.levels)) throw new HttpError(400, '目录需要包含 topics 和 levels');
  if (b.topics.length > MAX_ITEMS || b.levels.length > MAX_ITEMS) throw new HttpError(413, '目录太大');
  const topics: CatalogTopic[] = [];
  const seenT = new Set<string>();
  for (const t of b.topics) {
    if (!isObj(t)) throw new HttpError(400, '目录格式不正确');
    const id = validId(t.id);
    if (seenT.has(id)) throw new HttpError(400, `目录里专题重复：${id}`);
    seenT.add(id);
    topics.push({ id, grade: validGradeStrict(t.grade), name: validName(t.name) });
  }
  const levels: CatalogLevel[] = [];
  const seenL = new Set<string>();
  for (const l of b.levels) {
    if (!isObj(l)) throw new HttpError(400, '目录格式不正确');
    const id = validId(l.id);
    if (id.length > 16) throw new HttpError(400, '目录里的关卡编号太长');
    if (seenL.has(id)) throw new HttpError(400, `目录里关卡重复：${id}`);
    seenL.add(id);
    if (!Array.isArray(l.topicIds) || l.topicIds.length > 60) throw new HttpError(400, '目录里的关卡专题不正确');
    levels.push({ id, grade: validGradeStrict(l.grade), name: validName(l.name), topicIds: l.topicIds.map(validId), boss: l.boss === true });
  }
  return { topics, levels };
}

/** 带内存缓存的目录读取 */
export class CatalogStore {
  private env: Env;
  private cached: Catalog | null | undefined;
  private topicMap = new Map<string, CatalogTopic>();
  private levelMap = new Map<string, CatalogLevel>();

  constructor(env: Env) {
    this.env = env;
  }

  get(): Catalog | null {
    if (this.cached === undefined) {
      const row = this.env.db.q('SELECT data, updated_at FROM catalog WHERE id = 1').get() as { data: string; updated_at: number } | undefined;
      this.cached = null;
      if (row) {
        try {
          const c = parseCatalog(JSON.parse(row.data));
          this.cached = { ...c, updatedAt: row.updated_at };
        } catch {
          this.cached = null;
        }
      }
      this.topicMap = new Map((this.cached?.topics ?? []).map((t) => [t.id, t]));
      this.levelMap = new Map((this.cached?.levels ?? []).map((l) => [l.id, l]));
    }
    return this.cached;
  }

  put(c: Omit<Catalog, 'updatedAt'>): boolean {
    const json = JSON.stringify(c);
    const row = this.env.db.q('SELECT data FROM catalog WHERE id = 1').get() as { data: string } | undefined;
    if (row?.data === json) return false;
    this.env.db.q('INSERT INTO catalog (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').run(json, this.env.now());
    this.cached = undefined;
    return true;
  }

  topic(id: string): CatalogTopic | undefined {
    this.get();
    return this.topicMap.get(id);
  }

  level(id: string): CatalogLevel | undefined {
    this.get();
    return this.levelMap.get(id);
  }

  topicName(id: string): string {
    if (id === 'custom') return '家长出题';
    return this.topic(id)?.name ?? id;
  }

  levelName(id: string): string {
    return this.level(id)?.name ?? id;
  }

  /** 关卡所属年级：优先查目录，没有目录时按 "年级-序号" 的编号规则猜 */
  levelGrade(id: string): number | null {
    const l = this.level(id);
    if (l) return l.grade;
    const m = /^([3-6])-\d+$/.exec(id);
    return m ? Number(m[1]) : null;
  }
}

export function catalogRoutes(store: CatalogStore): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/catalog',
      handler: () => {
        const c = store.get();
        return c ? { catalog: c } : { catalog: null };
      },
    },
    {
      method: 'PUT',
      path: '/api/catalog',
      handler: async (c) => {
        c.auth();
        const parsed = parseCatalog(await c.body(256_000));
        const changed = store.put(parsed);
        return { ok: true, changed, topics: parsed.topics.length, levels: parsed.levels.length };
      },
    },
  ];
}
