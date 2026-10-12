# Beast of Thornmoor — Development Plan

A 2D side-scrolling action RPG in the spirit of *Shadow of the Beast*: deep multi-layer
parallax landscapes, a horned beast-man protagonist, gothic ruins, thorns and a distant castle,
armoured knights and skeletons, and a moody synth score. Runs entirely in the browser from
local files; no network requests at runtime.

## 1. Goals and constraints

- **Web technologies only.** HTML5 + ES modules + WebGL/Canvas via Phaser 3 (vendored in
  `vendor/phaser.min.js`, downloaded from npm, never from a CDN at runtime).
- **Controller first.** Xbox pad over USB via the browser Gamepad API (Phaser gamepad plugin
  plus a raw `navigator.getGamepads()` path for rumble). Keyboard is a full fallback.
- **No build step.** `npm start` runs a zero-dependency Node static server (ES modules and
  asset XHR do not work from `file://`). Everything the game loads is committed.
- **Generated art.** All art, fonts and audio are produced by scripts in `tools/` (Python:
  Pillow + NumPy, Blender via the `bpy` module for 3D-rendered pickups/props; audio synthesised
  with NumPy and encoded with ffmpeg). Generators are reproducible and their output is committed.
- **Repository.** The old isometric prototype is removed; this plan and the new game replace it.

## 2. Look and feel (from the reference image)

- Dark gothic dusk/night palette: slate blues, deep greens, warm torch oranges, bone greys.
- 7–8 parallax layers per zone: sky + moon + clouds, far mountains, far castle/ruins
  silhouettes, dead trees, thorn hedges, ground/path, foreground thorn overlay (in front of
  the player), plus drifting fog and ember particles.
- Internal resolution 1600×900 scaled to fit the window; the world keeps its 1280×720 design scale so the camera shows more of it and characters stay small on screen (painterly, not pixel art).
- HUD: red health bar and green stamina bar top-left under a beast emblem; gold top-right;
  souls (score/XP) bottom-right; item slot bottom-left.

## 3. Architecture

```
index.html             entry page (loads vendor/phaser.min.js, then src/main.js as a module)
package.json           scripts: start (serve), test (node tests + Playwright smoke), assets
vendor/phaser.min.js   Phaser 3.90 (MIT)
src/
  main.js              Phaser.Game config, scene registration
  config.js            constants (resolution, physics, tuning)
  input/Input.js       action mapping; merges keyboard + gamepad, deadzones, edge detection, rumble
  rig/Rig.js           runtime 2D skeletal animation: hierarchical parts, keyframe clips, blending
  rig/clips/*.js       animation clips per character (idle, run, jump, attack combos, hurt, death…)
  entities/Player.js   beast-man: movement, jump, dodge roll, 3-hit light combo, heavy attack, stamina
  entities/Enemy.js    base AI state machine (patrol, chase, telegraph, attack, stagger, death)
  entities/enemies/*.js knight, spearman, skeleton, bat, boss (Gate Warden)
  entities/Pickup.js   coins, potions, gear drops with bounce physics
  systems/Combat.js    hitboxes, damage calc, knockback, hit-stop, i-frames, damage numbers
  systems/Loot.js      drop tables, gear rarity + affixes
  systems/Stats.js     player stats, XP curve, levelling
  systems/Save.js      localStorage checkpoint save/load
  systems/Audio.js     SFX/music playback with variation
  systems/Parallax.js  builds the layered background for a zone, fog + ember emitters
  scenes/Boot.js       asset loading with progress bar
  scenes/Title.js      title screen (parallax, press Start)
  scenes/Game.js       the level: builds world from zone data, spawns, camera, transitions
  scenes/HUD.js        overlay scene for bars, gold, souls, boss bar, messages
  scenes/Pause.js      pause + inventory/equipment/stats screen (gamepad navigable)
  scenes/GameOver.js / Victory.js
  data/zones.js        three zones: ground segments, platforms, props, spawns, pickups, checkpoints
  data/enemies.js      enemy stat blocks
  data/items.js        gear and consumables
assets/
  bg/<zone>/*.png      parallax layers (tileable)
  sprites/*.png        rig body parts, props, particles, UI (packed as individual PNGs + JSON atlas)
  rigs/*.json          part metadata: pivots, parents, z-order, bind pose
  fonts/               bitmap font (PNG + XML) generated from a system serif face
  audio/*.ogg          SFX and music loops
tools/
  serve.js             static server (no deps)
  gen_backgrounds.py   parallax layers per zone
  gen_sprites.py       rig parts, props, particles, UI
  gen_font.py          bitmap font
  gen_audio.py         SFX + music
  blender_props.py     Blender (bpy) renders: spinning coin, soul gem, treasure chest sprite sheets
  smoke.mjs            Playwright smoke test (loads game, drives input, screenshots, asserts no errors)
tests/*.test.mjs       node:test unit tests for pure logic (damage, loot, stats, input mapping)
```

### Animation approach
Characters are **runtime 2D rigs** rather than frame-by-frame sprite sheets: each character is a
set of shaded body-part textures (head, torso, upper/lower arms, thighs, shins, tail, weapon)
arranged in a parent/child hierarchy. Animation clips are keyframed joint angles with easing,
interpolated every frame and cross-faded on state change. This gives smooth, tunable animation
from a small number of generated textures, and lets attacks carry hitbox timing as clip events.

### Procedural levels (added)
Each zone is generated from a seed by `src/systems/LevelGen.js`: a grid of 20x11-tile rooms with a
climbing critical path, side rooms, ASCII room templates (`src/data/rooms.js`) whose doors are sealed
to match, ladders and stairs for vertical travel, and altitude bands (moor, cloud bank, high sky)
that change the tile set and the parallax backdrop.

### Physics and world
Phaser Arcade physics. Ground and platforms are static bodies built from zone data; the visual
ground is drawn from generated tiles. The camera follows the player with a dead-zone; each
parallax layer is a `TileSprite` with its own scroll factor. Zones are linked by gates; the
third zone ends with a boss fight.

### Controller mapping (Xbox)
| Action | Pad | Keyboard |
|---|---|---|
| Move | Left stick / D-pad | A/D or ←/→ |
| Jump | A | Space / W |
| Light attack (combo) | X | J |
| Heavy attack (hold to charge) | Y | K |
| Dodge roll | B | L / Shift |
| Use potion | RB | Q |
| Interact | LB / Down | E |
| Pause / inventory | Start / Menu | Esc / Enter |

## 4. Milestones

1. **Skeleton** — repo layout, vendored Phaser, server, Boot/Title/Game scenes, input layer with
   gamepad, placeholder rectangles moving on a flat world. Smoke test green.
2. **Backgrounds** — `gen_backgrounds.py` producing the three zones' parallax sets; Parallax
   system with fog and embers; title screen uses it.
3. **Rig + player** — part generator, Rig runtime, beast-man clips (idle/run/jump/fall/attacks/
   dodge/hurt/death), movement feel tuning, stamina.
4. **Enemies + combat** — Knight, Spearman, Skeleton, Bat rigs and AI; hitboxes, damage, hit-stop,
   knockback, particles, damage numbers, death.
5. **ARPG layer** — XP/levels, stats, gold, loot drops (Blender-rendered coins/gems/chests),
   gear with rarity and affixes, potions, inventory/equipment UI, checkpoints + save.
6. **Content** — three zones with props, encounters, platforms, gates; boss "The Gate Warden";
   game over / victory flow.
7. **Audio + polish** — synthesised SFX, ambient music loop per zone, rumble, screen shake,
   vignette, README, final smoke test and screenshots.

Each milestone is committed separately so progress is reviewable.
