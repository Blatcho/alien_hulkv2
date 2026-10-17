import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIX, SHOT_ALIAS } from '../src/audio/sfx.js';
import { WEAPONS } from '../src/core/config.js';

const DIR = resolve(import.meta.dirname, '..', 'public', 'assets', 'audio');
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const credits = readFileSync(join(DIR, 'CREDITS.md'), 'utf8');
const code = readFileSync(resolve(import.meta.dirname, '..', 'src', 'audio', 'sfx.js'), 'utf8');

describe('recorded sound set', () => {
  it('has a recording for every sound in the mix, and a mix level for every recording', () => {
    expect(Object.keys(manifest.sounds).sort()).toEqual(Object.keys(MIX).sort());
  });

  it('every sound Sfx plays by name is in the mix (typos fall back to synthesis silently)', () => {
    const named = [...code.matchAll(/(?:play|distant)\('([a-z_]+)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(10);
    for (const key of named) expect(MIX, key).toHaveProperty(key);
    // Every gun has its shot - its own recording, or a stand-in played at another pitch (and the
    // power fists fire nothing).
    for (const [w, W] of Object.entries(WEAPONS)) {
      if (W.melee) continue;
      expect(MIX).toHaveProperty(SHOT_ALIAS[w]?.key ?? `shot_${w}`);
    }
  });

  it('every file exists, is small, and is credited to a CC0 source', () => {
    let bytes = 0;
    for (const [key, s] of Object.entries(manifest.sounds)) {
      expect(s.files.length, key).toBeGreaterThan(0);
      for (const f of s.files) {
        expect(existsSync(join(DIR, f.file)), f.file).toBe(true);
        bytes += statSync(join(DIR, f.file)).size;
        expect(f.dur).toBeGreaterThan(0.05);
        // The MP3 encoder delay, measured at build time: skipped on play, kept out of loops.
        expect(f.lead, f.file).toBeGreaterThan(0.02);
        expect(f.lead, f.file).toBeLessThan(0.05);
        expect(f.url, f.file).toMatch(/^https:\/\/(freesound\.org|kenney\.nl|opengameart\.org)\//);
        expect(credits).toContain(`| ${f.file} |`);
      }
    }
    expect(bytes).toBeLessThan(4e6);
    expect(credits).toMatch(/CC0/);
  });
});
