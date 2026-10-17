// GameView: everything visual for one World. Subscribes to sim events for effects and reads
// sim state each frame; never mutates the simulation.
import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Actors } from './actors.js';
import { FollowCamera } from './camera.js';
import { Fx } from './fx.js';
import { LevelView } from './levelView.js';
import { Lights } from './lights.js';
import { Markers } from './markers.js';
import { Renderer } from './renderer.js';
import { makeStarfield } from './starfield.js';
import { DarknessShader, VisMask } from './visMask.js';
import { WORLD } from '../core/config.js';
import { RARITY } from '../sim/loot.js';

export class GameView {
  constructor(container, world, assets, { retro = false, fog = true, onHitStop = null } = {}) {
    this.world = world;
    this.fog = fog;
    this.onHitStop = onHitStop;
    this.renderer = new Renderer(container, { retro });
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new FollowCamera(12.5); // visible world height in metres (zooms 8-26)
    this.renderer.onResize = (w, h) => {
      this.camera.resize(w, h);
      this.camera.pixelLines = this.renderer.lines;
    };

    this.level = new LevelView(world.level, assets);
    this.scene.add(this.level.build());
    this.starfield = makeStarfield();
    this.scene.add(this.starfield);
    this.actors = new Actors(this.scene, assets);
    this.lights = new Lights(this.scene, world.marines.length);
    this.fx = new Fx(this.scene, world.physics);
    this.markers = new Markers(this.scene); // what there is to click, glowing faintly
    this.vis = new VisMask(this.renderer, world.level);
    this.flashes = new Map();
    this.damageFlash = 0;
    this.time = 0;

    const darkness = new ShaderPass(new THREE.ShaderMaterial({
      uniforms: this.vis.uniforms,
      vertexShader: DarknessShader.vertexShader,
      fragmentShader: DarknessShader.fragmentShader,
    }));
    this.renderer.setup(this.scene, this.camera.cam, [darkness]);
    this.precompile();

    const lead = world.squad.leader;
    this.camera.teleport(lead.x + 3, lead.y + 2.3);
    this.subscribe();
    this.tmp = new THREE.Vector3();
  }

