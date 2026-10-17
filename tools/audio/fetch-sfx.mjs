// Fetch the candidate sound effects (all CC0) into tools/out/sfx-src (git-ignored):
//   - Freesound: each page is checked for the CC0 licence before its HQ preview is downloaded
//     (previews need no account; CC0 means any copy may be used).
//   - Kenney and OpenGameArt packs: zips, unpacked.
// Writes tools/out/sfx-src/sources.json (title, author, licence, duration, page) - the record of
// where every sound came from. tools/audio/build-sfx.mjs picks from here into public/assets/audio.
//
// Usage: node tools/audio/fetch-sfx.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'tools', 'out', 'sfx-src');

// [freesound id, role] - candidates per role; build-sfx.mjs decides which are used.
export const FREESOUND = [
  [715175, 'ambience'], [829563, 'ambience'], [614461, 'ambience'], [534018, 'ambience'], [402495, 'ambience'],
  [543404, 'door'], [543654, 'door'], [607265, 'door'], [171705, 'door'],
  [259758, 'carbine'], [160590, 'carbine'],
  ...[854226, 854227, 854228, 854229, 854230, 854231, 854232, 854233].map((id) => [id, 'carbine']), // qubodup M4A1 single shots
  [165394, 'heavy'], [396324, 'heavy'], [239138, 'heavy'], [183656, 'heavy'], [482122, 'heavy'], [482121, 'heavy'], [249146, 'heavy'],
  [773873, 'breacher'], [473846, 'breacher'], [418435, 'breacher'],
  [163460, 'marksman'], [351777, 'marksman'],
  [256912, 'reload'], [432141, 'reload'],
  [545484, 'alien'], [565024, 'alien'], [556535, 'alien'], [763384, 'alien'],
  [609587, 'explosion'], [244394, 'explosion'],
  [209772, 'clang'],
  [698697, 'footstep'], [398937, 'footstep'],
  [431901, 'beep'], [363251, 'beep'], [260103, 'beep'],
  [478187, 'tracker'],
  [420661, 'alarm'], [699248, 'alarm'],
  [396470, 'spark'], [512471, 'spark'],
];

export const PACKS = [
  { name: 'kenney-sci-fi', page: 'https://kenney.nl/assets/sci-fi-sounds', url: 'https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip' },
  { name: 'kenney-impact', page: 'https://kenney.nl/assets/impact-sounds', url: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip' },
  { name: 'kenney-interface', page: 'https://kenney.nl/assets/interface-sounds', url: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip' },
  { name: 'oga-60-sci-fi', page: 'https://opengameart.org/content/60-cc0-sci-fi-sfx', url: 'https://opengameart.org/sites/default/files/60-sci-fi-sfx_0.zip' },
  { name: 'oga-50-sci-fi', page: 'https://opengameart.org/content/50-cc0-sci-fi-sfx', url: 'https://opengameart.org/sites/default/files/sci-fi-sfx.zip' },
  { name: 'oga-80-creature', page: 'https://opengameart.org/content/80-cc0-creature-sfx', url: 'https://opengameart.org/sites/default/files/80-CC0-creature-SFX_0.zip' },
  { name: 'oga-80-creature-2', page: 'https://opengameart.org/content/80-cc0-creture-sfx-2', url: 'https://opengameart.org/sites/default/files/80-CC0-creature-sfx-2.zip' },
];

const curl = (url, file) => execFileSync('curl', ['-sfL', '--max-time', '120', '-o', file, url]);
const text = (url) => execFileSync('curl', ['-sfL', '--max-time', '60', url]).toString();

async function main() {
  mkdirSync(join(OUT, 'freesound'), { recursive: true });
  mkdirSync(join(OUT, 'packs'), { recursive: true });
  const sources = { freesound: [], packs: [] };
  for (const [id, role] of FREESOUND) {
    const page = `https://freesound.org/s/${id}/`;
    const html = text(page);
    const cc0 = html.includes('publicdomain/zero/1.0');
    const title = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? String(id);
    const author = html.match(/freesound\.org\/people\/([^/]+)\/sounds\//)?.[1] ?? '?';
    const duration = Number(html.match(/data-duration="([^"]*)"/)?.[1] ?? 0);
    const preview = html.match(/og:audio" content="[^"]*?(https:\/\/cdn\.freesound\.org\/previews\/[^"]*?)-lq\.mp3"/)?.[1];
    if (!cc0 || !preview) { console.log(`skip ${id} (${cc0 ? 'no preview' : 'NOT CC0'}) ${title}`); continue; }
    const file = join(OUT, 'freesound', `${id}.mp3`);
    if (!existsSync(file)) curl(`${preview}-hq.mp3`, file);
    sources.freesound.push({ id, role, title, author, duration, license: 'CC0-1.0', page: `https://freesound.org/people/${author}/sounds/${id}/`, file: `freesound/${id}.mp3` });
    console.log(`ok   ${id} ${role.padEnd(9)} ${duration.toFixed(1)}s  ${title} (${author})`);
  }
  for (const p of PACKS) {
    const dir = join(OUT, 'packs', p.name);
    const zip = `${dir}.zip`;
    if (!existsSync(zip)) curl(p.url, zip);
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); execFileSync('unzip', ['-q', '-o', zip, '-d', dir]); }
    sources.packs.push({ ...p, license: 'CC0-1.0' });
    console.log(`pack ${p.name}`);
  }
  writeFileSync(join(OUT, 'sources.json'), JSON.stringify(sources, null, 2));
}

main();
