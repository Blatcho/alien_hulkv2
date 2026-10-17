// Squad chatter. Lines are picked from a dedicated RNG stream (so barks never perturb the
// simulation's own randomness) with per-key cooldowns to stop spam. {n} = distance.
export const LINES = {
  reload: ['Reloading!', 'Changing mags!', 'Cover me, reloading!'],
  dry: ["I'm dry!", 'Out of ammo!'],
  contact: ['Contact!', 'Hostile!', 'Got movement - contact!', 'Eyes on!'],
  clear: ['Clear!', 'Room clear.', 'Area secure.', 'Clear. Stay frosty.'],
  clear_ack: ['Clear.', 'Clear here.', 'Nothing on my side.', 'Copy, clear.'],
  lost: ['Lost it... stay sharp.', "It's still out there.", 'Tracker says it is close.'],
  door_stack: ['Stacking up.', 'On the door.', 'Ready on the breach.'],
  rear: ['Watching our six.', 'Rear covered.', 'Six is clear.'],
  ladder_cover: ['Covering. Go.', "I've got you, climb.", 'Go, go - I have the shaft.'],
  ladder_top: ['Top is clear.', 'Up. Holding the hatch.', 'On top. Come up.'],
  motion: ['Movement. {n} meters.', 'Tracker: {n} meters and closing.', 'Something moving... {n} meters.'],
  nest: ['Hive resin everywhere. Stay sharp.', 'This is a nest. Eyes open.', 'Smell that? We are in their nest.'],
  down: ['{name} is down!', 'Man down! {name}!', 'We lost {name}!'],
  quiet: ['Too quiet.', 'Where are they...', 'Keep it tight.'],
  entry: ['Entering. Check corners.', 'Moving in.', 'Slice it. Slow.'],
  winded: ['Need a breather!', 'Can\'t keep this pace...', 'Suits are overheating - slow down!'],
  energy_out: ['Running on fumes... easing off.', 'Eyes are burning. Standing down to normal.'],
  no_energy: ['We\'re spent. Need a few kills or some food first.', 'Not enough in the tank for high alert.'],
  eat: ['Protein. Don\'t ask.', 'Fresh meat. Sort of.', 'That\'ll keep us going.', 'Dinner.'],
  order_ack: ['Copy.', 'Understood.', 'Roger that.', 'Changing it up.'],
  ceiling: ['On the ceiling!', 'It\'s above us - up top!', 'Crawling overhead!'],
  wounded: ["I'm hit bad!", 'Taking damage - need a stim!', 'Armour is breached!'],
  sleeper: ['Hold... one of them, not moving.', 'Contact, dormant. Easy.', 'Something is curled up in there.'],
  bound: ['Set. Move up.', 'Covering - go.', 'Moving up.', 'Hold here... okay, on me.'],
  six: ['Checking six.', 'Rear is quiet.', 'Nothing behind us.'],
  check_vent: ['Vent. Watching it.', 'Duct here... clear.', 'Eyes on that vent.'],
  check_body: ['This one is done.', 'Confirmed dead.', 'Not moving. Good.'],
  behind: ['Movement behind us!', 'On our six!', 'Something back there!'],
  above: ['Above us - in the ceiling!', 'Up top, moving!', 'It is over our heads.'],
  below: ['Under us!', 'Below - under the deck!', 'Something beneath the floor.'],
  noise: ['What was that?', 'Heard something.', 'Hold up... noise.'],
  lucky: ["That should've killed me.", 'Armour held... somehow.', 'Still breathing. Lucky.'],
  panic: ['Get it off me! GET IT OFF!', "I can't - I can't -", 'Oh god oh god oh god!'],
  steady: ['Stay with me, {name}!', "I've got you. Breathe.", 'Eyes on me, {name}. Keep firing.'],
  in_position: ['In position.', 'Holding here.', 'Set. Awaiting orders.'],
  medic: ['{name} is down! Medic!', 'Man down - get him up!', '{name}! Stay with me!'],
  reviving: ['On it - cover me!', 'Got you, got you...', 'Hold still. This\'ll hurt.'],
  revived: ['I\'m up. I\'m up.', 'Back in it.', 'Thanks. Let\'s go.'],
  finished: ['No - they got {name}!', '{name}... gone.', 'They finished {name}!'],
  power_out: ['Lights are gone - the whole deck!', 'Power\'s out. Torches - stay tight.', 'We\'ve lost the lights!'],
  fire: ['Fire! The doorway\'s gone up!', 'Something\'s burning - door ahead!', 'Fire in the bulkhead!'],
  distress: ['Kestrel relays a distress call - someone\'s alive on deck {deck}.', 'Hear that? A survivor, broadcasting from deck {deck}.'],
  going_back: ['We\'re not leaving {name}. On me.', 'Back for {name} - move!'],
  nudge: ['Copy. Moving.', 'On it.', 'Roger - heading there.', 'Understood. On me.'],
  flank: ['One going over us - watch the rear!', 'Ceiling! It\'s going round us!', 'Flanker - over the top!'],
  stalker: ['It was following us!', 'Contact rear - it was right behind us!', 'Behind! It\'s been tracking us!'],
  flee: ['It\'s running!', 'Wounded one - bolting for the vents!', 'Don\'t let it get away!'],
  dragged: ['It\'s got {name}! It\'s dragging him!', 'It\'s taking {name} - shoot it off him!', '{name}! It\'s got him!'],
  dropped: ['It let go of him!', 'Dropped him - get him up!'],
  taken: ['It took {name} into the vents...', '{name}\'s gone - into the ducts.', 'No... they dragged {name} off.'],
  screamer: ['Screamer! Drop it before it calls them!', 'Shut that thing up - now!', 'Screamer - kill it!'],
  screamed: ['That woke the whole deck.', 'Here they come - every one of them.', 'They heard that. All of them.'],
  scream_cut: ['Shut it up!', 'Cut it off - good!', 'Not today.'],
  birth: ['It\'s birthing them! Kill the big one!', 'Brood mother - she\'s making more!', 'They\'re coming out of her!'],
  brood_dead: ['The mother\'s down!', 'Big one\'s dead. Nest is finished.', 'Got her!'],
  shy: ['It won\'t come into the light.', 'Keep your torches on it!', 'The light\'s holding it back.'],
  grenade: ['Frag out!', 'Grenade - get down!', 'Fire in the hole!'],
  flare: ['Flare!', 'Lighting it up.', 'Popping a flare - eyes open.'],
  defend: ['Guns down - both sides!', 'Sentries up - let them come!', 'Turrets set. Nothing gets through.'],
  horde_warn: ['Tracker\'s lit up - there\'s a LOT of them. Dig in!', 'Movement everywhere... it\'s a swarm. Brace!', 'They\'re all coming at once - hold here!'],
  horde_on: ['HERE THEY COME!', 'Contact - everywhere!', 'Both sides! BOTH SIDES!'],
  break_freeze: ['I can\'t... I can\'t move...', 'No no no no - not me, not me -', 'I\'m staying here. I\'m STAYING HERE!'],
  break_flee: ['I\'m out - I\'m OUT!', 'Screw this - I\'m gone!', 'Not dying here - NOT HERE!'],
  break_berserk: ['COME ON! COME ON, YOU BASTARDS!', 'You want some? HERE IT IS!', 'DIE! ALL OF YOU, DIE!'],
  break_over: ['...I\'m okay. I\'m okay. Let\'s go.', 'Sorry. I\'m back. I\'m back.', 'Okay... okay. Breathing.'],
  break_wait: ['Hold up - {name}\'s lost it!', 'Nobody moves - we\'re not leaving {name}!', '{name}! Hang on, we\'re here!'],
  horde_over: ['That\'s the last of them... I think.', 'Swarm\'s down. Breathe.', 'Tracker\'s quiet. We held.'],
  covering: ['Covering!', 'Got you covered!', 'I\'ve got it - reload!'],
  topup: ['Topping up.', 'Fresh mag.', 'Swapping mags while it\'s quiet.'],
  shove: ['Get BACK!', 'Off me!', 'Back, you -'],
  melee: ['Come here!', 'Back to the dark with you!', 'Too close, bug!', 'Next!'],
  dressing: ['Hold still, {name}.', 'Patching you up, {name}.', 'Field dressing - you\'ll live.'],
  spotted: ['Something\'s following us - rear!', 'Behind us - it\'s been tracking us!', 'Rear! I see it!'],
  shaken: ['This is bad... this is really bad.', 'We\'re not getting out of here.', 'How many more of them are there?!'],
  rallied: ['Hold it together - we\'ve got this.', 'Steady. We\'re still in it.', 'Breathe. Eyes front.'],
  steady_squad: ['That\'s how it\'s done.', 'They bleed like anything else.', 'Keep it up - they\'re breaking.'],
  nudge_barrel: ['Barrel - on your call.', 'Lining it up. Clear the blast!', 'I have the drum.'],
  took_point: ["I've got point. On me.", 'Taking the lead - stay with me.', "He's gone. I'm on point now. Move."],
  hold_ack: ['Holding here.', 'Copy - holding position.', 'Set. We hold.'],
  follow_ack: ['On you.', 'Copy - moving with you.', 'Falling in.'],
};

