// Build the game's sound set from the fetched CC0 sources (tools/audio/fetch-sfx.mjs):
// cut each chosen take out of its recording, slice single shots out of full-auto bursts, mix
// to mono (ambience stays stereo), match loudness per role, crossfade loops so they loop
// without a seam, encode small MP3s into public/assets/audio with manifest.json + CREDITS.md.
// Decoding/cutting runs in headless Chrome (WebAudio); MP3 encoding in node (lamejs).
//
// Usage: node tools/audio/build-sfx.mjs            (then audition at /sfx.html)
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { Mp3Encoder } from '@breezystack/lamejs';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const SRC = join(ROOT, 'tools', 'out', 'sfx-src');
const OUT = join(ROOT, 'public', 'assets', 'audio');
const SR = 44100;

const FS = (id) => `freesound/${id}.mp3`;
const K = (pack, f) => `packs/${pack}/Audio/${f}.ogg`;
const O = (pack, f) => `packs/${pack}/${f}.ogg`;
const range = (src, spans, extra = {}) => spans.map(([s, e]) => ({ src, s, e, ...extra }));

// key -> { what the game plays for it }. norm: target peak dBFS (one-shots) or RMS dB (loops).
// shots: n single shots sliced out of a full-auto recording at each shot's attack.
export const SELECTION = {
  ambience: { loop: true, stereo: true, norm: { rms: -21 }, items: [{ src: FS(829563), s: 20, e: 68, xfade: 4 }] },
  ambience_drone: { loop: true, norm: { rms: -23 }, items: [{ src: FS(534018), s: 15.2, e: 48.9, xfade: 3 }] },
  ambience_thud: { norm: { peak: -3 }, items: range(FS(402495), [[5.85, 7.4], [7.5, 9.6], [11.35, 13.6], [16.1, 18.6]], { fo: 0.4 }) },
  ambience_beep: {
    norm: { peak: -6 },
    items: [
      ...['01', '02', '04', '05', '06', '07', '08', '09'].map((n) => ({ src: O('oga-50-sci-fi', `terminal_${n}`) })),
      ...['01', '02', '03'].map((n) => ({ src: O('oga-50-sci-fi', `beep_${n}`) })),
      { src: FS(431901) }, { src: FS(363251), s: 0.05, e: 1.55 }, { src: FS(260103), s: 0, e: 1.5 },
    ],
  },
  door: { norm: { peak: -3 }, items: [{ src: FS(543404) }, { src: FS(543654) }] },
  airlock: { norm: { peak: -2 }, items: [{ src: FS(607265), s: 3.35, e: 8.7, fo: 0.3 }] }, // clunk, bang, hiss
  // Single M4A1 shots, each ringing out with its own echo (overlapping at 8 rounds/s).
  shot_carbine: { norm: { peak: -1 }, items: [854226, 854227, 854228, 854229, 854230, 854231, 854232, 854233].map((id) => ({ src: FS(id), e: 0.6, fo: 0.25, trim: 0.25 })) },
  // Shots cut from a clean burst at ~11 rounds/s (the heavy fires 10): each is dry; the room's
  // ring after the last round is shot_heavy_tail, which Sfx plays when a burst stops.
  shot_heavy: { norm: { peak: -1 }, items: [{ src: FS(482122), shots: 6, skip: 2 }] },
  shot_heavy_tail: { norm: { peak: -6 }, items: [{ src: FS(482122), s: 1.37, e: 1.598, fi: 0.01, fo: 0.08 }] },
  shot_breacher: { norm: { peak: -1.5 }, items: [{ src: FS(773873), e: 0.95 }, { src: FS(473846), e: 1.6 }, { src: FS(418435), s: 0.15 }].map((it) => ({ ...it, trim: 0.25 })) },
  shot_marksman: { norm: { peak: -1.5 }, items: [{ src: FS(163460) }, { src: FS(351777), s: 0.68, e: 1.7 }].map((it) => ({ ...it, trim: 0.25 })) },
  reload: { norm: { peak: -3 }, items: [{ src: FS(256912), s: 0.5, e: 3.45 }, { src: FS(432141), e: 1.95 }] },
  alien_hiss: { norm: { peak: -3 }, items: [...range(FS(545484), [[0.7, 4.8], [7.9, 10.6], [45.1, 49.2], [52.2, 54.9]], { fo: 0.3 }), { src: FS(763384), s: 0.1 }] },
  alien_growl: { norm: { peak: -3 }, items: range(FS(545484), [[20.0, 21.5], [22.5, 25.7], [27.5, 31.1], [32.3, 37.7]], { fo: 0.3 }) },
  alien_screech: {
    norm: { peak: -2 },
    items: [{ src: FS(565024), s: 2.45, e: 4.9 }, ...range(FS(556535), [[0.1, 2.6], [7.35, 9.32]]),
      { src: O('oga-80-creature', 'alien_02') }, { src: O('oga-80-creature', 'alien_03') }, { src: O('oga-80-creature-2', 'alien_07') }],
  },
  alien_attack: { norm: { peak: -3 }, items: ['attack_02', 'attack_03', 'attack_04'].map((f) => ({ src: O('oga-80-creature-2', f) })).concat([{ src: O('oga-80-creature', 'alien_06') }]) },
  alien_death: { norm: { peak: -2 }, items: ['die_01', 'die_02', 'die_03', 'die_04'].map((f) => ({ src: O('oga-80-creature-2', f) })) },
  alien_hit: { norm: { peak: -8 }, items: ['slime_02', 'slime_03', 'slime_07'].map((f) => ({ src: O('oga-80-creature-2', f) })).concat([{ src: K('kenney-sci-fi', 'slime_000') }]) },
  armor_hit: { norm: { peak: -4 }, items: ['000', '001', '003'].map((n) => ({ src: K('kenney-impact', `impactPlate_heavy_${n}`) })) },
  explosion: { norm: { peak: -1 }, items: [{ src: FS(609587), e: 3.5, fo: 1.2 }, { src: FS(244394), e: 3.5, fo: 1.2 }, { src: K('kenney-sci-fi', 'explosionCrunch_001') }, { src: K('kenney-sci-fi', 'explosionCrunch_004') }] },
  explosion_sub: { norm: { peak: -2 }, items: [{ src: K('kenney-sci-fi', 'lowFrequency_explosion_000') }] },
  clang: {
    norm: { peak: -3 },
    items: [{ src: FS(209772), s: 0.2, e: 2.0 }, ...['000', '001', '003'].map((n) => ({ src: K('kenney-sci-fi', `impactMetal_${n}`) })),
      ...['000', '002', '004'].map((n) => ({ src: K('kenney-impact', `impactPlate_heavy_${n}`) }))],
  },
  footstep: { norm: { peak: -6 }, items: range(FS(698697), [[0, 0.6], [1.48, 1.95], [2.98, 3.65], [4.5, 5.15], [5.99, 6.5], [7.47, 7.9], [8.99, 9.5]]) },
  tracker: { norm: { peak: -6 }, items: range(FS(478187), [[0.15, 0.65], [1.21, 1.71], [4.45, 4.95]]) },
  alarm: { loop: true, norm: { rms: -20 }, items: [{ src: FS(420661), s: 0, e: 8.3, xfade: 0.4 }] },
  spark: { norm: { peak: -4 }, items: [...range(FS(396470), [[0.05, 1.8], [2.1, 3.5], [3.55, 4.2]]), { src: FS(512471) }] },
  ui_prompt: { norm: { peak: -6 }, items: [{ src: K('kenney-interface', 'question_001') }] },
  ui_ok: { norm: { peak: -6 }, items: [{ src: K('kenney-interface', 'confirmation_002') }] },
  ui_fail: { norm: { peak: -6 }, items: [{ src: K('kenney-interface', 'error_003') }] },
  ui_order: { norm: { peak: -9 }, items: [{ src: K('kenney-interface', 'select_003'), e: 0.25 }] },
  loot: { norm: { peak: -6 }, items: [{ src: K('kenney-interface', 'confirmation_004') }] },
};

