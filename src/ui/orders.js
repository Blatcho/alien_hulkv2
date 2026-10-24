// The standing orders as the HUD and the launch screen show them: one tile per knob
// (sim/doctrine.js KNOBS), its hotkey (cycles it - core/input.js), its pad button in lead mode,
// and each option's short name and what it means.
export const ORDER_TILES = [
  { knob: 'route', label: 'Route', key: 'R', icon: 'move',
    short: { manual: 'Your call', direct: 'Direct', thorough: 'Sweep' },
    detail: { manual: 'They go where you click, then hold', direct: 'Straight for the command deck', thorough: 'Sweep the side rooms on the way' } },
  { knob: 'roe', label: 'Fire', key: 'F', pad: '◀', lkey: 'X', icon: 'roe',
    short: { cautious: 'Cautious', normal: 'Normal', alert: 'High alert' },
    detail: { cautious: 'Only return fire', normal: 'Shoot anything that moves - vermin too', alert: 'Weapons up, fastest reactions - burns energy' } },
  { knob: 'pace', label: 'Pace', key: 'G', icon: 'run',
    short: { stealthy: 'Stealthy', steady: 'Steady', fast: 'Fast' },
    detail: { stealthy: 'Slow and quiet - hard to hear', steady: 'A steady jog', fast: 'Sprint while everyone has breath - drains stamina' } },
  { knob: 'loot', label: 'Loot', key: 'L', icon: 'loot',
    short: { leave: 'Leave it', way: 'On the way', all: 'Everything' },
    detail: { leave: 'Search nothing', way: 'Search what they pass, unless in a fight', all: 'Go out of the way for every container' } },
  { knob: 'stims', label: 'Stims', key: 'H', pad: '▶', lkey: 'H', icon: 'stim',
    short: { early: 'Early', critical: 'Critical', hoard: 'Hoard' },
    detail: { early: 'Stim anyone under 60% health', critical: 'Stim anyone under 35%', hoard: 'Only under 15%' } },
  { knob: 'light', label: 'Lights', key: 'V', pad: '▲', lkey: 'V', icon: 'flashlight',
    short: { on: 'On', auto: 'Auto', off: 'Off' },
    detail: { on: 'Torches on', auto: 'Off in lit, quiet rooms', off: 'Dark - harder to spot them, harder to be spotted' } },
  { knob: 'kit', label: 'Kit', key: 'K', pad: '▼', lkey: 'K', icon: 'grenade',
    short: { use: 'Use it', save: 'Save it' },
    detail: { use: 'Grenades into packs, flares into dark rooms - by themselves', save: 'Grenades and flares only on your call' } },
];

export const tileOf = (knob) => ORDER_TILES.find((t) => t.knob === knob);
