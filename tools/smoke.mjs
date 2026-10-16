// Smoke test: boots the game in headless Chromium (SwiftShader), runs the deterministic demo for a
// stretch of game time, checks that the marine moved, fought and nothing threw, and writes
// docs/screenshot.png. Needs Playwright with Chromium (see README).
//   node tools/smoke.mjs [--seconds 40] [--seed 7] [--shot docs/screenshot.png]
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SECONDS = Number(opt('seconds', 40)), SEED = Number(opt('seed', 7)), SHOT = opt('shot', 'docs/screenshot.png');

let chromium;
try {
  const require = createRequire(import.meta.url);
  let pw;
  for (const p of ['playwright', '/usr/local/lib/node_modules_global/playwright', '/usr/local/lib/node_modules/playwright']) { try { pw = require(p); break; } catch (e) { /* next */ } }
  if (!pw) throw new Error('playwright not found');
  chromium = pw.chromium;
} catch (e) {
  console.log('smoke: skipped (' + e.message + ')');
  process.exit(0);
}

const port = 8400 + Math.floor(Math.random() * 400);
const server = spawn(process.execPath, [path.join(root, 'tools', 'serve.js'), '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 450 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); });
let failed = false;
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?demo=1&seed=${SEED}&det=1&speed=8`);
  await page.waitForFunction(() => window.__game && window.__game.screen === 'play', null, { timeout: 120000 });
  const start = await page.evaluate(() => ({ x: window.__game.player.x, y: window.__game.player.y }));
  await page.waitForFunction((t) => window.__game.time >= t || window.__game.screen === 'dead' || window.__game.screen === 'extracted', SECONDS, { timeout: 600000 });
  const s = await page.evaluate(() => {
    const g = window.__game, p = g.player;
    return { screen: g.screen, time: g.time, x: p.x, y: p.y, hp: p.hp, shots: p.shots, hits: p.hits, kills: p.kills, aliens: g.aliens.length, alive: g.aliens.filter((a) => a.alive).length, seenRooms: g.world.seen.size, following: g.survivors.filter((x) => x.state === 'follow').length, hasLog: p.hasLog, lights: g.lightBuf.length };
  });
  console.log('smoke:', JSON.stringify(s));
  const moved = Math.hypot(s.x - start.x, s.y - start.y);
  const check = (cond, msg) => { if (!cond) { failed = true; console.log('FAIL:', msg); } };
  check(errors.length === 0, 'page errors:\n' + errors.join('\n'));
  check(moved > 400, `marine barely moved (${Math.round(moved)} px)`);
  check(s.shots > 0 && s.hits > 0, 'no shots landed');
  check(s.aliens > 0, 'no hostiles spawned');
  check(s.seenRooms >= 3, 'fog of war never revealed more rooms');
  check(s.screen !== 'dead' || s.time > 20, 'marine died at once');
  fs.mkdirSync(path.dirname(path.join(root, SHOT)), { recursive: true });
  await page.screenshot({ path: path.join(root, SHOT) });
  console.log('smoke: screenshot', SHOT);
} catch (e) {
  failed = true;
  console.log('FAIL:', e.message);
  if (errors.length) console.log(errors.join('\n'));
}
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
