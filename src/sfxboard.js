// Sound board (/sfx.html): every game event's sound, played through Sfx.bind() exactly as a run
// plays it (recorded or synthesised), plus every recorded take with its source.
import '@fontsource/share-tech-mono';
import { WEAPONS } from './core/config.js';
import { MIX, Sfx } from './audio/sfx.js';

const sfx = new Sfx();
const handlers = {};
const world = { on: (type, fn) => { (handlers[type] ??= []).push(fn); }, squad: { leader: { x: 0 }, order: [], pace: 'normal' } };
sfx.bind(world);
window.__sfx = sfx; // tools/dev checks
const emit = (type, e = {}) => handlers[type]?.forEach((fn) => fn(e));
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const X = () => Number($('#pos').value);
let ambience = true;

function start() {
  sfx.unlock();
  $('#status').textContent = 'loading recordings...';
  sfx.samples?.ready.then(() => { $('#status').textContent = ''; ambienceMix(); });
}
document.addEventListener('pointerdown', start, { once: true });

let last = performance.now();
(function frame(now) {
  sfx.update(Math.min(0.1, (now - last) / 1000), { x: 0 });
  last = now;
  requestAnimationFrame(frame);
})(last);

const burst = (weapon) => {
  const w = WEAPONS[weapon];
  const n = Math.round((w.burst[0] + w.burst[1]) / 2);
  const marine = { x: X() }; // one shooter per burst, as in a run (the heavy's tail follows its last round)
  for (let i = 0; i < n; i++) setTimeout(() => emit('shot', { marine, weapon }), i * 1000 / w.rate);
};
const steps = () => { for (let i = 0; i < 8; i++) setTimeout(() => sfx.footstep(X()), i * 420); };
let siren = false;

const EVENTS = {
  SHIP: [
    ['Door opens', () => emit('door', { portal: { x: X() }, open: true })],
    ['Door closes', () => emit('door', { portal: { x: X() }, open: false })],
    ['Door panel', () => emit('door-work', { portal: { x: X() } })],
    ['Airlock cycle', () => { world.squad.leader.x = X(); emit('airlock-cycle'); }],
    ['Uplink alarm on/off', () => { siren = !siren; emit(siren ? 'uplink-start' : 'uplink-done'); }],
    ['Crate smashed', () => emit('prop-destroyed', { entity: { x: X(), explosive: false } })],
    ['Round into a crate', () => emit('hit', { entity: { kind: 'prop', x: X() } })],
    ['Barrel explodes', () => emit('explosion', { x: X() })],
    ['Hull thud', () => sfx.play('ambience_thud', X(), 1, { muffle: true })],
    ['Terminal beep', () => sfx.play('ambience_beep', X(), 1)],
    ['Sparks', () => sfx.play('spark', X())],
  ],
  SQUAD: [
    ...Object.keys(WEAPONS).map((k) => [`${WEAPONS[k].label} burst`, () => burst(k)]),
    ['Reload', () => emit('reload', { marine: { x: X() } })],
    ['Footsteps', steps],
    ['Stim', () => emit('stim')],
    ['Tracker: clear', () => sfx.trackerPing([])],
    ['Tracker: contact', () => sfx.trackerPing([{ d: 22 }])],
    ['Tracker: close', () => sfx.trackerPing([{ d: 3 }])],
  ],
  HOSTILES: [
    ['Wakes (in sight)', () => emit('alien-wake', { alien: { x: X(), visible: true } })],
    ['Wakes (behind a wall)', () => emit('alien-wake', { alien: { x: X(), visible: false } })],
    ['Leaps', () => emit('alien-leap', { alien: { x: X() } })],
    ['Strikes a marine', () => emit('strike', { alien: { x: X() } })],
    ['Takes a round', () => emit('hit', { entity: { kind: 'alien', x: X() } })],
    ['Dies', () => emit('kill', { entity: { kind: 'alien', x: X() } })],
    ['Critter dies', () => emit('kill', { entity: { kind: 'critter', x: X() } })],
    ['Out of a vent', () => emit('vent-emerge', { vent: { x: X() } })],
    ['Build-up (far off)', () => emit('buildup')],
    ['Wave (far off)', () => emit('wave')],
    ['Ambush', () => emit('ambush')],
  ],
  INTERFACE: [
    ['Order', () => sfx.ui()],
    ['Encounter', () => emit('decision', { encounter: true })],
    ['Check passed', () => emit('encounter', { ok: true })],
    ['Check failed', () => emit('encounter', { ok: false })],
    ['Loot', () => emit('loot', { loot: { type: 'weapon' } })],
    ['Ship clear', () => emit('ship-clear')],
    ['Marine down', () => emit('kill', { entity: { kind: 'marine', x: X() } })],
    ['Won', () => emit('won')],
  ],
};
$('#events').innerHTML = Object.entries(EVENTS).map(([group, list], g) => `<h2${g ? '' : ' style="margin-top:0"'}>${group}</h2><div class="events">${
  list.map(([label], i) => `<button data-ev="${group}:${i}">${esc(label)}</button>`).join('')}</div>`).join('');