// ------------------------------------------------------------------ cut / slice / normalise (in Chrome)

async function process(tab, key, def) {
  const items = def.items.map((it) => ({ ...it, stereo: !!def.stereo, loop: !!def.loop, norm: def.norm }));
  return tab.evaluate(async (items, SR) => {
    const ctx = new OfflineAudioContext(1, 1, SR);
    const cache = {};
    const out = [];
    const toB64 = (f32) => { const b = new Uint8Array(f32.buffer); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
    for (const it of items) {
      const buf = cache[it.src] ??= await ctx.decodeAudioData(await (await fetch(`/tools/out/sfx-src/${it.src}`)).arrayBuffer());
      const s = it.s ?? 0;
      const e = Math.min(it.e ?? buf.duration, buf.duration);
      const chans = it.stereo ? 2 : 1;
      const oc = new OfflineAudioContext(chans, Math.ceil((e - s) * SR), SR);
      const node = oc.createBufferSource();
      node.buffer = buf;
      node.connect(oc.destination);
      node.start(0, s, e - s);
      const r = await oc.startRendering();
      const data = [...Array(chans).keys()].map((c) => r.getChannelData(c).slice());
      let pieces = [data];
      if (it.shots) {
        // Single shots out of a burst: slice at each shot's attack (2 ms envelope rising sharply).
        const W = Math.round(SR * 0.002);
        const env = [];
        for (let i = 0; i < data[0].length; i += W) { let m = 0; for (let k = i; k < Math.min(i + W, data[0].length); k++) m = Math.max(m, Math.abs(data[0][k])); env.push(m); }
        const top = Math.max(...env);
        const onsets = [];
        for (let j = 3; j < env.length; j++) {
          if (env[j] > top * 0.45 && env[j] > env[j - 3] * 2.5 && (!onsets.length || j - onsets[onsets.length - 1] > 25)) onsets.push(j);
        }
        if (!onsets.length) onsets.push(0);
        const skip = it.skip ?? 0;
        pieces = onsets.slice(skip, skip + it.shots).map((j, k) => {
          const a = Math.max(0, (j - 2) * W);
          const next = onsets[skip + k + 1];
          const b = next !== undefined ? Math.max(a + W * 20, (next - 1) * W) : Math.min(data[0].length, a + SR * 0.45);
          return data.map((ch) => ch.slice(a, b));
        });
        out.push({ note: `${onsets.length} attacks found` });
      } else if (!it.loop) {
        // Start on the sound: drop leading near-silence (below -30 dB of the take's peak, or
        // `trim` of it - guns start on the shot, not on a click of the action before it).
        let top = 0;
        for (const v of data[0]) top = Math.max(top, Math.abs(v));
        const first = data[0].findIndex((v) => Math.abs(v) > top * (it.trim ?? 0.03));
        const a = Math.max(0, first - Math.round(SR * 0.002));
        if (a > 0) pieces = [data.map((ch) => ch.slice(a))];
      }
      for (const p of pieces) {
        let ch = p;
        const n = ch[0].length;
        if (it.loop) {
          // Seamless loop: overlap the tail onto the head with an equal-power crossfade.
          const X = Math.round((it.xfade ?? 2) * SR);
          const L = n - X;
          ch = ch.map((d) => {
            const o = d.slice(0, L);
            for (let i = 0; i < X; i++) { const t = i / X; o[i] = d[i] * Math.sin(t * Math.PI / 2) + d[i + L] * Math.cos(t * Math.PI / 2); }
            return o;
          });
        } else {
          // Short fade in (no click) and a fade out over the tail.
          const fi = Math.round(SR * (it.fi ?? 0.003));
          const fo = Math.min(Math.round(SR * (it.fo ?? 0.04)), Math.floor(n / 3));
          for (const d of ch) {
            for (let i = 0; i < fi && i < n; i++) d[i] *= i / fi;
            for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
          }
        }
        let peak = 0;
        let sum = 0;
        for (const d of ch) for (let i = 0; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); sum += d[i] * d[i]; }
        const rms = Math.sqrt(sum / (ch.length * ch[0].length));
        let gain = it.norm.rms !== undefined ? 10 ** (it.norm.rms / 20) / Math.max(rms, 1e-6) : 10 ** (it.norm.peak / 20) / Math.max(peak, 1e-6);
        gain = Math.min(gain, 10 ** (-1 / 20) / Math.max(peak, 1e-6)); // never above -1 dBFS
        for (const d of ch) for (let i = 0; i < d.length; i++) d[i] *= gain;
        out.push({ src: it.src, s: it.s ?? 0, e: it.e ?? null, dur: ch[0].length / SR, channels: ch.map(toB64) });
      }
    }
    return out;
  }, items, SR);
}

