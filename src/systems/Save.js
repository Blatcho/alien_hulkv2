// Checkpoint persistence in localStorage.
export const SAVE_KEY = 'botm_save';

export function writeSave(data) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
}

export function readSave() {
  try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
}

export function snapshot(scene) {
  const p = scene.player;
  return {
    version: 1,
    zone: scene.zoneKey,
    seed: scene.seed,
    checkpoint: scene.checkpoint,
    stats: scene.stats.toJSON(),
    gold: p.gold, potions: p.potions, inventory: p.inventory || [], kills: p.kills,
    openedChests: [...scene.openedChests],
    savedAt: Date.now(),
  };
}
