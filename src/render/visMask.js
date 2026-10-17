// Fog of war. Each frame, every marine's visibility polygon (walls + closed doors block it)
// is drawn into a world-space mask texture with MAX blending. The fragment intensity encodes
// the flashlight cone + awareness radius + muzzle flashes. The mask also accumulates into a
// persistent "explored" texture. A post pass then darkens the screen: black where never seen,
// dim where explored, lit where currently visible; space outside the hull stays visible.
import * as THREE from 'three';
import { SIGHT } from '../core/config.js';
import { coneRange, eye, roomAura } from '../vis/sight.js';
import { segmentsNear, visibilityPolygon } from '../vis/polygon.js';

const PX_PER_M = 6;
const MAX_VERTS = 4096;

function polyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      eye: { value: new THREE.Vector2() }, facing: { value: 1 }, coneRange: { value: SIGHT.CONE_RANGE },
      coneCos: { value: Math.cos(THREE.MathUtils.degToRad(SIGHT.CONE_HALF)) }, aura: { value: SIGHT.AURA },
      flash: { value: 0 }, climbing: { value: 0 }, pitch: { value: 0 },
    },
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vW;
      void main() { vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec2 eye; uniform float facing, coneRange, coneCos, aura, flash, climbing, pitch;
      varying vec2 vW;
      void main() {
        vec2 d = vW - eye; float r = length(d);
        float a = smoothstep(aura, aura * 0.35, r) * 0.8;
        // facing is the rig's signed sweep (-1..1): the cone swings sides through 0 while
        // turning (fading as it points at the camera) instead of popping across.
        float side = facing < 0.0 ? -1.0 : 1.0;
        // ...and pitches up/down with the weapon, exactly like vis/sight.js inView().
        float c = dot(d / max(r, 1e-4), vec2(side * cos(pitch), sin(pitch)));
        float cone = abs(facing) * (1.0 - climbing) * smoothstep(coneCos - 0.06, coneCos + 0.05, c) * smoothstep(coneRange, coneRange * 0.5, r);
        float f = flash * smoothstep(10.0, 1.0, r);
        float v = max(max(a, cone), f);
        gl_FragColor = vec4(v, v, v, 1.0);
      }`,
  });
}

export const DarknessShader = {
  uniforms: {
    tDiffuse: { value: null }, tMask: { value: null }, tExplored: { value: null }, tShip: { value: null },
    camMin: { value: new THREE.Vector2() }, camSize: { value: new THREE.Vector2(1, 1) },
    levMin: { value: new THREE.Vector2() }, levSize: { value: new THREE.Vector2(1, 1) },
    dil: { value: new THREE.Vector2() }, enabled: { value: 1 }, memory: { value: 0.15 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tMask, tExplored, tShip;
    uniform vec2 camMin, camSize, levMin, levSize, dil; uniform float enabled, memory;
    varying vec2 vUv;
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      // Safety net: this pass runs right before bloom, and bloom's downsampling turns a single
      // NaN/Inf pixel from any shader into a large black box for a frame. Drop them here.
      // (Bit test, not isnan(): the D3D compiler behind Chrome on Windows assumes floats are
      // never NaN and strips isnan().)
      uvec4 bits = floatBitsToUint(col) & 0x7f800000u;
      if (any(equal(bits, uvec4(0x7f800000u)))) col = vec4(0.0, 0.0, 0.0, 1.0);
      vec2 m = (camMin + vUv * camSize - levMin) / levSize;
      float ship = (m.x < 0.0 || m.y < 0.0 || m.x > 1.0 || m.y > 1.0) ? 0.0 : texture2D(tShip, m).r;
      float vis = 0.0; float ex = 0.0;
      for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
        vec2 o = vec2(float(i), float(j)) * dil;
        vis = max(vis, texture2D(tMask, m + o).r);
        ex = max(ex, texture2D(tExplored, m + o).r);
      }
      // Remembered (not currently seen) areas: clamp HDR emissives first so lamps and
      // screens don't glare through the dimming, then desaturate.
      vec3 remembered = min(col.rgb, vec3(0.8)) * ex * memory;
      vec3 grey = vec3(dot(remembered, vec3(0.3, 0.55, 0.15)));
      vec3 inside = col.rgb * vis + mix(grey, remembered, 0.35) * (1.0 - vis);
      col.rgb = mix(col.rgb, inside, ship * enabled);
      gl_FragColor = col;
    }`,
};

