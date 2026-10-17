// NaN/Inf hunter. Plays a real-time autoplay run and counts non-finite pixels in the HDR scene
// buffer each frame, just before the post chain (bloom turns one such pixel into a big black
// box for a frame). Slow - it reads the whole buffer back every frame.
//
// Usage: node tools/dev/nanhunt.mjs [seconds] [--off]   (--off: flashlights off)
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '..', '..');
const secs = Number(process.argv[2] ?? 30);
const lightsOn = !process.argv.includes('--off');
const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
await server.listen();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--use-angle=d3d11'], defaultViewport: { width: 1600, height: 900 } });
const tab = await browser.newPage();
tab.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') console.log('[console]', m.text().slice(0, 200)); });
await tab.goto(`${server.resolvedUrls.local[0]}index.html?seed=DEMO1&go=1&autoplay=1&god=1`, { waitUntil: 'load' });
await tab.waitForFunction('window.__game?.world?.()');
await tab.evaluate((lightsOn) => {
  const w = window.__game.world(); const v = window.__game.view();
  w.settings.flashlight = lightsOn;
  const r = v.renderer; const pass = r.composer.passes[1];
  const orig = pass.render.bind(pass);
  let buf = null;
  window.__nan = { frames: 0, bad: [], maxV: 0, type: null };
  const half = (h) => { const e = (h >> 10) & 31, m = h & 1023; return e === 0 ? m * 2 ** -24 : e === 31 ? Infinity : (1 + m / 1024) * 2 ** (e - 15); };
  pass.render = (renderer, writeBuffer, readBuffer, dt, mask) => {
    const W = readBuffer.width, H = readBuffer.height;
    window.__nan.type = readBuffer.texture.type;
    if (!buf || buf.length !== W * H * 4) buf = new Uint16Array(W * H * 4);
    renderer.readRenderTargetPixels(readBuffer, 0, 0, W, H, buf);
    let bad = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, maxV = 0;
    for (let i = 0; i < buf.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const h = buf[i + c];
        if ((h & 0x7c00) === 0x7c00) { bad++; const p = i / 4; const x = p % W, y = (p / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); break; }
        const val = half(h & 0x7fff); if (val > maxV) maxV = val;
      }
    }
    window.__nan.frames++;
    window.__nan.maxV = Math.max(window.__nan.maxV, maxV);
    if (bad) window.__nan.bad.push({ t: +w.time.toFixed(3), bad, box: [x0, y0, x1, y1], maxV: Math.round(maxV) });
    orig(renderer, writeBuffer, readBuffer, dt, mask);
  };
}, lightsOn);
await new Promise((res) => setTimeout(res, secs * 1000));
const out = await tab.evaluate(() => window.__nan);
await browser.close(); await server.close();
console.log(`flashlights ${lightsOn ? 'ON' : 'OFF'}: frames ${out.frames}, texture type ${out.type}, frames with Inf/NaN ${out.bad.length}, max finite value ${out.maxV.toFixed(0)}`);
for (const b of out.bad.slice(0, 25)) console.log(' ', JSON.stringify(b));
