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
  applyRun, clearProfile, deployable, levelFor, loadProfile, loadRun, newProfile, rankFor, saveProfile, saveRun, trooperMods,
} from './meta/profile.js';
import { nodeOffer, reachable } from './meta/sector.js';
import { contractFor } from './gen/contracts.js';
import { candidatePool } from './meta/candidates.js';
import { HULL_CLASSES, classFor, parseSeed, seedCode } from './gen/classes.js';
import { storyFor } from './gen/stories.js';
import { DEFAULT_DIFFICULTY, difficultyString, isDefaultDifficulty, parseDifficulty, withDifficulty } from './meta/difficulty.js';
import { heatPay, heatSquad, heatString, parseHeat, withHeat } from './meta/heat.js';
import { DAILY_IDS, dailySeed, dailySquad, dailyStatus, dailyStreak, dayKey, dayLabel, foldDaily, loadDaily, saveDaily, scoreRun } from './meta/daily.js';
import { campaignStarted, issueWeapons, loadRecord, lockedHulls, recordRun, saveRecord, sectorCleared, unlockedArchetypes } from './meta/record.js';
import { portraitMap } from './render/portraits.js';
import { PRESETS, doctrineString, nextOrder, parseDoctrine } from './sim/doctrine.js';
import { Interact } from './ui/interact.js';
import { DebriefScreen } from './ui/debrief.js';
import { LaunchScreen } from './ui/launch.js';
import { MapOverlay } from './ui/map.js';

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
    this.map = new MapOverlay(this.hud.root, this); // the ship map (Tab / Back): pauses the run while open
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
    this.record = loadRecord(); // the service record (meta/record.js): every campaign, quick play and daily
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
    else this.hud.showStart(seed, { hasCampaign: !!this.profile, daily: this.dailyInfo(), record: this.record });
    window.__game = {
      ready: !!this.world || true,
      record: () => this.record,
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

  /**
   * Pick 4 of the ship's 8 candidates, the standing orders and the difficulty, then board
   * (reload). The seed may name its hull ('STN-A1B2C3'); the briefing lets the player pick one.
   */
  showQuickBriefing(code) {
    this.hud.hideStart();
    this.hud.root.classList.add('menu');
    const { cls: hull, seed } = parseSeed(code);
    const cls = classFor(seed, hull);
    const job = this.quickJob ?? params.job ?? null; // the contract the player picked, else the seed's roll (gen/contracts.js)
    // The ship's candidates - or a fresh set each time the player rerolls (carried as &pool=).
    let roll = 0;
    const poolFor = (r) => candidatePool(seed, 8, r).map((t) => ({ ...t, rank: rankFor(levelFor(t.xp)) }));
    const pool = poolFor(0);
    let last = null;
    try { last = JSON.parse(localStorage.getItem('hullbreach.quick') ?? 'null'); } catch { /* none */ }
    this.briefing?.dispose();
    this.briefing = new LaunchScreen(this.hud.root, {
      heading: 'QUICK PLAY · BRIEFING', pool, portraits: portraitMap(this.assets, pool),
      ship: { name: `Derelict ${seedCode(cls, seed)}`, size: HULL_CLASSES[cls].label, cls, blurb: HULL_CLASSES[cls].blurb, story: storyFor(seed, cls), threat: 0, modifiers: [], contract: contractFor(seed, { want: job }) }, // (no job named: the seed's roll)
      hull, onHull: (k) => this.showQuickBriefing(k ? seedCode(k, seed) : seed),
      job, onJob: (k) => { this.quickJob = k; this.showQuickBriefing(code); },
      selected: pool.slice(0, 4).map((t) => t.id), doctrine: last?.doctrine ?? PRESETS.standard.doctrine,
      difficulty: last?.difficulty, control: last?.control, heat: last?.heat,
      lockedHulls: lockedHulls(this.record), // (the service record's unlocks, meta/record.js)
      backLabel: 'MAIN MENU',
      onBack: () => { location.search = ''; },
      onReroll: () => {
        const fresh = poolFor(++roll);
        return { pool: fresh, portraits: portraitMap(this.assets, fresh) };
      },
      onDeploy: (offer, ids, doctrine, difficulty, control, heat) => {
        try { localStorage.setItem('hullbreach.quick', JSON.stringify({ doctrine, difficulty, control, heat })); } catch { /* private mode */ }
        const diff = isDefaultDifficulty(difficulty) ? '' : `&diff=${difficultyString(difficulty)}`;
        location.search = `?seed=${hull ? seedCode(hull, seed) : seed}&go=1&squad=${ids.join(',')}${roll ? `&pool=${roll}` : ''}&doc=${doctrineString(doctrine)}${diff}${control === 'lead' ? '&ctrl=lead' : ''}${job ? `&job=${job}` : ''}${heat.length ? `&heat=${heatString(heat)}` : ''}`;
      },
    });
  }

  // ------------------------------------------------------------------ the daily derelict

  /** Today (meta/daily.js): its seed, its label, how the player has done on it so far. */
  dailyInfo() {
    const day = dayKey();
    const ledger = loadDaily();
    return { day, label: dayLabel(day), seed: dailySeed(day), status: dailyStatus(ledger, day), streak: dailyStreak(ledger, day) };
  }

  /**
   * The daily's briefing: the day's ship and its four troopers, the orders and difficulty
   * fixed; the player's choices are the command and the heat (which multiplies the score).
   */
  showDailyBriefing() {
    this.hud.hideStart();
    this.hud.root.classList.add('menu');
    const { day, label, seed } = this.dailyInfo();
    const cls = classFor(seed);
    const pool = dailySquad(seed).map((t) => ({ ...t, rank: rankFor(levelFor(t.xp)) }));
    let last = null;
    try { last = JSON.parse(localStorage.getItem('hullbreach.quick') ?? 'null'); } catch { /* none */ }
    this.briefing?.dispose();
    this.briefing = new LaunchScreen(this.hud.root, {
      heading: `DAILY DERELICT · ${label}`, pool, portraits: portraitMap(this.assets, pool), daily: true, fixed: true,
      ship: { name: `Derelict ${seedCode(cls, seed)}`, size: HULL_CLASSES[cls].label, cls, blurb: HULL_CLASSES[cls].blurb, story: storyFor(seed, cls), threat: 0, modifiers: [], contract: contractFor(seed) },
      selected: DAILY_IDS, doctrine: PRESETS.standard.doctrine, difficulty: DEFAULT_DIFFICULTY, control: last?.control, heat: last?.heat,
      backLabel: 'MAIN MENU',
      onBack: () => { location.search = ''; },
      onDeploy: (offer, ids, doctrine, difficulty, control, heat) => {
        try { localStorage.setItem('hullbreach.quick', JSON.stringify({ ...(last ?? {}), control, heat })); } catch { /* private mode */ }
        location.search = `?seed=${seed}&go=1&squad=${ids.join(',')}&daily=${day}${control === 'lead' ? '&ctrl=lead' : ''}${heat.length ? `&heat=${heatString(heat)}` : ''}`;
      },
    });
  }

  /**
   * A quick-play run from the URL: ?seed=&go=1[&squad=c0,c3,c5,c6&pool=2&doc=...&diff=...&ctrl=lead&heat=...].
   * The daily (&daily=YYYY-MM-DD, meta/daily.js) runs with standard orders and normal difficulty, scored at the end.
   */
  startQuick(code) {
    const { seed, cls: hull } = parseSeed(code);
    const daily = params.daily ?? null;
    const heat = parseHeat(params.heat);
    const pool = candidatePool(seed, 8, params.pool);
    let squad = (params.squad ?? []).map((id) => pool.find((t) => t.id === id)).filter(Boolean)
      .map((t) => ({ ...t, rank: rankFor(levelFor(t.xp)) }));
    // A skeleton crew (meta/heat.js) is three: the first three named, or the ship's first three.
    if (heatSquad(heat) < 4) squad = (squad.length ? squad : pool.map((t) => ({ ...t, rank: rankFor(levelFor(t.xp)) }))).slice(0, heatSquad(heat));
    // No squad in the URL (tools, old links): the standard four at baseline stats.
    const mods = withHeat(withDifficulty(params.boss ? { boss: true } : {}, daily ? DEFAULT_DIFFICULTY : parseDifficulty(params.diff)), heat);
    const level = generateLevel(code, { mods, contract: params.boss ? 'queen' : (daily ? null : params.job) ?? contractFor(seed).kind });
    this.quick = { mode: daily ? 'daily' : 'quick', day: daily, cls: classFor(seed, hull), heat, lead: params.ctrl === 'lead' };
    this.start(level, { squad: squad.length ? squad : null, doctrine: daily ? parseDoctrine(null) : parseDoctrine(params.doc), control: params.ctrl === 'lead' ? 'lead' : 'squad' });
  }

  /**
   * A quick-play or daily run over: the service record takes it (meta/record.js), the daily's
   * score goes in the ledger (meta/daily.js), and the end screen (ui/hud.js showEnd) reads both.
   */
  finishQuick() {
    const q = this.quick ?? { mode: 'quick', heat: [], cls: null, lead: false, day: null };
    const result = this.world.results();
    let daily = null;
    if (q.mode === 'daily' && q.day) {
      const score = scoreRun(result, q.heat);
      const before = dailyStatus(loadDaily(), q.day).best?.score ?? 0;
      const ledger = foldDaily(loadDaily(), q.day, { score: score.total, won: score.won, kills: result.kills, time: Math.round(result.time), lead: q.lead, heat: q.heat });
      saveDaily(ledger);
      const s = dailyStatus(ledger, q.day);
      daily = { day: q.day, label: dayLabel(q.day), score, best: s.best?.score ?? score.total, newBest: s.plays > 1 && score.total > before, plays: s.plays, streak: dailyStreak(ledger, q.day) };
    }
    const unlocks = recordRun(this.record, result, { mode: q.mode, cls: q.cls, heat: q.heat, lead: q.lead, score: daily?.score.total ?? 0 });
    saveRecord(this.record);
    this.endInfo = () => ({ daily, unlocks });
  }

  // ------------------------------------------------------------------ campaign flow

  newCampaign() {
    clearProfile();
    campaignStarted(this.record);
    saveRecord(this.record);
    this.profile = newProfile(undefined, { issue: issueWeapons(this.record) }); // (the record's weapons in the armoury)
    saveProfile(this.profile);
    this.showCommand();
  }

  /** The launch screen (ui/launch.js): the offers, the squad, the contract, one DEPLOY; the Kestrel tab for the shopping. */
  showCommand() {
    this.hud.hideStart();
    this.hud.root.classList.add('menu');
    const p = this.profile;
    this.launch?.dispose();
    // The sector (meta/sector.js): the derelicts in reach of where the Kestrel sits.
    const offers = reachable(p.sector).map((n) => nodeOffer(p.sector, n.id, p.threat));
    this.launch = new LaunchScreen(this.hud.root, {
      profile: p, assets: this.assets, offers, sector: p.sector,
      selected: deployable(p).map((t) => t.id), doctrine: p.doctrine ?? PRESETS.standard.doctrine, difficulty: p.difficulty, control: p.control, heat: p.heat,
      archetypes: unlockedArchetypes(this.record), // the recruits' pool (meta/record.js)
      backLabel: 'MAIN MENU',
      onBack: () => { location.search = ''; },
      onDeploy: (offer, squad, doctrine, difficulty, control, heat) => {
        p.squad = squad;
        p.doctrine = doctrine;
        p.difficulty = difficulty;
        p.control = control;
        p.heat = heat;
        // The difficulty and the heat ride in the ship's mods (meta/difficulty.js, meta/heat.js); the heat pays.
        // The underwriter's terms (meta/events.js 'wire'): the next job pays more and bites harder.
        const boon = p.boon ?? null;
        const mods = withHeat(withDifficulty({ ...offer.mods, contract: offer.contract?.kind ?? null, ...(boon ? { hostiles: (offer.mods.hostiles ?? 1) * 1.25 } : {}) }, difficulty), heat);
        saveRun({ seed: offer.seed, threat: offer.threat, mods, reward: +(offer.reward * (boon?.pay ?? 1) * heatPay(heat)).toFixed(2), name: offer.name, cls: offer.cls, heat, squad, doctrine, difficulty, control, node: offer.node ?? null, bonuses: offer.bonuses ?? [] });
        this.profile.seedCounter++;
        saveProfile(this.profile);
        location.search = '?run=1';
      },
    });
  }

  startCampaignRun(run) {
    const p = this.profile;
    const squad = run.squad.map((id) => p.roster.find((t) => t.id === id && t.alive)).filter(Boolean)
      .map((t) => ({ ...t, mods: trooperMods(t), rank: rankFor(levelFor(t.xp)) }));
    const level = generateLevel(run.seed, { threat: run.threat, mods: run.mods });
    this.campaignRun = run;
    this.start(level, { squad, upgrades: p.upgrades, rewardMult: run.reward, shipName: run.name, doctrine: run.doctrine, campaign: true, control: run.control, relics: p.relics ?? [] });
    const settle = () => setTimeout(() => this.debriefRun(), 1600);
    this.world.on('won', settle);
    this.world.on('lost', settle);
  }

  debriefRun() {
    const result = this.world.results();
    const run = this.campaignRun ?? {};
    const debrief = applyRun(this.profile, result, { node: run.node, bonuses: run.bonuses });
    saveProfile(this.profile);
    saveRun(null);
    // The service record (meta/record.js) takes the run too, and may unlock something.
    const unlocks = recordRun(this.record, result, { mode: 'campaign', cls: run.cls ?? parseSeed(run.seed ?? '').cls ?? null, heat: run.heat ?? [], lead: !!this.world.lead });
    if (debrief.sector?.next) sectorCleared(this.record);
    saveRecord(this.record);
    this.loop.paused = true;
    this.hud.root.classList.add('menu');
    new DebriefScreen(this.hud.root, {
      profile: this.profile, debrief, result, shipName: run.name, unlocks,
      onContinue: () => { location.search = '?command=1'; },
    });
  }

  // ------------------------------------------------------------------ a run

  start(level, { squad = null, upgrades = {}, rewardMult = 1, shipName = null, doctrine = null, campaign = false, control = 'squad', relics = [] } = {}) {
    this.hud.hideStart();
    const seed = level.seed;
    this.world = new World(level, { params, squad, upgrades, rewardMult, doctrine, control, relics });
    this.world.shipName = shipName;
    if (!campaign) { const over = () => this.finishQuick(); this.world.on('won', over); this.world.on('lost', over); } // (before the HUD's own listeners: the end screen reads the result)
    this.input.setMode(this.world.lead ? 'lead' : 'squad');
    this.hud.campaign = campaign;
    this.view = new GameView(this.stage, this.world, this.assets, {
      retro: params.retro ?? pixelMode(),
      fog: !params.nofog,
      onHitStop: (s) => this.loop.freeze(s),
    });
    this.hud.bind(this.world, this.view);
    this.interact.bind(this.world, this.view);
    this.map.bind(this.world);
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
        this.hud.update(dt, this.loop.paused && !this.map.open);
        this.interact.update();
        this.map.update();
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
      case 'pause':
        if (this.map.open) { this.map.toggle(false); this.loop.paused = false; break; }
        this.loop.paused = !this.loop.paused;
        break;
      // The ship map (ui/map.js): the run waits while it's open.
      case 'map': this.map.toggle(); this.loop.paused = this.map.open; this.sfx.ui(); break;
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
