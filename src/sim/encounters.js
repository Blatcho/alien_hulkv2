// Encounters: the choose-your-own-adventure moments. A set piece in the ship stops the squad
// and offers two or three choices in the scene (ui/interact.js), each done by whoever is best
// at it, with the odds shown ("Hack the keypad - Okafor INT 7 - 78%"). The player has a few
// seconds to choose; otherwise the standing orders decide (sim/doctrine.js).
//
//   armoury   a sealed weapons locker: hack it (INT, quiet), force it (STR, loud), leave it
//   terminal  a crew terminal: pull the deck plans (INT) - the whole ship on the tracker
//   locker    a container something is hiding in, if Perception spots it on the way in:
//             shoot it first (loot lost), open it carefully (NRV), or leave it
//   junction  a deck's power is out (sim/shipevents.js): reset the breakers (INT), hot-wire it
//             (STR - quick, but it bites), or leave it dark
//   fire      a doorway on fire: put it out (INT), push through it (STA - everyone gets burnt),
//             or find another way
//   doorctl   door controls (the player pointed at them): close it so pursuers must force it,
//             weld it shut (a charge - nothing gets through), or cut a welded one open (a charge, loud)
//   vent      a duct vent (the player pointed at it): weld it shut - nothing uses it again
//   turret    a sentry gun on standby: hack it (INT) and it fights for the squad (sim/sentry.js)
//   autodoc   the medbay's autodoc: a cycle (INT) heals everyone and mends the worst wound
//   eggs      an egg cluster in a nest: burn it (a flare), shoot it (loud - one may get out),
//             or sneak past (NRV - if they stir, they hatch)
//   cryopod   a cryo pod - sharp eyes (PER) may tell what's in it first: a survivor, something
//             hostile, or a cache. Open it, shoot it through the glass, or leave it
//   keydoor   a locked storeroom door: the keycard (off a dead crewman), cut through (a charge,
//             loud), or leave it locked
//
// Rolls use their own RNG stream ('checks'), so they never reshuffle combat or the director.
import { AUTODOC, EGGS, STATS } from '../core/config.js';
import { Rng } from '../core/rng.js';
import { specialist } from './melee.js';
import { bestAt, checkChance, practice } from './stats.js';
import { upgradeWeapon } from './loot.js';

const DECIDE = 8; // seconds the player has to choose before the squad's orders do

// What sharp eyes make of a cryo pod's readings.
const POD_SEEN = {
  survivor: ['Readings say someone\'s alive in there.', 'a survivor - get them out'],
  alien: ['Something in there - and it\'s not crew.', 'it comes out fighting'],
  cache: ['No life signs. Cargo - a sealed case.', 'a sealed case'],
};

