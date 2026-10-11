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
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
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
  await page.waitForTimeout(450);
  await page.evaluate(() => window.__press(9, false));
  await page.waitForFunction(() => window.__game.scene.isActive('Game'), null, { timeout: 90000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, '02-game-start.png') });

  // Helpers: poll the player's x while holding an input so the test is robust at any frame rate.
  const playerX = () => page.evaluate(() => window.__game.scene.getScene('Game').player.x);
  const waitMove = async (from, dir, min = 60, maxMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const x = await playerX();
      if ((x - from) * dir >= min) return x;
      await page.waitForTimeout(150);
    }
    return playerX();
  };

  // Run right with the stick, jump with A, attack with X.
  const x0 = await playerX();
  await page.evaluate(() => window.__axis(0, 1));
  const x1 = await waitMove(x0, 1);
  await page.evaluate(() => window.__press(0, true));
  await page.waitForTimeout(450);
  await page.evaluate(() => window.__press(0, false));
  await page.screenshot({ path: path.join(outDir, '03-jump.png') });
  await page.evaluate(() => window.__press(2, true));
  await page.waitForTimeout(450);
  await page.evaluate(() => window.__press(2, false));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__axis(0, 0));
  await page.screenshot({ path: path.join(outDir, '04-after-run.png') });
  if (!(x1 > x0 + 50)) throw new Error(`Player did not move right with gamepad stick: ${x0} -> ${x1}`);
  const rumbles = await page.evaluate(() => window.__rumbles || 0);

  // Keyboard path.
  await page.evaluate(() => { window.__padEnabled = false; });
  await page.waitForTimeout(1500); // let any attack finish
  const kx0 = await playerX();
  await page.keyboard.down('KeyA');
  const kx1 = await waitMove(kx0, -1, 40);
  await page.keyboard.up('KeyA');
  if (!(kx1 < kx0 - 30)) throw new Error(`Player did not move left with keyboard: ${kx0} -> ${kx1}`);

  const fps = await page.evaluate(() => window.__game.loop.actualFps);
  console.log(`smoke ok: gamepad ${x0.toFixed(0)}->${x1.toFixed(0)}, keyboard ${kx0.toFixed(0)}->${kx1.toFixed(0)}, rumble calls ${rumbles}, ${fps.toFixed(0)} fps (software GL)`);
  if (warnings.length) console.log('warnings:\n' + warnings.slice(0, 10).join('\n'));
  if (errors.length) throw new Error('Console errors:\n' + errors.join('\n'));
} catch (e) {
  if (errors.length) console.error('Console errors:\n' + errors.join('\n'));
  throw e;
} finally {
  if (browser) await browser.close();
  server.kill();
}
