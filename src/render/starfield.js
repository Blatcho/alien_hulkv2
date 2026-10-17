// Procedural deep-space backdrop behind the hull: parallax star layers, a faint nebula and a
// distant derelict silhouette. One full-screen-ish plane with a shader; no textures.
import * as THREE from 'three';

export function makeStarfield() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { camPos: { value: new THREE.Vector2() }, time: { value: 0 } },
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec2 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xy;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec2 camPos; uniform float time;
      varying vec2 vWorld;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
      float stars(vec2 p, float density, float size) {
        vec2 g = floor(p); vec2 f = fract(p) - 0.5;
        float h = hash(g);
        if (h > density) return 0.0;
        vec2 o = vec2(hash(g + 7.1), hash(g + 3.3)) - 0.5;
        float d = length(f - o * 0.6);
        return smoothstep(size, 0.0, d) * (0.5 + 0.5 * hash(g + 1.7));
      }
      void main() {
        // Parallax: deeper layers move less with the camera.
        vec2 p1 = (vWorld - camPos * 0.92) * 3.5;
        vec2 p2 = (vWorld - camPos * 0.85) * 1.6;
        vec2 p3 = (vWorld - camPos * 0.97) * 0.12;
        vec3 col = vec3(0.004, 0.006, 0.012);
        float n = noise(p3 * 0.6) * 0.6 + noise(p3 * 1.7) * 0.4;
        col += vec3(0.05, 0.03, 0.08) * smoothstep(0.45, 0.9, n);
        col += vec3(0.02, 0.05, 0.06) * smoothstep(0.55, 0.95, noise(p3 * 1.1 + 9.0));
        float tw = 0.75 + 0.25 * sin(time * 2.0 + hash(floor(p1)) * 30.0);
        col += vec3(0.8, 0.85, 0.9) * stars(p1, 0.05, 0.06) * tw * 0.7;
        col += vec3(0.7, 0.75, 0.9) * stars(p2, 0.04, 0.05) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.position.z = -60;
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.userData.update = (cam, dt) => {
    const b = cam.bounds();
    mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, -60);
    mesh.scale.set((b.x1 - b.x0) * 1.1, (b.y1 - b.y0) * 1.1, 1);
    mat.uniforms.camPos.value.set(cam.cam.position.x, cam.cam.position.y);
    mat.uniforms.time.value += dt;
  };
  return mesh;
}
