// Spawns and pacing: hostiles lurk in the hives and vents at the start, more arrive through the vent
// network as the marine makes noise and progress; a wave when the log is taken and during blackouts.
import { Alien } from '../entities/Alien.js';
import { graphDistances, TILE } from '../gen/Ship.js';

export class Director {
  constructor(game) {
    this.game = game;
    this.t = 0; this.spawnT = 14; this.alive = 0; this.spawned = 0; this.killed = 0;
    this.tension = 0; this.maxAlive = 6; this.noiseLevel = 0;
    this.distCache = new Map();
    this.waves = 0;
  }

  // Room-graph distance (cached per source room).
  roomDistance(a, b) {
    if (a < 0 || b < 0) return 99;
    let d = this.distCache.get(a);
    if (!d) { d = graphDistances(this.game.ship.rooms, a); this.distCache.set(a, d); }
    return d[b] === Infinity ? 99 : d[b];
  }

  ventSpotInRoom(room) {
    const ship = this.game.ship;
    for (const vid of room.vents) { const v = ship.vents[vid]; return v.a === room.id ? v.pa : v.pb; }
    return null;
  }

  // Vent grille to emerge from near the player: in the player's room if it has one, else the
  // nearest room with a vent (by graph distance), never the airlock.
  ventNear(player, alien) {
    const ship = this.game.ship, world = this.game.world;
    const pr = world.roomIdAt(player.x, player.y + 4);
    const candidates = [];
    for (const v of ship.vents) {
      for (const [rid, spot] of [[v.a, v.pa], [v.b, v.pb]]) {
        const room = ship.rooms[rid];
        if (room.type === 'airlock') continue;
        const d = this.roomDistance(rid, pr);
        candidates.push({ spot, d: d + (rid === pr ? -0.5 : 0) + Math.random() * 0.4 });
      }
    }
    if (!candidates.length) return null;
    candidates.sort((p, q) => p.d - q.d);
    // the alien that just entered a vent should not pop out of the same grille
    const pick = candidates.find((c) => !alien || !alien.ventFrom || c.spot !== alien.ventFrom) || candidates[0];
    return pick.spot;
  }

  async populate() {
    const g = this.game;
    const ship = g.ship;
    const model = g.models.alien;
    // hives: lurkers on the floor
    for (const room of ship.rooms) {
      if (room.type !== 'hive') continue;
      const n = 2 + Math.floor(Math.random() * 2);
      for (let i = 0; i < n; i++) {
        const x = (room.x0 + 1 + Math.random() * (room.x1 - room.x0 - 1)) * TILE + TILE / 2;
        g.aliens.push(new Alien(g, model, { x, y: room.y0 * TILE, state: 'lurk' }));
        this.spawned++;
      }
    }
    // a few in the vent network, waking on noise
    for (let i = 0; i < 3; i++) {
      const a = new Alien(g, model, { x: 0, y: 0, state: 'vent' });
      a.ventT = 20 + Math.random() * 30;
      g.aliens.push(a); this.spawned++;
    }
    // a couple of lurkers in far rooms
    const far = ship.rooms.filter((r) => ship.dist[r.id] >= 4 && r.type !== 'hive' && r.type !== 'airlock').sort(() => Math.random() - 0.5).slice(0, 2);
    for (const room of far) {
      const x = (room.x0 + 1 + Math.random() * (room.x1 - room.x0 - 1)) * TILE + TILE / 2;
      g.aliens.push(new Alien(g, model, { x, y: room.y0 * TILE, state: 'lurk' }));
      this.spawned++;
    }
  }

  noise(x, y, radius) {
    const g = this.game;
    for (const a of g.aliens) {
      if (!a.alive) continue;
      if (a.state === 'lurk' && Math.hypot(a.cx - x, a.cy - y) < radius) a.noiseHeard = a.t;
      if (a.state === 'vent' && radius > 500) a.ventT = Math.min(a.ventT, 4 + Math.random() * 6);
    }
    this.noiseLevel = Math.min(3, this.noiseLevel + radius / 700);
  }

  onKill() { this.killed++; this.tension = Math.max(0, this.tension - 0.3); }

  onObjective() {
    this.maxAlive = 9; this.spawnT = 2;
    this.wave(3);
    this.game.audio.playMusic('music_tension');
  }

  onBlackout() { this.wave(2); }

  wave(n) {
    const g = this.game;
    for (let i = 0; i < n; i++) {
      const a = new Alien(g, g.models.alien, { x: 0, y: 0, state: 'vent' });
      a.ventT = 1.5 + i * 1.2 + Math.random();
      g.aliens.push(a); this.spawned++;
    }
    this.waves++;
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.noiseLevel = Math.max(0, this.noiseLevel - dt * 0.4);
    this.alive = g.aliens.filter((a) => a.alive).length;
    const hunting = g.aliens.filter((a) => a.alive && (a.state === 'hunt' || a.state === 'attack')).length;
    this.tension = Math.max(0, Math.min(1, this.tension + (hunting > 0 ? dt * 0.1 : -dt * 0.05)));
    this.spawnT -= dt * (1 + this.noiseLevel * 0.3);
    if (this.spawnT <= 0) {
      this.spawnT = 18 + Math.random() * 14 - Math.min(8, this.t / 40);
      if (this.alive < this.maxAlive && !g.player.dead) {
        const a = new Alien(g, g.models.alien, { x: 0, y: 0, state: 'vent' });
        a.ventT = 2 + Math.random() * 4;
        g.aliens.push(a); this.spawned++;
      }
    }
    // music: tension when hostiles are hunting nearby
    if (!g.player.hasLog) {
      const near = g.aliens.some((a) => a.alive && !a.hidden && a.state !== 'lurk' && Math.hypot(a.cx - g.player.cx, a.cy - g.player.cy) < 520);
      this.musicNearT = near ? 6 : Math.max(0, (this.musicNearT || 0) - dt);
      g.audio.playMusic(this.musicNearT > 0 ? 'music_tension' : 'music_derelict');
    }
    // prune the dead
    for (let i = g.aliens.length - 1; i >= 0; i--) if (g.aliens[i].removed) g.aliens.splice(i, 1);
  }
}
