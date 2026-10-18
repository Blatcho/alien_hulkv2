// Headless-Chrome screenshots of the running game/viewer, for automated visual checks.
//
//   node tools/shot.mjs                                   game, default seed
//   node tools/shot.mjs viewer.html --q "model=marine&clip=walk&t=0.25" --out marine-walk.png
//   node tools/shot.mjs index.html --q "seed=AB12CD&go=1" --eval "__game.stepFrames(1800)" --out run.png
//   node tools/shot.mjs index.html --q "seed=X&go=1&autoplay=1" --until "__game.state().status!=='playing'" --timeout 180000
//
// Options: --size 1600x900  --wait 500 (ms after ready)  --clip x,y,w,h  --swiftshader (software GL fallback)
// Browser console errors are echoed; exit code 1 if the page threw.
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const page = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ?? 'index.html';
const query = opt('q', '');
const out = opt('out', `${page.replace('.html', '')}.png`);
const [w, h] = opt('size', '1600x900').split('x').map(Number);
const evalExpr = opt('eval', null);
const until = opt('until', null);
const timeout = Number(opt('timeout', 60000));
const shots = Number(opt('shots', 1));
const interval = Number(opt('interval', 1000));

const CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  process.platform === 'win32' ? '' : execSync('find /opt/pw-browsers -maxdepth 4 -type f -name chrome 2>/dev/null | head -1').toString().trim(),
].find((p) => p && existsSync(p));

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
await server.listen();
const url = `${server.resolvedUrls.local[0]}${page}${query ? `?${query}` : ''}`;
const glArgs = argv.includes('--swiftshader')
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [...glArgs, `--window-size=${w},${h}`, '--autoplay-policy=no-user-gesture-required', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
  defaultViewport: { width: w, height: h },
});

let errors = 0;
try {
  const tab = await browser.newPage();
  tab.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warn' || m.text().startsWith('[game]')) console.log(`[browser ${t}] ${m.text()}`);
  });
  tab.on('pageerror', (e) => { errors++; console.log(`[pageerror] ${e.message}`); });
  console.log('open', url);
  await tab.goto(url, { waitUntil: 'load' });
  await tab.waitForFunction('window.__viewer?.ready || window.__game?.ready', { timeout });
  if (evalExpr) console.log('eval ->', await tab.evaluate(evalExpr));
  if (until) await tab.waitForFunction(until, { timeout, polling: 500 });
  await new Promise((r) => setTimeout(r, Number(opt('wait', 500))));
  mkdirSync(join(ROOT, 'shots'), { recursive: true });
  for (let i = 0; i < shots; i++) {
    const name = shots > 1 ? out.replace('.png', `-${i}.png`) : out;
    const clip = opt('clip', null)?.split(',').map(Number);
    await tab.screenshot({ path: join(ROOT, 'shots', name), ...(clip ? { clip: { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } } : {}) });
    console.log('saved shots/' + name);
    if (i < shots - 1) await new Promise((r) => setTimeout(r, interval));
  }
  const state = await tab.evaluate('window.__game?.state ? JSON.stringify(window.__game.state()) : null');
  if (state) console.log('state', state);
} catch (e) {
  errors++;
  console.error('shot failed:', e.message);
} finally {
  await browser.close();
  await server.close();
}
process.exit(errors ? 1 : 0);
