# Plan: Derelict-ship squad roguelike (working title "alien_hulk")

## Context
Build a browser game (Chrome), 2D side-scrolling, rendered with three.js from **Blender-generated skeletal GLB models** (no sprite sheets), Rapier for physics, procedural multi-deck derelict ships. The squad of 4 marines auto-advances from the rear airlock to the cockpit control panel. The player sets rules of engagement and makes choices at loot and at navigation points.
Decisions made: crisp flat-shaded low-poly by default, plus a "retro" low-resolution pixel toggle. The **vertical slice** comes first: one complete ship, full loop, HUD, win and lose. The roguelike meta layer comes after review. **The user moves the repo out of OneDrive before work starts.**
Environment verified: Blender 5.2.2 LTS (headless bpy; the glTF exporter supports `export_animation_mode=ACTIONS`), Node 24, npm 11, Chrome, and npm registry access (three 0.186, @dimforge/rapier2d-compat 0.21, vite 8).
IP: all names and designs are original. Don't use "Space Marine", "Genestealer" or "Space Hulk" (Games Workshop) or "Alien Breed" (Team17).

## Architecture
- **Stack:** Vite + ES modules, vitest, three.js WebGLRenderer + EffectComposer (RenderPass → UnrealBloom → darkness ShaderPass → OutputPass), and @dimforge/rapier2d-compat.
- **Camera:** orthographic, side-on. World x/y are gameplay; z is only for layering and parallax. 1 unit = 1 m.
- **Simulation:** fixed 60 Hz step with interpolated rendering. The sim is plain JS (no three.js) so vitest can test it. Seeded RNG streams (sfc32) per system; `?seed=` URL param; no `Math.random` in the sim.
- **Movement:** marines and aliens move by scripted kinematics along the nav graph. Traversals (ladder, stairs, jump arc, crouch) are scripted. Rapier handles line-of-sight and hitscan raycasts (collision groups mean no friendly fire), kinematic hitboxes, and dynamic debris (casings, gibs, crates knocked over by gunfire).
- **Nav:** a graph of rooms (nodes) and portals (edges: door, ladder, stairs, alien-only vents). Movement inside a room is 1D along the floor. The leader leaves a breadcrumb trail and followers keep their spacing along it.
- **Halts:** at doors, ladders and stairs, at forks and at visible loot (per the brief; "auto-open doors" is a player setting). Space = tactical pause.
- **Level generation:** decks are split into rooms of 2–5 cells. An adjacency graph gives doors between rooms on the same deck and ladders/stairs where rooms on neighbouring decks overlap. A random spanning tree plus about 15% extra loops. Airlock bottom-left, cockpit top-right. Validate the main path length and retry if needed. Room-type templates (corridor, quarters, storage, medbay, reactor, cargo, armory) have slots for props, vents and decoration. Dead ends become loot or nests. Difficulty scales with distance from the airlock.
- **Vision:** a 360° visibility polygon per marine, built from nearby wall and closed-door segments. The polygons are drawn into a low-res mask with MAX blending, and into a persistent "explored" target (previously seen areas stay dimly visible). The shader applies flashlight cone and awareness radius falloff. Muzzle flashes briefly light the mask. Gameplay visibility uses Rapier raycasts, so seeing and shooting always agree.
- **Rules of engagement:** cautious (return fire only, for a short window after being attacked), normal (visible hostiles), chaotic (anything that moves, including neutral critters).
- **AI:** marine states are advance, halt, engage, cover/crouch, traverse, interact and dead. Aliens are dormant in vents, hunt on sight or noise (using vent shortcuts), then leap and melee. A pacing director cycles calm → build-up → ambush → release.
- **Rendering:**
  - Vertex colours with flat shading, and emissive accents (eyes, lights).
  - Each room's static kit is merged into one mesh.
  - Characters use rigid skinning (each armour part is 100% weighted to one bone), cloned with `SkeletonUtils.clone`, with one AnimationMixer each. Mixer updates are skipped for characters out of view.
  - A fixed light budget: 4 flashlight SpotLights; dead marines' lights are set to 0 so shaders don't recompile. Fake volumetric cones, bloom, fog, and a parallax starfield through the windows.
  - Retro mode: render at 1/3 resolution with pixelated CSS scaling and camera snapping.