const COOLDOWN = {
  reload: 1.5, contact: 6, winded: 6, no_energy: 3, medic: 2, reviving: 3, going_back: 4, eat: 8, order_ack: 3, ceiling: 10, entry: 25, sleeper: 20, motion: 12, rear: 30, door_stack: 20, ladder_cover: 12, ladder_top: 12, quiet: 60, nest: 30, clear: 4, clear_ack: 4,
  nudge: 2, nudge_barrel: 2, in_position: 6, panic: 4, steady: 8, bound: 20, six: 25, check_vent: 20, check_body: 20, behind: 15, above: 15, below: 15, noise: 12,
  flank: 12, stalker: 10, flee: 8, dragged: 3, dropped: 4, screamer: 8, screamed: 10, scream_cut: 6, birth: 30, shy: 20,
  took_point: 2, hold_ack: 0.5, follow_ack: 0.5,
  grenade: 1, flare: 2, defend: 2, break_freeze: 2, break_flee: 2, break_berserk: 2, break_over: 3, break_wait: 6, horde_warn: 5, horde_on: 5, horde_over: 5, covering: 6, topup: 15, shove: 4, melee: 6, dressing: 3, spotted: 10, shaken: 30, rallied: 30, steady_squad: 45,
};

export class Barks {
  constructor(world, rng) {
    this.world = world;
    this.rng = rng;
    this.last = new Map();
    this.queue = [];
  }

  /** Say line `key` (optionally with probability `chance`). Returns true if spoken. */
  say(marine, key, chance = 1, vars = {}) {
    if (!marine?.alive) return false;
    const now = this.world.time;
    const cd = COOLDOWN[key] ?? 0;
    if (now - (this.last.get(key) ?? -99) < cd) return false;
    if (chance < 1 && !this.rng.chance(chance)) return false;
    this.last.set(key, now);
    const text = this.rng.pick(LINES[key] ?? [key]).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
    marine.bark = text;
    marine.barkT = 2.4;
    this.world.emit('bark', { marine, text, key });
    return true;
  }

  /** Say something after a delay (call-and-response). */
  later(delay, marine, key, chance = 1, vars = {}) {
    this.queue.push({ t: this.world.time + delay, marine, key, chance, vars });
  }

  update() {
    const now = this.world.time;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (q.t > now) continue;
      this.queue.splice(i, 1);
      this.say(q.marine, q.key, q.chance, q.vars);
    }
  }
}
