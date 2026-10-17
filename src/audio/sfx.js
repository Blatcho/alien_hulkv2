// Sound. Recorded CC0 effects (./samples.js, public/assets/audio) wherever there is one, with
// WebAudio synthesis behind them: the procedural version of a sound plays until its recording
// has loaded, stands in for anything missing, and is all you hear with ?sfx=synth.
// Everything is panned by world x relative to the camera and attenuated by distance.
// The AudioContext is created on the first user gesture (browser autoplay rules).
import { WEAPONS } from '../core/config.js';
import { Samples } from './samples.js';

// Shot samples for guns without recordings of their own (sfx.gunshot).
export const SHOT_ALIAS = {
  pistol: { key: 'shot_marksman', rate: 1.25, vol: 0.85 },
  minigun: { key: 'shot_heavy', rate: 1.4, vol: 0.55 },
};

// Guns whose fire is one continuous recording rather than a shot per round: the loop runs from
// a burst's first round for as long as rounds keep coming, then its tail plays (sfx.fireLoop).
export const FIRE_LOOP = {
  carbine: { key: 'fire_carbine', tail: 'fire_carbine_tail' },
};

// The mix: level of each recorded sound (build-sfx.mjs matches loudness within each sound;
// this balances them against each other). Every key here is in public/assets/audio/manifest.json.
export const MIX = {
  ambience: 0.5, ambience_drone: 0.32, ambience_thud: 0.3, ambience_beep: 0.16, spark: 0.18, alarm: 0.16,
  shot_carbine: 0.55, fire_carbine: 0.6, fire_carbine_tail: 0.5, shot_heavy: 0.7, shot_heavy_tail: 0.7, shot_breacher: 0.75, shot_marksman: 0.6, reload: 0.3,
  alien_hiss: 0.4, alien_growl: 0.45, alien_screech: 0.45, alien_attack: 0.5, alien_death: 0.35, alien_hit: 0.3,
  armor_hit: 0.3, explosion: 0.9, explosion_sub: 0.7, clang: 0.4, door: 0.4, airlock: 0.45, footstep: 0.2,
  tracker: 0.25, ui_prompt: 0.3, ui_ok: 0.3, ui_fail: 0.3, ui_order: 0.25, loot: 0.3,
};

export class Sfx {
  constructor({ synthOnly = false } = {}) {
    this.ctx = null;
    this.muted = false;
    this.synthOnly = synthOnly;
    this.cx = 0;
    this.stepT = 0;
    this.shotBudget = {}; // weapon -> recent shots: each gun has its own, so none drowns the others out
    this.tails = new Map(); // shooter -> the burst tail queued behind their last shot
    this.loops = new Map(); // shooter -> their gun's fire loop while they're firing (FIRE_LOOP)
    this.ambT = 4;
    this.lastPlay = {};
    this.fires = new Map(); // burning doorways: portal id -> x (crackle while they burn)
    this.crackleT = 0;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    this.comp = comp;
    const len = this.ctx.sampleRate * 1.5;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ambient();
    if (this.synthOnly) return;
    this.samples = new Samples(this.ctx);
    this.samples.ready.then(() => this.ambience());
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
  }

  // ------------------------------------------------------------------ building blocks

