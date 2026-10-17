// HUD portraits rendered from the actual 3D marine model (per-trooper squad tint), once at
// start-up, using the game's own WebGL renderer. Keeps the "no bitmaps" pipeline honest.
import * as THREE from 'three';

export function renderPortraits(glRenderer, assets, marines, size = 128) {
  if (!assets?.gltf.has('marine')) return null;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1211);
  scene.add(new THREE.HemisphereLight(0x9fb0c0, 0x201810, 0.45));
  const key = new THREE.DirectionalLight(0xfff0dd, 1.5);
  key.position.set(1.5, 2, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x80a0ff, 1.4);
  rim.position.set(-2, 1, -2);
  scene.add(rim);
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 20);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const pixels = new Uint8Array(size * size * 4);
  const img = ctx.createImageData(size, size);
  const prevTarget = glRenderer.getRenderTarget();
  const prevTone = glRenderer.toneMapping;

  const urls = marines.map((m) => {
    const inst = assets.character('marine', { tint: m.tint, loadout: m.loadout });
    const idle = inst.clips.get('idle_alert') ?? inst.clips.get('idle') ?? inst.clips.get('aim');
    if (idle) { inst.mixer.clipAction(idle).play(); inst.mixer.update(0.2); }
    inst.root.rotation.y = 0.45 + (m.index % 2 ? 0.15 : -0.1);
    scene.add(inst.root);
    inst.root.updateMatrixWorld(true);
    const head = new THREE.Vector3();
    (inst.sockets.eye ?? inst.sockets.head)?.getWorldPosition(head);
    if (!inst.sockets.eye && !inst.sockets.head) head.set(0, 1.75, 0);
    cam.position.set(head.x + 0.4, head.y + 0.1, head.z + 1.75);
    cam.lookAt(head.x, head.y - 0.1, head.z);

    glRenderer.setRenderTarget(rt);
    glRenderer.toneMapping = THREE.NoToneMapping;
    glRenderer.render(scene, cam);
    glRenderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    scene.remove(inst.root);
    // Flip Y (GL origin is bottom-left) and convert linear -> sRGB-ish for display.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = ((size - 1 - y) * size + x) * 4;
        const d = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) img.data[d + c] = Math.min(255, 255 * Math.pow(pixels[s + c] / 255, 1 / 2.2));
        img.data[d + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL('image/png');
  });

  glRenderer.setRenderTarget(prevTarget);
  glRenderer.toneMapping = prevTone;
  rt.dispose();
  return urls;
}

/** Portraits for troopers outside a game (Command, Briefing): a throwaway renderer, id -> url. */
export function portraitMap(assets, troopers, size = 128) {
  const out = new Map();
  if (!assets?.gltf.has('marine') || !troopers.length) return out;
  const gl = new THREE.WebGLRenderer({ antialias: true });
  gl.setSize(size, size);
  const urls = renderPortraits(gl, assets, troopers.map((t, i) => ({ ...t, index: i })), size) ?? [];
  troopers.forEach((t, i) => out.set(t.id, urls[i]));
  gl.dispose();
  return out;
}
