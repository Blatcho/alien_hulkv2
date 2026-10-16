// Boot: renderer, input, audio, HUD, then the title screen. The loop polls the pad, steps the game
// and draws the overlay. ?seed=N picks a ship, ?demo=1 starts the demo at once, ?pixel=0 renders at
// native resolution, ?bloom=0 disables bloom.
import { Renderer } from './core/Renderer.js';
import { Input } from './core/Input.js';
import { Audio } from './core/Audio.js';
import { HUD } from './ui/HUD.js';
import { Game } from './Game.js';
import { randomSeed, mulberry32 } from './gen/Ship.js';
import * as AlienModule from './entities/Alien.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const hudCanvas = document.getElementById('hud');
const renderer = new Renderer(canvas, { pixel: q.get('pixel') !== '0', bloom: q.get('bloom') !== '0' });
const input = new Input(canvas);
const audio = new Audio();
const hud = new HUD(hudCanvas);
renderer.onResize = (w, h, s) => { hud.resize(w, h, s); input.scale = s; };
hud.resize(renderer.width, renderer.height, renderer.scale); input.scale = renderer.scale;

// browsers keep the audio context suspended until a gesture: resume on the first ones
for (const ev of ['keydown', 'mousedown', 'touchstart']) window.addEventListener(ev, () => audio.resume(), { passive: true });
const seed = q.get('seed') ? Number(q.get('seed')) : randomSeed();
if (q.get('det') === '1') { const rng = mulberry32(seed ^ 0x5bd1e995); Math.random = rng; }   // deterministic runs for tests
const game = new Game({ renderer, input, audio, hud, seed });
game._alienModule = AlienModule;
window.__game = game;

let last = performance.now();
let booted = false;
let starting = false;

async function begin(demo) {
  if (starting) return;
  starting = true;
  await audio.init();
  game.loading = 'LOADING…';
  try { await game.start({ seed: game.seed, demo }); }
  catch (e) { console.error(e); game.loading = 'FAILED: ' + e.message; }
  starting = false;
}

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.preInput(realDt);
  const s = input.poll();
  if (game.screen === 'title') {
    if (input.keys.has('KeyN') && !game._nHeld) { game.seed = randomSeed(); game._nHeld = true; } else if (!input.keys.has('KeyN')) game._nHeld = false;
    if (s.confirmPressed && !game.loading) begin(false);
    if ((s.weaponPressed || input.keys.has('KeyD')) && !game.loading) begin(true);
  }
  const speed = Number(q.get('speed') || 0);
  if (speed > 0 && game.screen === 'play') { for (let i = 0; i < speed; i++) { if (i) { game.preInput(1 / 60); input.poll(); } game.update(1 / 60); } }
  else game.update(realDt);
  // the game polls input itself in demo mode; otherwise the state above is current
  if (game.screen !== 'title' && game.player) {
    if (q.get('render') !== '0') renderer.render();
  } else {
    renderer.gl.setClearColor(0x04050a); renderer.gl.clear();
  }
  hud.draw(game, realDt);
}

async function boot() {
  await hud.load();
  await game.loadModels().catch((e) => console.error(e));
  document.getElementById('boot').classList.add('gone');
  booted = true;
  if (q.get('demo') === '1') begin(true);
  else if (q.get('play') === '1') begin(false);
  requestAnimationFrame(frame);
}
boot();