export class VisMask {
  constructor(renderer, level) {
    this.gl = renderer.gl;
    this.level = level;
    const b = level.bounds;
    this.b = b;
    this.w = Math.ceil((b.x1 - b.x0) * PX_PER_M);
    this.h = Math.ceil((b.y1 - b.y0) * PX_PER_M);
    const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.maskRT = new THREE.WebGLRenderTarget(this.w, this.h, opts);
    this.exploredRT = new THREE.WebGLRenderTarget(this.w, this.h, opts);
    this.cam = new THREE.OrthographicCamera(b.x0, b.x1, b.y1, b.y0, -1, 1);
    this.scene = new THREE.Scene();
    this.polys = [];
    this.shipTex = this.makeShipTexture();

    // Accumulate mask -> explored.
    this.copyScene = new THREE.Scene();
    this.copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tMask: { value: this.maskRT.texture } },
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tMask; varying vec2 vUv; void main(){ float v = step(0.06, texture2D(tMask, vUv).r); gl_FragColor = vec4(v, v, v, 1.0); }',
    });
    this.copyScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat));

    const clear = this.gl.getClearColor(new THREE.Color());
    this.gl.setRenderTarget(this.exploredRT);
    this.gl.setClearColor(0x000000, 1);
    this.gl.clear();
    this.gl.setRenderTarget(null);
    this.gl.setClearColor(clear, 1);

    this.uniforms = THREE.UniformsUtils.clone(DarknessShader.uniforms);
    this.uniforms.tMask.value = this.maskRT.texture;
    this.uniforms.tExplored.value = this.exploredRT.texture;
    this.uniforms.tShip.value = this.shipTex;
    this.uniforms.levMin.value.set(b.x0, b.y0);
    this.uniforms.levSize.value.set(b.x1 - b.x0, b.y1 - b.y0);
    this.uniforms.dil.value.set(0.42 / (b.x1 - b.x0), 0.42 / (b.y1 - b.y0));
  }

  /** CPU mask: 1 over room interiors and structure, 0 in open space. */
  makeShipTexture() {
    const { w, h, b } = this;
    const data = new Uint8Array(w * h * 4);
    const rects = [
      ...this.level.rooms.filter((r) => !r.exterior).map((r) => ({ x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1 })),
      ...this.level.solids.filter((s) => s.kind !== 'dock'),
    ];
    for (const r of rects) {
      const i0 = Math.max(0, Math.floor((r.x0 - b.x0) * PX_PER_M));
      const i1 = Math.min(w, Math.ceil((r.x1 - b.x0) * PX_PER_M));
      const j0 = Math.max(0, Math.floor((r.y0 - b.y0) * PX_PER_M));
      const j1 = Math.min(h, Math.ceil((r.y1 - b.y0) * PX_PER_M));
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) data.fill(255, (j * w + i) * 4, (j * w + i) * 4 + 4);
    }
    const tex = new THREE.DataTexture(data, w, h);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }

  ensurePolys(n) {
    while (this.polys.length < n) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_VERTS * 3 * 3), 3));
      const mesh = new THREE.Mesh(g, polyMaterial());
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.polys.push(mesh);
    }
  }

  /** Recompute polygons and render the mask + explored accumulation. */
  update(world, flashes, rig = null) {
    const marines = world.marines;
    this.ensurePolys(marines.length);
    const boxes = this.level.solids.filter((s) => s.kind !== 'door' || !this.level.portals[s.portal].open);
    marines.forEach((m, i) => {
      const mesh = this.polys[i];
      if (!m.alive) { mesh.visible = false; return; }
      mesh.visible = true;
      const e = eye(m);
      const range = SIGHT.CONE_RANGE + 2;
      const poly = visibilityPolygon(e.x, e.y, segmentsNear(boxes, e.x, e.y, range));
      const pos = mesh.geometry.attributes.position;
      const n = poly.length / 2;
      let k = 0;
      for (let v = 0; v < n && k < MAX_VERTS * 3 - 3; v++) {
        const a = v * 2;
        const bI = ((v + 1) % n) * 2;
        pos.setXYZ(k++, e.x, e.y, 0);
        pos.setXYZ(k++, poly[a], poly[a + 1], 0);
        pos.setXYZ(k++, poly[bI], poly[bI + 1], 0);
      }
      mesh.geometry.setDrawRange(0, k);
      pos.needsUpdate = true;
      const u = mesh.material.uniforms;
      u.eye.value.set(e.x, e.y);
      const rg = rig?.get(m.id);
      u.facing.value = rg ? rg.fx : m.facing;
      u.coneRange.value = world.settings.flashlight ? coneRange(m) : SIGHT.DARK_CONE_RANGE;
      u.flash.value = flashes.get(m.id) ?? 0;
      u.climbing.value = rg ? rg.climb : m.mode === 'climb' ? 1 : 0;
      u.pitch.value = m.pitch ?? 0;
      u.aura.value = roomAura(m, world.level.rooms[m.room]);
    });
    const gl = this.gl;
    const prevTarget = gl.getRenderTarget();
    const prevClear = gl.getClearColor(new THREE.Color());
    const prevAlpha = gl.getClearAlpha();
    gl.setRenderTarget(this.maskRT);
    gl.setClearColor(0x000000, 1);
    gl.clear();
    gl.render(this.scene, this.cam);
    gl.setRenderTarget(this.exploredRT);
    gl.autoClear = false;
    gl.render(this.copyScene, this.copyCam);
    gl.autoClear = true;
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(prevClear, prevAlpha);
  }

  /** Point the darkness pass at the current camera view. */
  setView(bounds, enabled) {
    this.uniforms.camMin.value.set(bounds.x0, bounds.y0);
    this.uniforms.camSize.value.set(bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
    this.uniforms.enabled.value = enabled ? 1 : 0;
  }
}
