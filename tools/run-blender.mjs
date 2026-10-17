// Builds all game art by running each tools/blender/<asset>.py in headless Blender, then merges
// the per-asset *.meta.json files into public/assets/models/manifest.json.
//
//   npm run assets                    build everything
//   npm run assets -- marine alien    build a subset
//   npm run assets -- --preview       also render contact sheets to tools/out/previews/
//   BLENDER=path/to/blender.exe       override the Blender executable
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SCRIPTS = join(ROOT, 'tools', 'blender');
const OUT = join(ROOT, 'public', 'assets', 'models');
const PREVIEW = join(ROOT, 'tools', 'out', 'previews');
const ASSETS = ['marine', 'alien', 'critter', 'survivor', 'props', 'roomkit', 'dock'];

function findBlender() {
  if (process.env.BLENDER) return process.env.BLENDER;
  const base = 'C:/Program Files/Blender Foundation';
  if (existsSync(base)) {
    const versions = readdirSync(base).filter((d) => d.startsWith('Blender')).sort().reverse();
    for (const v of versions) {
      const exe = join(base, v, 'blender.exe');
      if (existsSync(exe)) return exe;
    }
  }
  return 'blender';
}

function run(blender, asset, preview) {
  return new Promise((done) => {
    const args = ['--background', '--factory-startup', '--python-exit-code', '1',
      '--python', join(SCRIPTS, `${asset}.py`), '--', '--out', OUT];
    if (preview) args.push('--preview', PREVIEW);
    const t0 = Date.now();
    const p = spawn(blender, args, { cwd: ROOT });
    let log = '';
    p.stdout.on('data', (d) => (log += d));
    p.stderr.on('data', (d) => (log += d));
    p.on('close', (code) => {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (code === 0) {
        const notes = log.split('\n').filter((l) => /^(EXPORTED|PREVIEW|WARN|STATS)/.test(l));
        console.log(`✔ ${asset} (${secs}s)\n  ${notes.join('\n  ')}`);
      } else {
        console.error(`✘ ${asset} failed (exit ${code})\n${log.split('\n').slice(-40).join('\n')}`);
      }
      done(code === 0);
    });
  });
}

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const wanted = args.filter((a) => !a.startsWith('--'));
const list = wanted.length ? wanted : ASSETS.filter((a) => existsSync(join(SCRIPTS, `${a}.py`)));
const blender = findBlender();
console.log(`Blender: ${blender}\nBuilding: ${list.join(', ')}`);

// Blender is mostly single-threaded here; run a few in parallel.
const results = [];
const queue = [...list];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const a = queue.shift();
    results.push(await run(blender, a, preview));
  }
}));

const models = {};
for (const f of readdirSync(OUT).filter((f) => f.endsWith('.meta.json'))) {
  const meta = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
  models[meta.name] = meta;
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ built: Date.now(), models }, null, 2));
console.log(`manifest.json: ${Object.keys(models).join(', ')}`);
if (results.includes(false)) process.exit(1);
