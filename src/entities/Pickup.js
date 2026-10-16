// Loot on the deck: ammo, medkits, weapons, scrap and the ship's log. Hovering and glowing.
import * as THREE from 'three';

const MODEL_FOR = { ammo: 'ammo', medkit: 'medkit', weapon: null, scrap: 'ammo', log: 'log' };

export class Pickup {
  constructor(game, rec, weaponKind) {
    this.game = game; this.kind = rec.kind; this.x = rec.x; this.y = rec.y; this.room = rec.room;
    this.weaponKind = weaponKind || null;
    const name = this.kind === 'weapon' ? `weapon_${this.weaponKind}` : MODEL_FOR[this.kind];
    const model = game.world.models[name];
    this.alive = true; this.t = Math.random() * 6;
    this.mesh = null;
    if (model) {
      let src = null; model.gltf.scene.traverse((o) => { if (o.isMesh && !src) src = o; });
      const mats = (Array.isArray(src.material) ? src.material : [src.material]).map((m) => m.clone());
      this.mesh = new THREE.Mesh(src.geometry, Array.isArray(src.material) ? mats : mats[0]);
      if (this.kind === 'scrap') mats[0].color.setHex(0xb08a50);
      this.mesh.position.set(this.x, this.y, 2);
      this.mesh.frustumCulled = false;
      game.renderer.scene.add(this.mesh);
    }
    this.needsInteract = this.kind === 'log';
    this.label = this.kind === 'log' ? 'Take the ship\'s log' : null;
  }

  get cx() { return this.x; }
  get cy() { return this.y + 8; }

  interact() { if (this.needsInteract) this.collect(); return true; }

  collect() {
    const g = this.game, p = g.player;
    this.alive = false;
    if (this.mesh) g.renderer.scene.remove(this.mesh);
    switch (this.kind) {
      case 'ammo': p.giveAmmo(); g.audio.play('pickup_ammo', { volume: 0.8 }); g.fx.number(this.x, this.y + 20, '+AMMO', 0xd8d0a0); break;
      case 'medkit': p.medkits++; g.audio.play('pickup_med', { volume: 0.8 }); g.fx.number(this.x, this.y + 20, '+MEDKIT', 0xff8a7a); break;
      case 'scrap': p.scrap += 10; g.audio.play('loot', { volume: 0.6 }); g.fx.number(this.x, this.y + 20, '+SCRAP', 0xc0a070); break;
      case 'weapon': {
        const fresh = p.giveWeapon(this.weaponKind);
        g.audio.play('levelup', { volume: 0.7 });
        g.fx.number(this.x, this.y + 20, fresh ? `+${this.weaponKind.toUpperCase()}` : '+AMMO', 0xffd34a, true);
        if (fresh) g.barks.say(p, this.weaponKind === 'shotgun' ? 'Now we\'re talking.' : 'That\'ll do.', 1.4);
        break;
      }
      case 'log': {
        p.hasLog = true;
        g.audio.play('levelup', { volume: 0.9 });
        g.fx.number(this.x, this.y + 20, 'SHIP\'S LOG', 0xffb340, true);
        g.onObjective();
        break;
      }
    }
  }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    if (this.mesh) this.mesh.position.y = this.y + 3 + Math.sin(this.t * 3) * 2;
    const p = this.game.player;
    if (!this.needsInteract && !p.dead && Math.abs(p.x - this.x) < 18 && Math.abs(p.y - this.y) < 30) this.collect();
  }
}
