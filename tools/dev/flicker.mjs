// Visual glitch hunter. Plays a real-time autoplay run in headless Chrome and inspects every
// rendered frame (down-sampled luminance grid). A "spike" is a patch of cells that jumps
// dark (or bright) for one or two frames and then returns - the signature of flicker, as
// opposed to lights turning on or the camera panning. Offending frames are saved to
// shots/flicker-*.png together with the frame before them.
//
// Usage: node tools/dev/flicker.mjs [seed] [seconds] [--bright] [--calm] [--fixedcam] [--room=airlock|N|x,y] [--min=N] [--after=T]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const seed = args[0] ?? 'DEMO1';
const seconds = Number(args[1] ?? 60);
const includeBright = process.argv.includes('--bright');
const calm = process.argv.includes('--calm'); // no hostiles: isolates non-combat flicker
const fixedCam = process.argv.includes('--fixedcam'); // camera parked on room 1: any spike is real flicker
const minDark = Number(process.argv.find((a) => a.startsWith('--min='))?.slice(6) ?? 6);
const fromT = Number(process.argv.find((a) => a.startsWith('--after='))?.slice(8) ?? 0.5); // ignore spikes before this game time
mkdirSync(join(ROOT, 'shots'), { recursive: true });

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 },
});
const tab = await browser.newPage();
tab.on('pageerror', (e) => console.log('[pageerror]', e.message));
await tab.goto(`${server.resolvedUrls.local[0]}index.html?seed=${seed}&go=1&autoplay=1&god=1`, { waitUntil: 'load' });
await tab.waitForFunction('window.__game?.world?.()', { timeout: 60000 });
const camRoom = process.argv.find((a) => a.startsWith('--room='))?.slice(7) ?? '1'; // 'airlock', a room index or 'x,y'
if (fixedCam) await tab.evaluate((camRoom) => { const v = window.__game.view(); const L = window.__game.world().level; const at = camRoom.split(',').map(Number); const r = L.rooms[camRoom === 'airlock' ? L.airlock : Number(camRoom)]; if (at.length === 2) v.camera.teleport(at[0], at[1]); else v.camera.teleport((r.x0 + r.x1) / 2, r.y0 + 2.3); v.camera.update = function () { this.apply(); }; }, camRoom);
if (calm) await tab.evaluate(() => { const w = window.__game.world(); for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); } w.reserve = 0; });