  subscribe() {
    const w = this.world;
    w.on('shot', ({ marine, weapon, rays }) => {
      const p = this.actors.socket(marine, 'muzzle', this.tmp);
      rays.forEach((r, i) => {
        this.fx.shot(p.x, p.y, p.z, r.x1, r.y1, { weapon, flash: i === 0, casing: i === 0 });
        if (r.wall) this.fx.sparksAt(r.x1, r.y1, Math.sign(r.x1 - p.x), rays.length > 1 ? 2 : 6);
      });
      this.lights.flash(p.x, p.y, p.z, marine.facing);
      this.flashes.set(marine.id, 1);
      if (weapon === 'breacher' || weapon === 'marksman' || weapon === 'pistol') this.camera.shake(0.05);
      this.camera.push(-marine.facing * 0.012, 0);
    });
    w.on('hit', ({ entity, x, y, dx }) => {
      const dir = Math.sign(dx) || 1;
      if (entity.kind === 'prop') { this.fx.sparksAt(x, y, -dir, 5); return; }
      if (entity.kind === 'alien') { this.fx.bloodAt(x, y, dir, true, 6); this.fx.sparksAt(x, y, -dir, 2); }
      else if (entity.kind === 'critter') this.fx.bloodAt(x, y, dir, true, 4);
      else { this.fx.bloodAt(x, y, dir, false, 10); this.camera.shake(0.3); this.damageFlash = 1; }
    });
    w.on('kill', ({ entity }) => {
      if (entity.kind === 'alien') {
        this.fx.gibs(entity.x, entity.y, entity.facing * -1);
        this.camera.shake(0.18);
        this.onHitStop?.(0.045);
      } else if (entity.kind === 'critter') this.fx.bloodAt(entity.x, entity.y + 0.2, 1, true, 8);
      else { this.camera.shake(0.6); this.onHitStop?.(0.12); }
    });
    w.on('strike', () => this.camera.shake(0.2));
    w.on('equip', ({ marine, item }) => {
      this.actors.refreshLoadout(marine, item.rarity === 'common' ? null : RARITY[item.rarity].color);
    });
    w.on('explosion', ({ x, y, r }) => {
      this.fx.explosion(x, y, r);
      this.lights.explosion(x, y);
      this.camera.shake(0.75);
      this.onHitStop?.(0.06);
      this.damageFlash = Math.max(this.damageFlash, 0.35);
    });
    w.on('prop-destroyed', ({ entity, prop }) => {
      this.level.destroyProp(prop);
      if (!entity.explosive) this.fx.sparksAt(entity.x, entity.y + 1, 1, 24);
    });
    w.on('vent-emerge', ({ alien }) => { if (alien.visible) this.camera.shake(0.1); });
    // Ship events: a doorway on fire (the deck going dark is read from the rooms every frame).
    const fireAt = (p) => Math.min(w.level.rooms[p.a].y0, w.level.rooms[p.b].y0);
    w.on('fire', ({ portal }) => { this.level.addFireLight(portal); this.fx.addFire(portal.id, portal.x, fireAt(portal)); });
    w.on('fire-out', ({ portal }) => { this.level.removeFireLight(portal); this.fx.removeFire(portal.id); });
    // Kit: flares light a room for good; grenades are drawn from the sim each frame.
    w.on('flare', ({ room, x, y }) => { this.level.addFlareLight(room, x, y); this.fx.addFlare(room.id, x, y); });
    w.on('shove', ({ alien }) => { this.fx.shove(alien.x, alien.y + 1); this.camera.shake(0.12); });
    // Power weapons landing (sim/melee.js): the field discharges.
    w.on('melee-hit', ({ x, y, dir, weapon }) => {
      this.fx.power(x, y, dir, weapon);
      this.lights.flash(x, y, 0.4, dir);
      this.camera.shake(weapon === 'fists' ? 0.2 : 0.12);
    });
    // Set pieces: a hacked sentry firing, eggs burnt or shot, a cryo pod opening, a door cut open.
    w.on('sentry-shot', ({ sentry, x0, y0, x1, y1, hit }) => {
      const z = sentry.prop.z;
      const head = this.level.props.get(sentry.prop.id)?.obj.getObjectByName('turret_head');
      if (head) head.scale.x = sentry.facing; // the guns swing round to it
      this.fx.shot(x0, y0, z + 0.3, x1, y1, { weapon: 'carbine', casing: false });
      this.lights.flash(x0, y0, z + 0.4, sentry.facing);
      if (!hit) this.fx.sparksAt(x1, y1, -sentry.facing, 3);
    });
    w.on('eggs-burnt', ({ prop }) => { this.fx.burn(prop.x, this.world.level.rooms[prop.room].y0); this.level.destroyProp(prop); });
    w.on('eggs-shot', ({ prop }) => {
      const y = this.world.level.rooms[prop.room].y0;
      this.fx.bloodAt(prop.x, y + 0.5, 1, true, 16);
      this.fx.splat(prop.x, y + 0.05, 1.8);
      this.level.destroyProp(prop);
    });
    w.on('hatch', ({ prop }) => this.fx.bloodAt(prop.x, this.world.level.rooms[prop.room].y0 + 0.5, -1, true, 10));
    w.on('pod-opened', ({ prop }) => this.fx.vapour(prop.x, this.world.level.rooms[prop.room].y0));
    w.on('unlocked', ({ portal, cut }) => { if (cut) this.fx.sparksAt(portal.x, this.world.level.rooms[portal.a].y0 + 1.2, 1, 30); });
    w.on('power-out', () => this.camera.shake(0.15));
    // The Defend guns going down either side of the squad (they fire through 'sentry-shot').
    w.on('defend', ({ guns }) => {
      for (const g of guns) {
        this.level.addProp(this.world.level.rooms[g.room], g.prop);
        const head = this.level.props.get(g.prop.id)?.obj.getObjectByName('turret_head');
        if (head) head.scale.x = g.facing; // each covers its own side
      }
      this.camera.shake(0.08);
    });
    // A barricade on the walking line coming apart.
    w.on('barricade-down', ({ prop, room }) => {
      this.level.destroyProp(prop);
      this.fx.sparksAt(prop.x, room.y0 + 0.8, 1, 30);
      this.camera.shake(0.2);
    });
    w.on('acid', ({ x, y }) => this.fx.acidSplash(x, y));
    // Welds (door controls, vents): a glowing bead that cools; cutting a door burns it away.
    w.on('welded', ({ portal }) => {
      const y = fireAt(portal);
      this.level.weld(`d${portal.id}`, portal.x, y + 1.5, 0.14, 2.9, 1.05);
      this.fx.sparksAt(portal.x, y + 1.2, 1, 30);
    });
    w.on('cut', ({ portal }) => {
      this.level.unweld(`d${portal.id}`);
      this.fx.sparksAt(portal.x, fireAt(portal) + 1.2, -1, 40);
      this.camera.shake(0.2);
    });
    w.on('vent-welded', ({ vent }) => {
      const room = w.level.rooms[vent.room];
      const y = vent.ceiling ? room.y1 - 0.08 : room.y0 + 0.45;
      this.level.weld(`v${vent.id}`, vent.x, y, 1.05, vent.ceiling ? 0.12 : 0.62, WORLD.BACK_Z + 0.25);
      this.fx.sparksAt(vent.x, y, 1, 24);
    });
  }