$('#events').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ev]');
  if (!b) return;
  start();
  const [group, i] = b.dataset.ev.split(':');
  EVENTS[group][i][1]();
});

// Recorded vs synthesised.
$('#mode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b) return;
  start();
  if (siren) { sfx.alarm(false); siren = false; }
  sfx.synthOnly = b.dataset.mode === 'synth';
  $('#mode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  ambienceMix();
});
$('#amb').addEventListener('click', () => {
  start();
  ambience = !ambience;
  $('#amb').classList.toggle('on', ambience);
  $('#amb').textContent = ambience ? 'Ambience on' : 'Ambience off';
  ambienceMix();
});
/** Beds (recorded) or drone (synth), per the switches; the one-off ship noises go with the beds. */
function ambienceMix() {
  if (!sfx.ctx) return;
  if (!sfx.synthOnly) sfx.ambience();
  const t = sfx.ctx.currentTime;
  const rec = ambience && !sfx.synthOnly && !!sfx.beds;
  sfx.beds?.gain.cancelScheduledValues(t);
  sfx.beds?.gain.setTargetAtTime(rec ? 1 : 0, t, 0.3);
  sfx.drone.gain.cancelScheduledValues(t);
  sfx.drone.gain.setTargetAtTime(ambience && !rec ? 1 : 0, t, 0.3);
  sfx.ambT = rec ? 2 : Infinity;
}

// Every take.
fetch(`${import.meta.env.BASE_URL}assets/audio/manifest.json`).then((r) => r.json()).then((m) => {
  $('#takes').innerHTML = Object.entries(m.sounds).map(([key, s]) => {
    const sources = [...new Map(s.files.filter((f) => f.url).map((f) => [f.url, f.from.replace(/ \([\d.]+-[\d.a-z]+ s\)$/, '')])).entries()];
    return `<div class="take"><b>${esc(key)}<small>${s.loop ? 'loop · ' : ''}mix ${MIX[key] ?? '-'}</small></b>
      <div class="takes">${s.files.map((f, i) => `<button data-key="${key}" data-take="${i}" title="${esc(f.from)}">${i + 1} · ${f.dur.toFixed(2)}s</button>`).join('')}</div>
      <div class="src">${sources.map(([url, text]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`).join(' · ')}</div></div>`;
  }).join('');
});
let playing = null;
$('#takes').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-key]');
  if (!b) return;
  start();
  await sfx.samples?.ready;
  playing?.stop();
  // Loops play one pass (click again to stop early).
  const again = playing?.key === b.dataset.key + b.dataset.take;
  playing = null;
  if (again || !sfx.samples?.has(b.dataset.key)) return;
  playing = sfx.samples.play(b.dataset.key, sfx.out(X(), MIX[b.dataset.key] ?? 1), { take: +b.dataset.take, jitter: 0 });
  playing.key = b.dataset.key + b.dataset.take;
  playing.onended = () => { if (playing?.key === b.dataset.key + b.dataset.take) playing = null; };
});