export const ENCOUNTERS = {
  armoury: {
    title: 'SEALED WEAPONS LOCKER',
    text: () => 'The keypad still has power. Whatever is in there, somebody wanted it kept.',
    options: [
      { id: 'hack', label: 'Hack the keypad', stat: 'int', base: 0.55, time: 4, note: 'quiet' },
      { id: 'force', label: 'Force it open', stat: 'str', base: 0.5, time: 1.6, note: 'loud' },
      { id: 'leave', label: 'Leave it' },
    ],
  },
  terminal: {
    title: 'CREW TERMINAL',
    text: () => 'A terminal flickers on standby. The deck plans might still be in there.',
    options: [
      { id: 'download', label: 'Pull the deck plans', stat: 'int', base: 0.5, time: 5, note: 'maps the ship' },
      { id: 'leave', label: 'Leave it' },
    ],
  },
  junction: {
    title: 'POWER JUNCTION',
    text: () => 'The deck breakers have tripped. Somebody who knows the system could reset them.',
    options: [
      { id: 'restore', label: 'Reset the breakers', stat: 'int', base: 0.6, time: 4, note: 'lights back on across the deck' },
      { id: 'hotwire', label: 'Hot-wire it', stat: 'str', base: 0.5, time: 1.5, note: 'quick - but it bites' },
      { id: 'leave', label: 'Leave it dark' },
    ],
  },
  fire: {
    title: 'FIRE IN THE DOORWAY',
    text: () => 'A cable run has gone up. The doorway is a wall of flame.',
    options: [
      { id: 'putout', label: 'Put it out', stat: 'int', base: 0.6, time: 3, note: 'the suppression panel' },
      { id: 'through', label: 'Push through it', stat: 'sta', base: 0.55, note: 'everyone takes burns' },
      { id: 'back', label: 'Find another way' },
    ],
  },
  doorctl: {
    title: 'DOOR CONTROLS',
    text: (_, prop) => (prop.door.welded ? 'Welded shut. A cutting charge and a strong arm would get it open.'
      : prop.door.open ? 'The door still works. Shut it, and anything behind us has to force its way through.'
        : 'Shut. A welding charge would make sure it stays that way.'),
    options: (prop, w) => {
      const p = prop.door;
      const charge = `uses a charge (${w.kit.charges} left)`;
      const torch = specialist(w, 'tech'); // a tech welds with his own torch
      if (p.welded) return [{ id: 'cut', label: 'Cut it open', stat: 'str', base: 0.6, time: 5, note: `${charge} - loud`, needs: 'charges' }, { id: 'leave', label: 'Leave it' }];
      return [
        ...(p.open ? [{ id: 'seal', label: 'Close it', time: 0.8, note: 'they have to force it to follow' }] : []),
        torch ? { id: 'weld', label: 'Weld it shut', stat: 'int', base: 0.75, time: 4, note: `${torch.name}'s torch - no charge needed` }
          : { id: 'weld', label: 'Weld it shut', stat: 'str', base: 0.7, time: 4, note: `${charge} - nothing gets through`, needs: 'charges' },
        { id: 'leave', label: 'Leave it' },
      ];
    },
  },
  vent: {
    title: 'DUCT VENT',
    text: () => 'One of the ways they move through the ship. Weld it, and nothing comes out of this one again.',
    options: (prop, w) => {
      const torch = specialist(w, 'tech');
      return [
        torch ? { id: 'weld', label: 'Weld it shut', stat: 'int', base: 0.8, time: 3, note: `${torch.name}'s torch - no charge needed` }
          : { id: 'weld', label: 'Weld it shut', stat: 'str', base: 0.75, time: 3, note: `uses a charge (${w.kit.charges} left)`, needs: 'charges' },
        { id: 'leave', label: 'Leave it' },
      ];
    },
  },
  turret: {
    title: 'SENTRY TURRET',
    text: () => 'A ship\'s sentry gun on standby, still loaded. Its friend-or-foe chip could be talked round.',
    options: [
      { id: 'hack', label: 'Hack it', stat: 'int', base: 0.55, time: 4, note: 'it fights for us' },
      { id: 'leave', label: 'Leave it' },
    ],
  },
  autodoc: {
    title: 'AUTODOC',
    text: (_, prop, w) => (w.squad.order.some((m) => m.wound || m.hp < m.maxHp * 0.9)
      ? 'The medbay\'s autodoc still has power, and one nanite cartridge.' : 'The autodoc still has a cartridge. Nobody needs it - yet.'),
    options: [
      { id: 'treat', label: 'Run a cycle', stat: 'int', base: 0.7, time: 5, note: `everyone +${AUTODOC.HEAL} hp, the worst wound mended` },
      { id: 'leave', label: 'Save it for later' },
    ],
  },
  eggs: {
    title: 'EGG CLUSTER',
    text: () => 'Leathery eggs in a mat of resin. Something inside them is moving.',
    options: (prop, w) => [
      { id: 'burn', label: 'Burn them', time: 1.5, note: `uses a flare (${w.kit.flares} left) - none hatch`, needs: 'flares' },
      { id: 'shoot', label: 'Shoot them', note: 'loud - one might get out' },
      { id: 'sneak', label: 'Sneak past', stat: 'nrv', base: 0.6, note: 'if they stir, they hatch' },
    ],
  },
  cryopod: {
    title: 'CRYO POD',
    text: (spotter, prop) => (prop.known ? `${spotter?.name ?? 'Someone'}: "${POD_SEEN[prop.pod][0]}"` : 'Frosted over. No telling what\'s inside.'),
    options: (prop) => [
      { id: 'open', label: 'Open it', time: 2.5, note: prop.known ? POD_SEEN[prop.pod][1] : 'whatever is in there' },
      ...(prop.known && prop.pod === 'alien' ? [{ id: 'shoot', label: 'Shoot it through the glass', note: 'nothing else in there' }] : []),
      { id: 'leave', label: 'Leave it' },
    ],
  },
  keydoor: {
    title: 'LOCKED DOOR',
    text: (_, prop, w) => (w.kit.keycards > 0 ? 'Stores - crew access only. We have a keycard.'
      : 'Stores - crew access only. The reader wants a keycard; somebody aboard had one.'),
    options: (prop, w) => [
      { id: 'card', label: 'Use the keycard', time: 1, note: `${w.kit.keycards} keycard${w.kit.keycards === 1 ? '' : 's'}`, needs: 'keycards' },
      { id: 'cut', label: 'Cut through', stat: 'str', base: 0.65, time: 5, note: `uses a charge (${w.kit.charges} left) - loud`, needs: 'charges' },
      { id: 'back', label: 'Leave it locked' },
    ],
  },
  locker: {
    title: 'SOMETHING IN THE LOCKER',
    text: (spotter) => `${spotter?.name ?? 'Someone'}: "Hold it. That locker just moved."`,
    options: [
      { id: 'shoot', label: 'Shoot it first', note: 'whatever is inside is lost' },
      { id: 'open', label: 'Open it carefully', stat: 'nrv', base: 0.5, time: 1.2, note: 'keep the loot' },
      { id: 'leave', label: 'Leave it' },
    ],
  },
};

