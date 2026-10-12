// Zone definitions. Levels are generated from these parameters by systems/LevelGen.js (seeded):
// a grid of rooms `cols` wide and `rows` tall; rows at or above `cloudRow` sit in the cloud bank and
// rows at or above `highRow` are above the clouds (sky-stone ruins).
export const ZONES = {
  thornmoor: {
    name: 'Thornmoor', subtitle: 'Where the thorns remember', music: 'music_moor', level: 1, next: 'graveyard',
    ambient: 0xa0a8c4, moonLight: 0xb0c4f0, weather: 'leaves', lightning: false, shafts: true,
    cols: 5, rows: 4, cloudRow: 2, highRow: 3, enemyTypes: ['skeleton', 'skeleton', 'knight', 'spearman'], zoneIndex: 0,
  },
  graveyard: {
    name: 'The Hollow Graves', subtitle: 'The dead keep poor company', music: 'music_graveyard', level: 2, next: 'castle',
    ambient: 0x90a8b0, moonLight: 0xa0e0d0, weather: 'rain', lightning: true, shafts: false,
    cols: 6, rows: 5, cloudRow: 2, highRow: 4, enemyTypes: ['skeleton', 'skeleton', 'knight', 'spearman', 'knight'], zoneIndex: 1,
  },
  castle: {
    name: 'The Warden\'s Gate', subtitle: 'None pass unbidden', music: 'music_castle', level: 3, next: null,
    ambient: 0xa89aa0, moonLight: 0xd0b0a8, weather: 'ash', lightning: true, shafts: false,
    cols: 6, rows: 6, cloudRow: 3, highRow: 5, enemyTypes: ['knight', 'knight', 'spearman', 'skeleton'], zoneIndex: 2,
    boss: { type: 'warden' },
  },
};
