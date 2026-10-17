// Loudness of every game sound at the master bus, recorded vs synthesised, in headless Chrome
// (/sfx.html's events). For balancing MIX in src/audio/sfx.js against what the game had.
//
// Usage: node tools/dev/sfx-levels.mjs
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const tab = await browser.newPage();
const errors = [];
tab.on('pageerror', (e) => errors.push(e.message));
tab.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
await tab.goto(`${server.resolvedUrls.local[0]}sfx.html`, { waitUntil: 'networkidle0' });
await tab.mouse.click(5, 5);
const res = await tab.evaluate(async () => {
  const sfx = window.__sfx;
  await sfx.samples.ready;
  const loaded = Object.keys(sfx.samples.sounds).length;
  const an = sfx.ctx.createAnalyser();
  an.fftSize = 2048;
  sfx.master.connect(an);
  const buf = new Float32Array(an.fftSize);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const listen = async (ms) => {
    let peak = 0; let sum = 0; let n = 0;
    const t1 = performance.now() + ms;
    while (performance.now() < t1) {
      an.getFloatTimeDomainData(buf);
      for (const v of buf) { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; }
      await sleep(20);
    }
    return { peak, rms: Math.sqrt(sum / Math.max(1, n)) };
  };
  const db = (v) => (20 * Math.log10(Math.max(v, 1e-5))).toFixed(1).padStart(6);
  const buttons = [...document.querySelectorAll('[data-ev]')];
  const rows = [];
  // Ambience alone first (beds / drone), then the events with the ambience off.
  const mode = (m) => document.querySelector(`[data-mode="${m}"]`).click();
  const amb = {};
  for (const m of ['rec', 'synth']) { mode(m); await sleep(2500); amb[m] = await listen(3000); }
  rows.push(`${'ambience'.padEnd(24)} ${db(amb.rec.peak)} ${db(amb.rec.rms)}   | ${db(amb.synth.peak)} ${db(amb.synth.rms)}`);
  document.querySelector('#amb').click();
  await sleep(1500);
  for (const b of buttons) {
    if (/alarm|Won|Marine down/.test(b.textContent)) continue;
    const r = {};
    for (const m of ['rec', 'synth']) {
      mode(m);
      await sleep(300);
      b.click();
      r[m] = await listen(/burst|Footsteps|Airlock/.test(b.textContent) ? 2200 : 1200);
      await sleep(400);
    }
    rows.push(`${b.textContent.padEnd(24)} ${db(r.rec.peak)} ${db(r.rec.rms)}   | ${db(r.synth.peak)} ${db(r.synth.rms)}`);
  }
  return { loaded, state: sfx.ctx.state, rows };
});
console.log(`context ${res.state}, ${res.loaded} recorded sounds decoded`);
console.log(`${'event'.padEnd(24)}  recorded: peak   rms  |  synth: peak   rms   (dBFS at the master bus)`);
console.log(res.rows.join('\n'));
if (errors.length) console.log('\nerrors:\n' + errors.join('\n'));
await browser.close();
await server.close();
