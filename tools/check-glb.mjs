// Validates exported GLBs against their Blender-written metadata without a browser:
// clip names, skin, sockets, vertex colours. Usage: node tools/check-glb.mjs [dir] [--verbose]
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'public/assets/models';
const verbose = process.argv.includes('--verbose');

/** Parse the JSON chunk of a binary glTF. */
export function readGlbJson(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  const len = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

let failures = 0;
const fail = (msg) => { failures++; console.error('FAIL', msg); };

for (const file of readdirSync(dir).filter((f) => f.endsWith('.meta.json'))) {
  const meta = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const glbPath = join(dir, meta.file);
  if (!existsSync(glbPath)) { fail(`${meta.file} missing`); continue; }
  const gltf = readGlbJson(glbPath);
  const anims = (gltf.animations ?? []).map((a) => a.name);
  const nodes = new Set((gltf.nodes ?? []).map((n) => n.name));
  const prims = (gltf.meshes ?? []).flatMap((m) => m.primitives);
  const tris = prims.reduce((s, p) => s + (gltf.accessors[p.indices]?.count ?? 0) / 3, 0);

  for (const clip of meta.clips ?? []) if (!anims.includes(clip.name)) fail(`${meta.name}: clip "${clip.name}" not exported`);
  for (const s of meta.sockets ?? []) if (!nodes.has(s)) fail(`${meta.name}: socket "${s}" missing`);
  for (const n of meta.nodes ?? []) if (!nodes.has(n)) fail(`${meta.name}: node "${n}" missing`);
  if ((meta.clips ?? []).length && !(gltf.skins ?? []).length) fail(`${meta.name}: animated but has no skin`);
  if (prims.some((p) => p.attributes.COLOR_0 === undefined)) fail(`${meta.name}: primitive without COLOR_0`);

  console.log(`ok ${meta.name.padEnd(12)} tris=${String(tris).padStart(6)} clips=[${anims.join(', ')}] materials=${(gltf.materials ?? []).map((m) => m.name).join('/')}`);
  if (verbose) console.log('   nodes:', [...nodes].join(', '));
}

if (failures) { console.error(`${failures} problem(s)`); process.exit(1); }