await tab.evaluate(([includeBright, minDark, fromT]) => {
  // Luminance grid of 8x8-pixel box averages of an 800x450 copy. (Shrinking straight to the grid
  // with drawImage point-samples: thin bright lines popped in and out of cells as they moved.)
  const B = 8, GW = 100, GH = 56;
  const ring = [0, 1, 2].map(() => { const c = document.createElement('canvas'); c.width = 800; c.height = 450; return c; });
  const hist = [];
  let frame = 0;
  window.__flicker = { events: [], frames: 0 };
  // |mid - avg(before, after)| x4, red = got darker, green = got brighter.
  const diffImage = (m, b0, a0) => {
    const W = 800, H = 450;
    const g = (c) => c.getContext('2d').getImageData(0, 0, W, H).data;
    const M = g(m), B = g(b0), A = g(a0);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const octx = out.getContext('2d');
    const img = octx.createImageData(W, H);
    for (let i = 0; i < M.length; i += 4) {
      const lm = 0.3 * M[i] + 0.59 * M[i + 1] + 0.11 * M[i + 2];
      const lb = (0.3 * (B[i] + A[i]) + 0.59 * (B[i + 1] + A[i + 1]) + 0.11 * (B[i + 2] + A[i + 2])) / 2;
      const d = (lm - lb) * 4;
      img.data[i] = d < 0 ? Math.min(255, -d) : 0;
      img.data[i + 1] = d > 0 ? Math.min(255, d) : 0;
      img.data[i + 2] = lm * 0.25;
      img.data[i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    return out.toDataURL('image/png');
  };
  window.__game.onFrame = (canvas) => {
    frame++;
    const full = ring[frame % 3];
    const fctx = full.getContext('2d', { willReadFrequently: true });
    fctx.drawImage(canvas, 0, 0, 800, 450);
    const px = fctx.getImageData(0, 0, 800, 450).data;
    const L = new Float32Array(GW * GH);
    for (let y = 0; y < GH * B; y++) {
      const row = ((y / B) | 0) * GW;
      for (let x = 0; x < GW * B; x++) {
        const k = (y * 800 + x) * 4;
        L[row + ((x / B) | 0)] += 0.3 * px[k] + 0.59 * px[k + 1] + 0.11 * px[k + 2];
      }
    }
    for (let i = 0; i < L.length; i++) L[i] /= B * B;
    const cam = window.__game.view().camera;
    hist.push({ L, frame, t: window.__game.world().time, now: window.__game.view().time * 1000, img: full,
      cx: cam.cam.position.x, cy: cam.cam.position.y, cell: cam.viewHeight * B / 450 });
    if (hist.length > 4) hist.shift();
    window.__flicker.frames = frame;
    if (hist.length < 4) return;
    // Pattern a -> b(,c) -> d where the middle frame(s) deviate and a ~ d.
    const [a, b, c, d] = hist;
    for (const [mid, span] of [[b, 1], [c, 1]]) {
      const before = span === 1 && mid === b ? a : b;
      const after = mid === b ? c : d;
      let dark = 0; let bright = 0; let x0 = GW, x1 = 0, y0 = GH, y1 = 0;
      // Interpolate by render-clock time, not frame index (frames arrive unevenly), and
      // compensate the camera: neighbours are sampled where the same WORLD point was on screen.
      // Without this, thin bright details (lamp strips, rails) crossing grid cells during a fast
      // pan read as spikes on every other frame.
      const f = (mid.now - before.now) / Math.max(1e-3, after.now - before.now);
      const shift = (o) => [(mid.cx - o.cx) / mid.cell, -(mid.cy - o.cy) / mid.cell];
      const [bx, by] = shift(before); const [ax, ay] = shift(after);
      const at = (G, x, y) => {
        if (x < 0 || y < 0 || x > GW - 1 || y > GH - 1) return NaN;
        const x0 = Math.min(GW - 2, x | 0), y0 = Math.min(GH - 2, y | 0), u = x - x0, v = y - y0, k = y0 * GW + x0;
        return (G[k] * (1 - u) + G[k + 1] * u) * (1 - v) + (G[k + GW] * (1 - u) + G[k + GW + 1] * u) * v;
      };
      for (let i = 0; i < L.length; i++) {
        const gx = i % GW, gy = (i / GW) | 0;
        const lb = at(before.L, gx + bx, gy + by), la = at(after.L, gx + ax, gy + ay);
        if (Number.isNaN(lb) || Number.isNaN(la)) continue; // scrolled in from off-screen
        const base = lb + (la - lb) * f;
        if (Math.abs(lb - la) > 18) continue; // not stable around the spike
        const dv = mid.L[i] - base;
        if (dv < -28) dark++; else if (dv > 40) bright++; else continue;
        const x = i % GW, y = (i / GW) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const n = dark + (includeBright ? bright : 0);
      if (n >= minDark && mid.t > fromT) {
        window.__flicker.events.push({
          t: +mid.t.toFixed(2), frame: mid.frame, dark, bright, gap: [mid.now - before.now, after.now - mid.now].map(Math.round),
          box: [x0, y0, x1, y1].map((v) => v * B * 2),
          img: window.__flicker.events.length < 10 ? mid.img.toDataURL('image/png') : null,
          prev: window.__flicker.events.length < 10 ? before.img.toDataURL('image/png') : null,
          diff: window.__flicker.events.length < 10 ? diffImage(mid.img, before.img, after.img) : null,
        });
      }
      break; // only test the single-frame case per frame (b)
    }
  };
}, [includeBright, minDark, fromT]);

console.log(`recording ${seconds}s of real-time play on ${seed}...`);
await new Promise((r) => setTimeout(r, seconds * 1000));
const result = await tab.evaluate(() => ({ frames: window.__flicker.frames, events: window.__flicker.events, state: window.__game.world().state() }));
await browser.close();
await server.close();

console.log(`frames analysed: ${result.frames}, spikes: ${result.events.length}, game time ${result.state.time}s`);
result.events.forEach((e, i) => {
  console.log(`  #${i} t=${e.t}s frame ${e.frame} dark=${e.dark} bright=${e.bright} gap=${e.gap.join('/')}ms box=${e.box.join(',')}`);
  if (e.img) {
    writeFileSync(join(ROOT, 'shots', `flicker-${i}.png`), Buffer.from(e.img.split(',')[1], 'base64'));
    writeFileSync(join(ROOT, 'shots', `flicker-${i}-prev.png`), Buffer.from(e.prev.split(',')[1], 'base64'));
    writeFileSync(join(ROOT, 'shots', `flicker-${i}-diff.png`), Buffer.from(e.diff.split(',')[1], 'base64'));
  }
});