  /**
   * Compile every shader the level can need now, instead of on first sight (which stalls
   * frames mid-game: the camera then jumps - it looked like flicker). Hidden objects are
   * made visible for the compile pass.
   */
  precompile() {
    const hidden = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { this.renderer.gl.compile(this.scene, this.camera.cam); } catch (err) { console.warn('[game] precompile', err); }
    for (const o of hidden) o.visible = false;
  }

  setRetro(on) { this.renderer.setRetro(on); }

  render(alpha, dt) {
    const w = this.world;
    this.time += dt;
    this.level.update(dt, this.time);
    const entities = [...w.marines, ...w.aliens, ...w.critters, ...w.survivors];
    this.actors.update(dt, alpha, entities);

    // Camera: squad centre with look-ahead in the heading, a little above the floor.
    const sq = w.squad;
    const alive = sq.order.length ? sq.order : w.marines;
    // Follow the same interpolated positions the actors are drawn at - using raw sim
    // positions (which advance in whole steps) makes the whole scene judder by a pixel.
    const lerp = (a, b) => a + (b - a) * alpha;
    // Lead: the player's marine, looking the way he faces (gently - he turns a lot in a fight).
    const you = w.lead && w.player?.alive ? w.player : null;
    const cx = you ? lerp(you.prevX, you.x) : alive.reduce((s, m) => s + lerp(m.prevX, m.x), 0) / alive.length;
    const lead = you ?? alive[0];
    const ahead = you ? you.facing * 2.2 : sq.heading * 3.2;
    this.lookAhead = (this.lookAhead ?? ahead) + (ahead - (this.lookAhead ?? 0)) * Math.min(1, dt * (you ? 1.1 : 1.5));
    this.camera.update(dt, cx + this.lookAhead, lerp(lead.prevY, lead.y) + 2.3);
    this.starfield.userData.update(this.camera, dt);

    for (const [id, v] of this.flashes) this.flashes.set(id, Math.max(0, v - dt * 14));
    this.updateRig(dt);
    this.lights.update(dt, w.marines, (m) => this.actors.socket(m, 'light', this.tmp), w.settings.flashlight, this.level.lamps, this.camera.center, this.rig);

    this.vis.update(w, this.flashes, this.rig);
    this.vis.setView(this.camera.bounds(), this.fog);
    this.fx.syncAcid(w.projectiles, w.pools);
    this.fx.syncGrenades(w.gear.grenades);
    this.fx.update(dt);
    this.markers.update(w, dt);

    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
    this.renderer.grade.uniforms.damage.value = this.damageFlash * 0.8 + (w.uplink ? 0.25 + 0.15 * Math.sin(this.time * 6) : 0);
    this.renderer.render(dt);
  }

  /**
   * Flashlight rig, shared by the spotlight, the beam sprite and the fog-of-war cone so they
   * always agree and never snap:
   *   fx     signed beam direction along x. Turning sweeps it through 0 (beam pointing at the
   *          camera - foreshortened to nothing) to the other side over ~0.2 s.
   *   climb  0..1 fade while on a LADDER (facing the wall; stair steps don't count).
   *   reach  eased distance to the first wall, cast from the body (a muzzle poking into a door
   *          used to start the ray inside it and blink the beam on and off).
   */
  updateRig(dt) {
    this.rig ??= new Map();
    for (const m of this.world.marines) {
      let r = this.rig.get(m.id);
      if (!r) { r = { fx: m.facing, climb: 0, reach: 20 }; this.rig.set(m.id, r); }
      const climbing = m.mode === 'climb' || (m.mode === 'step' && Math.abs(m.z) > 1.25);
      const step = dt / 0.2 * 2;
      r.fx += Math.sign(m.facing - r.fx) * Math.min(Math.abs(m.facing - r.fx), step);
      r.climb += ((climbing ? 1 : 0) - r.climb) * Math.min(1, dt * 6);
      const side = Math.sign(r.fx) || m.facing;
      const pitch = m.pitch ?? -0.05;
      const hit = this.world.physics.raycast(m.x, m.y + 1.35 * (m.scale ?? 1), side * Math.cos(pitch), Math.sin(pitch), 30);
      const want = Math.max(0.2, (hit?.dist ?? 30) - 0.85);
      r.reach += (want - r.reach) * Math.min(1, dt * 10);
    }
  }

  /** World -> CSS pixel coordinates (for DOM barks and markers). */
  toScreen(x, y, z = 0) {
    const v = this.tmp.set(x, y, z).project(this.camera.cam);
    return { x: (v.x + 1) / 2 * this.renderer.width, y: (1 - v.y) / 2 * this.renderer.height };
  }
}
