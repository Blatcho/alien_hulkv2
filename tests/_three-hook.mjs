import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function resolve(specifier, context, next) {
  if (specifier === 'three') return { url: pathToFileURL(path.join(root, 'vendor/three/three.module.js')).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) return { url: pathToFileURL(path.join(root, 'vendor/three/addons', specifier.slice('three/addons/'.length))).href, shortCircuit: true };
  return next(specifier, context);
}
