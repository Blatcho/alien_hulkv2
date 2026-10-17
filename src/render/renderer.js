// WebGL renderer + post-processing chain.
//   RenderPass -> [extra passes, e.g. fog-of-war] -> UnrealBloom -> grade/vignette -> OutputPass
// OutputPass does tone mapping + sRGB conversion, so nothing before it should.
// Pixel (retro) mode renders about RETRO_LINES tall and lets CSS upscale with hard pixel edges,
// each pixel a whole number of device pixels across - so they're all the same size, even on
// screens scaled to 125% or 150%. No film grain there: on big pixels it reads as speckle.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const RETRO_LINES = 450;
const GRAIN = 0.018;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    vignette: { value: 0.9 },
    grain: { value: GRAIN },
    damage: { value: 0 }, // red edge pulse when the squad takes hits
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float time, vignette, grain, damage;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      c.rgb *= mix(1.0, smoothstep(0.75, 0.05, r), vignette);
      c.rgb = mix(c.rgb, vec3(0.55, 0.02, 0.0), damage * smoothstep(0.16, 0.5, r) * 0.55);
      c.rgb += (hash(vUv * 900.0 + time) - 0.5) * grain;
      gl_FragColor = c;
    }`,
};

export class Renderer {
  constructor(container, { retro = false } = {}) {
    this.container = container;
    this.gl = new THREE.WebGLRenderer({ antialias: !retro, powerPreference: 'high-performance' });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.0;
    this.gl.setClearColor(0x000000, 1);
    this.gl.info.autoReset = false; // count the whole frame (all passes), reset in render()
    this.canvas = this.gl.domElement;
    container.appendChild(this.canvas);
    this.retro = retro;
    this.canvas.classList.toggle('retro', retro);
    this.lines = 0; // pixel mode: the frame's height in pixels (0 = full resolution)
    this.scene = null;
    this.camera = null;
    this.composer = null;
    this.extraPasses = [];
    window.addEventListener('resize', () => this.resize());
  }

  /** Build the post chain for a scene/camera. `extraPasses` run before bloom. */
  setup(scene, camera, extraPasses = []) {
    this.scene = scene;
    this.camera = camera;
    this.extraPasses = extraPasses;
    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(scene, camera));
    for (const p of extraPasses) this.composer.addPass(p);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.grade.uniforms.grain.value = this.retro ? 0 : GRAIN;
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  setRetro(on) {
    this.retro = on;
    this.canvas.classList.toggle('retro', on);
    if (this.grade) this.grade.uniforms.grain.value = on ? 0 : GRAIN;
    this.resize();
  }

  resize() {
    let w = this.container.clientWidth || window.innerWidth;
    let h = this.container.clientHeight || window.innerHeight;
    if (this.retro) {
      // k device pixels per art pixel, k whole; the canvas overhangs the stage by under one
      // art pixel rather than stretch to fit it.
      const dpr = window.devicePixelRatio || 1;
      const k = Math.max(2, Math.round((h * dpr) / RETRO_LINES));
      const bw = Math.ceil((w * dpr) / k);
      const bh = Math.ceil((h * dpr) / k);
      w = (bw * k) / dpr;
      h = (bh * k) / dpr;
      this.gl.setPixelRatio(1);
      this.gl.setSize(bw, bh, false);
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.composer?.setPixelRatio(1);
      this.composer?.setSize(bw, bh);
      this.lines = bh;
    } else {
      const ratio = Math.min(window.devicePixelRatio, 2);
      this.gl.setPixelRatio(ratio);
      this.gl.setSize(w, h, true);
      this.composer?.setPixelRatio(ratio);
      this.composer?.setSize(w, h);
      this.lines = 0;
    }
    if (this.camera?.isOrthographicCamera) this.onResize?.(w, h);
    else if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.width = w;
    this.height = h;
  }

  render(dt) {
    this.gl.info.reset();
    this.grade.uniforms.time.value += dt;
    this.composer.render(dt);
  }
}
