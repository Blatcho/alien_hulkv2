// Lead mode end to end in headless Chrome with a fake controller: the briefing's LEAD choice, then a run
// where the stick walks the marine aboard, the right stick aims and RT fires. Screenshots go to
// shots/lead-*.png; exit 1 on a page error or if the marine never moved.
// Usage: node tools/dev/lead-e2e.mjs   (CHROME=/path/to/chrome to pick the browser)
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'shots');
const CHROME = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', execSync('find /opt/pw-browsers -maxdepth 4 -type f -name chrome 2>/dev/null | head -1').toString().trim()].find((p) => p && existsSync(p)) ?? '';
if (!existsSync(CHROME)) { console.error('no chrome at', CHROME); process.exit(1); }

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1600,900', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  defaultViewport: { width: 1600, height: 900 },
});
let failed = false;
mkdirSync(OUT, { recursive: true });
const shot = (tab, name) => tab.screenshot({ path: join(OUT, `lead-${name}.png`) });
try {
  const tab = await browser.newPage();
  tab.on('pageerror', (e) => { failed = true; console.log('[pageerror]', e.message); });
  tab.on('console', (m) => { if (m.type() === 'error' || m.text().startsWith('[game]')) console.log(`[browser ${m.type()}]`, m.text()); });
  // A fake Xbox pad: window.__pad holds axes/buttons the test sets.
  await tab.evaluateOnNewDocument(() => {
    window.__pad = { axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), connected: true, index: 0, id: 'Fake Xbox', mapping: 'standard' };
    navigator.getGamepads = () => [window.__pad];
  });

  // 1. The briefing: pick LEAD, one marine + 2 followers.
  const SEED = globalThis.process.env.SEED ?? 'A1'; // a seed code names its hull: STN-A1B2C3
  await tab.goto(`${base}index.html?brief=${SEED}`, { waitUntil: 'load' });
  await tab.waitForSelector('.briefing .deploy', { visible: true, timeout: 60000 });
  await shot(tab, '1-briefing-squad');
  await tab.click('.briefing [data-control="lead"]');
  await tab.waitForSelector('.briefing .controls', { visible: true });
  // Deselect the last two picks: YOU + one follower.
  const ids = await tab.$$eval('.briefing .rt.pick.in', (els) => els.map((e) => e.dataset.id));
  console.log('picked', ids);
  await tab.click(`.briefing .rt.pick[data-id="${ids[3]}"]`);
  await tab.click(`.briefing .rt.pick[data-id="${ids[2]}"]`);
  const stats = await tab.$eval('.briefing .stats', (e) => e.textContent);
  const deploy = await tab.$eval('.briefing .deploy', (e) => `${e.textContent} disabled=${e.disabled}`);
  console.log('briefing:', stats, '|', deploy);
  await shot(tab, '2-briefing-lead');
  await Promise.all([tab.waitForNavigation({ waitUntil: 'load' }), tab.click('.briefing .deploy')]);
  console.log('url', tab.url());
  await tab.waitForFunction('window.__game?.world?.()', { timeout: 60000 });
  const info0 = await tab.evaluate(() => { const w = __game.world(); return { control: w.control, player: w.player?.name, n: w.marines.length, lead: __game.input().mode }; });
  console.log('run:', JSON.stringify(info0));
  await new Promise((r) => setTimeout(r, 1200));
  await shot(tab, '3-run-start');

  // Sound: the context opens on the first command or stick input; here, now, so the recordings load.
  await tab.evaluate(async () => { const s = __game.sfx(); s.unlock(); await s.samples?.ready; });
  // 2. Walk right with the left stick for 6 s (real time), then aim and fire.
  const x0 = await tab.evaluate(() => __game.world().player.x);
  const H = await tab.evaluate(() => __game.world().level.heading ?? 1);
  await tab.evaluate((h) => { window.__pad.axes[0] = h; }, H);
  await new Promise((r) => setTimeout(r, 6000));
  await tab.evaluate(() => { window.__pad.axes[0] = 0; });
  const after = await tab.evaluate(() => { const w = __game.world(); const p = w.player; return { x: +p.x.toFixed(2), room: p.room, airlock: w.level.airlock, state: w.squad.state, followers: w.squad.order.slice(1).map((m) => +m.x.toFixed(2)), padSeen: __game.input().padSeen, pad: { ...w.pad } }; });
  console.log('after walk:', JSON.stringify(after), 'from', x0.toFixed(2));
  if ((after.x - x0) * H < 2) { failed = true; console.log('FAIL: the marine did not walk'); }
  await shot(tab, '4-run-walked');
  await tab.evaluate((h) => { window.__pad.axes[2] = h; window.__pad.axes[3] = -0.3; window.__pad.buttons[7] = { pressed: true, value: 1 }; }, H);
  await new Promise((r) => setTimeout(r, 1500));
  const fired = await tab.evaluate(() => { const p = __game.world().player; const sfx = __game.sfx(); return { shots: p.shots, aiming: p.aiming, mag: p.mag, anim: p.anim, reticle: document.querySelector('#reticle').className, you: [...document.querySelectorAll('.portrait .point')].map((e) => `${e.hidden ? 'hidden' : e.textContent}`), ammo: document.querySelector('#weapon .ammo').textContent, hold: document.querySelector('.act[data-id="hold"]').hidden, turn: document.querySelector('.act[data-id="turn"]').hidden, tiles: [...document.querySelectorAll('.ord')].filter((e) => !e.hidden).map((e) => e.dataset.knob), sound: { ctx: sfx.ctx?.state ?? null, loaded: !!sfx.samples?.has('fire_carbine'), loops: sfx.loops.size, started: sfx.loopsStarted } }; });
  console.log('firing:', JSON.stringify(fired));
  if (!fired.shots) { failed = true; console.log('FAIL: no shots fired'); }
  // (Headless software GL can run under 5 fps, so the loop may time out between two rounds; it must have started.)
  if (fired.sound.loaded && !fired.sound.started) { failed = true; console.log('FAIL: the carbine fire loop never started while the trigger was held'); }
  await shot(tab, '5-run-firing');
  await tab.evaluate(() => { window.__pad.buttons[7] = { pressed: false, value: 0 }; window.__pad.axes[2] = 0; window.__pad.axes[3] = 0; });
  await new Promise((r) => setTimeout(r, 800));
  const quiet = await tab.evaluate(() => ({ loops: __game.sfx().loops.size }));
  console.log('trigger released:', JSON.stringify(quiet));
  if (fired.sound.loaded && quiet.loops !== 0) { failed = true; console.log('FAIL: the fire loop kept running after the trigger was released'); }
  // B: followers hold; the use prompt near the inner door after walking to it.
  // (held across a few frames: headless software GL may run under 10 fps)
  await tab.evaluate(() => { window.__pad.buttons[1] = { pressed: true, value: 1 }; });
  await new Promise((r) => setTimeout(r, 600));
  await tab.evaluate(() => { window.__pad.buttons[1] = { pressed: false, value: 0 }; });
  await new Promise((r) => setTimeout(r, 600));
  const held = await tab.evaluate(() => ({ hold: __game.world().squad.followersHold, label: document.querySelector('.act[data-id="hold"] .lbl').textContent, status: document.querySelector('#objective .roe').textContent.slice(0, 120) }));
  console.log('hold:', JSON.stringify(held));
  await shot(tab, '6-run-hold');
} catch (e) {
  failed = true;
  console.error('visual check failed:', e.message);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
