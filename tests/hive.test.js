// The hive's habits: flanking over the squad, stalking the rear, hit and run through the vents,
// torch-shy creepers, runners drawn to gunfire, dragging a man down off to a vent - and two new
// breeds, the screamer and the brood mother.
import { beforeAll, describe, expect, it } from 'vitest';
import { BROOD, PACK, ROE, SCREAM } from '../src/core/config.js';
import { walkLimits } from '../src/gen/layout.js';
import { ceilingSpans, generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { lit, updateAlien, wake } from '../src/sim/alien.js';
import { makeAlien } from '../src/sim/entities.js';
import { World } from '../src/sim/world.js';

const STEP = 1 / 60;
beforeAll(async () => { await initPhysics(); });
const run = (w, s) => { for (let i = 0; i < s * 60 && w.status === 'playing'; i++) w.step(STEP); };
/** Nothing on the board, well inside the ship. */
function calm(params = {}, seed = 'A1') {
  const w = new World(generateLevel(seed), { params });
  for (const a of w.aliens) { a.alive = false; w.physics.removeHitbox(a); }
  w.reserve = 0;
  run(w, 45);
  return w;
}
/** On until the whole squad is in one room with clear floor `need` metres ahead of the point man. */
function roomAhead(w, need = 9) {
  for (let i = 0; i < 60 * 240; i++) {
    const sq = w.squad;
    const lead = sq.leader;
    const [wl, wr] = walkLimits(w.level.rooms[lead.room]);
    const ahead = sq.heading > 0 ? wr - lead.x : lead.x - wl;
    if (ahead >= need && lead.mode === 'walk' && sq.order.every((m) => m.room === lead.room && m.mode === 'walk')) return lead;
    w.step(STEP);
  }
  throw new Error('no room ahead');
}
/** On until the whole squad is in one room with `need` metres of floor behind the rear man. */
function roomBehind(w, need = 8) {
  for (let i = 0; i < 60 * 300; i++) {
    const sq = w.squad;
    const rear = sq.order[sq.order.length - 1];
    const [wl, wr] = walkLimits(w.level.rooms[rear.room]);
    const behind = sq.heading > 0 ? rear.x - wl : wr - rear.x;
    if (behind >= need && sq.order.every((m) => m.room === rear.room && m.mode === 'walk')) return rear;
    w.step(STEP);
  }
  throw new Error('no room behind');
}
const spawn = (w, type, x, room, state = 'hunt') => {
  const [wl, wr] = walkLimits(w.level.rooms[room]);
  const a = w.addAlien(makeAlien(w.rng, Math.min(wr, Math.max(wl, x)), w.level.rooms[room].y0, room, state, { type }));
  a.wakeT = 0;
  return a;
};
/** Every habit roll comes up. */
const sure = () => ({ chance: () => true, float: (lo) => lo, int: (lo) => lo, pick: (arr) => arr[0], next: () => 0 });
const tick = (w, a, s, until = () => false) => {
  for (let i = 0; i < s * 60; i++) { updateAlien(w, a, STEP); if (until()) return true; }
  return false;
};

describe('pack habits', () => {
  it('flanking: with a packmate closing from the front, a climber goes over them for the far man', () => {
    const w = calm();
    // A room with one long stretch of ceiling: the squad in a line under it.
    const room = w.level.rooms.find((r) => r.dist >= 2 && ceilingSpans(w.level, r).some(([x0, x1]) => x1 - x0 >= 17));
    const [x0] = ceilingSpans(w.level, room).find(([p, q]) => q - p >= 17);
    w.squad.order.forEach((m, i) => Object.assign(m, { room: room.id, x: x0 + 8 - i * 2.2, y: room.y0, mode: 'walk', moving: false }));
    const lead = w.squad.leader;
    const h = 1;
    spawn(w, 'drone', lead.x + h * 4, lead.room);
    const a = spawn(w, 'runner', lead.x + h * 7, lead.room);
    w.hive = sure();
    let flanked = null;
    let onto = null;
    let up = false;
    w.on('flank', ({ marine }) => { flanked = marine; });
    w.on('alien-drop', ({ alien, onto: o }) => { if (alien === a) onto = o; });
    tick(w, a, 0.5, () => flanked);
    const far = w.squad.order.reduce((b, o) => (Math.abs(o.x - a.x) > Math.abs(b.x - a.x) ? o : b));
    expect(flanked).toBe(far);
    expect(a.prey).toBe(far);
    tick(w, a, 10, () => { up ||= a.surface !== 'floor'; return onto; });
    expect(up).toBe(true);
    expect(onto).toBe(far); // dropped on the man at the back
  });

  it('stalking: one that woke unseen shadows the rear man - and closes when a man near it reloads', () => {
    const w = calm();
    roomBehind(w, 8);
    const order = w.squad.order;
    const rear = order[order.length - 1];
    const h = w.squad.heading;
    const a = spawn(w, 'runner', rear.x - h * 7, rear.room, 'dormant');
    expect(Math.abs(a.x - rear.x)).toBeGreaterThan(3);
    w.hive = sure();
    wake(w, a, 'steps');
    expect(a.stalk).toBeTruthy();
    const x0 = a.x;
    tick(w, a, 3);
    expect(a.stalk).toBeTruthy(); // still only watching
    expect(Math.abs(a.x - x0)).toBeLessThan(0.5);
    let mark = null;
    w.on('stalker', ({ marine }) => { mark = marine; });
    order[2].reloadT = 2;
    tick(w, a, 0.1);
    expect(mark).toBe(order[2]);
    expect(a.stalk).toBe(null);
    const d = Math.abs(a.x - order[2].x);
    tick(w, a, 0.6);
    expect(Math.abs(a.x - order[2].x)).toBeLessThan(d);
  });

  it('a stalker left behind follows the squad from room to room', () => {
    const w = calm({ god: true });
    const rear = w.squad.order[w.squad.order.length - 1];
    const a = spawn(w, 'creeper', rear.x - w.squad.heading * 4, rear.room, 'dormant');
    w.hive = sure();
    wake(w, a, 'noise');
    // Here only its patience never runs out, nobody slips, and it's never seen or shot at.
    a.stalk.t = -1e9;
    const gap = PACK.STALK.GAP;
    PACK.STALK.GAP = 1e9;
    const rooms = new Set([a.room]);
    try {
      for (let i = 0; i < 60 * 60 && a.stalk; i++) {
        w.settings.roe = ROE.CAUTIOUS;
        w.step(STEP);
        a.visible = false;
        rooms.add(a.room);
      }
    } finally { PACK.STALK.GAP = gap; }
    expect(a.stalk).toBeTruthy();
    expect(rooms.size).toBeGreaterThan(1);
  }, 60000);

  it('hit and run: badly hurt, it bolts for a vent, lurks, and comes back out near the squad healed', () => {
    const w = calm({ god: true });
    const v = w.level.vents.find((o) => o.links.length && !o.welded && o.room !== w.squad.leader.room);
    w.hive = sure();
    const a = spawn(w, 'runner', v.x + 4, v.room);
    let fled = 0;
    let back = 0;
    w.on('alien-flee', () => fled++);
    w.on('alien-return', () => back++);
    w.damage(a, a.maxHp * 0.75, w.squad.leader, {});
    expect(fled).toBe(1);
    expect(tick(w, a, 20, () => a.state === 'vent')).toBe(true);
    expect(tick(w, a, PACK.FLEE.LURK[0] + 2, () => back)).toBe(true);
    expect(a.hp).toBe(a.maxHp);
    const near = w.director.ventsNear(w.squad.leader.room, 0, 1).map((o) => o.room);
    expect(near).toContain(a.room);
    // It only runs the once.
    a.state = 'hunt';
    w.damage(a, a.maxHp * 0.75, w.squad.leader, {});
    expect(fled).toBe(1);
  });

  it('a creeper held in a torch beam backs off; with the torches off it comes straight on', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w);
    const h = w.squad.heading;
    for (const m of w.squad.order) { m.facing = h; m.pitch = 0; }
    const a = spawn(w, 'creeper', lead.x + h * 6, lead.room);
    a.climbs = 0; // (no going up out of it, here)
    a.leapRange = 0;
    expect(lit(w, a)).toBe(true);
    const d0 = Math.abs(a.x - lead.x);
    tick(w, a, 2);
    expect(Math.abs(a.x - lead.x)).toBeGreaterThan(d0);
    w.settings.flashlight = false;
    expect(lit(w, a)).toBe(false);
    const d1 = Math.abs(a.x - lead.x);
    tick(w, a, 0.5);
    expect(Math.abs(a.x - lead.x)).toBeLessThan(d1);
  });

  it('runners hear gunfire from further off than drones', () => {
    const w = calm();
    const lead = w.squad.leader;
    const far = w.level.rooms.reduce((b, r) => (Math.abs(r.y0 - lead.y) + Math.abs(r.x0 - lead.x) > Math.abs(b.y0 - lead.y) + Math.abs(b.x0 - lead.x) ? r : b));
    const x = (far.x0 + far.x1) / 2;
    const runner = spawn(w, 'runner', x, far.id, 'dormant');
    const drone = spawn(w, 'drone', x, far.id, 'dormant');
    w.noise(runner.x + 20, runner.y, 14);
    for (let i = 0; i < 6; i++) { w.tick++; updateAlien(w, runner, STEP); updateAlien(w, drone, STEP); }
    expect(runner.state).toBe('hunt');
    expect(drone.state).toBe('dormant');
  });

  it('one that reaches a man down drags him off toward a vent; shot enough it lets go; at the vent he is taken', () => {
    const w = calm();
    const lead = w.squad.leader;
    const v = w.level.vents.find((o) => !o.ceiling && o.room !== lead.room && !o.welded
      && Math.abs(w.level.rooms[o.room].y0 - lead.y) > 1 && walkLimits(w.level.rooms[o.room])[1] - walkLimits(w.level.rooms[o.room])[0] > 10);
    const room = w.level.rooms[v.room];
    const [wl, wr] = walkLimits(room);
    const m = w.squad.order[3];
    const away = v.x - wl > wr - v.x ? -1 : 1; // the roomier side of the vent
    Object.assign(m, { room: v.room, x: v.x + away * 5, y: room.y0, mode: 'walk' });
    w.downMarine(m);
    w.hive = sure();
    const a = spawn(w, 'brute', m.x + away * 1.2, v.room);
    let dragged = 0;
    let taken = 0;
    w.on('dragged', () => dragged++);
    w.on('taken', () => taken++);
    expect(tick(w, a, 4, () => dragged)).toBe(true);
    expect(m.dragged).toBe(a);
    const d0 = Math.abs(m.x - v.x);
    tick(w, a, 1.5);
    expect(Math.abs(m.x - v.x)).toBeLessThan(d0 - 0.5);
    w.damage(a, PACK.DRAG.DROP + 1, w.squad.leader, {});
    expect(a.drag).toBe(null);
    expect(m.dragged).toBeFalsy();
    expect(m.alive).toBe(true);
    // Unchecked, it gets him to the vent.
    expect(tick(w, a, 25, () => taken)).toBe(true);
    expect(m.alive).toBe(false);
    expect(m.taken).toBe(true);
    expect(a.state).toBe('vent');
  });
});