- **HUD:** DOM/CSS overlay styled after the reference image: portraits with HP and ammo bars, rules-of-engagement selector, an action bar (Move/Hold, Attack, Cover, Flashlight, Stim-pack), a minimap with a motion tracker (radar dots plus a rising ping), objective and seed, decision prompts, and start and end-of-run screens.
- **Feel:** hit-stop, screen shake, tracers, sparks, acid-blood decals, squad barks, portraits that flash on damage, pulsing emergency lights, and procedural WebAudio sound effects.

## Blender pipeline
- `tools/blender/lib/`: shared helpers for materials and vertex colours, rigs (rigid skinning), keyframing (Blender 5 slotted actions via `keyframe_insert`, every bone keyed in every clip, a fake user and an NLA stash per action) and export.
- One script per asset family: `marine.py`, `alien.py`, `critter.py`, `props.py` (crates, cabinets, chests, doors, ladder, stairs, control panel, airlock) and `roomkit.py` (walls, floors, pipes, window frames, grime, cobwebs).
- Clips are in place, with stride speed stored in the manifest.
  - Marine clips: idle, walk, run, crouch, crouch_walk, jump, climb, shoot, reload, hit, die.
  - Alien clips: idle, skitter, leap, attack, hit, die.
- Sockets (muzzle, flashlight, eyes) are exported as empties.
- `build_all.py` writes `public/assets/models/*.glb` and `manifest.json`. Run it with `npm run assets`, which calls Blender with `--background --factory-startup --python-exit-code 1`.
- `preview.py` renders Workbench PNG contact sheets so I can inspect the art myself. `tools/check-glb.mjs` checks the clips and sockets in each GLB against the manifest. `viewer.html` is an in-browser model and animation viewer.

## Source tree
`src/core` (loop, rng, events, input, config, assets) · `src/sim` (world, squad, marine, alien, critter, combat, roe, interact, director) · `src/gen` (layout, templates, populate, validate) · `src/nav` (graph, astar, trail, decisions) · `src/vis` (polygon, los) · `src/physics` · `src/render` (renderer, camera, levelMesh, actors, lights, visMask, post, fx) · `src/audio` · `src/ui` (hud, minimap, prompts, screens) · `tools/` (blender/, run-blender.mjs, shot.mjs, check-glb.mjs) · `index.html`, `viewer.html` · a README with concise docs for each module.

## Milestones (each one runs in Chrome and is committed)
0. **Scaffold and pipeline spike:** Vite, vitest, fixed-step loop, Rapier init, and a puppeteer-core screenshot script. A 2-bone test GLB with 2 clips loads and animates in three.js.
1. **Level generation and nav graph:** 1,000-seed validation tests, boxes-only debug render, minimap.
2. **Squad movement:** placeholder capsules follow the trail, traverse portals, halt at decisions and reach the cockpit (the win condition). An autoplay test reaches the cockpit.
3. **Art pass 1:** marine, alien and room kit from Blender replace the placeholders; manifest and viewer.
4. **Vision and lighting:** visibility mask, explored memory, flashlights, bloom and fog.
5. **Combat:** aliens, vents, hunting AI, hitscan, rules of engagement, critters, HP, ammo and reload, death and loss. Sim tests, e.g. cautious mode never shoots critters.
6. **Interactables and full HUD:** loot and credits, crates, cabinets and chests, cover, stim-pack, action bar, prompts, start and end screens.
7. **Feel and performance:** effects, audio, retro toggle, pacing director. Performance targets: under 300 draw calls, pixel ratio capped at 2, 60 fps in Chrome.

After review: the roguelike meta layer (credits → upgrades and recruits, permadeath, escalating ships, run history).

## Verification
- `npm test`: generator reachability and budgets across seeds, A*, trail following, visibility polygons on fixture rooms, and rules-of-engagement targeting.
- `npm run assets`, then `check-glb` and preview PNG renders that I inspect visually.
- `npm run shot`: headless Chrome (puppeteer-core, `--use-angle=d3d11`, with SwiftShader as fallback) opens `?seed=…&autoplay=1`, uses the `window.__game` hook (`stepFrames`, `state`), saves screenshots and checks that the game reaches the win state.
- Manual: `npm run dev`, then play in Chrome.
