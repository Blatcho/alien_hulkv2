// Playwright smoke test: serves the game, loads it in headless Chromium with WebGL (SwiftShader),
// drives it with a fake Xbox gamepad and the keyboard, takes screenshots and fails on console errors.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = ['playwright', ...(process.env.NODE_PATH || '').split(':').filter(Boolean).map((d) => path.join(d, 'playwright'))];
  for (const c of candidates) { try { return require(c); } catch (e) { /* try next */ } }
  throw new Error('playwright not found: run `npm install` (devDependency) or set NODE_PATH');
}
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { chromium } = loadPlaywright();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.env.SMOKE_OUT || path.join(root, 'tests', 'screens');
fs.mkdirSync(outDir, { recursive: true });
const port = 8123 + Math.floor(Math.random() * 1000);

const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.js'), '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  // Fake gamepad: standard mapping, controlled through window.__pad.
  await page.addInitScript(() => {
    const pad = { connected: true, id: 'Fake Xbox Controller (STANDARD GAMEPAD)', index: 0, mapping: 'standard', timestamp: 0,
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0],
      vibrationActuator: { playEffect: () => { window.__rumbles = (window.__rumbles || 0) + 1; return Promise.resolve('complete'); } } };
    window.__pad = pad;
    window.__press = (i, on) => { pad.buttons[i].pressed = on; pad.buttons[i].value = on ? 1 : 0; };
    window.__axis = (i, v) => { pad.axes[i] = v; };
    navigator.getGamepads = () => (window.__padEnabled ? [pad, null, null, null] : [null, null, null, null]);
  });

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__game && window.__game.scene.isActive('Title'), null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, '01-title.png') });

  // Start the game with the fake pad's Start button.
  await page.evaluate(() => { window.__padEnabled = true; window.__press(9, true); });
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__press(9, false));
  await page.waitForFunction(() => window.__game.scene.isActive('Game'), null, { timeout: 10000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, '02-game-start.png') });

  // Run right with the stick, jump with A, attack with X.
  const x0 = await page.evaluate(() => window.__game.scene.getScene('Game').player.x);
  await page.evaluate(() => window.__axis(0, 1));
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__press(0, true));
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__press(0, false));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outDir, '03-jump.png') });
  await page.evaluate(() => window.__press(2, true));
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__press(2, false));
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__axis(0, 0));
  const x1 = await page.evaluate(() => window.__game.scene.getScene('Game').player.x);
  await page.screenshot({ path: path.join(outDir, '04-after-run.png') });
  if (!(x1 > x0 + 100)) throw new Error(`Player did not move right with gamepad stick: ${x0} -> ${x1}`);

  // Keyboard path.
  await page.evaluate(() => { window.__padEnabled = false; });
  const kx0 = await page.evaluate(() => window.__game.scene.getScene('Game').player.x);
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(200);
  const kx1 = await page.evaluate(() => window.__game.scene.getScene('Game').player.x);
  if (!(kx1 < kx0 - 50)) throw new Error(`Player did not move left with keyboard: ${kx0} -> ${kx1}`);

  const fps = await page.evaluate(() => window.__game.loop.actualFps);
  console.log(`smoke ok: gamepad ${x0.toFixed(0)}->${x1.toFixed(0)}, keyboard ${kx0.toFixed(0)}->${kx1.toFixed(0)}, ${fps.toFixed(0)} fps (software GL)`);
  if (errors.length) throw new Error('Console errors:\n' + errors.join('\n'));
} finally {
  if (browser) await browser.close();
  server.kill();
}