export class Encounters {
  constructor(world) {
    this.world = world;
    this.rng = new Rng(world.level.seed, 'checks');
  }

  /** Approaching a container with something inside: does anyone notice? (Perception) */
  spotAmbush(prop) {
    const w = this.world;
    const eyes = bestAt(w.squad.order, 'per');
    if (!eyes) return null;
    practice(eyes, 'per', 0.5);
    return this.rng.chance(checkChance(eyes.stats, 'per', 0.35)) ? eyes : null;
  }

  /** Stop the squad and put the choices in the scene. */
  offer(kind, prop, feature, spotter = null) {
    const w = this.world;
    const def = ENCOUNTERS[kind];
    // A cryo pod: the sharpest eyes read what's in it first - or can't.
    if (kind === 'cryopod' && prop.known === undefined) {
      spotter = bestAt(w.squad.order, 'per');
      prop.known = !!spotter && this.rng.chance(checkChance(spotter.stats, 'per', 0.45));
      if (spotter) practice(spotter, 'per', 0.5);
    }
    const list = typeof def.options === 'function' ? def.options(prop, w) : def.options;
    const options = list.map((o) => {
      const off = o.needs ? (w.kit[o.needs] ?? 0) <= 0 : false; // nothing left in the kit for it
      if (!o.stat) return { ...o, off };
      const by = bestAt(w.squad.order, o.stat);
      return { ...o, off, by, odds: checkChance(by.stats, o.stat, o.base), who: `${by.name} ${STATS.SHORT[o.stat]} ${by.stats[o.stat]}` };
    });
    w.squad.ask({
      type: 'encounter', kind, encounter: true, feature, prop, title: def.title, text: def.text(spotter, prop, w),
      options, deadline: w.time + DECIDE, askedAt: w.time, x: prop.x, y: w.level.rooms[prop.room].y0,
    });
    if (spotter && kind === 'locker') w.emit('bark', { marine: spotter, text: 'Hold it. That locker just moved.' });
  }

  /** A choice was made (player or orders): start the work, or settle it now. */
  choose(d, optionId) {
    const w = this.world;
    const sq = w.squad;
    const o = d.options.find((q) => q.id === optionId);
    if (!o || o.off) return false;
    const p = d.prop;
    sq.handled.add(d.feature.key);
    if (o.id === 'back') {
      if (d.kind === 'keydoor') p.door.passed = true; // not that way (unless they're sent)
      sq.handled.delete(d.feature.key);
      sq.turnAround('order');
      return true;
    }
    if (o.id === 'leave') {
      p.encounterDone = true;
      if (p.loot) p.ignored = true;
      return true;
    }
    // The man picked when it was offered may have gone down since: the best one still standing.
    if (o.stat && !sq.order.includes(o.by)) {
      o.by = bestAt(sq.order, o.stat) ?? sq.leader;
      o.odds = checkChance(o.by.stats, o.stat, o.base);
    }
    if (o.by && o.by !== sq.leader) w.emit('bark', { marine: sq.leader, text: `${o.by.name}, you're up.` });
    if (o.time) {
      sq.state = 'action';
      sq.action = { type: 'encounter', t: 0, dur: o.time, d, o, by: o.by ?? sq.leader };
      sq.assignTask(o.by, p.x);
    } else this.resolve(d, o);
    return true;
  }

