// Recorded sound effects: public/assets/audio (all CC0 - see CREDITS.md there), built by
// tools/audio/build-sfx.mjs. Fetched and decoded after the first user gesture, sound by sound;
// Sfx plays its procedural version of anything not (yet) loaded.
const BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/`;

export class Samples {
  constructor(ctx) {
    this.ctx = ctx;
    this.manifest = null;
    this.sounds = {}; // key -> { loop, takes: [{ buffer, lead, dur }] }
    this.last = {};   // key -> the take played last (never the same one twice running)
    this.ready = this.load();
  }

  async load() {
    try {
      const r = await fetch(`${BASE}manifest.json`);
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      this.manifest = await r.json();
    } catch (err) {
      console.warn('[sfx] no recorded sounds, synthesising:', err.message);
      return;
    }
    await Promise.all(Object.entries(this.manifest.sounds).map(async ([key, s]) => {
      try {
        const takes = await Promise.all(s.files.map(async (f) => {
          const r = await fetch(BASE + f.file);
          if (!r.ok) throw new Error(`${f.file} ${r.status}`);
          const buffer = await this.ctx.decodeAudioData(await r.arrayBuffer());
          // MP3s decode with the encoder's delay in front (lead): start after it, loop inside it.
          const lead = Math.min(f.lead ?? 0, buffer.duration);
          return { buffer, lead, dur: Math.min(f.dur ?? buffer.duration, buffer.duration - lead) };
        }));
        this.sounds[key] = { loop: s.loop, takes };
      } catch (err) {
        console.warn(`[sfx] ${key} unavailable:`, err.message);
      }
    }));
  }

  has(key) { return !!this.sounds[key]; }

  /** Take `take` of a sound, or a random one that isn't the last played. */
  pick(key, take) {
    const t = this.sounds[key].takes;
    if (take !== undefined) return t[take % t.length];
    let i = Math.floor(Math.random() * t.length);
    if (t.length > 1 && i === this.last[key]) i = (i + 1) % t.length;
    this.last[key] = i;
    return t[i];
  }

  /**
   * Play a take of `key` into `dest` (Sfx.out: distance, pan, muffle). jitter varies the pitch
   * (and so the length) a little every time, so repeats don't sound copied.
   * @returns {AudioBufferSourceNode|null}
   */
  play(key, dest, { rate = 1, jitter = 0.04, when = 0, loop = false, take } = {}) {
    if (!this.has(key)) return null;
    const t = this.pick(key, take);
    const src = this.ctx.createBufferSource();
    src.buffer = t.buffer;
    if (loop) {
      src.loop = true;
      src.loopStart = t.lead;
      src.loopEnd = t.lead + t.dur;
    }
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * jitter);
    src.connect(dest);
    src.start(when || this.ctx.currentTime, t.lead);
    return src;
  }
}
