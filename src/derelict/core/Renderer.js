// Orthographic pixel renderer: the scene is rendered at ART_LINES rows of art pixels and shown at an
// integer scale so every art pixel is a whole number of device pixels. Bloom runs at art resolution.
// Lights are pooled: a fixed set of point lights lives in the scene from the first frame, so the
// shader programs never recompile when a lamp comes into view; each frame the nearest sources are
// written into the pool.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const ART_LINES = 450;
export const LIGHT_POOL = 12;

export class Renderer {
  constructor(canvas, { lines = ART_LINES, pixel = true, bloom = true } = {}) {
    this.canvas = canvas;
    this.lines = lines;
    this.pixel = pixel;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.gl.setPixelRatio(1);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.setClearColor(0x04050a, 1);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04050a);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);
    this.width = 800; this.height = lines; this.scale = 1;
    this.composer = new EffectComposer(this.gl);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.42, 0.4, 0.9);
    this.bloomPass.enabled = bloom;
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    // lighting
    this.ambient = new THREE.AmbientLight(0x3a4250, 1.1);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0x3a4452, 0x101014, 0.35);
    this.scene.add(this.hemi);
    this.pool = [];
    for (let i = 0; i < LIGHT_POOL; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.position.set(0, -99999, 60);
      this.scene.add(l);
      this.pool.push(l);
    }
    this.flash = new THREE.SpotLight(0xe8e2cf, 0, 700, 0.5, 0.85, 1.7);
    this.flash.position.set(0, -99999, 80);
    this.flash.target.position.set(1, -99999, 0);
    this.scene.add(this.flash); this.scene.add(this.flash.target);
    this.sources = [];                     // {x, y, z, color, intensity, range}
    this.shake = { x: 0, y: 0 };
    this.cx = 0; this.cy = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    if (this.pixel) {
      this.scale = Math.max(1, Math.floor(vh / this.lines));
      this.height = this.lines;
      this.width = Math.max(320, Math.floor(vw / this.scale));
    } else {
      this.scale = 1; this.height = vh; this.width = vw;
    }
    this.gl.setSize(this.width, this.height, false);
    this.composer.setSize(this.width, this.height);
    this.bloomPass.setSize(this.width, this.height);
    const cssW = this.width * this.scale, cssH = this.height * this.scale;
    this.canvas.style.width = cssW + 'px'; this.canvas.style.height = cssH + 'px';
    const frame = this.canvas.parentElement;
    if (frame) { frame.style.width = cssW + 'px'; frame.style.height = cssH + 'px'; }
    this.camera.left = -this.width / 2; this.camera.right = this.width / 2;
    this.camera.top = this.height / 2; this.camera.bottom = -this.height / 2;
    this.camera.updateProjectionMatrix();
    if (this.onResize) this.onResize(this.width, this.height, this.scale);
  }

  // camera centre in world pixels (snapped to whole pixels so tiles do not shimmer)
  setCamera(x, y) {
    this.cx = x; this.cy = y;
    this.camera.position.x = Math.round(x + this.shake.x);
    this.camera.position.y = Math.round(y + this.shake.y);
  }

  worldToScreen(x, y) {
    return { x: x - this.camera.position.x + this.width / 2, y: this.height / 2 - (y - this.camera.position.y) };
  }

  screenToWorld(sx, sy) {
    return { x: sx - this.width / 2 + this.camera.position.x, y: this.height / 2 - sy + this.camera.position.y };
  }

  onScreen(x, y, margin = 0) {
    return Math.abs(x - this.camera.position.x) <= this.width / 2 + margin && Math.abs(y - this.camera.position.y) <= this.height / 2 + margin;
  }

  // Called once per frame with the frame's light sources; the nearest LIGHT_POOL on-screen ones
  // are written into the pool, the rest are switched off (intensity 0, parked far away).
  applyLights(sources) {
    const cx = this.camera.position.x, cy = this.camera.position.y;
    const hw = this.width / 2 + 160, hh = this.height / 2 + 160;
    const near = [];
    for (const s of sources) {
      if (s.intensity <= 0) continue;
      if (Math.abs(s.x - cx) > hw + s.range || Math.abs(s.y - cy) > hh + s.range) continue;
      const d = Math.hypot(s.x - cx, s.y - cy) - s.range * 0.5 - (s.priority || 0) * 1000;
      near.push({ s, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      const e = near[i];
      if (!e) { l.intensity = 0; l.position.y = -99999; continue; }
      l.color.setHex(e.s.color);
      l.intensity = e.s.intensity * e.s.range * e.s.range * 0.55;
      l.distance = e.s.range * 1.6;
      l.position.set(e.s.x, e.s.y, e.s.z === undefined ? 60 : e.s.z);
    }
  }

  setFlashlight(on, x, y, dx, dy) {
    const f = this.flash;
    if (!on) { f.intensity = 0; f.position.y = -99999; return; }
    f.intensity = 1.0 * 520 * 520 * 0.26;
    f.position.set(x - dx * 10, y + 10, 150);
    f.target.position.set(x + dx * 250, y + dy * 250, -8);
  }

  render() {
    this.composer.render();
  }
}