function encode(channels, file) {
  const pcm = channels.map((b64) => {
    const f = new Float32Array(Uint8Array.from(Buffer.from(b64, 'base64')).buffer);
    const i16 = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
    return i16;
  });
  const enc = new Mp3Encoder(pcm.length, SR, pcm.length > 1 ? 128 : 96);
  const parts = [];
  for (let i = 0; i < pcm[0].length; i += 1152) {
    const mp3 = pcm.length > 1 ? enc.encodeBuffer(pcm[0].subarray(i, i + 1152), pcm[1].subarray(i, i + 1152)) : enc.encodeBuffer(pcm[0].subarray(i, i + 1152));
    if (mp3.length) parts.push(Buffer.from(mp3));
  }
  parts.push(Buffer.from(enc.flush()));
  const mp3 = Buffer.concat(parts);
  writeFileSync(file, mp3);
  return mp3;
}

/**
 * Where the sound starts in the decoded MP3: the encoder and decoder delay (~1100 samples of
 * silence) that browsers don't strip without a LAME tag. Found by matching the decoded file
 * against the PCM that went in; Samples skips it, and loops wrap around the real audio only.
 */
async function encoderLead(tab, mp3, channel0) {
  const ref = new Float32Array(Uint8Array.from(Buffer.from(channel0, 'base64')).buffer).slice(0, 16384);
  return tab.evaluate(async (mp3b64, refb64) => {
    const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
    const buf = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes(mp3b64));
    const dec = buf.getChannelData(0);
    const ref = new Float32Array(bytes(refb64));
    let best = -Infinity;
    let lead = 0;
    for (let lag = 0; lag < 3000; lag++) {
      let s = 0;
      for (let i = 0; i < ref.length; i++) s += (dec[i + lag] ?? 0) * ref[i];
      if (s > best) { best = s; lead = lag; }
    }
    return { lead, length: buf.length };
  }, mp3.toString('base64'), Buffer.from(ref.buffer).toString('base64'));
}

