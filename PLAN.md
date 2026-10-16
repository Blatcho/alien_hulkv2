# Derelict — plan

A side-on cut-away roguelike aboard a multi-deck derelict starship. The player docks the dropship
*Kestrel 21* at the rear airlock, sweeps the decks for survivors and the ship's log, and extracts.
Browser only, controller first, no runtime network dependencies.

## 1. Pillars
- **Cut-away ship**: 24 columns × 3 decks of rooms, generated from a spanning tree plus loops
  (`src/derelict/gen/Ship.js`), joined by doors, ladders, stairs and alien-only vents. Props, loot,
  survivors, set pieces (hive growth, eggs) and ship events (fires, power failures).
- **Mood**: dark and grimy. Flashlight beam, fog of war from visibility polygons that remembers
  what was seen, motion tracker, speech-bubble barks, hit-stop, screen shake, acid blood.
- **Feel**: the marine moves with agility and speed but with gravity and purpose. Auto-aim at the
  closest hostile on screen, right-stick 360° override with the upper body turning to face it.

## 2. Controls (Xbox layout)
| Action | Pad | Keyboard (demo/testing) |
|---|---|---|
| Move (speed by deflection) | Left stick | WASD / arrows |
| Aim 360° | Right stick | Mouse |
| Shield | LT | Shift |
| Fire | RT | Mouse 1 / J |
| Jump | A | Space |
| Dodge back | B | K |
| Change weapon | Y | Q |
| Interact | X | E |
| Reload | RB | R |
| Health kit | LB | H |
| Pause | Start | Esc |
The title screen's **Demo** plays the game by itself (autopilot) so it can be tested without a pad.

## 3. Rendering (`src/derelict/core/Renderer.js`)
- three.js orthographic camera; the scene is rendered at **450 art lines** (width from aspect) into
  the canvas, which CSS upscales by a whole number of device pixels (`image-rendering: pixelated`).
  Pixel mode is the default; `?smooth=1` renders at device resolution.
- Characters are low-poly 3D models yawed ~35° toward the camera (3/4 view); they flip when the
  aim crosses the vertical. The upper body (spine, chest, arms, weapon) is rotated procedurally
  to the aim angle after the animation mixer runs.
- Clips: walk and run play at a time scale derived from the speed travelled. Reloads, strikes and
  bursts play on upper-body tracks only (clips are split by bone name at load) so they layer
  over locomotion.
- Lights: a fixed pool of point/spot lights created once (no shader recompiles); emitters (room
  lamps, fires, muzzle flashes, acid) are assigned to the nearest pool slots each frame. Bloom via
  UnrealBloomPass. Fog of war: a visibility polygon from the player's eye against wall segments
  (plus the flashlight cone) rasterised into "visible" and "seen" canvas textures that a full-ship
  overlay plane samples.

## 4. Art pipeline (`tools/blender/*.py`, `tools/check-glb.mjs`)
- Every model is a Python script run with headless Blender (`blender --background --python
  tools/blender/marine.py -- assets/models/marine.glb`) or the `bpy` module. Low-poly bmesh with
  vertex colours and battered weathering (edge wear, grime, scratches), rigidly skinned (each vertex
  to one bone), exported as GLB with clips plus a `.meta.json` (bones, upper-body bone set, clips,
  dimensions, attachment points).
- `node tools/check-glb.mjs assets/models/*.glb` validates every GLB against its meta.
- Models: marine (player), alien, survivor, ship tile kit (floor, wall, ceiling, door, ladder, stair,
  vent, light, airlock), props (crates, barrels, consoles, lockers, cryopods, eggs, resin, debris,
  pickups), the Kestrel dropship.

## 5. Systems
- `src/derelict/gen/Ship.js` ship generator + `tests/ship.test.mjs`. `src/derelict/world/World.js` builds meshes,
  the collision grid, doors and vents. `src/derelict/core/Physics.js` AABB-vs-grid with slopes and ladders.
- Entities: `Player`, `Alien`, `Survivor`, `Bullet`, `Pickup`, `Door`.
- Systems: `Fog`, `Lights`, `Tracker` (motion tracker), `Barks`, `FX` (hit-stop, shake, particles,
  muzzle flash, acid), `Events` (fires, power failures), `Director` (alien spawns), `Autopilot`.
- `src/derelict/ui/HUD.js`: canvas overlay with the bitmap fonts: portrait, name, health, shield, ammo,
  weapon slots, minimap, motion tracker, barks, objective.

## 6. Loop
Dock → sweep decks (fog clears, tracker pings, aliens hunt through vents) → rescue survivors,
loot ammo/medkits/weapons, survive fires and blackouts → retrieve the log on the bridge → return
to the airlock → extract. Death ends the run (seeded; `?seed=`).