  out(x, vol = 1, muffle = false) {
    const c = this.ctx;
    const g = c.createGain();
    let node = g;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      g.connect(p);
      node = p;
      g.pan = p;
    }
    this.place(g, x, vol);
    if (muffle) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500;
      node.connect(f);
      node = f;
    }
    node.connect(this.master);
    return g;
  }

  /** Level and pan for world x (undefined = centred) on a node from out() - again later, if it moves. */
  place(g, x, vol = 1) {
    const dx = x === undefined ? 0 : x - this.cx;
    g.gain.value = vol * Math.max(0.08, 1 - Math.abs(dx) / 40);
    if (g.pan) g.pan.pan.value = Math.max(-0.9, Math.min(0.9, dx / 18));
  }

  /**
   * A recorded take of `key` at world x (undefined = centred), at `vol` times its MIX level.
   * gap: skip it if the same sound started less than this long ago (a pack waking at once).
   * @returns {boolean} false when there's no recording - the caller synthesises instead
   */
  play(key, x, vol = 1, { muffle = false, gap = 0, ...opts } = {}) {
    if (this.synthOnly || !this.samples?.has(key)) return false;
    const now = this.ctx.currentTime;
    if (gap && now - (this.lastPlay[key] ?? -1) < gap) return true;
    this.lastPlay[key] = now;
    this.samples.play(key, this.out(x, vol * (MIX[key] ?? 1), muffle), opts);
    return true;
  }

  noise(dest, t, dur, { type = 'bandpass', freq = 1000, q = 1, vol = 1, attack = 0.002, sweep = null } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.0);
    src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, { type = 'sine', freq = 440, to = null, vol = 0.5, attack = 0.005 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------ the ship

  /** Synthesised hull drone: plays from the first gesture until the recorded beds take over. */
  ambient() {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.07;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    for (const [freq, type] of [[43, 'sawtooth'], [43.4, 'sawtooth'], [64.7, 'triangle']]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.connect(f);
      o.start();
    }
    const n = c.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    const nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 90;
    const ng = c.createGain();
    ng.gain.value = 0.6;
    n.connect(nf).connect(ng).connect(f);
    n.start();
    // Its own fader, so the recorded beds can crossfade it out.
    this.drone = c.createGain();
    f.connect(g).connect(this.drone).connect(this.master);
    // Slow LFO "breathing" of the hull.
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = 0.07;
    lg.gain.value = 0.03;
    lfo.connect(lg).connect(g.gain);
    lfo.start();
  }

  /** The recorded hull: two looping beds (stereo room tone + a low drone) replace the synth drone. */
  ambience() {
    if (this.synthOnly || this.beds || !this.samples.has('ambience')) return;
    const c = this.ctx;
    const t = c.currentTime;
    this.drone.gain.setTargetAtTime(0, t, 1.5);
    this.beds = c.createGain();
    this.beds.gain.setValueAtTime(0, t);
    this.beds.gain.linearRampToValueAtTime(1, t + 5);
    this.beds.connect(this.master);
    for (const key of ['ambience', 'ambience_drone']) {
      const g = c.createGain();
      g.gain.value = MIX[key];
      g.connect(this.beds);
      this.samples.play(key, g, { loop: true, jitter: 0 });
    }
  }

  /** Now and then over the beds: a thud in the hull, a terminal chirping, a cable shorting out. */
  ambienceTick(dt) {
    if (!this.beds || (this.ambT -= dt) > 0) return;
    this.ambT = 3 + Math.random() * 9;
    const x = this.cx + (Math.random() * 2 - 1) * 24;
    const r = Math.random();
    if (r < 0.5) this.play('ambience_beep', x, 0.6 + Math.random() * 0.6, { muffle: Math.random() < 0.4 });
    else if (r < 0.85) this.play('ambience_thud', x, 1, { muffle: true, rate: 0.75 + Math.random() * 0.3 });
    else this.play('spark', x);
  }

  /** The uplink hold: a ship's siren somewhere behind the bulkheads until it's done. */
  alarm(on) {
    if (on && !this.siren && !this.synthOnly && this.samples?.has('alarm')) {
      const g = this.out(undefined, MIX.alarm, true);
      this.siren = { g, src: this.samples.play('alarm', g, { loop: true, jitter: 0 }) };
    } else if (!on && this.siren) {
      this.siren.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      this.siren.src.stop(this.ctx.currentTime + 2.5);
      this.siren = null;
    }
  }

  airlock(x) { if (!this.play('airlock', x)) this.door(x); }

  /** A deck's power dying (a long falling whine and a thunk) or coming back (a rising hum). */
  power(on) {
    const t = this.ctx.currentTime;
    const o = this.out(undefined, 0.35);
    this.tone(o, t, 1.4, { type: 'sawtooth', freq: on ? 40 : 170, to: on ? 150 : 28, vol: 0.18, attack: 0.05 });
    if (on) this.play('ui_ok', undefined, 0.8);
    else this.play('ambience_thud', undefined, 1.4) || this.noise(o, t + 0.05, 0.5, { type: 'lowpass', freq: 300, vol: 0.6 });
  }

  /** Fire crackle: little bursts of noise near each burning doorway. */
  crackle(dt) {
    if (!this.fires.size || (this.crackleT -= dt) > 0) return;
    this.crackleT = 0.06 + Math.random() * 0.18;
    for (const x of this.fires.values()) {
      const o = this.out(x, 0.12 + Math.random() * 0.12);
      this.noise(o, this.ctx.currentTime, 0.04 + Math.random() * 0.08, { type: 'bandpass', freq: 1800 + Math.random() * 2500, q: 0.8, vol: 0.8 });
    }
  }

  // ------------------------------------------------------------------ effects

  gunshot(x, weapon = 'carbine', shooter = null) {
    const L = FIRE_LOOP[weapon];
    if (L && shooter && !this.synthOnly && this.samples?.has(L.key)) { this.fireLoop(x, weapon, shooter, L); return; }
    if ((this.shotBudget[weapon] ?? 0) > 10) return;
    this.shotBudget[weapon] = (this.shotBudget[weapon] ?? 0) + 1;
    // Guns with no recordings of their own: a pitched relative (the bolt pistol a punchy marksman
    // crack, the minigun a quick, high repeater).
    const alias = SHOT_ALIAS[weapon];
    if (alias && this.play(alias.key, x, alias.vol, { jitter: 0.05, rate: alias.rate })) return;
    if (this.play(`shot_${weapon}`, x, 1, { jitter: 0.04 })) { this.burstTail(x, weapon, shooter); return; }
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.55);
    if (weapon === 'breacher') {
      // Deep boom + pump clack.
      this.noise(o, t, 0.28, { type: 'lowpass', freq: 1800, sweep: 120, vol: 1.0 });
      this.tone(o, t, 0.22, { type: 'sine', freq: 90, to: 35, vol: 0.7 });
      this.noise(o, t + 0.32, 0.05, { type: 'bandpass', freq: 1400, q: 4, vol: 0.5 });
    } else if (weapon === 'marksman') {
      // Sharp crack with a tail.
      this.noise(o, t, 0.06, { type: 'highpass', freq: 2500, vol: 1.0 });
      this.noise(o, t + 0.02, 0.5, { type: 'bandpass', freq: 900, q: 0.8, sweep: 250, vol: 0.35 });
      this.tone(o, t, 0.12, { type: 'square', freq: 220, to: 60, vol: 0.3 });
    } else if (weapon === 'heavy') {
      this.noise(o, t, 0.1, { type: 'lowpass', freq: 2200, sweep: 300, vol: 0.9 });
      this.tone(o, t, 0.08, { type: 'square', freq: 100, to: 40, vol: 0.45 });
    } else {
      this.noise(o, t, 0.12, { type: 'lowpass', freq: 3200, sweep: 400, vol: 0.9 });
      this.tone(o, t, 0.09, { type: 'square', freq: 140, to: 50, vol: 0.35 });
      this.noise(o, t + 0.01, 0.05, { type: 'highpass', freq: 5000, vol: 0.2 });
    }
  }

  /**
   * A gun recorded as continuous fire (FIRE_LOOP): a round starts its loop at the shooter, or
   * keeps it going; it stops - with its tail - once no round has come for a round and a half
   * (update). The loop follows the shooter about (place).
   */
  fireLoop(x, weapon, shooter, L) {
    const now = this.ctx.currentTime;
    const until = now + 1.6 / (WEAPONS[weapon]?.rate ?? 8);
    const f = this.loops.get(shooter);
    if (f && f.key === L.key) { f.until = until; f.x = x; return; }
    if (f) this.endLoop(shooter, f);
    const g = this.out(x, MIX[L.key] ?? 1);
    g.gain.setValueAtTime(0.0001, now);
    const src = this.samples.play(L.key, g, { loop: true, jitter: 0.03 });
    if (!src) return;
    this.place(g, x, MIX[L.key] ?? 1);
    this.loops.set(shooter, { key: L.key, tail: L.tail, src, g, x, until, vol: MIX[L.key] ?? 1 });
  }

  /** The loop stops (a quick fade, no click) and the burst's end rings out where it was. */
  endLoop(shooter, f = this.loops.get(shooter)) {
    if (!f) return;
    this.loops.delete(shooter);
    const now = this.ctx.currentTime;
    f.g.gain.cancelScheduledValues(now);
    f.g.gain.setValueAtTime(f.g.gain.value, now);
    f.g.gain.linearRampToValueAtTime(0.0001, now + 0.03);
    try { f.src.stop(now + 0.05); } catch { /* already stopped */ }
    if (f.tail) this.play(f.tail, f.x, 1, { jitter: 0.04 });
  }

  /**
   * The room ringing after the last round of a burst (for guns whose shots are cut dry out of a
   * burst): queued a round and a bit behind every shot, and cancelled by the shooter's next one.
   */
  burstTail(x, weapon, shooter) {
    const key = `shot_${weapon}_tail`;
    if (!shooter || this.synthOnly || !this.samples?.has(key)) return;
    const now = this.ctx.currentTime;
    const queued = this.tails.get(shooter);
    if (queued && queued.when > now) queued.src.stop();
    const when = now + 1.3 / (WEAPONS[weapon]?.rate ?? 8);
    this.tails.set(shooter, { when, src: this.samples.play(key, this.out(x, MIX[key]), { when, jitter: 0.03 }) });
  }

  /** A power weapon cutting the air: a quick filtered rush and the field's hum. */
  whoosh(x, pitch = 1) {
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.4);
    this.noise(o, t, 0.22, { type: 'bandpass', freq: 600 * pitch, q: 1.2, sweep: 2400 * pitch, vol: 0.7, attack: 0.04 });
    this.tone(o, t, 0.25, { type: 'sawtooth', freq: 110 * pitch, to: 160 * pitch, vol: 0.12, attack: 0.03 });
  }

  /** The minigun's barrels winding up. */
  spinUp(x) {
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.35);
    this.tone(o, t, 0.7, { type: 'sawtooth', freq: 70, to: 260, vol: 0.18, attack: 0.05 });
    this.noise(o, t, 0.7, { type: 'bandpass', freq: 900, q: 3, sweep: 2600, vol: 0.25, attack: 0.1 });
  }

  /** A round into something alive. */
  splat(x) {
    if (this.play('alien_hit', x, 1, { gap: 0.06, jitter: 0.1 })) return;
    const t = this.ctx.currentTime;
    this.noise(this.out(x, 0.35), t, 0.14, { type: 'bandpass', freq: 700, q: 2, sweep: 200, vol: 0.7 });
  }

  /** A round into a crate or bulkhead. */
  ping(x) { if (!this.play('armor_hit', x, 0.5, { gap: 0.08, jitter: 0.1 })) this.clang(x, 0.3); }

  screech(x, muffled = false, pitch = 1) {
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.4, muffled);
    this.tone(o, t, 0.55, { type: 'sawtooth', freq: 900 * pitch, to: 380 * pitch, vol: 0.28, attack: 0.03 });
    this.tone(o, t + 0.02, 0.5, { type: 'square', freq: 1310 * pitch, to: 520 * pitch, vol: 0.12, attack: 0.04 });
    this.noise(o, t, 0.5, { type: 'bandpass', freq: 2400, q: 3, sweep: 900, vol: 0.4, attack: 0.03 });
  }

  /** Something wakes: a hiss or a growl (through the walls if it's out of sight). */
  alienWake(x, muffled) {
    const key = Math.random() < 0.6 ? 'alien_hiss' : 'alien_growl';
    if (!this.play(key, x, 1, { muffle: muffled, gap: 0.3, jitter: 0.08 })) this.screech(x, muffled);
  }

  alienLeap(x) { if (!this.play('alien_screech', x, 1, { gap: 0.2, jitter: 0.08 })) this.screech(x, false, 1.3); }

  alienDeath(x) { if (!this.play('alien_death', x, 1, { gap: 0.1, jitter: 0.08 })) this.screech(x, false, 0.7); }

  /** Something small: the same death, higher and quieter. */
  critterDeath(x) { if (!this.play('alien_death', x, 0.45, { rate: 1.6, gap: 0.1, jitter: 0.1 })) this.splat(x); }

  /** Off in the dark, not near yet (the director building up, a wave coming through the vents). */
  distant(key, vol = 1) {
    const x = this.cx + (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 14);
    this.play(key, x, vol, { muffle: true, rate: 0.85 + Math.random() * 0.1 });
  }

  boom(x) {
    if (this.play('explosion', x)) { this.play('explosion_sub', x); return; }
    const t = this.ctx.currentTime;
    const o = this.out(x, 1.0);
    this.noise(o, t, 1.4, { type: 'lowpass', freq: 900, sweep: 60, vol: 1.0, attack: 0.005 });
    this.tone(o, t, 0.9, { type: 'sine', freq: 70, to: 24, vol: 0.9 });
    this.noise(o, t + 0.05, 0.6, { type: 'bandpass', freq: 2400, q: 0.6, sweep: 400, vol: 0.4 });
    for (let i = 0; i < 5; i++) this.noise(o, t + 0.3 + Math.random() * 0.8, 0.05, { type: 'highpass', freq: 3000, vol: 0.2 });
  }

  /** An alien's strike landing on armour. */
  claw(x) {
    if (this.play('alien_attack', x, 1, { gap: 0.15, jitter: 0.08 })) { this.play('armor_hit', x, 0.8); return; }
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.5);
    this.noise(o, t, 0.1, { type: 'highpass', freq: 2500, sweep: 7000, vol: 0.6 });
    this.tone(o, t + 0.04, 0.15, { type: 'triangle', freq: 180, to: 90, vol: 0.4 });
  }

  door(x, open = true) {
    if (this.play('door', x, open ? 1 : 0.8, { rate: open ? 1 : 0.92, jitter: 0.03 })) return;
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.5);
    this.noise(o, t, 0.7, { type: 'bandpass', freq: 2200, q: 0.7, sweep: 700, vol: 0.35, attack: 0.05 });
    this.tone(o, t + 0.6, 0.25, { type: 'square', freq: 70, to: 40, vol: 0.4 });
  }

  clang(x, vol = 1, muffle = false) {
    if (this.play('clang', x, vol, { muffle, gap: 0.05, jitter: 0.06 })) return;
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.45 * vol, muffle);
    for (const f of [320, 471, 689]) this.tone(o, t, 0.6, { type: 'triangle', freq: f, vol: 0.15 });
    this.noise(o, t, 0.08, { type: 'bandpass', freq: 1800, vol: 0.5 });
  }

  reload(x) {
    if (this.play('reload', x)) return;
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.35);
    this.noise(o, t, 0.05, { type: 'highpass', freq: 3000, vol: 0.5 });
    this.noise(o, t + 0.9, 0.06, { type: 'bandpass', freq: 1600, q: 3, vol: 0.7 });
    this.tone(o, t + 1.6, 0.05, { type: 'square', freq: 900, vol: 0.2 });
  }

  footstep(x) {
    if (this.play('footstep', x, 1, { jitter: 0.08 })) return;
    const t = this.ctx.currentTime;
    const o = this.out(x, 0.18);
    this.tone(o, t, 0.08, { type: 'sine', freq: 90, to: 55, vol: 0.6 });
    this.noise(o, t, 0.04, { type: 'bandpass', freq: 1200, q: 1.5, vol: 0.25 });
  }

  /** The motion tracker's sweep: faint when clear, louder and higher the closer the nearest blip. */
  trackerPing(blips) {
    if (!this.ctx) return;
    const near = blips.length ? Math.min(...blips.map((b) => b.d)) : Infinity;
    if (this.play('tracker', undefined, blips.length ? 1 : 0.35, { rate: blips.length ? 1 + Math.max(0, 30 - near) / 40 : 0.94, jitter: 0 })) return;
    const t = this.ctx.currentTime;
    const f = blips.length ? 1200 + Math.max(0, 30 - near) * 45 : 1150;
    const o = this.out(undefined, blips.length ? 0.22 : 0.07);
    this.tone(o, t, 0.16, { type: 'sine', freq: f, vol: 0.5 });
    if (blips.length) this.tone(o, t + 0.09, 0.1, { type: 'sine', freq: f * 1.5, vol: 0.2 });
  }

  chime() {
    if (this.play('loot')) return;
    const t = this.ctx.currentTime;
    const o = this.out(undefined, 0.25);
    this.tone(o, t, 0.15, { type: 'triangle', freq: 880, vol: 0.4 });
    this.tone(o, t + 0.08, 0.25, { type: 'triangle', freq: 1320, vol: 0.4 });
  }

  stinger(low = false) {
    const t = this.ctx.currentTime;
    const o = this.out(undefined, 0.35);
    const base = low ? 55 : 110;
    for (const r of [1, 1.19, 1.5]) this.tone(o, t, 1.8, { type: 'sawtooth', freq: base * r, to: base * r * (low ? 0.8 : 1.02), vol: 0.12, attack: 0.02 });
  }

  ui() {
    if (!this.ctx || this.play('ui_order')) return;
    this.tone(this.out(undefined, 0.15), this.ctx.currentTime, 0.06, { type: 'square', freq: 660, vol: 0.3 });
  }

  click() { if (!this.ctx) return; this.noise(this.out(undefined, 0.2), this.ctx.currentTime, 0.03, { type: 'highpass', freq: 3000, vol: 0.5 }); }
  stim() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noise(this.out(undefined, 0.3), t, 0.4, { type: 'highpass', freq: 4000, sweep: 1500, vol: 0.4 });
  }

  // ------------------------------------------------------------------ wiring

  bind(world) {
    this.world = world;
    const on = (type, fn) => world.on(type, (e) => { if (this.ctx && !this.muted) fn(e); });
    on('shot', ({ marine, weapon }) => this.gunshot(marine.x, weapon, marine));
    on('hit', ({ entity }) => {
      if (entity.kind === 'prop') this.ping(entity.x);
      else if (entity.kind !== 'marine') this.splat(entity.x);
    });
    on('kill', ({ entity }) => {
      if (entity.kind === 'alien') this.alienDeath(entity.x);
      else if (entity.kind === 'critter') this.critterDeath(entity.x);
      else if (entity.kind === 'marine' || entity.kind === 'survivor') this.stinger(true);
    });
    on('alien-wake', ({ alien }) => this.alienWake(alien.x, !alien.visible));
    on('alien-leap', ({ alien }) => this.alienLeap(alien.x));
    on('alien-drop', ({ alien }) => this.alienLeap(alien.x)); // off the ceiling onto the squad
    on('alien-climb', ({ alien }) => this.clang(alien.x, 0.35)); // claws on the bulkhead
    on('strike', ({ alien }) => this.claw(alien.x));
    on('buildup', () => this.distant('alien_growl', 2.2));
    on('wave', () => this.distant('alien_screech'));
    on('explosion', ({ x }) => this.boom(x));
    on('prop-destroyed', ({ entity }) => { if (!entity.explosive) this.clang(entity.x); });
    on('door-work', ({ portal }) => this.play('ambience_beep', portal.x, 2.5, { gap: 0.5 })); // the door panel
    on('door', ({ portal, open }) => this.door(portal.x, open));
    on('door-forced', ({ portal }) => this.clang(portal.x));
    on('vent-emerge', ({ vent }) => { this.clang(vent.x); this.alienWake(vent.x, false); });
    on('vent-enter', ({ vent }) => this.clang(vent.x, 0.6, true));
    on('airlock-cycle', () => this.airlock(world.squad.leader?.x));
    on('reload', ({ marine }) => this.reload(marine.x));
    on('downed', () => this.stinger(true));
    // The hive's habits.
    on('scream-start', ({ alien }) => this.play('alien_screech', alien.x, 1.6, { rate: 0.7, gap: 0.3 }) || this.screech(alien.x, false, 2));
    on('scream', ({ called }) => { this.distant('alien_screech', 1.4); if (called) this.distant('alien_growl', 1.6); });
    on('scream-cut', ({ alien }) => this.play('alien_hit', alien.x, 1.2, { rate: 0.8 }));
    on('birth', ({ alien }) => { this.play('alien_hiss', alien.x, 1.2, { rate: 0.6, gap: 0.2 }); this.splat(alien.x); });
    on('brood-dead', ({ alien }) => this.play('alien_death', alien.x, 1.6, { rate: 0.55 }));
    on('dragged', ({ alien }) => { this.play('alien_growl', alien.x, 1.2, { rate: 0.85, gap: 0.3 }); this.stinger(true); });
    on('taken', ({ alien }) => { this.clang(alien.x); this.play('alien_hiss', alien.x, 1, { rate: 0.8 }); });
    on('alien-flee', ({ alien }) => this.play('alien_hiss', alien.x, 0.9, { rate: 1.3, gap: 0.3 }));
    on('alien-shy', ({ alien }) => this.play('alien_hiss', alien.x, 0.8, { rate: 1.1, gap: 0.5 }));
    // Set pieces.
    on('sentry-online', ({ sentry }) => { this.play('ui_ok', sentry.x, 0.8); this.play('tracker', sentry.x, 0.7, { rate: 1.3 }); });
    on('sentry-shot', ({ sentry }) => this.play('shot_carbine', sentry.x, 0.6, { rate: 1.3, gap: 0.05, jitter: 0.05 }));
    on('sentry-dry', ({ sentry }) => this.clang(sentry.x, 0.3));
    on('hatch', ({ prop }) => { this.play('alien_hiss', prop.x, 1.1, { rate: 1.3, gap: 0.2 }); this.splat(prop.x); });
    on('eggs-burnt', ({ prop }) => this.play('spark', prop.x, 1.6, { rate: 0.45, gap: 0.2 }));
    on('eggs-shot', ({ prop }) => this.splat(prop.x));
    on('pod-opened', ({ prop }) => this.play('airlock', prop.x, 0.6, { rate: 1.5, gap: 0.3 }));
    on('autodoc', ({ prop }) => this.play('ui_ok', prop.x, 0.6, { rate: 0.8 }));
    on('keycard', ({ prop }) => this.play('loot', prop.x, 0.8));
    on('unlocked', ({ portal, cut }) => this.play(cut ? 'spark' : 'door', portal.x, cut ? 1.4 : 0.8));
    // Kit and close quarters.
    on('grenade', ({ marine }) => this.clang(marine.x, 0.25));
    on('flare', ({ x }) => { this.play('spark', x, 1.6, { rate: 0.55, gap: 0.2 }); this.play('spark', x, 1.2, { rate: 0.8 }); });
    on('shove', ({ alien }) => { this.play('armor_hit', alien.x, 1.1, { rate: 0.8, gap: 0.1 }); this.play('alien_hit', alien.x, 0.8, { rate: 1.2 }); });
    // Power weapons: the swing hums through the air, the blow lands with a crack of the field.
    on('melee-swing', ({ marine, weapon }) => this.whoosh(marine.x, weapon === 'fists' ? 0.7 : 1));
    on('melee-hit', ({ x, weapon }) => {
      this.play('spark', x, 1.3, { rate: weapon === 'fists' ? 0.6 : 0.9, gap: 0.05 });
      this.play(weapon === 'fists' ? 'armor_hit' : 'alien_hit', x, 1.1, { rate: weapon === 'fists' ? 0.7 : 1.1, gap: 0.05 });
    });
    on('spin-up', ({ marine }) => this.spinUp(marine.x));
    on('dressing', ({ marine }) => this.play('ui_ok', marine.x, 0.4, { rate: 0.8, gap: 0.5 }));
    on('morale', ({ level, worse }) => { if (worse && (level === 'shaken' || level === 'breaking')) this.stinger(); });
    on('power-out', () => this.power(false));
    on('spit', ({ x }) => this.play('alien_hit', x, 1.8, { rate: 1.5, gap: 0.1 }) || this.splat(x));
    on('acid', ({ x }) => this.play('spark', x, 0.8, { rate: 1.9, gap: 0.08 }));
    on('defend', ({ guns }) => { for (const g of guns) this.clang(g.x, 0.7); this.play('ui_ok', guns[0].x, 0.7, { rate: 0.9 }); });
    // A horde: the alarm through the countdown, then the vents give.
    on('horde-warning', () => { this.distant('alarm', 1.2); this.trackerPing([{ d: 2 }, { d: 3 }, { d: 4 }]); });
    on('horde', () => { this.distant('alien_screech', 1.6); this.distant('alien_growl', 1.4); });
    on('barricade-down', ({ prop }) => { this.clang(prop.x); this.play('armor_hit', prop.x, 1.2); });
    on('welded', ({ portal }) => { this.play('spark', portal.x, 1.3); this.clang(portal.x, 0.7); });
    on('vent-welded', ({ vent }) => { this.play('spark', vent.x, 1.3); this.clang(vent.x, 0.6); });
    on('cut', ({ portal }) => { this.play('explosion_sub', portal.x, 0.8) || this.boom(portal.x); this.clang(portal.x); });
    on('power-on', () => this.power(true));
    on('fire', ({ portal }) => { this.fires.set(portal.id, portal.x); this.play('spark', portal.x, 1.4); });
    on('fire-out', ({ portal }) => { this.fires.delete(portal.id); this.play('spark', portal.x, 1.2, { rate: 0.7 }); });
    on('distress', () => { if (!this.play('ui_prompt')) this.ui(); this.trackerPing([{ d: 4 }]); });
    on('revived', () => { if (!this.play('ui_ok')) this.chime(); });
    on('stim', () => this.stim());
    on('loot', ({ loot }) => { if (loot.type !== 'empty' && loot.type !== 'ambush') this.chime(); });
    on('decision', (d) => { if (d.encounter && !this.play('ui_prompt')) this.ui(); });
    on('encounter', ({ ok }) => { if (ok) this.chime(); else { this.play('ui_fail'); this.stinger(); } });
    on('ambush', () => { this.play('alien_screech', world.squad.leader?.x); this.stinger(); });
    on('uplink-start', () => this.alarm(true));
    on('uplink-done', () => this.alarm(false));
    on('ship-clear', () => this.play('ui_ok'));
    on('won', () => { this.alarm(false); this.stinger(); for (const s of [...this.loops.keys()]) this.endLoop(s); });
    on('lost', () => { this.alarm(false); this.stinger(true); for (const s of [...this.loops.keys()]) this.endLoop(s); });
  }

  update(dt, camCenter) {
    this.cx = camCenter.x;
    for (const w in this.shotBudget) this.shotBudget[w] = Math.max(0, this.shotBudget[w] - dt * 20);
    if (!this.ctx || this.muted) return;
    this.ambienceTick(dt);
    this.crackle(dt);
    // Fire loops: along with their shooters, and over once the rounds stop.
    const now = this.ctx.currentTime;
    for (const [shooter, f] of this.loops) {
      if (now > f.until || !shooter.alive) { this.endLoop(shooter, f); continue; }
      f.x = shooter.x;
      this.place(f.g, f.x, f.vol);
    }
    if (!this.world) return;
    this.stepT -= dt;
    const sq = this.world.squad;
    if (this.stepT <= 0 && sq.order.some((m) => m.moving && m.mode === 'walk')) {
      this.stepT = sq.pace === 'run' ? 0.22 : sq.pace === 'cautious' ? 0.6 : 0.42;
      if (sq.pace !== 'cautious' || Math.random() < 0.3) this.footstep(sq.leader.x);
    }
  }
}