// ------------------------------------------------------------------ main

const sources = JSON.parse(readFileSync(join(SRC, 'sources.json'), 'utf8'));
/** Where a take came from: { text, url }. */
const credit = (src) => {
  if (src.startsWith('freesound/')) {
    const f = sources.freesound.find((q) => q.file === src);
    return f ? { text: `"${f.title.replace(` by ${f.author}`, '')}" by ${f.author} (Freesound)`, url: f.page } : { text: src };
  }
  const pack = sources.packs.find((p) => src.startsWith(`packs/${p.name}/`));
  return pack ? { text: `${src.split('/').pop()} from ${pack.name}`, url: pack.page } : { text: src };
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } });
await server.listen();
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const tab = await browser.newPage();
await tab.goto(`${server.resolvedUrls.local[0]}index.html`, { waitUntil: 'domcontentloaded' });
const manifest = { version: 1, sounds: {} };
const credits = [];
for (const [key, def] of Object.entries(SELECTION)) {
  const res = await process(tab, key, def);
  const files = [];
  for (const r of res) {
    if (r.note) { console.log(`  ${key}: ${r.note}`); continue; }
    const file = `${key}_${files.length + 1}.mp3`;
    const mp3 = encode(r.channels, join(OUT, file));
    const { lead, length } = await encoderLead(tab, mp3, r.channels[0]);
    if (length < lead + r.dur * SR - 2) console.warn(`  ${file}: decodes short (${length} < ${lead} + ${Math.round(r.dur * SR)})`);
    const c = credit(r.src);
    const cut = r.e !== null || r.s ? ` (${r.s.toFixed(2)}-${r.e === null ? 'end' : r.e.toFixed(2)} s)` : '';
    files.push({ file, dur: +r.dur.toFixed(6), lead: +(lead / SR).toFixed(6), from: c.text + cut, url: c.url });
    credits.push(`| ${file} | ${c.text}${cut}, CC0 - ${c.url ?? ''} |`);
  }
  manifest.sounds[key] = { loop: !!def.loop, files };
  console.log(`${key.padEnd(15)} ${files.length} file(s)`);
}
await browser.close();
await server.close();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
writeFileSync(join(OUT, 'CREDITS.md'), `# Sound credits

Every sound here is **CC0 / public domain** (no attribution required - listed anyway, with thanks).
Built by \`tools/audio/build-sfx.mjs\` from sources fetched by \`tools/audio/fetch-sfx.mjs\`
(cut, mixed to mono, loudness-matched and re-encoded).

| File | Source |
|---|---|
${credits.join('\n')}
`);
const bytes = readdirSync(OUT).reduce((s, f) => s + readFileSync(join(OUT, f)).length, 0);
console.log(`wrote ${Object.keys(manifest.sounds).length} sounds, ${readdirSync(OUT).length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB -> public/assets/audio`);
