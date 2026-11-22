// 音频读写：用 ffmpeg 解码任意格式为 Float32（单声道或立体声），写出 WAV / 编码 MP3
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SR = 48000;

/** 解码为 { sr, ch: Float32Array[] }，channels = 1 或 2 */
export function decode(path, channels = 1, sr = SR) {
  const out = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(channels), '-ar', String(sr), '-'], {
    maxBuffer: 1 << 30,
  });
  const all = new Float32Array(out.buffer, out.byteOffset, out.byteLength / 4);
  const n = all.length / channels;
  const ch = [];
  for (let c = 0; c < channels; c++) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = all[i * channels + c];
    ch.push(a);
  }
  return { sr, ch };
}

/** 写 32 位浮点 WAV */
export function writeWav(path, { sr, ch }) {
  mkdirSync(dirname(path), { recursive: true });
  const n = ch[0].length,
    nc = ch.length;
  const buf = Buffer.alloc(44 + n * nc * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * nc * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20);
  buf.writeUInt16LE(nc, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * nc * 4, 28);
  buf.writeUInt16LE(nc * 4, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * nc * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++) {
      buf.writeFloatLE(ch[c][i], o);
      o += 4;
    }
  writeFileSync(path, buf);
}

/** 编码 MP3（VBR 质量 q：0 最好 … 9 最差）；sr 默认 44100 */
export function encodeMp3(wavPath, mp3Path, { q = 4, sr = 44100, mono = false } = {}) {
  mkdirSync(dirname(mp3Path), { recursive: true });
  const args = ['-v', 'error', '-y', '-i', wavPath, '-ar', String(sr)];
  if (mono) args.push('-ac', '1');
  args.push('-c:a', 'libmp3lame', '-q:a', String(q), mp3Path);
  const r = spawnSync('ffmpeg', args);
  if (r.status !== 0) throw new Error('ffmpeg mp3 失败: ' + r.stderr);
}
