// Sound audit of a real game: plays a ship in headless Chrome in real time (autoplay, god mode)
// and accounts for every sound - sim events emitted, sounds started (recorded or synthesised),
// sounds dropped (the shot budget, repeat gaps), and how loud each gun actually is in the mix
// (level after MIX and distance, per weapon), plus how hard the master compressor works.
//
// Usage: node tools/dev/sfx-audit.mjs [seed=A1] [seconds=120] [speed=1]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const [seed = 'A1', secs = '120', speed = '1'] = process.argv.slice(2);
const ROOT = resolve(import.meta.dirname, '..', '..');
// No hot reload: an edit mid-run would reload the page and lose the counts.
const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0, hmr: false, watch: null } });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const tab = await browser.newPage();
await tab.setViewport({ width: 1280, height: 720 });
const errors = [];
tab.on('pageerror', (e) => errors.push(e.message));
tab.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errors.push(`${m.type()}: ${m.text()}`); });
await tab.goto(`${server.resolvedUrls.local[0]}index.html?seed=${seed}&go=1&autoplay=1&god=1&speed=${speed}`, { waitUntil: 'networkidle0' });
await tab.waitForFunction(() => window.__game?.world?.(), { timeout: 60000 });
await tab.evaluate(() => window.__game.command('noop')); // a gesture: unlocks the audio
const loaded = await tab.evaluate(async () => {
  const sfx = window.__game.sfx();
  const world = window.__game.world();
  await sfx.samples.ready;
  const A = window.__audit = { events: {}, shots: {}, calls: {}, dropped: {}, gapped: {}, played: {}, synth: {}, gain: {}, dist: {}, comp: [] };
  const inc = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
  const emit = world.emit.bind(world);
  world.emit = (type, e) => {
    inc(A.events, type);
    if (type === 'shot') inc(A.shots, e.weapon);
    return emit(type, e);
  };
  const gunshot = sfx.gunshot.bind(sfx);
  sfx.gunshot = (x, weapon) => {
    inc(A.calls, weapon);
    if (sfx.shotBudget > 14) inc(A.dropped, weapon);
    return gunshot(x, weapon);
  };
  // Level per sound: a tap after MIX and distance (pre-pan, pre-master), one analyser per key.
  const taps = {};
  const tap = (key) => {
    if (!taps[key]) { taps[key] = sfx.ctx.createAnalyser(); taps[key].fftSize = 1024; taps[key].buf = new Float32Array(1024); taps[key].peak = 0; taps[key].sum = 0; taps[key].n = 0; }
    return taps[key];
  };
  const play = sfx.play.bind(sfx);
  sfx.play = (key, x, vol = 1, opts = {}) => {
    const had = sfx.samples?.has(key) && !sfx.synthOnly;
    const before = sfx.lastPlay[key];
    const out = sfx.out.bind(sfx);
    sfx.out = (...a) => {
      const g = out(...a);
      g.connect(tap(key));
      inc(A.gain, key, g.gain.value);
      inc(A.dist, key, Math.abs((a[0] ?? sfx.cx) - sfx.cx));
      return g;
    };
    const r = play(key, x, vol, opts);
    sfx.out = out;
    if (!had) inc(A.synth, key);
    else if (sfx.lastPlay[key] === before && opts.gap) inc(A.gapped, key);
    else inc(A.played, key);
    return r;
  };
  window.__tick = () => {
    for (const [key, t] of Object.entries(taps)) {
      t.getFloatTimeDomainData(t.buf);
      let s = 0; let p = 0;
      for (const v of t.buf) { s += v * v; p = Math.max(p, Math.abs(v)); }
      t.peak = Math.max(t.peak, p);
      if (p > 0.003) { t.sum += s / t.buf.length; t.n++; }
    }
    A.comp.push(sfx.comp.reduction);
  };
  setInterval(window.__tick, 20);
  window.__levels = () => Object.fromEntries(Object.entries(taps).map(([k, t]) => [k, { peak: t.peak, rms: Math.sqrt(t.sum / Math.max(1, t.n)) }]));
  return Object.keys(sfx.samples.sounds).length;
});
console.log(`seed ${seed}, speed ${speed}: ${loaded} recorded sounds loaded`);
const t0 = Date.now();
let status = 'playing';
while (Date.now() - t0 < Number(secs) * 1000 && status === 'playing') {
  await new Promise((r) => setTimeout(r, 2000));
  status = await tab.evaluate(() => window.__game.state().status);
}
const r = await tab.evaluate(() => ({ A: window.__audit, levels: window.__levels(), time: window.__game.world().time, status: window.__game.state().status }));
const db = (v) => (20 * Math.log10(Math.max(v, 1e-5))).toFixed(1).padStart(6);
const { A } = r;
console.log(`sim time ${r.time.toFixed(0)} s, ${r.status}\n`);
console.log('GUNFIRE   shot events  sounds  dropped (budget)  recorded   level peak / rms (dB, after mix + distance)');
for (const w of Object.keys(A.shots)) {
  const L = r.levels[`shot_${w}`] ?? { peak: 0, rms: 0 };
  console.log(`${w.padEnd(10)} ${String(A.shots[w]).padStart(10)} ${String(A.calls[w] ?? 0).padStart(7)} ${String(A.dropped[w] ?? 0).padStart(10)} ${String(A.played[`shot_${w}`] ?? 0).padStart(15)}   ${db(L.peak)} / ${db(L.rms)}`);
}
console.log('\nSOUND            played  gapped  synth   mean gain  mean |dx|  peak / rms');
const keys = [...new Set([...Object.keys(A.played), ...Object.keys(A.gapped), ...Object.keys(A.synth)])].sort();
for (const k of keys) {
  const n = (A.played[k] ?? 0) + (A.gapped[k] ?? 0);
  const L = r.levels[k] ?? { peak: 0, rms: 0 };
  console.log(`${k.padEnd(16)} ${String(A.played[k] ?? 0).padStart(6)} ${String(A.gapped[k] ?? 0).padStart(7)} ${String(A.synth[k] ?? 0).padStart(6)}   ${((A.gain[k] ?? 0) / Math.max(1, A.played[k] ?? 0)).toFixed(3).padStart(9)} ${((A.dist[k] ?? 0) / Math.max(1, A.played[k] ?? 0)).toFixed(1).padStart(9)}   ${db(L.peak)} / ${db(L.rms)}`);
}
const comp = A.comp.filter((v) => v < -0.5);
console.log(`\ncompressor: reducing ${(100 * comp.length / A.comp.length).toFixed(0)}% of the time, mean ${(comp.reduce((s, v) => s + v, 0) / Math.max(1, comp.length)).toFixed(1)} dB, max ${Math.min(0, ...A.comp).toFixed(1)} dB`);
console.log(`\nevents: ${Object.entries(A.events).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(errors.length ? `\nerrors:\n${errors.join('\n')}` : '\nno errors');
await browser.close();
await server.close();
