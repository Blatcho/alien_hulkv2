// Decode every candidate sound in headless Chrome (WebAudio) and find the separate events in
// each file - single shots in a burst, single steps in a walk, hisses in a long session - with
// their loudness and brightness. Writes tools/out/sfx-src/analysis.json for build-sfx.mjs.
//
// Usage: node tools/audio/analyze-sfx.mjs [substring filter]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'tools', 'out', 'sfx-src');
const filter = process.argv[2] ?? '';

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(SRC).map((f) => relative(ROOT, f).replace(/\\/g, '/')).filter((f) => /\.(mp3|ogg|wav)$/i.test(f) && f.includes(filter));

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
await server.listen();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const tab = await browser.newPage();
await tab.goto(`${server.resolvedUrls.local[0]}index.html`, { waitUntil: 'domcontentloaded' });
// A filtered run updates those files' entries and keeps the rest.
const OUT = join(SRC, 'analysis.json');
const out = filter && existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
for (let i = 0; i < files.length; i += 20) {
  const batch = files.slice(i, i + 20);
  const res = await tab.evaluate(async (batch) => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const db = (v) => +(20 * Math.log10(Math.max(v, 1e-6))).toFixed(1);
    const result = {};
    for (const f of batch) {
      try {
        const buf = await ctx.decodeAudioData(await (await fetch(`/${f}`)).arrayBuffer());
        const sr = buf.sampleRate;
        const ch = [...Array(buf.numberOfChannels).keys()].map((c) => buf.getChannelData(c));
        const n = buf.length;
        const mono = new Float32Array(n);
        for (const c of ch) for (let k = 0; k < n; k++) mono[k] += c[k] / ch.length;
        // 10 ms RMS envelope + zero-crossing rate (a brightness proxy).
        const W = Math.round(sr * 0.01);
        const env = [];
        const zcr = [];
        for (let s = 0; s < n; s += W) {
          let e = 0; let z = 0;
          const end = Math.min(n, s + W);
          for (let k = s; k < end; k++) { e += mono[k] * mono[k]; if (k > s && (mono[k] >= 0) !== (mono[k - 1] >= 0)) z++; }
          env.push(Math.sqrt(e / Math.max(1, end - s)));
          zcr.push(z / Math.max(1, end - s) * sr / 2);
        }
        const peakEnv = Math.max(...env);
        let peak = 0;
        for (let k = 0; k < n; k++) peak = Math.max(peak, Math.abs(mono[k]));
        const sorted = [...env].sort((a, b) => a - b);
        const floor = sorted[Math.floor(sorted.length * 0.1)];
        const on = Math.max(peakEnv * 0.12, floor * 4);
        const off = Math.max(peakEnv * 0.03, floor * 2);
        const segs = [];
        let cur = null;
        env.forEach((v, j) => {
          if (!cur && v > on) cur = { a: j, b: j };
          else if (cur && v > off) cur.b = j;
          else if (cur && j - cur.b > 6) { segs.push(cur); cur = null; }
        });
        if (cur) segs.push(cur);
        const segments = segs.filter((g) => g.b - g.a >= 2).map((g) => {
          const sl = env.slice(g.a, g.b + 1);
          const rms = Math.sqrt(sl.reduce((s, v) => s + v * v, 0) / sl.length);
          const bright = zcr.slice(g.a, g.b + 1).reduce((s, v) => s + v, 0) / sl.length;
          return { s: +(Math.max(0, g.a - 0.5) * 0.01).toFixed(3), e: +((g.b + 1) * 0.01).toFixed(3), peak: db(Math.max(...sl)), rms: db(rms), bright: Math.round(bright) };
        });
        const rmsAll = Math.sqrt(env.reduce((s, v) => s + v * v, 0) / env.length);
        result[f] = { dur: +buf.duration.toFixed(3), sr, channels: buf.numberOfChannels, peak: db(peak), rms: db(rmsAll), floor: db(floor), segments: segments.slice(0, 60), nSegments: segments.length };
      } catch (err) { result[f] = { error: String(err) }; }
    }
    return result;
  }, batch);
  Object.assign(out, res);
  process.stdout.write(`${Math.min(files.length, i + 20)}/${files.length}\r`);
}
await browser.close();
await server.close();
writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`\nanalysed ${files.length} files -> tools/out/sfx-src/analysis.json`);
