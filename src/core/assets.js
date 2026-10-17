// Loads the Blender-exported GLBs listed in public/assets/models/manifest.json.
// Characters are cloned per instance with SkeletonUtils (shared geometry + clips, own skeleton);
// static kit pieces are handed out as geometries so the level builder can merge them per room.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/models/`;

export class Assets {
  constructor() {
    this.loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // EXT_meshopt_compression
    this.manifest = null;
    this.gltf = new Map();
  }

  async loadManifest() {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    this.manifest = await res.json();
    return this.manifest;
  }

  /** Load every model in the manifest (or just `names`). */
  async load(names) {
    if (!this.manifest) await this.loadManifest();
    const list = names ?? Object.keys(this.manifest.models);
    await Promise.all(list.map(async (name) => {
      const meta = this.manifest.models[name];
      const gltf = await this.loader.loadAsync(`${BASE}${meta.file}?v=${this.manifest.built ?? 0}`);
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.frustumCulled = !o.isSkinnedMesh; // skinned bounds are bind-pose only
          prepareMaterial(o.material);
        }
      });
      this.gltf.set(name, { gltf, meta });
    }));
    return this;
  }

  meta(name) { return this.gltf.get(name)?.meta ?? this.manifest?.models[name]; }

  /**
   * New animated instance: { root, mixer, clips, sockets, meta }.
   * `tint` recolours the accent material (squad colours) on a per-instance material clone.
   * `loadout` ({helmet, pads, pack, weapon}) shows only that trooper's var_* parts and points
   * the muzzle/light sockets at that weapon.
   */
  character(name, { tint, loadout } = {}) {
    const entry = this.gltf.get(name);
    if (!entry) throw new Error(`asset "${name}" not loaded`);
    const root = SkeletonUtils.clone(entry.gltf.scene);
    const sockets = {};
    root.traverse((o) => {
      if (o.name.startsWith('socket_')) sockets[o.name.slice(7)] = o;
      // Troopers: tint the accent parts. Aliens: tint the whole hide (the breeds), not the eyes.
      if (o.isMesh && tint && (o.material.name === 'M_Accent' || (name === 'alien' && o.material.name !== 'M_Glow'))) {
        o.material = o.material.clone();
        o.material.userData.rim = false; // clones lose the rim shader: add it again below
        o.material.color.set(tint);
      }
      if (o.isMesh) addRim(o.material, name === 'alien' ? 0xb090ff : 0xc8d8c0, name === 'alien' ? 0.22 : 0.16);
      if (loadout && o.name.startsWith('var_')) {
        const [, slot, value] = o.name.split('_');
        o.visible = loadout[slot] === value;
      }
    });
    if (loadout) {
      sockets.muzzle = sockets[`muzzle_${loadout.weapon}`] ?? sockets.muzzle;
      sockets.light = sockets[`light_${loadout.weapon}`] ?? sockets.light;
    }
    const clips = new Map(entry.gltf.animations.map((c) => [c.name, c]));
    return { root, mixer: new THREE.AnimationMixer(root), clips, sockets, meta: entry.meta };
  }

  /** Static node (prop / kit piece) cloned with shared geometry & materials. */
  node(name, nodeName) {
    const entry = this.gltf.get(name);
    const src = nodeName ? entry.gltf.scene.getObjectByName(nodeName) : entry.gltf.scene;
    if (!src) throw new Error(`node "${nodeName}" not in ${name}`);
    return src.clone(true);
  }

  /** Names of the top-level nodes of a model file (kit catalogues). */
  nodeNames(name) {
    return this.gltf.get(name).gltf.scene.children.map((c) => c.name);
  }
}

/**
 * Fresnel rim light so characters read against dark walls (the reference art outlines its
 * sprites; this is the 3D equivalent). Patched once per material.
 */
export function addRim(mat, color, strength) {
  if (mat.userData.rim) return;
  mat.userData.rim = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = { value: new THREE.Color(color).multiplyScalar(strength) };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 rimView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
        float rim = 1.0 - saturate(dot(normalize(normal), rimView));
        totalEmissiveRadiance += rimColor * pow(rim, 4.0);`);
  };
  mat.customProgramCacheKey = () => `rim-${color}-${strength}`;
  mat.needsUpdate = true;
}

/** Flat-shaded low-poly look; emissive materials stay unaffected by fog-of-war darkening. */
export function prepareMaterial(mat) {
  const mats = Array.isArray(mat) ? mat : [mat];
  for (const m of mats) {
    m.flatShading = true;
    if (m.emissive && m.emissive.getHex() !== 0) m.toneMapped = true;
    m.needsUpdate = true;
  }
}
