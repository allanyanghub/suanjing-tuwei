// 素材分析：时长、峰值、RMS、起音点（便于切片）。用法：node analyze.mjs <file>...
import { decode } from './io.mjs';
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
for (const f of process.argv.slice(2)) {
  const { sr, ch } = decode(f, 1);
  const x = ch[0];
  let pk = 0,
    s2 = 0;
  for (const v of x) {
    pk = Math.max(pk, Math.abs(v));
    s2 += v * v;
  }
  // 10 ms 帧能量，起音 = 能量比前 50ms 平均高 9dB 且超过 峰值-40dB
  const hop = Math.round(sr * 0.01);
  const env = [];
  for (let i = 0; i + hop <= x.length; i += hop) {
    let m = 0;
    for (let j = i; j < i + hop; j++) m = Math.max(m, Math.abs(x[j]));
    env.push(m);
  }
  const ons = [];
  let last = -99;
  for (let k = 5; k < env.length; k++) {
    let a = 0;
    for (let j = k - 5; j < k; j++) a += env[j];
    a /= 5;
    if (env[k] > a * 2.8 && env[k] > pk * 0.01 && k - last > 6) {
      // 本段峰值与持续时间（到降至该峰 -30dB）
      let p = 0,
        e = k;
      for (let j = k; j < Math.min(env.length, k + 30); j++) p = Math.max(p, env[j]);
      for (e = k; e < env.length && (env[e] > p * 0.03 || e < k + 3); e++);
      ons.push(`${(k * 0.01).toFixed(2)}s(${db(p)}dB,${((e - k) * 0.01).toFixed(2)}s)`);
      last = k;
    }
  }
  console.log(`${f.split('/').slice(-2).join('/')}: dur=${(x.length / sr).toFixed(2)} pk=${db(pk)} rms=${db(Math.sqrt(s2 / x.length))} onsets[${ons.length}]: ${ons.slice(0, 40).join(' ')}`);
}
