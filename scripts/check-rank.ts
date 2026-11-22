/** 段位规则自检：node --experimental-strip-types scripts/check-rank.ts */
import assert from 'node:assert/strict';
import { KING_START, TIER_START, allDivisions, applyDelta, matchDelta, mergeRank, rankView, seedRank } from '../src/core/rank.ts';

// 阶梯
assert.deepEqual(TIER_START, [0, 9, 18, 30, 42, 57, 72]);
assert.equal(KING_START, 72);
assert.equal(rankView(0).label, '青铜 III');
assert.equal(rankView(2).full, '青铜 III · 2 星');
assert.equal(rankView(3).label, '青铜 II');
assert.equal(rankView(8).full, '青铜 I · 2 星');
assert.equal(rankView(9).label, '白银 III');
assert.equal(rankView(18).label, '黄金 III');
assert.equal(rankView(29).full, '黄金 I · 3 星');
assert.equal(rankView(71).full, '星耀 I · 4 星');
assert.equal(rankView(72).full, '王者 · 0 星');
assert.equal(rankView(80).full, '王者 · 8 星');
assert.equal(allDivisions().length, 19);

// 加减星
const d = (w: boolean, a: number, c: number) => matchDelta(w, a, c).delta;
assert.equal(d(true, 10, 9), 2);
assert.equal(d(true, 10, 6), 1);
assert.equal(d(true, 10, 4), 0);
assert.equal(d(false, 10, 8), 0);
assert.equal(d(false, 10, 6), -1);
assert.equal(d(false, 10, 1), -1);
assert.equal(d(false, 0, 0), -1);
assert.equal(d(true, 0, 0), 0);

// 保段：不掉大段，但大段内可以掉小段
let r = { pts: 9, best: 9, n: 0 };
r = applyDelta(r, -1);
assert.equal(r.pts, 9, '白银 III 0 星不会掉回青铜');
assert.equal(r.n, 1);
r = applyDelta({ pts: 12, best: 12, n: 3 }, -1);
assert.equal(r.pts, 11, '白银 II 0 星可以掉到白银 III');
r = applyDelta({ pts: 0, best: 0, n: 0 }, -1);
assert.equal(r.pts, 0);
r = applyDelta({ pts: 17, best: 17, n: 0 }, 2);
assert.equal(rankView(r.pts).label, '黄金 III');
assert.equal(r.best, 19);
r = applyDelta({ pts: 72, best: 75, n: 9 }, -1);
assert.equal(r.pts, 72, '王者不掉段');
assert.equal(r.best, 75);

// 合并：局数多的胜出
assert.deepEqual(mergeRank({ pts: 5, best: 10, n: 4 }, { pts: 8, best: 8, n: 3 }), { pts: 5, best: 10, n: 4 });
assert.deepEqual(mergeRank({ pts: 5, best: 5, n: 3 }, { pts: 8, best: 8, n: 3 }), { pts: 8, best: 8, n: 3 });

// 老存档补段位，最高补到黄金 III
assert.deepEqual(seedRank({ wins: 3 }, { a: 3, b: 2, c: 1 }), { pts: 5, best: 5, n: 0 });
assert.equal(seedRank({ wins: 40 }, { a: 3 }).pts, 18);

console.log('段位规则 OK');