describe('the screamer', () => {
  it('finding the squad, it rears up and screams; a heavy hit cuts the next one off', () => {
    const w = calm();
    const lead = roomAhead(w);
    const a = spawn(w, 'screamer', lead.x + w.squad.heading * 8, lead.room);
    let screamed = 0;
    let cut = 0;
    w.on('scream', () => screamed++);
    w.on('scream-cut', () => cut++);
    updateAlien(w, a, STEP);
    expect(a.state).toBe('scream');
    tick(w, a, SCREAM.WINDUP + 0.1, () => screamed);
    expect(screamed).toBe(1);
    expect(a.state).toBe('hunt');
    a.screamT = 0;
    updateAlien(w, a, STEP);
    expect(a.state).toBe('scream');
    w.damage(a, 5, lead, { stagger: 0.35 });
    expect(cut).toBe(1);
    expect(a.state).toBe('hunt');
    tick(w, a, SCREAM.WINDUP + 0.1);
    expect(screamed).toBe(1);
  });

  it('the scream wakes every sleeper in earshot and calls more out of the vents', () => {
    const w = calm();
    w.reserve = 4;
    const lead = w.squad.leader;
    const a = spawn(w, 'screamer', lead.x, lead.room);
    const near = spawn(w, 'drone', lead.x + 2, lead.room, 'dormant');
    const farRoom = w.level.rooms.find((r) => Math.hypot((r.x0 + r.x1) / 2 - a.x, r.y0 - a.y) > SCREAM.RANGE + 6);
    const far = spawn(w, 'drone', (farRoom.x0 + farRoom.x1) / 2, farRoom.id, 'dormant');
    let ev = null;
    w.on('scream', (e) => { ev = e; });
    w.scream(a);
    expect(near.state).toBe('hunt');
    expect(far.state).toBe('dormant');
    expect(ev.woke).toBeGreaterThanOrEqual(1);
    expect(w.reserve).toBe(4 - ev.called);
    if (w.director.ventsNear(a.room, 0, 1).length) expect(ev.called).toBeGreaterThan(0);
  });

  it('the squad drops a screamer before a closer drone', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 10);
    const h = w.squad.heading;
    const drone = spawn(w, 'drone', lead.x + h * 5, lead.room);
    const scr = spawn(w, 'screamer', lead.x + h * 8, lead.room);
    drone.wakeT = scr.wakeT = 99; // (both just standing there)
    // Who each man draws a bead on first (the fight's over inside a second or so).
    const first = new Map();
    for (let i = 0; i < 60 && first.size < w.squad.order.length; i++) {
      w.step(STEP);
      for (const m of w.squad.order) if (m.target && !first.has(m)) first.set(m, m.target);
    }
    const picks = [...first.values()];
    expect(picks.length).toBeGreaterThan(0);
    // (A fuel barrel right by the screamer is the screamer.)
    const atScreamer = (t) => t === scr || (t.kind === 'prop' && Math.abs(t.x - scr.x) < 2.5);
    expect(picks.filter(atScreamer).length).toBeGreaterThan(picks.length / 2);
  });
});

