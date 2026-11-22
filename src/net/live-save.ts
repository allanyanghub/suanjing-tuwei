/**
 * 游戏存档（src/core/save.ts 的 `save` 对象）与联网层之间的适配器。
 * 只读写进度字段（stars / wrong / agent / mapChoice / stats / rank）；`settings` 是本设备自己的设置，
 * 永远不上传，也不随玩家切换。写入是"原地替换字段"，游戏里持有的 `save` 引用一直有效。
 *
 * 这是 src/net 里唯一引用游戏存档模块的文件；单元测试不引用它。
 */
import { cleanRank, seedRank } from '../core/rank.ts';
import { persist, save, type WrongEntry } from '../core/save.ts';
import type { SaveBlob } from './api.ts';
import type { LiveSave } from './sync.ts';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export const gameLiveSave: LiveSave = {
  read(): SaveBlob {
    return JSON.parse(
      JSON.stringify({ stars: save.stars, wrong: save.wrong, agent: save.agent, mapChoice: save.mapChoice, stats: save.stats, rank: save.rank }),
    ) as SaveBlob;
  },
  write(d: SaveBlob): void {
    const c = JSON.parse(JSON.stringify(d)) as SaveBlob;
    save.stars = c.stars ?? {};
    save.wrong = (c.wrong ?? []) as unknown as WrongEntry[];
    save.agent = c.agent || 'ling';
    save.mapChoice = c.mapChoice ?? {};
    save.stats = { answered: num(c.stats?.answered), correct: num(c.stats?.correct), kills: num(c.stats?.kills), wins: num(c.stats?.wins) };
    save.rank = cleanRank(c.rank, () => seedRank(save.stats, save.stars));
    persist();
  },
};
