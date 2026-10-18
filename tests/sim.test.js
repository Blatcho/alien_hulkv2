import { beforeAll, describe, expect, it } from 'vitest';
import { generateLevel } from '../src/gen/level.js';
import { initPhysics } from '../src/physics/physics.js';
import { World } from '../src/sim/world.js';
import { roeAllows } from '../src/sim/combat.js';
import { AWARE, ROE } from '../src/core/config.js';
import { inView } from '../src/vis/sight.js';
import { Trail } from '../src/nav/trail.js';
import { makeAlien } from '../src/sim/entities.js';

const makeAlienFor = (world, x, room) => makeAlien(world.rng, x, room.y0, room.id, 'hunt');

const STEP = 1 / 60;

beforeAll(async () => { await initPhysics(); });

/** Step until the squad asks the given kind of decision; returns the time (or null). */
function untilDecision(world, type, seconds = 60) {
  for (let i = 0; i < seconds * 60; i++) {
    world.step(STEP);
    if (world.squad.decision?.type === type) return world.time;
  }
  return null;
}

function run(world, seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n && world.status === 'playing'; i++) world.step(STEP);
  return world;
}

describe('trail', () => {
  it('samples and reverses consistently', () => {
    const t = new Trail();
    t.push(0, 0, 0, 'walk', 0);
    t.push(2, 0, 0, 'walk', 0);
    t.push(2, 0, -1.4, 'step', 0);
    t.push(2, 5, -1.4, 'climb', 1);
    expect(t.length).toBeCloseTo(2 + 0.7 + 5, 5);
    expect(t.sample(1).x).toBeCloseTo(1);
    expect(t.sample(5).mode).toBe('climb');
    const L = t.reverse();
    expect(t.sample(L - 5).mode).toBe('climb');
    expect(t.sample(L - 1).mode).toBe('walk');
    expect(t.sample(0).y).toBeCloseTo(5);
  });
});

describe('rules of engagement', () => {
  const alien = { kind: 'alien', alive: true, state: 'hunt' };
  const sleeper = { kind: 'alien', alive: true, state: 'dormant' };
  const critter = { kind: 'critter', alive: true, moving: true };
  const stranger = { kind: 'survivor', alive: true, moving: true, identified: false };
  const friend = { ...stranger, identified: true };
  it('cautious only returns fire, and only at hostiles', () => {
    expect(roeAllows(ROE.CAUTIOUS, alien, { attackedRecently: false })).toBe(false);
    expect(roeAllows(ROE.CAUTIOUS, alien, { attackedRecently: true })).toBe(true);
    expect(roeAllows(ROE.CAUTIOUS, critter, { attackedRecently: true })).toBe(false);
    expect(roeAllows(ROE.CAUTIOUS, stranger, { attackedRecently: true })).toBe(false);
  });
  it('normal fires on anything that moves - including unidentified survivors', () => {
    expect(roeAllows(ROE.NORMAL, alien, {})).toBe(true);
    expect(roeAllows(ROE.NORMAL, critter, {})).toBe(true);
    expect(roeAllows(ROE.NORMAL, { ...critter, moving: false }, {})).toBe(false);
    expect(roeAllows(ROE.NORMAL, sleeper, {})).toBe(false);
    expect(roeAllows(ROE.NORMAL, stranger, {})).toBe(true);
    expect(roeAllows(ROE.NORMAL, friend, {})).toBe(false);
    expect(roeAllows(ROE.NORMAL, { ...alien, state: 'vent' }, {})).toBe(false);
  });
  it('high alert fires on every hostile (sleepers too) and nothing else', () => {
    expect(roeAllows(ROE.ALERT, alien, {})).toBe(true);
    expect(roeAllows(ROE.ALERT, sleeper, {})).toBe(true);
    expect(roeAllows(ROE.ALERT, critter, {})).toBe(false);
    expect(roeAllows(ROE.ALERT, stranger, {})).toBe(false);
  });
});