describe('the brood mother', () => {
  it('turns up in some ships - one at most, on the floor of the deepest nest', () => {
    let found = 0;
    for (let i = 0; i < 60; i++) {
      const L = generateLevel(`BR${i}`);
      const b = L.spawns.aliens.filter((s) => s.type === 'brood');
      expect(b.length).toBeLessThanOrEqual(1);
      if (!b.length) continue;
      found++;
      const room = L.rooms[b[0].room];
      expect(room.nest).toBe(true);
      expect(b[0].surface).toBe('floor');
      const nests = L.rooms.filter((r) => r.nest && L.spawns.aliens.some((s) => s.room === r.id));
      expect(room.dist).toBe(Math.max(...nests.map((r) => r.dist)));
    }
    expect(found).toBeGreaterThan(5);
    expect(found).toBeLessThan(50);
  });

  it('awake, she births runners out of the ship\'s reserve; killing her pays', () => {
    const w = calm({ god: true });
    const lead = roomAhead(w, 10);
    w.reserve = 3;
    const b = spawn(w, 'brood', lead.x + w.squad.heading * 10, lead.room);
    b.hp = b.maxHp = 1e6;
    const born = [];
    w.on('birth', ({ child }) => born.push(child));
    run(w, 2 + BROOD.EVERY + 1);
    expect(born.length).toBeGreaterThanOrEqual(2);
    expect(born.every((c) => c.type === 'runner')).toBe(true);
    expect(w.reserve).toBe(3 - born.length);
    b.hp = 10;
    const credits = w.credits;
    let dead = 0;
    w.on('brood-dead', () => dead++);
    w.damage(b, 50, lead, {});
    expect(dead).toBe(1);
    expect(w.credits).toBeGreaterThanOrEqual(credits + BROOD.BONUS);
  });
});
