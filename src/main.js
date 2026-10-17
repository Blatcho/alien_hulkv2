// Entry point: boots physics + assets and routes between
//   title -> Command (campaign hub) -> run (a derelict) -> Debrief -> Command ...
// or a one-off quick-play ship (?seed=X&go=1). Each run is a fresh page load (clean WebGL
// state); the campaign lives in localStorage. Exposes window.__game for tests/screenshots.
import '@fontsource/share-tech-mono';
import './ui/hud.css';
import { Assets } from './core/assets.js';
import { Input } from './core/input.js';
import { Loop } from './core/loop.js';
import { params } from './core/params.js';
import { randomSeed } from './core/rng.js';
import { generateLevel } from './gen/level.js';
import { initPhysics } from './physics/physics.js';
import { GameView } from './render/view.js';
import { renderPortraits } from './render/portraits.js';
import { World } from './sim/world.js';
import { Hud } from './ui/hud.js';
import { Sfx } from './audio/sfx.js';
import {
  applyRun, clearProfile, levelFor, loadProfile, loadRun, newProfile, rankFor, saveProfile, saveRun, trooperMods,
} from './meta/profile.js';
import { candidatePool } from './meta/candidates.js';
import { difficultyString, isDefaultDifficulty, parseDifficulty, withDifficulty } from './meta/difficulty.js';
import { portraitMap } from './render/portraits.js';
import { PRESETS, doctrineString, nextOrder, parseDoctrine } from './sim/doctrine.js';
import { BriefingScreen } from './ui/briefing.js';
import { CommandScreen } from './ui/command.js';
import { Interact } from './ui/interact.js';
import { DebriefScreen } from './ui/debrief.js';

const ZOOM_STEP = 0.1; // one wheel notch or +/- press: 10% of the view height

// Pixel mode is on unless the player turned it off (P), which is remembered between runs.
const PIXELS_KEY = 'hullbreach.pixels';
const pixelMode = () => { try { return localStorage.getItem(PIXELS_KEY) !== 'off'; } catch { return true; } };
const savePixelMode = (on) => { try { localStorage.setItem(PIXELS_KEY, on ? 'on' : 'off'); } catch { /* private mode */ } };