  /** Is anything standing in this doorway (it can't be shut on them)? */
  doorway(door) {
    const w = this.world;
    const y = w.level.rooms[door.a].y0;
    const busy = (e) => e.alive && Math.abs(e.x - door.x) < 0.7 && Math.abs(e.y - y) < 1.5;
    return w.marines.some(busy) || w.aliens.some((a) => a.state !== 'vent' && (busy(a) || a.trav?.portal === door.id))
      || (w.survivors ?? []).some(busy);
  }

  /** The dice, and what comes of it. */
  resolve(d, o) {
    const w = this.world;
    const p = d.prop;
    const by = o.by ?? w.squad.leader;
    const ok = o.stat ? this.rng.chance(o.odds) : true;
    if (o.stat) practice(by, o.stat, ok ? 2 : 1);
    p.encounterDone = true;
    w.emit('encounter', { kind: d.kind, option: o.id, ok, prop: p, marine: by });
    const say = (text) => w.emit('bark', { marine: by, text });
    const alarm = (r) => w.noise(p.x, w.level.rooms[p.room].y0 + 1, r);
    switch (d.kind) {
      case 'armoury':
        if (o.id === 'force') alarm(22); // success or not, it's loud
        if (ok) {
          say(o.id === 'hack' ? 'Code cracked. It\'s open.' : 'Got it open!');
          // Whoever sealed it kept the good stuff in it.
          if (p.loot?.type === 'weapon') p.loot.item = upgradeWeapon(this.rng, p.loot.item);
          else if (p.loot?.type === 'credits') p.loot.amount *= 2;
          w.resolveLoot(p, by);
        } else {
          p.searched = true;
          p.jammed = true;
          if (o.id === 'hack') { alarm(32); say('Alarm! It locked us out - and everything heard that.'); } else {
            w.damage(by, 18, null, { x: by.x, y: by.y + 1.2, dx: 0, dy: 0 });
            say('The latch snapped back - my hand! It\'s jammed.');
          }
        }
        return;
      case 'terminal':
        if (ok) {
          for (const r of w.level.rooms) r.seen = true;
          w.intel = true;
          say('Deck plans pulled. The whole ship\'s on the tracker - every cache too.');
        } else {
          alarm(35);
          say('Security lockout - and a siren. They know we\'re here.');
        }
        return;
      case 'junction':
        if (ok) {
          say(o.id === 'restore' ? 'Breakers reset. Lights!' : 'There - that\'s got it. Lights!');
          w.shipEvents.restorePower();
        } else {
          p.encounterDone = false; // it can be tried again
          if (o.id === 'hotwire') { w.burn(by, 22); say('AAGH - it bit me! Still dead.'); } else say('Tripped again. It needs another go.');
        }
        return;
      case 'fire': {
        const door = p.fire;
        w.squad.handled.delete(d.feature.key); // the door is met again: through, or the fire again
        if (o.id === 'putout') {
          if (ok) { say('Suppression\'s on - it\'s out.'); w.shipEvents.putOut(door); } else { w.burn(by, 10); say('It flared back - I\'m burnt!'); }
          return;
        }
        // Pushing through: everyone takes it, less for a hardy squad.
        for (const m of w.squad.order) w.burn(m, ok ? this.rng.int(4, 9) : this.rng.int(10, 18));
        door.braved = w.squad.leader.room;
        say(ok ? 'Through! Keep moving!' : 'Gah - we\'re through, but that hurt!');
        return;
      }
      case 'doorctl': {
        const door = p.door;
        if (o.id === 'seal') {
          if (this.doorway(door)) { say('Something\'s in the doorway - can\'t close it!'); return; }
          w.setDoor(door, false);
          say('Door\'s shut. They\'ll have to force it.');
          return;
        }
        const torch = o.id === 'weld' && !o.needs; // the tech's own torch: no charge spent
        if (!torch) w.kit.charges--;
        if (o.id === 'weld') {
          alarm(16);
          if (!ok) { say(torch ? 'Torch sputtered - the seam won\'t hold.' : 'The charge fizzled - it won\'t hold.'); return; }
          if (door.open && this.doorway(door)) { say('Something\'s in the doorway - can\'t weld it!'); if (!torch) w.kit.charges++; return; }
          w.setDoor(door, false);
          door.welded = true;
          w.emit('welded', { portal: door });
          say('Welded. Nothing\'s coming through there.');
        } else if (o.id === 'cut') {
          alarm(28);
          if (!ok) { say('Cutter\'s jammed - that charge is gone.'); return; }
          door.welded = false;
          w.setDoor(door, true);
          w.emit('cut', { portal: door });
          say('We\'re through!');
        }
        return;
      }
      case 'vent': {
        if (o.needs) w.kit.charges--; // (a tech's torch costs nothing)
        alarm(12);
        if (!ok) { say(o.needs ? 'The charge fizzled - it won\'t hold.' : 'Torch sputtered - the seam won\'t hold.'); return; }
        p.vent.welded = true;
        w.emit('vent-welded', { vent: p.vent });
        say('Vent\'s sealed. One less way in.');
        return;
      }
      case 'turret':
        if (ok) {
          w.addSentry(p);
          say('It\'s ours now. Friend-or-foe says we\'re the friends.');
        } else {
          p.jammed = true;
          alarm(30);
          say('Locked out - and it squawked an alarm.');
        }
        return;
      case 'autodoc':
        p.used = true;
        for (const m of w.squad.order) m.hp = Math.min(m.maxHp, m.hp + AUTODOC.HEAL * (ok ? 1 : AUTODOC.FAIL));
        if (ok) {
          const worst = w.squad.order.find((m) => m.wound);
          if (worst) w.mend(worst);
          say(worst ? `Cycle done. ${worst.name}, that should hold.` : 'Cycle done. Everyone\'s patched up.');
        } else say('The cartridge clogged halfway - it\'s spent.');
        w.emit('autodoc', { prop: p, ok });
        return;
      case 'eggs':
        if (o.id === 'burn') {
          w.kit.flares--;
          p.destroyed = true;
          w.emit('eggs-burnt', { prop: p });
          say('Burn, you -. That\'s the lot.');
        } else if (o.id === 'shoot') {
          p.destroyed = true;
          alarm(24);
          w.emit('eggs-shot', { prop: p });
          const out = this.rng.chance(EGGS.SHOOT) ? w.hatch(p, 1) : 0;
          say(out ? 'One got out!' : 'Shredded. Nothing\'s coming out of those.');
        } else if (ok) say('Easy... easy. We\'re past.');
        else {
          const n = w.hatch(p, this.rng.int(EGGS.HATCH[0], EGGS.HATCH[1]));
          say(n ? 'They\'re hatching!' : 'They stirred... nothing came out.');
        }
        return;
      case 'cryopod':
        p.opened = true;
        p.searched = true;
        if (o.id === 'shoot') {
          if (w.reserve > 0) { w.reserve--; w.stats.kills++; }
          p.pod = 'empty';
          alarm(14);
          say('Put it down through the glass. Never woke up.');
        } else if (p.pod === 'survivor') {
          w.addSurvivor(this.rng, p.x, p.room);
          say('Got a pulse - help them out!');
        } else if (p.pod === 'alien') {
          if (w.hatch(p, 1, 'drone')) say('It\'s awake - it\'s AWAKE!');
          else say('Something in there - frozen solid. Dead.');
        } else if (p.loot) {
          w.resolveLoot(p, by);
        } else say('Empty.');
        w.emit('pod-opened', { prop: p, pod: p.pod });
        return;
      case 'keydoor': {
        const door = p.door;
        if (o.id === 'card') {
          w.kit.keycards--;
          say('Card took. We\'re in.');
        } else {
          w.kit.charges--;
          alarm(28);
          if (!ok) { say('Cutter\'s jammed - that charge is gone.'); w.squad.handled.delete(d.feature.key); return; }
          say('Cut through!');
        }
        door.locked = false;
        door.passed = false;
        w.squad.handled.delete(d.feature.key); // the door is met again: open now
        w.emit('unlocked', { portal: door, cut: o.id === 'cut' });
        return;
      }
      case 'locker': {
        const kill = () => {
          if (w.reserve > 0) { w.reserve--; w.stats.kills++; by.kills++; by.lastKillT = w.time; }
          w.emit('ambush-foiled', { prop: p, marine: by });
        };
        if (o.id === 'shoot') {
          p.searched = true;
          p.opened = true;
          kill();
          alarm(20);
          say('Put a burst through it. Whatever it was, it\'s done.');
        } else if (ok) {
          kill();
          p.loot = { type: 'credits', amount: this.rng.int(4, 10) * 10 };
          say('It came out at me - point blank. Got it.');
          w.resolveLoot(p, by);
        } else {
          say('It\'s coming out!');
          w.resolveLoot(p, by); // the ambush springs
        }
        return;
      }
      default:
    }
  }
}
