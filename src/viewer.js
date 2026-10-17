// Asset viewer (viewer.html): inspect every Blender-exported model and play its clips with
// the same materials, lighting and post chain as the game. URL: ?model=marine&clip=walk&t=0.3
import '@fontsource/share-tech-mono';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Assets } from './core/assets.js';
import { Renderer } from './render/renderer.js';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const renderer = new Renderer($('stage'));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101418);
scene.fog = new THREE.Fog(0x101418, 12, 30);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
camera.position.set(3.2, 1.8, 6.5);
const controls = new OrbitControls(camera, renderer.canvas);
controls.target.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0x8899aa, 0x202018, 0.6));
const key = new THREE.DirectionalLight(0xfff1dd, 1.6);
key.position.set(3, 6, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x6aa0ff, 1.2);
rim.position.set(-4, 3, -5);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: 0x1a1f22, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
scene.add(new THREE.GridHelper(12, 24, 0x2e3a33, 0x1f2724));

renderer.setup(scene, camera);

const assets = new Assets();
let current = null;
let action = null;
const timer = new THREE.Timer();

function show(name) {
  if (current) scene.remove(current.root);
  const meta = assets.meta(name);
  current = meta.clips?.length ? assets.character(name) : { root: assets.node(name), clips: new Map(), meta };
  scene.add(current.root);
  const b = meta.bounds;
  const h = b ? b.max[1] - b.min[1] : 2;
  const w = b ? Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) : 2;
  const size = Math.max(h, w);
  controls.target.set(0, h / 2, 0);
  camera.position.set(size * 1.4, h * 0.75 + size * 0.2, size * 3.2);
  let tris = 0;
  current.root.traverse((o) => { if (o.isMesh) tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
  $('stats').textContent = `tris ${tris}\nheight ${h.toFixed(2)} m\nsockets ${(meta.sockets ?? []).join(', ') || '-'}`;
  document.querySelectorAll('#models button').forEach((btn) => btn.classList.toggle('on', btn.textContent === name));
  const clipsEl = $('clips');
  clipsEl.innerHTML = '';
  for (const clip of current.clips.keys()) {
    const btn = document.createElement('button');
    btn.textContent = clip;
    btn.onclick = () => play(clip);
    clipsEl.appendChild(btn);
  }
  if (current.clips.size) play(q.get('clip') && current.clips.has(q.get('clip')) ? q.get('clip') : [...current.clips.keys()][0]);
}

function play(clipName) {
  const clip = current.clips.get(clipName);
  const next = current.mixer.clipAction(clip);
  const meta = current.meta.clips.find((c) => c.name === clipName);
  next.reset();
  next.setLoop(meta?.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  next.clampWhenFinished = true;
  if (action && action !== next) next.crossFadeFrom(action, 0.2, false);
  next.play();
  action = next;
  document.querySelectorAll('#clips button').forEach((btn) => btn.classList.toggle('on', btn.textContent === clipName));
}

renderer.gl.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta() * Number($('speed').value);
  current?.mixer?.update(dt);
  if ($('turn').checked && current) current.root.rotation.y += dt * 0.6;
  controls.update();
  renderer.render(dt);
});

await assets.load();
const modelsEl = $('models');
for (const name of Object.keys(assets.manifest.models)) {
  const btn = document.createElement('button');
  btn.textContent = name;
  btn.onclick = () => show(name);
  modelsEl.appendChild(btn);
}
show(q.get('model') && assets.manifest.models[q.get('model')] ? q.get('model') : Object.keys(assets.manifest.models)[0]);
if (q.has('t') && action) {
  // Freeze on a normalised clip time for deterministic screenshots.
  action.paused = true;
  action.time = Number(q.get('t')) * action.getClip().duration;
  current.mixer.update(0);
  $('speed').value = 0;
}
if (q.has('yaw') && current) current.root.rotation.y = THREE.MathUtils.degToRad(Number(q.get('yaw')));
window.__viewer = { ready: true, show, play };
