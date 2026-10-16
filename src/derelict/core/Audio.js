// Web Audio: decoded OGG buffers, SFX with pitch/variant/pan and a min gap, one looping music track
// with crossfade, and a couple of looping ambiences (fire, alarm).
export const SFX = [
  'rifle', 'shotgun', 'smg', 'reload_out', 'reload_in', 'empty', 'alien_screech', 'alien_hiss', 'alien_attack',
  'alien_death', 'alien_hurt', 'acid', 'tracker_ping', 'pickup_ammo', 'pickup_med', 'shield_on', 'shield_hit', 'alarm',
  'fire', 'power_down', 'power_up', 'vent_clang', 'step1', 'step2', 'bark', 'jump', 'land', 'dodge', 'player_hurt',
  'player_death', 'hit_flesh1', 'hit_flesh2', 'hit_metal1', 'hit_metal2', 'ui_move', 'ui_confirm', 'ui_back', 'door',
  'wall_hit', 'loot', 'potion', 'room_clear', 'levelup', 'explosion', 'medkit', 'weapon_switch', 'survivor_rescued',
  'crit', 'kill',
];
export const MUSIC = ['music_title', 'music_derelict', 'music_tension', 'music_extract'];

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.sfxGain = null; this.musicGain = null; this.master = null;
    this.music = null; this.musicKey = '';
    this.last = new Map();
    this.loops = new Map();
    this.enabled = true;
    this.listenerX = 0;
  }

  async init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.9; this.master.connect(this.ctx.destination);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.5; this.musicGain.connect(this.master);
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (e) { this.enabled = false; return; }
    const names = [...SFX.map((n) => 'sfx_' + n), ...MUSIC];
    await Promise.all(names.map(async (n) => {
      try {
        const r = await fetch(`assets/sound/${n}.ogg`);
        if (!r.ok) return;
        const buf = await this.ctx.decodeAudioData(await r.arrayBuffer());
        this.buffers.set(n, buf);
      } catch (e) { /* missing sound: silent */ }
    }));
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

  play(key, { volume = 1, rate = 1, detune = 60, variants = 0, minGap = 40, x } = {}) {
    if (!this.ctx || !this.enabled) return null;
    let k = 'sfx_' + key;
    if (variants > 0) k = `sfx_${key}${1 + Math.floor(Math.random() * variants)}`;
    const buf = this.buffers.get(k);
    if (!buf) return null;
    const now = performance.now();
    if (this.last.has(k) && now - this.last.get(k) < minGap) return null;
    this.last.set(k, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * Math.pow(2, ((Math.random() * 2 - 1) * detune) / 1200);
    const g = this.ctx.createGain();
    let vol = volume;
    let node = g;
    if (x !== undefined) {
      const d = Math.abs(x - this.listenerX);
      vol *= Math.max(0, 1 - Math.max(0, d - 220) / 520);
      if (vol <= 0.01) return null;
      const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (pan) { pan.pan.value = Math.max(-0.8, Math.min(0.8, (x - this.listenerX) / 400)); g.connect(pan); node = pan; }
    }
    g.gain.value = vol;
    src.connect(g); node.connect(this.sfxGain);
    src.start();
    return src;
  }

  // Looping ambience keyed by name; volume is set every frame by the caller (0 stops it).
  loop(key, volume, rate = 1) {
    if (!this.ctx || !this.enabled) return;
    let l = this.loops.get(key);
    if (volume <= 0.001) { if (l) { l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); l.fading = true; setTimeout(() => { if (l.fading) { try { l.src.stop(); } catch (e) {} this.loops.delete(key); } }, 400); } return; }
    if (!l) {
      const buf = this.buffers.get('sfx_' + key);
      if (!buf) return;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      src.connect(gain); gain.connect(this.sfxGain); src.start();
      l = { src, gain, fading: false };
      this.loops.set(key, l);
    }
    l.fading = false;
    l.src.playbackRate.value = rate;
    l.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.08);
  }

  playMusic(key, { fade = 1.2, volume = 1 } = {}) {
    if (!this.ctx || !this.enabled) return;
    if (this.musicKey === key) return;
    const buf = this.buffers.get(key);
    if (!buf) return;
    const old = this.music;
    if (old) { old.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3); setTimeout(() => { try { old.src.stop(); } catch (e) {} }, fade * 1000 + 200); }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const gain = this.ctx.createGain(); gain.gain.value = 0;
    src.connect(gain); gain.connect(this.musicGain); src.start();
    gain.gain.setTargetAtTime(volume, this.ctx.currentTime, fade / 3);
    this.music = { src, gain }; this.musicKey = key;
  }

  stopMusic(fade = 0.8) {
    if (!this.music) return;
    const old = this.music;
    old.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    setTimeout(() => { try { old.src.stop(); } catch (e) {} }, fade * 1000 + 200);
    this.music = null; this.musicKey = '';
  }

  stopAll() {
    for (const [k] of this.loops) this.loop(k, 0);
    this.stopMusic(0.3);
  }
}
