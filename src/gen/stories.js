// Derelict stories: what happened aboard before the squad got there. A story is rolled from the
// seed and the hull class (gen/classes.js stories: which stories a class tells), so the briefing
// can read it off the seed before the ship is generated, and the generator (gen/populate.js)
// tells it the same way every time: where the dead lie and what they carry, whether a door was
// welded from inside, how many nests and survivors, which ship events the ship leans to.
import { Rng } from '../core/rng.js';
import { HULL_CLASSES } from './classes.js';

export const STORIES = {
  mutiny: {
    title: 'Mutiny',
    blurb: 'The log ends in an argument. Half the crew shot the other half, and nobody won.',
    // The dead: how many, where they lie (room types first, then anywhere), what they carry.
    bodies: [3, 5], bodyRooms: ['barracks', 'quarters', 'corridor', 'armory', 'magazine', 'galley'], bodyLoot: ['ammo', 'weapon', 'credits'],
    nests: 0.7, survivors: 0, events: { fire: 1.5 }, oddities: { turret: 0.8, storeroom: 0.8 },
  },
  outbreak: {
    title: 'Containment failure',
    blurb: 'Whatever the labs were keeping got out. The crew died trying to put it back.',
    bodies: [2, 4], bodyRooms: ['lab', 'specimens', 'medbay', 'hydroponics', 'corridor'], bodyLoot: ['medkit', 'stim', 'credits'],
    nests: 1.5, eggs: 1, survivors: 0, events: { fire: 1.5, power: 1.3 }, oddities: { cryopod: 0.8, pods: { alien: 3 } },
  },
  evacuation: {
    title: 'Evacuation',
    blurb: 'They tried to get everyone to the boats. Not everyone made it that far.',
    bodies: [2, 4], bodyRooms: ['airlock', 'corridor', 'cargo', 'promenade', 'galley'], bodyLoot: ['medkit', 'food', 'credits'], near: true,
    nests: 1, survivors: 1, events: { distress: 2.5 }, oddities: { storeroom: 0.3 },
  },
  quarantine: {
    title: 'Quarantine',
    blurb: 'The medbay sealed itself from the inside. The rest of the ship kept dying anyway.',
    bodies: [2, 4], bodyRooms: ['medbay', 'quarters', 'lab', 'corridor'], bodyLoot: ['medkit', 'stim', 'credits'],
    nests: 1.1, survivors: 0, weld: 'medbay', events: { power: 2 }, oddities: { cryopod: 0.7, pods: { survivor: 2 } },
  },
  salvage: {
    title: 'Salvage crew',
    blurb: 'Somebody got here first. Their gear is still aboard; so are they.',
    bodies: [3, 4], bodyRooms: ['cargo', 'storage', 'engineering', 'corridor'], bodyLoot: ['weapon', 'ammo', 'treasure'],
    nests: 1, survivors: 0, events: {}, oddities: { turret: 1, storeroom: 1, prize: 'weapon' },
  },
  silence: {
    title: 'Silence',
    blurb: 'Nothing in the log. One day the crew just stopped writing.',
    bodies: [0, 1], bodyRooms: [], bodyLoot: ['credits', 'empty'],
    nests: 1.3, survivors: -1, events: { power: 1.5 }, oddities: { cryopod: 0.9, pods: { cache: 2 } },
  },
};

export const STORY_KEYS = Object.keys(STORIES);

/** The story a seed tells on a hull of that class: {key, title, blurb, ...effects}. */
export function storyFor(bare, cls) {
  const rng = new Rng(bare, 'story');
  const weights = HULL_CLASSES[cls]?.stories ?? {};
  const key = rng.weighted(STORY_KEYS.map((k) => [k, weights[k] ?? 1]));
  return { key, ...STORIES[key] };
}
