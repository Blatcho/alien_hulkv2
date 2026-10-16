#!/usr/bin/env node
// Validates the GLB models the Blender scripts export against their .meta.json sidecars.
//   node tools/check-glb.mjs assets/models/*.glb
// Checks: GLB container (magic, version, JSON + BIN chunks, lengths), every mesh primitive has
// POSITION, NORMAL and COLOR_0, skinned meshes carry JOINTS_0/WEIGHTS_0 and a skin whose joints
// match the meta bone list, every clip in the meta exists as an animation (and vice versa) with
// sensible durations, accessor byte ranges stay inside the BIN chunk, triangle and bone budgets.
import fs from 'node:fs';
import path from 'node:path';

const MAX_TRIS = 20000;
const MAX_BONES = 64;
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error('not a GLB (bad magic)');
  if (buf.readUInt32LE(4) !== 2) throw new Error('unsupported GLB version');
  const total = buf.readUInt32LE(8);
  if (total !== buf.length) throw new Error(`declared length ${total} != file length ${buf.length}`);
  let off = 12; let json = null; let bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    const chunk = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4E4F534A) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004E4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error('no JSON chunk');
  return { json, bin };
}

export function checkGlb(file) {
  const problems = [];
  const buf = fs.readFileSync(file);
  const { json, bin } = parseGlb(buf);
  const metaPath = file.replace(/\.glb$/, '.meta.json');
  if (!fs.existsSync(metaPath)) problems.push(`missing ${path.basename(metaPath)}`);
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
  const accessors = json.accessors || [], views = json.bufferViews || [];
  const accessorBytes = (i) => {
    const a = accessors[i]; const v = views[a.bufferView];
    const n = TYPE_COUNT[a.type] * COMPONENT_BYTES[a.componentType];
    const stride = v.byteStride || n;
    const end = (v.byteOffset || 0) + (a.byteOffset || 0) + stride * (a.count - 1) + n;
    if (!bin || end > bin.length) problems.push(`accessor ${i} runs past the BIN chunk`);
    return a;
  };
  let tris = 0;
  for (const [mi, mesh] of (json.meshes || []).entries()) {
    for (const [pi, prim] of mesh.primitives.entries()) {
      const at = prim.attributes || {};
      for (const need of ['POSITION', 'NORMAL', 'COLOR_0']) if (!(need in at)) problems.push(`mesh ${mi} primitive ${pi} (${mesh.name}) lacks ${need}`);
      for (const k of Object.values(at)) accessorBytes(k);
      if (prim.indices !== undefined) { const a = accessorBytes(prim.indices); tris += a.count / 3; }
      else tris += accessors[at.POSITION].count / 3;
      if ((prim.mode ?? 4) !== 4) problems.push(`mesh ${mi} primitive ${pi} is not triangles`);
    }
  }
  if (tris > MAX_TRIS) problems.push(`${Math.round(tris)} triangles exceeds the ${MAX_TRIS} budget`);
  const nodeNames = (json.nodes || []).map((n) => n.name);
  const skins = json.skins || [];
  const metaBones = meta.bones || [];
  if (metaBones.length) {
    if (!skins.length) problems.push('meta lists bones but the GLB has no skin');
    for (const s of skins) {
      const joints = s.joints.map((j) => nodeNames[j]);
      if (joints.length > MAX_BONES) problems.push(`skin has ${joints.length} joints (> ${MAX_BONES})`);
      for (const b of metaBones) if (!joints.includes(b)) problems.push(`bone ${b} from the meta is not a skin joint`);
      for (const j of joints) if (!metaBones.includes(j)) problems.push(`skin joint ${j} is not in the meta bones`);
      if (s.inverseBindMatrices !== undefined) accessorBytes(s.inverseBindMatrices);
    }
    for (const mesh of json.meshes || []) for (const prim of mesh.primitives) {
      if (!('JOINTS_0' in prim.attributes) || !('WEIGHTS_0' in prim.attributes)) problems.push(`skinned mesh ${mesh.name} lacks JOINTS_0/WEIGHTS_0`);
    }
    for (const u of meta.upper || []) if (!metaBones.includes(u)) problems.push(`upper-body bone ${u} is not a bone`);
  }
  const anims = (json.animations || []).map((a) => a.name);
  const clips = meta.clips || {};
  for (const name of Object.keys(clips)) if (!anims.includes(name)) problems.push(`clip ${name} from the meta is missing in the GLB`);
  for (const name of anims) if (!(name in clips)) problems.push(`animation ${name} has no entry in the meta`);
  for (const a of json.animations || []) {
    let maxT = 0;
    for (const s of a.samplers) { const acc = accessorBytes(s.input); if (acc.max) maxT = Math.max(maxT, acc.max[0]); accessorBytes(s.output); }
    const spec = clips[a.name];
    if (spec && spec.frames && spec.fps) {
      const expect = (spec.frames - 1) / spec.fps;
      if (Math.abs(maxT - expect) > 0.09) problems.push(`animation ${a.name} lasts ${maxT.toFixed(3)}s, meta says ${expect.toFixed(3)}s`);
    }
    if (!a.channels.length) problems.push(`animation ${a.name} has no channels`);
  }
  return { file, problems, tris: Math.round(tris), anims: anims.length, bones: skins.length ? skins[0].joints.length : 0 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node tools/check-glb.mjs <file.glb> ...'); process.exit(2); }
  let bad = 0;
  for (const f of files) {
    try {
      const r = checkGlb(f);
      const tag = r.problems.length ? 'FAIL' : 'ok  ';
      console.log(`${tag} ${path.basename(f)}  tris=${r.tris} bones=${r.bones} clips=${r.anims}`);
      for (const p of r.problems) console.log('     - ' + p);
      if (r.problems.length) bad++;
    } catch (e) { console.log(`FAIL ${path.basename(f)}  ${e.message}`); bad++; }
  }
  process.exit(bad ? 1 : 0);
}
