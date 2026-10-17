// End-to-end campaign loop in headless Chrome:
//   title -> NEW CAMPAIGN -> Command -> DEPLOY -> Briefing -> DEPLOY -> run (god) -> Debrief
//   -> Command again, checking the profile moved on. Screenshots land in shots/e2e-*.png.
// Usage: node tools/dev/campaign-e2e.mjs [--mortal]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const god = !process.argv.includes('--mortal');
mkdirSync(join(ROOT, 'shots'), { recursive: true });
const shot = (tab, name) => tab.screenshot({ path: join(ROOT, 'shots', `e2e-${name}.png`) });

const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--use-angle=d3d11', '--window-size=1600,900'], defaultViewport: { width: 1600, height: 900 },
});
let failed = false;
try {
  const tab = await browser.newPage();
  tab.on('pageerror', (e) => { failed = true; console.log('[pageerror]', e.message); });
  tab.on('dialog', (d) => d.accept());
  await tab.goto(base, { waitUntil: 'load' });
  await tab.waitForSelector('#newcamp', { visible: true, timeout: 60000 });
  await tab.click('#newcamp');
  await tab.waitForSelector('.command .deploy', { visible: true });
  await shot(tab, '1-command');
  await tab.click('.command .deploy');
  await tab.waitForSelector('.briefing .deploy', { visible: true });
  await shot(tab, '1b-briefing');
  await tab.click('.briefing [data-preset="assault"]'); // Standard is point-and-click: this run plays itself
  await Promise.all([tab.waitForNavigation({ waitUntil: 'load' }), tab.click('.briefing .deploy')]);
  await tab.waitForFunction('window.__game?.world?.()', { timeout: 60000 });
  await tab.evaluate(`(() => { const w = __game.world(); w.params.autoplay = true; w.params.god = ${god}; })()`);
  await new Promise((r) => setTimeout(r, 1500));
  await shot(tab, '2-boarding');
  const status = await tab.evaluate(`(() => { for (let i = 0; i < 2400 && __game.world().status === 'playing'; i++) __game.stepFrames(30); return __game.world().status; })()`);
  console.log('run finished:', status);
  await tab.waitForSelector('.debrief .deploy', { visible: true, timeout: 20000 });
  await shot(tab, '3-debrief');
  await Promise.all([tab.waitForNavigation({ waitUntil: 'load' }), tab.click('.debrief .deploy')]);
  await tab.waitForSelector('.command .deploy', { visible: true, timeout: 60000 });
  await shot(tab, '5-command-after');
  const profile = await tab.evaluate(`JSON.parse(localStorage.getItem('hullbreach.profile.v1'))`);
  console.log(`profile: threat ${profile.threat}, credits ${profile.credits}, runs ${profile.runs}, wins ${profile.wins}, roster ${profile.roster.length}, stash ${profile.stash.length}, memorial ${profile.memorial.length}`);
  console.log('troopers:', profile.roster.map((t) => `${t.name} xp${t.xp} ${Object.entries(t.stats).map(([k, v]) => k + v).join(' ')}`).join(' | '));
  if (profile.runs !== 1) { failed = true; console.log('FAIL: run not recorded'); }
} catch (e) {
  failed = true;
  console.error('e2e failed:', e.message);
} finally {
  await browser.close();
  await server.close();
}
process.exit(failed ? 1 : 0);