class Game {
  constructor() {
    this.stage = document.getElementById('stage');
    this.hud = new Hud(document.getElementById('hud'), this);
    this.sfx = new Sfx({ synthOnly: params.synthSfx });
    this.paused = false;
    this.input = new Input((a) => this.command(a), { stage: this.stage });
    this.interact = new Interact(this.stage, this.hud.root, this);
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      // A mouse wheel sends one big step per notch, a trackpad a stream of small ones (a pinch
      // comes as ctrl+wheel): zoom by how far it scrolled, not by how many events arrived.
      const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1);
      this.view?.camera.zoom(Math.max(-ZOOM_STEP, Math.min(ZOOM_STEP, px * (e.ctrlKey ? 0.004 : 0.001))));
    }, { passive: false });
  }

  async boot() {
    await initPhysics();
    this.assets = new Assets();
    try {
      await this.assets.load();
    } catch (err) {
      console.warn('[game] art not built yet - using placeholders', err);
    }
    const seed = (params.seed ?? randomSeed()).toUpperCase();
    this.profile = loadProfile();
    const run = loadRun();
    if (params.run && run && this.profile) {
      if (run.started) {
        // Reloaded mid-run: the op is abandoned (no rewards, nobody lost). No save-scumming.
        saveRun(null);
        this.showCommand();
      } else {
        run.started = true;
        saveRun(run);
        this.startCampaignRun(run);
      }
    } else if (params.skipIntro || params.autoplay) this.startQuick(seed);
    else if (params.brief) this.showQuickBriefing(params.brief.toUpperCase());
    else if (params.command && this.profile) this.showCommand();
    else this.hud.showStart(seed, { hasCampaign: !!this.profile });
    window.__game = {
      ready: !!this.world || true,
      state: () => this.world?.state() ?? { status: 'menu' },
      stepFrames: (n) => { this.loop?.stepFrames(n); return this.world?.state(); },
      command: (c, arg) => this.command(c, arg),
      world: () => this.world,
      view: () => this.view,
      sfx: () => this.sfx,
      input: () => this.input,
    };
  }

  /** New ship: its briefing (the candidates come with the ship's seed). */
  newRun(seed = randomSeed()) { location.search = `?brief=${seed}`; }

  // ------------------------------------------------------------------ quick play

  /** Pick 4 of the ship's 8 candidates, the standing orders and the difficulty, then board (reload). */
  showQuickBriefing(seed) {
    this.hud.hideStart();
    this.hud.root.classList.add('menu');
    // The ship's candidates - or a fresh set each time the player rerolls (carried as &pool=).
    let roll = 0;
    const poolFor = (r) => candidatePool(seed, 8, r).map((t) => ({ ...t, rank: rankFor(levelFor(t.xp)) }));
    const pool = poolFor(0);
    let last = null;
    try { last = JSON.parse(localStorage.getItem('hullbreach.quick') ?? 'null'); } catch { /* none */ }
    this.briefing?.dispose();
    this.briefing = new BriefingScreen(this.hud.root, {
      heading: 'QUICK PLAY · BRIEFING', pool, portraits: portraitMap(this.assets, pool),
      ship: { name: `Derelict ${seed}`, size: 'Unknown class', threat: 0, modifiers: [] },
      selected: pool.slice(0, 4).map((t) => t.id), doctrine: last?.doctrine ?? PRESETS.standard.doctrine,
      difficulty: last?.difficulty, control: last?.control,
      backLabel: 'MAIN MENU',
      onBack: () => { location.search = ''; },
      onReroll: () => {
        const fresh = poolFor(++roll);
        return { pool: fresh, portraits: portraitMap(this.assets, fresh) };
      },
      onDeploy: (ids, doctrine, difficulty, control) => {
        try { localStorage.setItem('hullbreach.quick', JSON.stringify({ doctrine, difficulty, control })); } catch { /* private mode */ }
        const diff = isDefaultDifficulty(difficulty) ? '' : `&diff=${difficultyString(difficulty)}`;
        location.search = `?seed=${seed}&go=1&squad=${ids.join(',')}${roll ? `&pool=${roll}` : ''}&doc=${doctrineString(doctrine)}${diff}${control === 'lead' ? '&ctrl=lead' : ''}`;
      },
    });
  }

  /** A quick-play run from the URL: ?seed=&go=1[&squad=c0,c3,c5,c6&pool=2&doc=...&diff=...&ctrl=lead]. */
  startQuick(seed) {
    const pool = candidatePool(seed, 8, params.pool);
    const squad = (params.squad ?? []).map((id) => pool.find((t) => t.id === id)).filter(Boolean)
      .map((t) => ({ ...t, rank: rankFor(levelFor(t.xp)) }));
    // No squad in the URL (tools, old links): the standard four at baseline stats.
    const level = generateLevel(seed, { mods: withDifficulty({}, parseDifficulty(params.diff)) });
    this.start(level, { squad: squad.length ? squad : null, doctrine: parseDoctrine(params.doc), control: params.ctrl === 'lead' ? 'lead' : 'squad' });
  }

  // ------------------------------------------------------------------ campaign flow

  newCampaign() {
    clearProfile();
    this.profile = newProfile();
    saveProfile(this.profile);
    this.showCommand();
  }

  showCommand() {
    this.hud.hideStart();
    this.hud.root.classList.add('menu');
    this.commandScreen?.dispose();
    this.commandScreen = new CommandScreen(this.hud.root, {
      profile: this.profile,
      assets: this.assets,
      onDeploy: (offer, squad, doctrine, difficulty, control) => {
        // The difficulty rides in the ship's mods (meta/difficulty.js).
        saveRun({ seed: offer.seed, threat: offer.threat, mods: withDifficulty(offer.mods, difficulty), reward: offer.reward, name: offer.name, squad, doctrine, difficulty, control });
        this.profile.seedCounter++;
        saveProfile(this.profile);
        location.search = '?run=1';
      },
      onQuit: () => { location.search = ''; },
    });
  }

  startCampaignRun(run) {
    const p = this.profile;
    const squad = run.squad.map((id) => p.roster.find((t) => t.id === id && t.alive)).filter(Boolean)
      .map((t) => ({ ...t, mods: trooperMods(t), rank: rankFor(levelFor(t.xp)) }));
    const level = generateLevel(run.seed, { threat: run.threat, mods: run.mods });
    this.campaignRun = run;
    this.start(level, { squad, upgrades: p.upgrades, rewardMult: run.reward, shipName: run.name, doctrine: run.doctrine, campaign: true, control: run.control });
    const settle = () => setTimeout(() => this.debriefRun(), 1600);
    this.world.on('won', settle);
    this.world.on('lost', settle);
  }

  debriefRun() {
    const result = this.world.results();
    const debrief = applyRun(this.profile, result);
    saveProfile(this.profile);
    saveRun(null);
    this.loop.paused = true;
    this.hud.root.classList.add('menu');
    new DebriefScreen(this.hud.root, {
      profile: this.profile, debrief, result, shipName: this.campaignRun?.name,
      onContinue: () => { location.search = '?command=1'; },
    });
  }

  // ------------------------------------------------------------------ a run

  start(level, { squad = null, upgrades = {}, rewardMult = 1, shipName = null, doctrine = null, campaign = false, control = 'squad' } = {}) {
    this.hud.hideStart();
    const seed = level.seed;
    this.world = new World(level, { params, squad, upgrades, rewardMult, doctrine, control });
    this.world.shipName = shipName;
    this.input.setMode(this.world.lead ? 'lead' : 'squad');
    this.hud.campaign = campaign;
    this.view = new GameView(this.stage, this.world, this.assets, {
      retro: params.retro ?? pixelMode(),
      fog: !params.nofog,
      onHitStop: (s) => this.loop.freeze(s),
    });
    this.hud.bind(this.world, this.view);
    this.interact.bind(this.world, this.view);
    this.hud.setPortraits(renderPortraits(this.view.renderer.gl, this.assets, this.world.marines));
    this.sfx.bind(this.world);
    this.loop = new Loop(
      (dt) => this.world.step(dt),
      (alpha, dt) => {
        const t0 = performance.now();
        if (this.world.lead) {
          // The controller (or keys and mouse) steers the player's marine: read every frame.
          const p = this.world.player;
          const origin = p ? this.view.toScreen(p.x, p.y + 1.4 * (p.scale ?? 1), p.z) : null;
          const st = this.input.poll(origin);
          if (st.fire || st.moveX) this.sfx.unlock(); // (the sticks and triggers never reach command())
          this.world.steer(st);
        }
        this.view.render(alpha, dt);
        this.hud.update(dt, this.loop.paused);
        this.interact.update();
        this.sfx.update(dt, this.view.camera.center);
        this.debugStats(dt, performance.now() - t0);
        window.__game?.onFrame?.(this.view.renderer.canvas, dt); // test hook (tools/dev/flicker.mjs)
      },
    );
    this.loop.timeScale = params.speed;
    this.loop.start();
    this.hud.minimap.game.onTrackerPing = (blips) => this.sfx.trackerPing(blips);
    console.log(`[game] seed ${seed}: ${level.rooms.length} rooms, ${level.portals.length} connections, ${level.spawns.aliens.length} dormant hostiles`);
  }

  /** ?debug=1 or the backquote key: frame time, draw calls, triangles, entity counts. */
  debugStats(dt, renderMs) {
    if (!this.debugEl) {
      this.debugEl = document.createElement('div');
      this.debugEl.style.cssText = 'position:fixed;left:14px;bottom:90px;font:12px monospace;color:#9fe07a;background:rgba(0,0,0,.6);padding:6px 8px;white-space:pre;pointer-events:none;z-index:9';
      this.debugEl.hidden = !params.debug;
      document.body.appendChild(this.debugEl);
      this.fps = 60;
    }
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    if (this.debugEl.hidden) return;
    const info = this.view.renderer.gl.info;
    const w = this.world;
    const alive = w.aliens.filter((a) => a.alive);
    this.debugEl.textContent = [
      `${this.fps.toFixed(0)} fps  render ${renderMs.toFixed(1)} ms`,
      `draw calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  geo ${info.memory.geometries}`,
      `aliens ${alive.length} (${alive.filter((a) => a.state !== 'dormant').length} active)  debris ${w.physics.debris.length}`,
      `squad ${w.squad.state}${w.squad.engaged ? ' ENGAGED' : ''}  director ${w.director.phase} ${w.director.timer.toFixed(0)}s`,
    ].join('\n');
  }

  command(action, arg) {
    const w = this.world;
    this.sfx.unlock();
    if (!w || w.status !== 'playing') return;
    switch (action) {
      case 'option1': case 'option2': case 'option3': {
        // Only encounters are the player's call; routine decisions follow the standing orders.
        const d = w.squad.decision;
        const opt = d?.encounter ? d.options[Number(action.slice(-1)) - 1] : null;
        if (opt) { w.choose(opt.id); this.sfx.ui(); }
        break;
      }
      case 'pause': this.loop.paused = !this.loop.paused; break;
      case 'cover': if (w.lead) this.input.toggleCover(); else w.toggleCover(); this.sfx.ui(); break;
      case 'turn': if (!w.lead) { w.turnAround(); this.sfx.ui(); } break;
      // Lead mode: A, RB, B - and the D-pad, which walks an encounter's options when a card is up.
      case 'use': if (w.lead) { if (this.interact.encounterOpen()) this.interact.pickHighlighted(); else w.use(); this.sfx.ui(); } break;
      case 'reload': if (w.lead) w.reloadWeapon(); break;
      case 'hold': if (w.lead) { if (this.interact.encounterOpen()) this.interact.pickLast(); else { w.toggleHold(); this.sfx.ui(); } } break;
      case 'pad:up': case 'pad:down': case 'pad:left': case 'pad:right': {
        const dir = action.slice(4);
        if (this.interact.encounterOpen() && (dir === 'up' || dir === 'down')) { this.interact.moveHighlight(dir === 'up' ? -1 : 1); this.sfx.ui(); break; }
        const knob = { left: 'roe', right: 'stims', up: 'light', down: 'kit' }[dir];
        const value = w.doctrine && nextOrder(w.doctrine.cfg, knob);
        if (value) { w.setOrder(knob, value); this.sfx.ui(); }
        break;
      }
      case 'grenade': case 'flare': case 'defend': w.useKit(action); this.sfx.ui(); break;
      case 'nudge': w.nudge(arg); this.sfx.ui(); break;
      case 'move': w.moveTo(arg.room, arg.x); this.sfx.ui(); break;
      case 'order': w.setOrder(arg.knob, arg.value); this.sfx.ui(); break;
      case 'zoomIn': this.view.camera.zoom(-ZOOM_STEP); break;
      case 'zoomOut': this.view.camera.zoom(ZOOM_STEP); break;
      case 'retro': this.view.setRetro(!this.view.renderer.retro); savePixelMode(this.view.renderer.retro); break;
      case 'mute': this.sfx.toggleMute(); break;
      case 'debug': if (this.debugEl) this.debugEl.hidden = !this.debugEl.hidden; break;
      default:
        // Order hotkeys: the next option of that standing order.
        if (action.startsWith('cycle:')) {
          const knob = action.slice(6);
          const value = w.doctrine && nextOrder(w.doctrine.cfg, knob);
          if (value) { w.setOrder(knob, value); this.sfx.ui(); }
        }
    }
  }
}

const game = new Game();
game.boot();