describe('simulation', () => {
  it.each(['A1', 'B2', 'C3', 'D4', 'E5', 'F6'])('seed %s: autoplay squad reaches the command deck and wins (god mode)', (seed) => {
    const world = new World(generateLevel(seed), { params: { autoplay: true, god: true } });
    run(world, 900);
    expect(world.state().status).toBe('won');
    expect(world.stats.rooms).toBeGreaterThan(3);
  });

  it.each(['G7', 'H8', 'I9'])('seed %s: a mortal squad plays out without errors', (seed) => {
    const world = new World(generateLevel(seed), { params: { autoplay: true } });
    run(world, 900);
    expect(['won', 'lost', 'playing']).toContain(world.status);
    expect(world.stats.shots ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('the squad stacks up at the inner airlock door, then opens it on its own', () => {
    const world = new World(generateLevel('DOOR'), { params: {} });
    const door = world.level.portals.find((p) => p.airlock);
    const at = untilDecision(world, 'door');
    expect(at).not.toBeNull();
    expect(door.open).toBe(false);
    run(world, 5);
    expect(door.open).toBe(true);
  });

  it('walking marines always stand on their room floor, even after the point man dies on a ladder', () => {
    const world = new World(generateLevel('LADDERDEATH'), { params: { autoplay: true, god: true } });
    const onFloor = () => world.squad.order.every((m) => m.mode !== 'walk' || Math.abs(m.y - world.level.rooms[m.room].y0) < 0.02);
    let killed = false;
    for (let i = 0; i < 60 * 600 && world.status === 'playing'; i++) {
      world.step(STEP);
      if (i % 10 === 0) expect(onFloor()).toBe(true);
      const lead = world.squad.leader;
      if (!killed && lead.mode === 'climb' && world.squad.order.length === 4) {
        world.kill(lead, null);
        killed = true;
      }
    }
    expect(killed).toBe(true);
    expect(world.status).toBe('won');
  });

  it('climbs ladders one at a time, with the next man covering the shaft', () => {
    // A corvette with ladders on the way to the bridge (docked to starboard, too).
    const world = new World(generateLevel('CRV-L1'), { params: { autoplay: true, god: true } });
    let maxClimbing = 0;
    let covered = false;
    let ladders = 0;
    world.on('ladder-top', () => ladders++);
    for (let i = 0; i < 60 * 600 && world.status === 'playing'; i++) {
      world.step(STEP);
      const climbing = world.squad.order.filter((m) => m.mode === 'climb').length;
      maxClimbing = Math.max(maxClimbing, climbing);
      if (climbing && world.squad.order.some((m) => m.anim === 'aim_up' || m.anim === 'aim_down')) covered = true;
    }
    expect(ladders).toBeGreaterThan(0);
    expect(maxClimbing).toBe(1);
    expect(covered).toBe(true);
    expect(world.status).toBe('won');
  });

  it('door drill: while stacking up, #2 kneels covering the door and the rear man watches our six', () => {
    const world = new World(generateLevel('DOOR'), { params: {} });
    untilDecision(world, 'door');
    // Sample the stack-up: the last step before the doctrine gives the word.
    let snap = null;
    for (let i = 0; i < 60 * 5 && world.squad.decision?.type === 'door'; i++) {
      const [, second, , last] = world.squad.order;
      snap = { H: world.squad.heading, second: { stance: second.stance, anim: second.anim, facing: second.facing }, last: { stance: last.stance, facing: last.facing } };
      world.step(STEP);
    }
    expect(snap.second.stance).toBe('engaged');
    expect(snap.second.anim).toBe('crouch_aim');
    expect(snap.second.facing).toBe(snap.H);
    expect(snap.last.facing).toBe(-snap.H);
    expect(snap.last.stance).toBe('alert');
  });

  it('after a fight the squad holds weapons up, calls clear, then relaxes to casual', () => {
    const world = new World(generateLevel('A1'), { params: { autoplay: true, god: true } });
    const said = [];
    world.on('bark', (b) => said.push({ t: world.time, key: b.key }));
    let combatEnd = null;
    let sawCasualAfter = false;
    for (let i = 0; i < 60 * 300 && world.status === 'playing'; i++) {
      const was = world.squad.engaged;
      world.step(STEP);
      if (was && !world.squad.engaged && combatEnd === null) combatEnd = world.time;
      if (combatEnd !== null && world.time < combatEnd + 1.5) {
        expect(world.squad.order.every((m) => m.stance === 'engaged')).toBe(true);
      }
      if (combatEnd !== null && world.time > combatEnd + 14 && world.squad.order.every((m) => m.stance === 'casual')) sawCasualAfter = true;
    }
    expect(combatEnd).not.toBeNull();
    expect(said.some((b) => (b.key === 'clear' || b.key === 'lost') && b.t > combatEnd)).toBe(true);
    expect(sawCasualAfter).toBe(true);
  });

  it('each trooper carries a different weapon; the breacher fires pellet spreads', () => {
    const world = new World(generateLevel('A1'), { params: { autoplay: true, god: true } });
    expect(new Set(world.marines.map((m) => m.weaponKey)).size).toBe(4);
    let pellets = 0;
    world.on('shot', (s) => { if (s.weapon === 'breacher') pellets = Math.max(pellets, s.rays.length); });
    run(world, 300);
    expect(pellets).toBe(7);
  });

  it('explosions damage everything in range and chain into nearby barrels', () => {
    let world = null;
    let pair = null;
    for (let i = 0; i < 60 && !pair; i++) {
      world = new World(generateLevel(`BOOM${i}`), { params: {} });
      const barrels = world.props.filter((p) => p.explosive);
      for (const a of barrels) for (const b of barrels) {
        if (a !== b && a.room === b.room && Math.abs(a.x - b.x) < 3.5) pair = [a, b];
      }
    }
    expect(pair).not.toBeNull();
    const [a, b] = pair;
    const room = world.level.rooms[a.room];
    const victim = world.addAlien(makeAlienFor(world, a.x + 1, room));
    victim.state = 'hunt';
    world.damage(a, 999, world.marines[0]);
    run(world, 0.6);
    expect(a.alive).toBe(false);
    expect(b.alive).toBe(false);          // chain reaction
    expect(victim.hp).toBeLessThan(victim.maxHp);
    expect(a.prop.destroyed && b.prop.destroyed).toBe(true);
  });

  it('aliens never strike through closed doors, walls or floors', () => {
    let strikes = 0;
    for (const seed of ['NOWALL1', 'NOWALL2', 'NOWALL3', 'A1']) { // NOWALL3 sees plenty of melee
      const world = new World(generateLevel(seed), { params: { autoplay: true } });
      world.on('strike', ({ alien, marine }) => {
        strikes++;
        expect(world.physics.los(alien.x, alien.y + 0.9, marine.x, marine.y + 1.0)).toBe(true);
        expect(Math.abs(alien.y - marine.y)).toBeLessThanOrEqual(2.2);
      });
      run(world, 400);
    }
    expect(strikes).toBeGreaterThan(0);
  });

  it('a closed door stops an alien pressed right against it', () => {
    const world = new World(generateLevel('DOOR'), { params: {} });
    untilDecision(world, 'door');
    world.toggleCover(); // Cover: a full stop - the doctrine won't open the door either
    run(world, 2);
    const door = world.level.portals.find((p) => p.airlock);
    expect(door.open).toBe(false);
    const marine = world.squad.leader;
    const other = world.level.rooms[door.b];
    const a = world.addAlien(makeAlienFor(world, door.x + 0.7, other));
    a.state = 'attack';
    a.target = marine;
    const hp = marine.hp;
    let struck = false;
    world.on('strike', () => { if (!door.open) struck = true; });
    run(world, 0.9); // shorter than it takes to force the door
    expect(struck).toBe(false);
    expect(marine.hp).toBe(hp);
  });

  it('after stairs or a ladder the point man waits at the top until the squad is up, the rest cover the climb', () => {
    const world = new World(generateLevel('A1'), { params: { autoplay: true, god: true } });
    let checks = 0;
    let covering = 0;
    let climbs = 0;
    world.on('ladder-top', () => climbs++);
    for (let i = 0; i < 60 * 600 && world.status === 'playing'; i++) {
      world.step(STEP);
      const L = world.squad.ladder;
      if (!L || L.sb === undefined) continue;
      const stillComing = world.squad.order.some((m) => m.s < L.sb - 0.01);
      if (!stillComing) continue;
      checks++;
      // Nobody gets further than the regroup point while team-mates are still climbing.
      expect(world.squad.leader.s).toBeLessThanOrEqual(L.sb + world.squad.offset(world.squad.order.length - 1) + 0.6);
      const up = world.squad.order.filter((m) => m.s >= L.sb - 0.01 && m !== world.squad.leader);
      if (up.some((m) => m.stance === 'engaged' && !m.moving && m.facing === (Math.sign((L.portal.kind === 'ladder' ? L.portal.x : L.up ? L.portal.xt : L.portal.xb) - m.x) || m.facing))) covering++;
    }
    expect(climbs).toBeGreaterThan(0);
    expect(checks).toBeGreaterThan(0);
    expect(covering).toBeGreaterThan(0);
  });

  it('turning around makes the rear marine the new point man, and the squad keeps that way', () => {
    const world = new World(generateLevel('TURN'), { params: {} });
    run(world, 20);
    // On their feet and under way (an order to turn is ignored mid-climb or mid-job).
    for (let i = 0; i < 60 * 120; i++) {
      const sq = world.squad;
      if (sq.state === 'advance' && !sq.trav && !sq.action && !sq.ladder && sq.order.every((m) => m.mode === 'walk' && m.room === sq.leader.room)) break;
      world.step(STEP);
    }
    const rear = world.squad.order[world.squad.order.length - 1];
    const H = world.squad.heading;
    world.turnAround();
    run(world, 4);
    expect(world.squad.leader).toBe(rear);
    expect(world.squad.heading).toBe(-H);
    run(world, 6);
    expect(world.squad.heading).toBe(-H); // the doctrine doesn't U-turn straight back
  });
});

describe('squad behaviour', () => {
  // One autoplay run, sampled every step, shared by the checks below.
  let rec = null;
  const record = () => {
    if (rec) return rec;
    const world = new World(generateLevel('A1'), { params: { autoplay: true, god: true } });
    rec = { world, gaps: [], minGap: Infinity, spread: [], pitch: world.marines.map(() => [0, 0]), kinds: new Set(), distinct: 0,
      sixMoving: 0, checks: 0, frontKneel: 0 };
    for (let i = 0; i < 60 * 400 && world.status === 'playing'; i++) {
      world.step(STEP);
      const sq = world.squad;
      const o = sq.order;
      const H = sq.heading;
      if (sq.loose()) rec.gaps.push(o[0].s - o[1].s);
      for (let k = 1; k < o.length; k++) if (o[k].mode === 'walk' && o[k - 1].mode === 'walk') rec.minGap = Math.min(rec.minGap, o[k - 1].s - o[k].s);
      const walking = o.filter((m) => m.moving && m.mode === 'walk').map((m) => m.v);
      if (walking.length >= 3) rec.spread.push(Math.max(...walking) - Math.min(...walking));
      world.marines.forEach((m, j) => { rec.pitch[j][0] = Math.min(rec.pitch[j][0], m.pitch); rec.pitch[j][1] = Math.max(rec.pitch[j][1], m.pitch); });
      for (const m of o) if (m.look) rec.kinds.add(m.look.kind);
      if (o.length === 4 && new Set(o.map((m) => m.look)).size === 4) rec.distinct++;
      const rear = o[o.length - 1];
      if (sq.leader.moving && rear.sixT > 0 && rear.facing === -H) rec.sixMoving++;
      rec.checks += o.filter((m) => m.checkT > 0 && m.sixT <= 0 && m.checkOn).length;
      for (const m of o) {
        if (!m.target || !m.anim.startsWith('crouch')) continue;
        const dir = Math.sign(m.target.x - m.x);
        if (o.some((b) => b !== m && b.target && Math.sign(b.target.x - b.x) === dir && (m.x - b.x) * dir > 0.3 && !b.anim.startsWith('crouch'))) rec.frontKneel++;
      }
    }
    return rec;
  };

  it('the formation breathes: spacing and speeds vary, but nobody walks into the man ahead', () => {
    const r = record();
    expect(r.world.status).toBe('won');
    const mean = r.gaps.reduce((a, b) => a + b, 0) / r.gaps.length;
    const sd = Math.sqrt(r.gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / r.gaps.length);
    expect(sd).toBeGreaterThan(0.2);
    expect(r.minGap).toBeGreaterThanOrEqual(AWARE.MIN_GAP - 1e-6);
    expect(r.spread.reduce((a, b) => a + b, 0) / r.spread.length).toBeGreaterThan(0.2);
  });

  it('troopers look around: weapons pitch up and down onto different things', () => {
    const r = record();
    for (const [lo, hi] of r.pitch) {
      expect(lo).toBeLessThan(-0.3);
      expect(hi).toBeGreaterThan(0.3);
    }
    for (const kind of ['vent', 'door', 'prop', 'horizon']) expect(r.kinds.has(kind)).toBe(true);
    expect(r.distinct).toBeGreaterThan(600); // all four watching different things for 10 s+
  });

  it('the rear man checks six on the move; others stop to check vents and bodies', () => {
    const r = record();
    expect(r.sixMoving).toBeGreaterThan(60);
    expect(r.checks).toBeGreaterThan(60);
  });

  it('in a firefight the front rank kneels while the man behind fires over him', () => {
    expect(record().frontKneel).toBeGreaterThan(0);
  });

  it('the sight cone follows the weapon pitch', () => {
    const m = { x: 0, y: 0, facing: 1, scale: 1, anim: 'aim', mode: 'walk', pitch: 0 };
    const eyeY = 1.65;
    expect(inView(m, 12, eyeY, true)).toBe(true);        // straight ahead
    expect(inView(m, 8, eyeY + 8, true)).toBe(false);    // 45 deg up
    m.pitch = 0.7;
    expect(inView(m, 12, eyeY, true)).toBe(false);
    expect(inView(m, 8, eyeY + 8, true)).toBe(true);
  });
});
