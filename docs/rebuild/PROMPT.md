# Build "Hull Breach": a derelict-boarding squad roguelike for the browser

You are working in an empty git repo on my Windows machine, from VS Code. Build the complete game described below.

Work in this order:
1. **Plan first.** Write the approved plan to `docs/PLAN.md`: context, architecture, Blender pipeline, source tree, milestones, verification.
2. **Build milestone by milestone** (section 15), on a branch called `vertical-slice`.
3. **Every milestone must run in Chrome.** Verify it yourself with the tests and the headless tools, then commit before moving on.
4. **Don't stop at a skeleton.**

The spec below is the target. Where it gives a number, use that number. Where it gives a name (file, clip, node, material, event, CSS class), use that name, because other parts depend on it.

---

## 0. Environment and ground rules

- **This machine:** Windows, VS Code with Claude Code, Blender **5.2 LTS** (`C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`), Node 24, npm 11, Chrome, npm registry access, and `curl` and `unzip` on PATH for the sound fetcher (Git for Windows provides both). The sound build also needs web access to freesound.org, kenney.nl and opengameart.org. Check the versions at the start and record them in the plan.
- **Blender runs only from the command line:** `blender --background --factory-startup --python-exit-code 1 --python <script> -- <args>`.
  - Do not use an MCP server or the GUI.
  - All art is Python (bpy + bmesh) that you write, run headless, and then inspect by rendering preview PNGs and opening them yourself.
  - Iterate on the art until it reads well at game scale.
- **Target browser:** desktop Chrome. On Windows, headless Chrome needs `--use-angle=d3d11`, with SwiftShader as the fallback.
- **Keep everything original.** The influences are Space Hulk and Alien Breed. Never use the names "Space Marine", "Genestealer" or "Space Hulk" (Games Workshop) or "Alien Breed" (Team17). Copy no Warhammer 40k iconography and nothing from the *Alien* franchise.
- **Scope order:** the vertical slice comes first (one complete ship, the full loop, HUD, win and lose). The roguelike meta layer comes after.
- **Commits:** commit after every milestone and every notable fix.
  - The title is short and imperative, e.g. "Simulation: squad controller, aliens, critters, combat, director".
  - The body is `-` bullets saying what changed and why.
  - When behaviour or balance changes, end the body with measured numbers, e.g. `Balance (30 seeds, mortal, original four): Assault 30/30 176 s`.
  - When a golden digest changes, say why.
- **README.md:** keep it current. Short sentences, tables for controls, URL parameters and stats, an architecture tree, and "key design decisions" bullets. `tools/blender/README.md` holds the art contract (section 13).
- **JavaScript style:** plain ES modules, no TypeScript, no UI framework. 2-space indent, single quotes, semicolons.
  - Each module opens with a header comment saying what it owns.
  - Public functions get JSDoc one-liners.
  - Tunables live in `src/core/config.js`, not inline.
- **Python style:** 4-space indent, a module docstring, and a shared `lib/`.

---

## 1. The game

**Title and page:** "HULL BREACH" (page title "Derelict: Hull Breach"), subtitle "DERELICT BOARDING ACTION · SQUAD ROGUELIKE".

**View:** a 2D side-scroller showing a multi-deck derelict ship in side-on cut-away (back wall, floor slabs, bulkheads, the ship's cross-section against space).

**Mission:** a four-trooper boarding team rides the dropship **Kestrel 21**. It docks at the rear airlock (bottom-left), and the team must reach the **command deck at the bow** (top-right). There they hold the deck while a navigation uplink completes. Four-armed predators of seven breeds hunt them through the vents, along the walls and across the ceilings.

**There are no navigation buttons.** Before boarding you pick:
- the four who go;
- their order: slot 1 walks point and slot 4 is the rear guard;
- their **standing orders** (doctrine).

The standing orders decide who steers:
- **Standard** is the default and the player's game: **point and click**.
  - The squad holds position ("AWAITING ORDERS") until you click either:
    - a **spot on the floor** of a room they know ("Move here"), or
    - **something in the scene**: a door, ladder, stairwell, crate, terminal, vent, door control, set piece, survivor, man down or fuel barrel. At the start that includes the outer airlock door, "Board the derelict".
  - They go there, stop, and hold again.
  - On the way they still handle doors and ladders, fights, stims, flashlights and kit themselves.
  - Encounters wait for your choice.
- **Recon, Assault and Salvage** run themselves: they choose their own route and answer encounters by their orders if you don't. These are kept for multi-team play. Clicking things in the scene still nudges them.
- Any order can be changed mid-mission from the **orders bar**. Switching the route to or from Standard hands the route over.

The marines always act by their own stats. In the mission the player can:
- press **Cover** (`C`). This is a full stop: everyone crouches and nothing moves on until it is released. With something coming, the barricade goes down too.
- press **Turn around** (`T`). The rear man leads the way back. Under Standard the line reverses in place and holds.
- **Use the kit:** a grenade (`Q`) into the thick of them, a flare (`E`) ahead of the point man, the barricade (`B`) toward the nearest threat. `K` toggles the Kit order (use it / save it).
- **Change orders:** `R` route, `F` fire discipline, `G` pace, `L` loot, `H` stims, `V` flashlights. Each key cycles that order; the tiles on the orders bar open a menu.
- **Point and click in the scene**, as above.
- **Choose at encounters.** These are choose-your-own-adventure cards in the scene. Each option names who would do it and the odds. Choose with keys `1`–`3` or a click.
  - Under the autonomous orders, the orders decide after 8 s.
  - Under Standard they wait. A new click walks away from an unanswered encounter.

Other keys:

| Key | Action |
|---|---|
| `Space` / `Esc` | pause |
| `P` | retro pixel mode |
| `M` | mute |
| `` ` `` | debug stats |
| mouse wheel | zoom |

**Mood:** dark, grimy and claustrophobic. Flashlight beams cut through black, the fog of war remembers what you've seen, the motion tracker pings, the squad chatters (speech-bubble "barks"), and there are hit-stop, screen shake, acid blood and explosions. Things drop from the ceiling.

---

## 2. Stack and project files

- **Libraries:**
  - Vite 8 (ES modules) and vitest 5.
  - three **0.186**: WebGLRenderer, EffectComposer, GLTFLoader + `MeshoptDecoder`, `SkeletonUtils.clone`.
  - `@dimforge/rapier2d-compat` **0.21**.
  - `@fontsource/share-tech-mono`.
  - `puppeteer-core` 24 (dev dependency) for the headless-Chrome tools.
  - `@breezystack/lamejs` (dev dependency) for MP3 encoding in the sound build.
- **`package.json`:** `"name": "alien-hulk"`, `"private": true`, `"type": "module"`. Scripts:
  - `dev` = `vite`, `build`, `preview`
  - `test` = `vitest run`
  - `assets` = `node tools/run-blender.mjs`
  - `check-glb` = `node tools/check-glb.mjs`
  - `shot` = `node tools/shot.mjs`
- **`vite.config.js`:** port 5173; build target `es2022`; three inputs (`index.html` for the game, `viewer.html` for the asset viewer, `sfx.html` for the sound board); vitest `include: ['tests/**/*.test.js']`; `testTimeout: 30000`, because whole-ship simulations take seconds.
- **`.gitattributes`:** `* text=auto eol=lf`; `*.glb`, `*.png` and `*.jpg` are binary.
- **`.gitignore`:** `node_modules/ dist/ .vite/ *.log .DS_Store Thumbs.db *.blend1 tools/out/ shots/ __pycache__/ *.pyc`.
- **No external art:** there are no sprite sheets and no textures. All art is Blender-generated low-poly GLB with vertex colours, and the built GLBs are committed to `public/assets/models/`.
- **Sound:**
  - It started purely procedural (WebAudio synthesis), and that synthesis stays in the game as the fallback for every sound.
  - On top of it goes a set of **recorded CC0 effects**. Scripts fetch them from Freesound, Kenney and OpenGameArt, **check each licence before downloading**, cut and level them, and commit them as small MP3s to `public/assets/audio/` with `manifest.json` and `CREDITS.md` (section 11).
  - No sound may be used unless it is CC0.
- **`index.html`:**
  - `<div id="stage">` (canvas) and `<div id="hud">` (DOM overlay), plus a module script `/src/main.js`.
  - Inline SVG favicon: a shield in `#566a3a` with two red visor slits `#ff3020`.

---

## 3. Architecture

```
src/
  core/      loop (fixed 60 Hz + interpolation), rng (seeded streams), config, params (URL), events, input, assets
  gen/       layout (spanning tree + loops), templates (room types, props, loot tables), populate, level
  nav/       graph (portal-graph route planner, vents for aliens), trail (breadcrumbs)
  sim/       world (step order, commands), squad, tactics (stances/drills), awareness (looking around),
             doctrine (standing orders, goals, nudges), encounters, stats, combat (+ROE), alien, critter,
             survivor, hazards (destructibles), loot, barks, director, traverse, entities,
             kit (grenades, flares, barricade), melee (the shove), morale, sentry (hacked turrets), shipevents
  meta/      profile (campaign save, XP, upgrades, permadeath, settlement), candidates (archetypes), growth, ships
  physics/   Rapier wrapper: static colliders, doors, kinematic hitboxes, raycasts, debris
  vis/       sight (rules shared by gameplay and rendering), polygon (visibility polygons)
  render/    renderer (post chain), view, camera, levelView, batch, actors, lights, visMask, fx, portraits, starfield
  ui/        hud (+hud.css), minimap (+tracker), interact (hover/click + encounter cards), briefing, command, debrief, statbars, icons
  audio/     sfx (events -> sounds, the MIX, procedural fallbacks), samples (loads the recorded set)
  main.js    boot + screen routing;  viewer.js  asset viewer;  sfxboard.js  sound board (/sfx.html)
tools/
  blender/   one script per asset family + lib/ ; run-blender.mjs · check-glb.mjs · shot.mjs
  audio/     fetch-sfx.mjs (download + licence check) · analyze-sfx.mjs (find events) · build-sfx.mjs (cut, level, encode)
  dev/       balance.mjs · threat.mjs · campaign-e2e.mjs · flicker.mjs · nanhunt.mjs · sfx-levels.mjs · sfx-audit.mjs
public/assets/
  models/    *.glb + *.meta.json + manifest.json (built by Blender)
  audio/     *.mp3 + manifest.json + CREDITS.md (built by tools/audio)
tests/       vitest suites (see section 14)
```

Design principles:
- **The simulation is pure data.** No three.js or DOM code lives in `src/sim`, `src/gen`, `src/nav`, `src/vis` or `src/meta`. The whole game therefore runs headless under vitest, and autoplay tests play complete ships to the win.
- **Determinism:**
  - Every system draws from its own seeded RNG stream. There is no `Math.random` anywhere in the simulation; only `randomSeed()` may use it.
  - The same seed, squad, doctrine and input always produce the same run.
  - Player input goes through a command queue that is applied at the start of the next step, so input replays deterministically.
- **Movement is scripted, not physics-driven.** Characters move along the navigation graph. Rapier only answers "what does this ray hit" (line of sight and hitscan) and simulates cosmetic debris. The same sight rules drive gameplay and fog of war, so what you see and what the squad can shoot always agree.
- **The room graph drives navigation.** Movement inside a room is 1D along the floor. Portals (doors, ladders, stairs, and vents for aliens) connect rooms.
- **Constant light count.** Flashlights, lamp lights and muzzle lights are pooled and reassigned each frame, never created or destroyed, so shaders never recompile mid-game. Precompile shaders at level start.
- **Fog of war** uses visibility polygons drawn into a world-space mask with MAX blending, plus a persistent "explored" mask.
- **Test hook:** `window.__game = { ready, state(), stepFrames(n), command(c, arg), world(), view(), sfx(), onFrame? }`.

### Core modules
- **`rng.js`:**
  - `hashString`: FNV-1a 32-bit.
  - `Rng(seed, stream)`: sfc32, seeded from `hash(`${seed}/${stream}`)` and its `+'b'`, `+'c'` and `+'d'` variants, discarding the first 12 draws.
  - API: `next`, `float`, `int` (inclusive), `chance`, `pick`, `weighted([item, weight] | {weight})`, `shuffle`.
  - `randomSeed()` returns 6 upper-case base-36 characters.
  - Stream names:

    | Area | Streams |
    |---|---|
    | Layout | `layout-${attempt}` |
    | Populate | `types`, `props`, `vents`, `actors`, `encounters` |
    | Simulation | `sim`, `luck`, `nerve`, `barks`, `aware`, `checks` |
    | Renderer dressing | `dress` |
    | Meta | `recruit`, `ships`, `starters`, `candidates` |
    | The hive, the kit and the ship (7.12) | `crawl`, `breeds`, `wounds`, `hive`, `melee`, `sentry`, `distress`; generation `breeds`, `brood`, `rations`, `oddities`, `events` |

- **`loop.js`:**
  - Fixed step `1/60`. Each frame, `dt` is clamped to 0–0.1, and the next frame is scheduled first.
  - Accumulator runs at most 5 steps per frame, then drops the remainder.
  - `render(alpha, dt)` is called with the interpolation alpha.
  - Hit-stop via `freeze(s)`: while it lasts, the simulation doesn't step but rendering continues.
  - Frame errors are caught and logged once, so the loop survives them.
  - `stepFrames(n)` for headless use.
  - Entities keep `prevX`, `prevY`, `prevZ` and `prevPitch` for interpolation.
- **`events.js`:** synchronous event bus. `on` returns an unsubscribe function; there is also a `'*'` wildcard.
- **`params.js`:** URL parameters:
  - `seed`
  - `autoplay` (encounters resolve at once; for tests and attract mode)
  - `retro`, `debug`, `god` (squad invulnerable), `nofog`
  - `speed` (time scale)
  - `go` (skip the title)
  - `run` (launch the saved campaign run)
  - `command` (open the Command screen)
  - `brief=SEED` (quick-play briefing)
  - `squad=c0,c3,c5,c6`
  - `doc=manual.normal.steady.way.critical.on.use` (seven orders; old six-field strings get `use`)
  - `sfx=synth` (procedural sound only; no recorded effects)

---

## 4. Coordinates and tunables (`src/core/config.js`)

- World units are metres.
- x runs along the ship: the airlock is at low x, the cockpit at high x.
- y is up.
- z is render depth only: back wall −2, walking plane 0, front floor edge +1.

Use these values:

```js
export const WORLD = { CELL_W: 6, DECK_H: 5, SLAB: 0.5, WALL: 0.6, HULL: 1.2, DOOR_H: 3.0, DOOR_W: 0.5,
  BACK_Z: -2.0, FRONT_Z: 1.0, LADDER_Z: -1.45, STAIRS_Z: -1.1, STAIRS_RUN: 5.0, SHAFT_W: 1.3 };
export const SHIP = { COLS: 24, DECKS: 3, ROOM_WIDTHS: [[2, 4], [3, 4], [4, 2], [5, 1]], LOOP_CHANCE: 0.2,
  STAIRS_CHANCE: 0.55, MIN_MAIN_PATH: 9, PORTAL_CLEAR: 1.6 };
export const SQUAD = { SIZE: 4, SPACING: 1.5, WALK: 1.7, RUN: 3.3, CROUCH: 0.9, CLIMB: 1.4, STAIRS: 1.6,
  JUMP_TIME: 0.65, SEARCH_TIME: 1.8, DOOR_TIME: 0.9, HP: 100,
  NAMES: [['SGT.', 'VOSS'], ['CPL.', 'REYES'], ['PVT.', 'OKAFOR'], ['PVT.', 'LINDQVIST']],
  TINTS: ['#c8a040', '#9a2f2a', '#3b6fa0', '#d0d0c8'],
  // height scale + gait: cadence x, forward lean deg, hip sway deg, vertical bounce m, shoulder swagger deg
  PROFILES: [
    { scale: 1.03, gait: { cadence: 0.95, lean: 3, sway: 2.0, bounce: 0.018, swagger: 3 } },    // steady sergeant
    { scale: 1.08, gait: { cadence: 0.86, lean: 6, sway: 4.5, bounce: 0.03, swagger: 5 } },     // lumbering heavy
    { scale: 0.97, gait: { cadence: 1.1, lean: 9, sway: 1.5, bounce: 0.022, swagger: 1 } },     // pushy breacher
    { scale: 0.94, gait: { cadence: 1.0, lean: 1.5, sway: 0.8, bounce: 0.006, swagger: 0.5 } }, // gliding marksman
  ],
  STIMS: 3, STIM_HEAL: 45 };
// rate = trigger pulls/s while bursting; spread deg (crouch x0.6, running x1.8); noise = wake radius; pellets>1 = shotgun
export const WEAPONS = {
  carbine:  { label: 'Carbine', mag: 40, reserve: 160, rate: 8, burst: [3, 6], pause: 0.35, reload: 2.2, damage: [9, 14], range: 26, spread: 3.6, noise: 30, pellets: 1 },
  heavy:    { label: 'Heavy repeater', mag: 90, reserve: 270, rate: 10, burst: [8, 14], pause: 0.55, reload: 3.6, damage: [7, 11], range: 24, spread: 5.6, noise: 40, pellets: 1 },
  breacher: { label: 'Breacher', mag: 8, reserve: 48, rate: 1.7, burst: [1, 2], pause: 0.25, reload: 2.8, damage: [6, 9], range: 12, spread: 8, noise: 32, pellets: 7, falloff: true, stagger: 0.35 },
  marksman: { label: 'Marksman rifle', mag: 10, reserve: 50, rate: 1.4, burst: [1, 1], pause: 0.15, reload: 2.6, damage: [36, 46], range: 34, spread: 0.6, noise: 34, pellets: 1, sight: 30 },
};
export const LOADOUTS = [ // names match the var_* parts in marine.glb
  { name: 'command', helmet: 'command', pads: 'command', pack: 'command', weapon: 'carbine' },
  { name: 'heavy', helmet: 'heavy', pads: 'heavy', pack: 'heavy', weapon: 'heavy' },
  { name: 'breacher', helmet: 'breacher', pads: 'breacher', pack: 'breacher', weapon: 'breacher' },
  { name: 'marksman', helmet: 'marksman', pads: 'marksman', pack: 'marksman', weapon: 'marksman' },
];
export const STANCE = { POST_COMBAT: 2.6, ALERT_AFTER: 9, MOTION_RANGE: 14, SIGNAL_TIME: 1.2 };
export const STATS = { KEYS: ['str', 'spd', 'sta', 'acc', 'per', 'int', 'nrv', 'lck'], BASE: 5, MIN: 1, MAX: 10, CEILING: 3 /* + LABEL, SHORT, TEXT; nrv: 'Making energy last on high alert, composure under attack' */ };
export const AWARE = { MIN_GAP: 0.8, SLACK: [-0.25, 0.9], ACCEL: 2.4, DECEL: 6, CATCH_UP: 1.5, SCAN: [1.1, 2.8],
  PITCH_RATE: 2.4, PITCH_MAX: 0.75, PITCH_MIN: -0.55, PITCH_BASE: { casual: -0.2, alert: -0.07, engaged: -0.02 },
  CHECK: [0.7, 1.4], CHECK_COOL: [5, 10], SIX_EVERY: [9, 16], SIX_TIME: [1.4, 2.6], BOUND: [4, 6.5],
  BOUND_HOLD: [0.7, 1.3], ENTRY_PAUSE: 0.8, KNEEL: 1.5, WATCH: 1.6 };
export const SIGHT = { CONE_RANGE: 22, CONE_HALF: 32, AURA: 6.5, DARK_CONE_RANGE: 9 };
export const ROE = { CAUTIOUS: 'cautious', NORMAL: 'normal', ALERT: 'alert', ATTACKED_WINDOW: 5 };
// FOCUS { MAX: 100, DRAIN: 1.8, PER_KILL: 14, MIN_TO_ENTER: 10 } was replaced by ENERGY, and PACE slowed down:
// both are in 7.12 with ALIEN_TYPES, PACK, KIT, MORALE, DOWN and the rest.
export const ALIEN = { HP: 90, SPEED: 6.2, CLIMB: 3.2, VENT_SPEED: 6.5, LEAP_RANGE: 5, LEAP_TIME: 0.45,
  ATTACK_RANGE: 1.25, ATTACK_TIME: 0.85, DAMAGE: [16, 25], SIGHT: 18, HEAR_STEPS: 6, REPATH: 0.5 };
export const CRITTER = { HP: 6, SPEED: 1.8, FLEE: 4.2 };
export const HOSTILES = { BASE: 22, PER_THREAT: 5, DORMANT_SHARE: 0.55, MIN_RESERVE: 4, CLEAR_BONUS: 150 };
```

Other module-level constants:
- `SURVIVOR = { HP: 45, WALK: 1.7, RUN: 3.3, IDENTIFY: 6, PANIC: 10 }` (sim/survivor.js)
- `BLAST = { RADIUS: 4.2, DAMAGE: 115, NOISE: 45, CHAIN_DELAY: 0.14, SAFE_DIST: 4.8 }` (sim/hazards.js)
- world `TUNING = { uplinkTime: 14, waveEvery: 4.5, calm: [22, 40], ambushBonus: 1.8 }`

---

## 5. Procedural ship (`src/gen`)

**Layout (`layout.js`, stream `layout-${attempt}`; up to 200 attempts, then throw).**
- **Grid:** 24 columns × 3 decks. Cells are 6 m wide and decks 5 m floor to floor.
- **Stepped hull:** for deck `d`, `t = d/(decks-1)`:
  - `c0 = round(t*4) + int(0,1)`
  - `c1 = cols-1 - round((1-t)*4) + (top ? 0 : int(-1,0))`
  - So the bottom deck reaches the stern and the top deck the bow.
- **Partitioning into rooms:** widths are drawn from `ROOM_WIDTHS` (2–5 cells).
  - Deck 0 reserves its first 2 cells for the **airlock**. The top deck reserves its last 2 for the **cockpit**.
  - A leftover of 1 cell is avoided (`w<5 ? w+1 : w-1`); a room narrower than 2 merges into the previous one.
- **Room record:** `{id, deck, c0, c1, x0, x1, y0=deck*5, y1=y0+4.5, portals:[]}`.
- **Candidate connections:**
  - Doors between consecutive rooms on a deck, with weight `U`.
  - Verticals between rooms on adjacent decks that overlap by at least one cell (the lower room may not be the airlock, the upper may not be the cockpit), with weight `U*2.2`, so doors win tree slots.
- **Graph:**
  - Kruskal spanning tree (union-find, ascending weight).
  - Each leftover candidate is re-added as a loop with probability 0.2.
  - Reject the attempt if the result is not connected.
- **Vertical placement:** usable x is `[ov0+1.9, ov1-1.9]`. Up to 8 tries:
  - **Stairs** with probability 0.55 when there is room for 5 m + 0.2: direction ±1; `xb` is the bottom end, `xt` the top end; footprint `[xa-0.5, xa+5.5]`. Stairs are tried in the first 5 attempts.
  - Otherwise a **ladder** at x, footprint ±0.9.
  - Footprints must keep 0.6 m clear of other footprints in both rooms.
  - Portal records: `{kind:'door', a:left, b:right, x:rooms[a].x1, y, open:false}`, `{kind:'ladder', x, span}` and `{kind:'stairs', xb, xt, dir, span}`. `a` is always the lower room, plus `yLow` and `yHigh`.
- **Validation:** BFS from the airlock. `mainPath` (airlock → cockpit) must be at least 9 rooms. Store `room.dist` (BFS hops).
  - `bounds = {x0:minX-HULL-2, x1:maxX+HULL+6, y0:-SLAB-1, y1:decks*5+1}`.
  - `walkLimits(room) = [x0+0.75, x1-0.75]`.

**`generateLevel(seed, {threat, mods, cols, decks})`** runs layout, then populate, then `addDock`, then `buildSolids`.
- **Dock:** `DOCK = {TUBE:4, BAY:12.4, NOSE:19, CEIL:4.2}`.
  - An exterior dock room (the Kestrel's bay plus the boarding tube) sits left of the airlock. It is always explored and seen.
  - It connects to the airlock through an **outer door** portal (`outer:true`, `thick: HULL`).
  - The squad spawns in the dock at `x0+1.2+4*1.5`.
- **Solids:** axis-aligned boxes `{x0,y0,x1,y1,kind}`:
  - Floor slabs, with shaft openings cut out: ladders ±0.65; stairs a 2.2 m opening at the top end.
  - Hull walls.
  - Bulkheads at room boundaries (starting at door height when there is a door).
  - Door boxes tagged with their portal id.
  - The dock's floor and ceiling.
- **Other helpers:**
  - `roomAt(x,y)`.
  - `portalEnds`: a door end sits `thick/2+0.2` into each room; a ladder at its x; stairs at `xb` below and `xt` above.

**Templates (`templates.js`).**
- **PROPS**, with footprint `w` and render depth `z`:
  - Lootable (`interact`, with a label; `body` "Dead crewman" w 2.0 is lootable too):
    - crate 1.2 ("Supply crate")
    - locker 1.0
    - chest 1.3 ("Footlocker")
    - cabinet 1.4 ("Med cabinet")
    - ammo_rack 1.6
    - weapon_case 1.4 ("Weapons case")
    - safe 1.0 ("Strongbox")
  - Scenery: barrel, bigcrate, bunk, medbed, shelf, table, reactor, pilot_seat, airlock_hatch.
  - Destructibles:
    - `barrel_explosive` (hp 20, h 1.1, explosive, wreck `barrel_wreck`)
    - `console` (hp 35, h 1.3, wreck `console_broken`)
  - `control_panel` 2.4 (the objective, "Navigation core").
  - Set pieces (7.12): `barricade` 1.2 (`obstacle: 'jump'`), `turret` 1.0, `eggs` 1.6, `cryopod` 1.3.
  - Obstacles on the walking line:
    - `debris` 1.5 (`obstacle:'jump'`)
    - `beam` 1.8 (`obstacle:'crouch'`)
- **ROOM_TYPES** (weight / minCells / props per 10 m / light: `normal|dim|flicker|red`):

  | Type | Weight | minCells | Density | Light | Props (weights) |
  |---|---|---|---|---|---|
  | airlock | 0 | | 0 | red | |
  | cockpit | 0 | | 0 | normal | ("Command deck") |
  | corridor | 3 | 4 | 1.4 | dim | barrel 2, barrel_explosive .8, crate 1, debris 1.2, beam .8 |
  | quarters | 3 | | 3.2 | dim | bunk 3, locker 3, chest 2, table 1, safe .5 |
  | storage | 3 | | 3.6 | flicker | crate 4, chest 2, barrel 2, barrel_explosive .6, shelf 2, bigcrate 1, weapon_case .5, safe .3 |
  | medbay | 1.5 | | 3.0 | normal | medbed 3, cabinet 3, console 1 |
  | cargo | 2 | 3 | 2.6 | dim | bigcrate 4, crate 3, barrel 2, barrel_explosive .9, weapon_case .6 |
  | armory | 1 | | 3.0 | red | ammo_rack 3, weapon_case 2.5, locker 2, crate 1 |
  | engineering | 2 | | 2.4 | flicker | console 3, barrel 2, barrel_explosive .9, crate 1, weapon_case .4, debris .6 |
  | reactor | 0 | 3 | 1.8 | red | console 2, barrel 1, barrel_explosive 1.2 |

  Each type also has **backdrop** weights for the renderer's back-wall variants (plain / pipes / vent / window / screen / shelves / hazard).
- **LOOT tables:**

  | Table | Outcomes (weights) |
  |---|---|
  | default | credits 5, ammo 3, stim 1, medkit 1.2, weapon 1.7, treasure 1.2, empty 2.2, ambush 0.5 |
  | ammo_rack | ammo 6, weapon 1.5, credits 1, empty 1 |
  | cabinet | medkit 4, stim 2, empty 1.5 |
  | weapon_case | weapon 1 |
  | safe | treasure 3, credits 1 |
  | body | credits 3, ammo 3, stim 1, medkit 1, empty 3 |

  `food` and `drink` results come from the `rations` pass (7.12).

**Populate (`populate.js`).** Five passes, each on its own stream, so adding a pass never changes the others.
1. **`types`:**
   - One reactor room on the middle of the main path (≥3 cells). The other rooms are weighted by type, and dead ends get armory and storage weights ×3.
   - `room.seed`, `light` and `onMainPath` are set per room.
   - `nest` = a dead end with `dist ≥ 3`, chosen with probability `min(.95, .55*mods.nests)`.
   - `mods.blackout` makes rooms 70% dim and 30% flicker.
   - The inner airlock door gets `airlock:true`.
2. **`props`:**
   - The airlock gets an `airlock_hatch`.
   - The cockpit gets `control_panel` at `wr-1.8` and `pilot_seat` 2.2 m before it. `level.objective = {room, x: panel.x-0.4}`.
   - In other rooms, `target = round(width/10*density*U(.7,1.3))`; loot per room is 0/1/2 with weights 3/5/2.
   - At most one obstacle per room, and none if `dist < 2` or the room is under 3 cells.
   - Keep props out of **clear zones**: 1.6+0.6 m at doors, ±1.3 m at ladders, ±1.2 m around stairs, and the room ends.
   - Minimum centre gap is `(w1+w2)/2 + 0.3`, or `+4` between obstacles.
   - Mods scale `barrel_explosive`, `safe` and `weapon_case` weights.
   - Loot is rolled here: luck = weapon_case 0.9, ammo_rack 0.5, else 0.15, plus `threat*0.15 + mods.luck`.
     - credits `int(2,12)*5`; ammo `int(3,8)*10`; medkit 35; stim 1.
3. **`vents`:**
   - Rooms of 4+ cells get 1–2 vents; other rooms get 1.
   - 45% are ceiling vents, the rest wall vents. None within 3 m of each other or inside clear zones.
   - Each vent's duct links to its 2 nearest vents in other rooms, if they are less than 30 m away.
4. **`actors`:**
   - Sleeping aliens: none if `dist < 2`; otherwise `floor(U*0.9 + p*1.5)`, where `p = dist/maxDist`. Nests hold `2 + floor(p*2.5 + U)`.
   - Critters: 40% of rooms get 1–3.
   - **Fixed hostile budget:**
     - `total = round((22 + 5*threat) * mods.hostiles)`.
     - `dormant` = total − max(4, round(total*0.45)).
     - Nest sleepers are kept first. The remainder is the **director's reserve**.
     - `level.hostiles = {total, dormant, reserve}`.
   - Survivors: 1 / 2 / 0 with weights 5/3/1, plus `mods.survivors`, hidden in rooms with `dist ≥ 3` that are not nests, the cockpit or the reactor.
5. **`encounters`**, then the newer passes in this order: `breeds`, `brood`, `rations`, `oddities`, `events` (7.12):
   - With probability .85, one weapons case or strongbox (not an ambush) becomes an `armoury` encounter.
   - With probability .75, one console becomes a `terminal`.

---

## 6. Navigation and traversal

- **`NavGraph`:**
  - Two nodes per portal (one at each end) and one per vent.
  - Edge costs:
    - door 0.4
    - ladder `dy/1.4`
    - stairs `hypot/1.6`
    - vent link `(dist+2)/6.5`, marked `ventOnly`
  - Within a room, any two nodes connect at `|dx|/speed`.
  - `route(from{room,x}, to{room,x}, {vents, speed, blocked})` is Dijkstra from a virtual start to a virtual goal. It returns steps: `walk`, `portal` or `vent`.
  - Closed doors are not blocked in the graph.
- **`Trail`:** breadcrumbs `{x, y, z, s(arclength), mode, room}`.
  - Push skips points under 5 cm.
  - `sample(s)` interpolates.
  - `reverse()` for turning around.
  - `truncateAfter` and `forgetBefore` trim it.
  - `nextWalkable` finds the next walkable point.
  - A point's mode describes the segment arriving at it. Trail segments belong to their arrival room.
- **`traverse.js`:**
  - `portalPath`: a door is two walk points. A ladder or stairs is: step to z = −1.45 (ladder) or −1.1 (stairs), then `climb`/`stairs`, then step back to z = 0.
  - `jumpPath`: 9 points on a 0.95 m arc over `width+1.1` in 0.65 s.
  - `crouchPath`: under a beam.
  - `modeSpeed`: climb 1.4, stairs 1.6, step 1.6, crouch 0.9, jump 5.2.
  - `advance()` spends the dt budget across vertices.

---

## 7. Simulation (`src/sim`)

### 7.1 World
- **Construction:**
  - Streams `sim`, `luck` and `nerve`.
  - Settings `{roe: NORMAL, flashlight: true}`; stims = 3 + upgrade; `reserve`; energy 100; `kit`; morale 65.
  - Physics and nav graph.
  - Marines (roster troopers, or the default four at baseline stats), then squad, aliens, critters, survivors.
  - Director, hazards, barks, tactics, encounters, doctrine.
- **`step(dt)` order:**
  1. Apply queued commands.
  2. Timers and prev-position snapshots.
  3. `updateMeters` (stamina, energy).
  4. Squad.
  5. Aliens, critters, survivors.
  6. Clear noises.
  7. Move hitboxes and step physics.
  8. Visibility.
  9. Marine combat, in squad order (`engaged` lasts 0.8 s after the last target).
  10. Hazards, tactics, barks.
  11. Airlock cycle.
  12. Director, doctrine.
  13. Lose if nobody is left standing.
  - The newer systems add steps; see the end of 7.12.
- **Visibility:**
  - Aliens, critters and survivors are visible if any marine `canSee`s them. The first spotter practises PER.
  - Every 15 ticks, adjacent rooms become `seen` when a marine has line of sight into them.
- **Airlock:**
  - The outer door opens on approach ("Kestrel, we are boarding. Cycling the lock.").
  - It seals once everyone is inside, and the lock cycles (`airlock-cycle` event, toast "LOCK CYCLED").
- **`damage()` and `kill()`:**
  - Hits set `hitT` and stagger aliens (default 0.12 s).
  - A marine clawed below 50% gets a nerve check. A killing blow puts him **down**, not dead (7.12).
  - Luck's *lucky escape* leaves the marine on 1 HP once.
  - Alien kills refill energy by 12, vermin by 20.
  - The first time `lifesigns()` (living aliens + reserve) reaches 0, the ship is **clear**: bonus `150*(1+0.5*threat)` credits and a "SHIP CLEAR" toast.
- **`alienStrike`:** needs `canReach` (below). Damage is `16–25 × (cover ? 0.75 : 1) × armor mod`. `god` skips it.
- **Doors:** opening one toggles its collider and makes a noise of radius 10.
- **Loot (`resolveLoot`):**
  - credits: added.
  - ammo: magazines for everyone.
  - medkit: +35 to the most hurt.
  - stim: +1.
  - weapon: a luck roll may upgrade its rarity. Then a `weapon` decision: give it to a marine or stash it.
  - treasure: salvage.
  - ambush: spawn a reserve alien from the container.
- **Uplink:**
  - Reaching the objective starts it: the best-INT marine works the panel for `14 s × uplink mod`, which keeps running while engaged.
  - The director sends waves meanwhile.
  - Completing it wins; there is no walk back.
  - The loss condition is everyone down or dead.
- **Commands:**
  - `toggleCover`
  - `turnAround`: ignored mid-traversal or mid-action.
  - `nudge(id)`: queued.
  - `moveTo(room, x)`: queued; a click on the floor under Standard orders.
    - `floorSpot(room, x)` accepts only rooms the squad has seen or explored, and clamps x into the walk limits.
    - When a `nudge` or `move` is applied while an encounter is waiting, it first chooses `leave` (a new order walks away from it).
  - `choose(optionId)`
  - `setROE`: alert needs energy ≥ 10.
  - `setOrder(knob, value)`: the orders bar.
  - `useKit('grenade' | 'flare' | 'barricade')`.
  - Both are queued like every input, so they replay.
  - `setPace`: run needs stamina ≥ 25.
  - `useStim`: +45 × medic mod to the lowest-HP marine.
- **`interactables()`:** only in seen or explored rooms. Each entry has a stable id and a label:

  | Id | What | Label |
  |---|---|---|
  | `p{id}` | door | "Go through" / "Breach the door"; the outer airlock door, listed only under Standard while it is shut, is "Board the derelict" |
  | `p{id}r{room}` | ladder or stairs end | "Climb up/down", "Take the stairs up/down" |
  | `t{prop}` | terminal | |
  | `c{prop}` | unsearched container | "Search the supply crate" |
  | `s{id}` | unidentified survivor | "Get to the survivor" |
  | `b{entity}` | visible fuel barrel | "Shoot the barrel" |
  | … | door controls, vents, men down, the junction, the distress beacon, burning doors, set pieces | see 7.12 |

- **`results()`:** `{status, time, kills, credits, salvage, salvageItems, rescued, cleared, stash, rewardMult, troopers:[{id, name, alive, kills, weaponItem, usage, wound}]}`.
- **Events:** `enter-room`, `airlock-cycle`, `bark`, `hit`, `lucky`, `kill`, `ship-clear`, `survivor-died`, `marine-died`, `strike`, `door`, `loot`, `ambush`, `equip`, `uplink-start`, `uplink-done`, `won`, `lost`, `roe`, `pace`, `flashlight`, `stim`, `panic`, `decision`, `decision-made`, `search-start`, `door-work`, `ladder-top`, `regrouped`, `squad-turn`, `encounter`, `ambush-foiled`, `shot`, `reload`, `alien-wake`, `vent-enter`, `vent-emerge`, `door-forced`, `alien-leap`, `survivor-found`, `survivor-rescued`, `prop-destroyed`, `explosion`, `buildup`, `wave`, `arrived`. The newer systems add their own (7.12).

### 7.2 Squad controller (`squad.js`)
- **Movement:**
  - The **point man** walks the squad's heading. The others **replay his exact path** (ladders and jumps included), spaced along the breadcrumb trail.
  - Lanes in depth are `[0, .42, -.38, .8]`, fading out on ladders.
  - Squad speed is `pace speed × slowest man's statPace`; in cover it is the crouch speed.
- **Features per room:**
  - Loot. A crate inside wreckage the squad vaults over is searched from the near edge.
  - Encounters, the objective, obstacles (jump or crouch), ladders and stairs, and the room's end (door or wall).
  - The point man eases into the next stopping feature: the cap is `0.45 + |dx|*1.8`, with acceleration 2.4 and deceleration 6.
- **Halts:** at a feature he triggers:
  - an encounter, or a loot `{search, ignore}` decision (possibly a hidden-ambush spot check first);
  - the objective (start the uplink);
  - jump or crouch;
  - a vertical `{take, pass, back}` decision;
  - a door: open doors are passed, closed ones get `{open, back}`;
  - a wall: bark "Dead end. Turning back." and turn around.
  - a **goal**: the spot the player clicked (Standard). `doctrine.stopX(lead)` gives it when it is in the leader's room and ahead of him. It becomes a stopping feature if it comes before the next real feature. On reaching it: `doctrine.arrived()`.
  - The **doctrine answers decisions** once the squad has stacked up (section 7.5).
- **Actions:**
  - search 1.8 s × INT mod
  - door 0.9 s
  - uplink
  - encounter
  - Actions pause while engaged, except the uplink.
- **Specialist walk-up:** the squad's best man for a job walks out of the line to it while the rest cover.
  - Searches, locks and the uplink go to the best INT; an encounter goes to its named man.
  - Conditions: he is in the same room, on his feet, and within 14 m. Otherwise the point man does it.
  - He barks "I've got this one.". The timer starts when he arrives. He falls back into his slot before the squad moves on.
- **Followers:**
  - The slot target is `lead.s - sum(gaps ahead)`. While loose, add a personal slack drift. Never come within 0.8 m of the man ahead.
  - Stragglers jog: ×1.5 when more than 2.2 m behind, ×1.25 when more than 0.8 m behind. Backpedalling is ×0.7.
  - A follower counts as moving only above 0.25·dt, so millimetre shuffles don't turn him.
- **Ladders and stairs, one at a time:**
  - A climb queue waits at the foot, 1.2 m apart.
  - On a ladder, "busy" means someone is between the ends. On stairs it means someone is below the halfway point.
  - The point man holds clear of the top until everyone is up. After a 1.4 s hold the squad emits `regrouped`.
  - **Nobody is ever stranded on a climb** (7.12): the point man steps off toward the side with room, waits short of the next stop, and the line packs evenly onto a short landing.
- **Turning around:**
  - Wait until everyone is `settled()`. A man queued at a ladder foot counts as settled, which avoids a deadlock mid-climb.
  - Then reverse the trail and the order, so the rear man becomes point, and flip the heading.
  - Bark "On me. Moving back.".
  - If he now stands at a ladder or stairs, offer it (it may be the way on).
- **Deaths and downs:** a dead or downed man leaves the line (a downed one lies where he fell, 7.12). The next man walks forward along the trail and **resumes an unfinished traversal**.
- **Invariant (tested):** walking marines always stand on their room's floor.

### 7.3 Tactics: stances and drills (`tactics.js`)
- **Stances:**
  - **casual:** weapon lowered, about 45° down.
  - **alert:** weapon at the hip.
  - **engaged:** weapon at eye level.
- **Stance rules:**
  - Engaged: combat, the uplink, a visible sleeper, or high alert.
  - Alert: an `alertUntil` window, a nest, flashlights off, any non-move situation, or sneaking.
  - Otherwise casual.
  - Stances rise instantly and drop only after 1 s (hysteresis).
- **Situation** (first match): `uplink`, `door`, `ladder`, `search`, `hold`, `move`.
- **Door drill:** gaps `[.95, 1.1, 1.6]`.
  - Point faces the door.
  - #2 **kneels** engaged, covering the door.
  - #3 covers the door.
  - The rear man watches behind.
  - Barks `door_stack`, then `rear` 0.9 s later.
- **Ladder and stairs drill:**
  - The next climber covers the shaft (`aim_up`/`aim_down`).
  - The first man up kneels covering the hatch.
  - Arrivals cover the climb.
  - Barks `ladder_cover` and `ladder_top`.
- **Search / hold:** #2 faces ahead, the rear faces back.
- **Uplink:** everyone but the leader faces back, engaged; #2 crouches; #4 covers up.
- **After a fight:**
  1. Weapons stay up for 2.6 s.
  2. If motion is still within 8.4 m: bark `lost`.
  3. Otherwise **"Clear!"**: the man with the latest kill who has a free hand calls it, with the `signal` animation (1.2 s, can't shoot meanwhile).
  4. Another answers `clear_ack` 0.8 s later.
  5. The squad is alert for 9 s, then casual.
  6. Only close motion cancels the call.
- **Other triggers:**
  - Room entry: alert for 3.5 s and bark `entry`.
  - A marine at 30 HP or below barks `wounded`.
  - A dormant hostile in view: weapons up and bark `sleeper`.
  - Unseen motion within 14 m: bark `motion` ("Tracker: {n} meters and closing.").
  - A nest: bark `nest`.
  - 50 s of calm: bark `quiet`.
- **Facing:**
  - A target always wins.
  - Otherwise face the drill post, otherwise the heading.
  - Turning needs 0.35 s since the last turn and 1.1 s since the last target (no twitching).
- **Animation clip choice, in priority order:** die (also the pose of a man down), climb, jump, hit, reload, bash, signal, interact, aim_up/aim_down, shoot/crouch_shoot, walk_aim, aim, run, crouch_walk, walk_alert, walk_casual, crouch_alert, idle_alert, idle_casual.

### 7.4 Awareness: marines move and look like people (`awareness.js`, stream `aware`)
- **Sectors:**
  - Point looks ahead.
  - #2 looks **high** (vents, hatches, lamps).
  - #3 looks **low** (crates, bodies).
  - The rear looks behind.
  - They avoid watching the same thing.
- **Points of interest:** vents, doors, openings (high/low), props, flickering lamps, corners, bodies (for 90 s), and sounds (for 2.5 s: vent-emerge, vent-enter, wake, explosion, doors opened by others).
  - Weights: vent 3, opening 3, door 2, corner 1.2, prop 1, body 2.5, lamp 1.2, horizon 3.
  - Multipliers: distance, role match ×3, ahead/behind, already watched ×0.15, recency.
  - A new look every 1.1–2.8 s.
  - Looks behind are **head-only glances**.
- **Pitch:**
  - Weapon, torch, sight cone, fog cone, spotlight and beam all **pitch onto the look point**.
  - Rate 2.4 rad/s (×2 onto a target).
  - Clamp −0.55..0.75 (down to −0.85 when checking or covering).
  - Base pitch per stance comes from `PITCH_BASE`.
- **Loose formation:**
  - Personal slack drifts within `SLACK` every 2–5 s.
  - Everyone eases in and out of their personal pace.
  - When the squad halts, spacing snaps back to the drill gaps.
- **Point man:**
  - Pauses 0.8 s at the threshold of each **unexplored** room.
  - When nervous (something on the tracker), he **advances in bounds** of 4–6.5 m, then kneels to cover for 0.7–1.3 s (bark `bound`).
- **Checks:**
  - One follower at a time stops briefly (0.7–1.4 s) to check a vent, opening or body 0.3–2.6 m ahead. Barks `check_vent` / `check_body`. Cooldown 5–10 s.
  - The **rear man checks six** every 9–16 s for 1.4–2.6 s: 55% backpedal facing the rear, otherwise stop and look (bark `six`).
- **Reactions:**
  - Noises pull eyes round (bark `noise`).
  - An alien behind turns the rear man for at least 1.6 s (bark `behind`).
  - A contact on another deck points weapons at the ceiling or floor (barks `above` / `below`).
- **Firefight:**
  - The front rank **kneels** (1.5 s) while the man behind fires over him.
  - A rear man with no target covers the other way.
  - After a target drops, a man keeps covering it for a beat.

### 7.5 Doctrine: standing orders (`doctrine.js`)
The doctrine is the squad's single decision-maker. Its knobs are set in the briefing:

| Knob | Values |
|---|---|
| route | `manual` ("Your call - they go where you click") \| `direct` \| `thorough` (sweep side rooms, detour budget 40, cockpit left for last, sweep ends at 360 s) |
| roe (fire discipline) | `cautious` \| `normal` \| `alert` |
| pace | `stealthy` → cautious \| `steady` → normal \| `fast` → run while everyone has breath (stamina ≥ 50, not engaged) |
| loot | `leave` \| `way` (grab what's on the way, skip it while engaged or with a contact) \| `all` |
| stims (medic) | `early` <60% \| `critical` <35% \| `hoard` <15% |
| light | `on` \| `auto` (off only while calm in a lit room) \| `off` |
| kit | `use` (grenades into packs, flares into dark rooms, by themselves) \| `save` (only on your call) |

- **Presets:**
  - **Standard:** `manual.normal.steady.way.critical.on.use`, the **briefing default** (campaign and quick play). Text: "You direct the squad: they hold until you click a spot or an object, go there, and hold again".
  - **Recon:** thorough.cautious.stealthy.way.critical.auto.use.
  - **Assault:** direct.alert.fast.leave.early.on.use.
  - **Salvage:** thorough.normal.steady.all.critical.on.use.
  - The autonomous presets are kept for multi-team play.
- **`DEFAULT_DOCTRINE`** stays `direct.normal.steady.way.critical.on.use`. It is the autonomous default the simulation uses without orders (tests, tools, old links).
- **URL form:** the seven values joined with `.`. `parseDoctrine` sanitises invalid values back to the defaults, and round-trips with `doctrineString`.
- **Standard is `route: 'manual'`.** Helpers:
  - `isManual(d)`.
  - `disabledOptions(d)`: `{route: ['direct', 'thorough'], loot: ['all']}` under manual, else `{route: ['manual']}`. The briefing greys these out.
  - `fitOrders(d)`: manual with loot `all` falls back to `way`. It is applied when the doctrine is built and on every briefing change.
- **Manual behaviour:**
  - The squad state is `hold` whenever there is no player order, no traversal and no pending turn. It goes to `advance` only while an order (override) exists. The tactics "hold" drill plays meanwhile: #2 covers ahead, the rear watches back.
  - `currentGoal()` returns only the player's override, never the objective or a sweep. With no goal, `onRoute(door)` is false, so the squad doesn't wander.
  - Encounters are **never answered by the orders**, even after the deadline (unless `autoplay` is on).
  - Nudges and move orders never expire (`until: Infinity`); under the autonomous routes they last 90 s.
  - **Move orders:** `moveTo(room, x)` sets the override `{goal: {kind: 'nudge', room, x}, verb: 'move', target: {kind: 'move', label: 'Move here'}}`.
    - `stopX(lead)` feeds the squad the stop point.
    - A spot already between the rear man and the point (same room) counts as reached.
    - `arrived()` clears the override, emits `arrived`, and the leader may bark `in_position` (0.6): "In position." / "Holding here." / "Set. Awaiting orders.".
  - **Turn around** under manual only clears the override: the line reverses in place and holds.
- **Answering decisions:** only after the squad is `settled()` (or after 3 s), plus 0.5 s, so the drills play. Decisions with a deadline (encounters) wait for it unless `autoplay` is on.
  - door: open if it is on the route, else back.
  - vertical: take if it is on the route, else pass.
  - weapon: give to the same-class marine with worse rarity, highest ACC first; otherwise stash.
- **Mid-mission changes** come through the orders bar (`setOrder`, 7.12).
- **Errands:** the doctrine also runs `rescue()` (going back for a man down) and `errands()` (door controls, vents, the distress call, locked doors), all in 7.12.
- **Steering** (every 0.5 s):
  - If the route's next portal lies more than 1.2 m behind the leader and behind the rear man, and everyone is on foot in this room, turn around.
  - Never mid-climb, never while straddling a door, never ping-pong: wait 4 s between steers.
- **Turn around (autonomous routes):** sets a goal override: the nearest unexplored room behind (40 s), else onward (12 s). The next door therefore doesn't U-turn the squad straight back.
- **Nudges** are acknowledged with bark `nudge`:
  - door, ladder or stairs: route through it to its far side.
  - crate: search it even under "leave it".
  - terminal: re-offer it.
  - survivor: go to them until they are identified.
  - barrel: a `forced` target that bypasses fire discipline but is only shot once nobody friendly is within 4.8 m (bark `nudge_barrel`).
- **`encounterChoice`** (when the timer runs out, autonomous routes only):
  - locker: `open` if loot is `all` and its odds ≥ .6, else `shoot`.
  - terminal: `download` if its odds ≥ .3 (thorough) or ≥ .5, else `leave`.
  - armoury: `leave` under "leave it". Otherwise hack when quiet or when hack ≥ force, else force; take it if the odds are at least .35.

### 7.6 Encounters (`encounters.js`, stream `checks`)
- **Flow:**
  - The squad stops and an in-world card offers options. Each names **who** would do it (the best at the stat) and **the odds**: `checkChance = clamp(base + .08·(stat-5) + .02·(luck-5), .05, .95)`.
  - The player has 8 s; then `encounterChoice` decides.
  - Under Standard the choice is always the player's. The card's clock bar still drains, but nothing answers at zero.
  - Timed options become an action with a specialist walk-up. A success practises the stat +2, a failure +1.
- **Sealed weapons locker** (`armoury`: a weapons case or strongbox):
  - **Hack the keypad** (INT, .55, 4 s, quiet).
  - **Force it** (STR, .5, 1.6 s, loud: noise 22).
  - **Leave it.**
  - Success upgrades what's inside one rarity (or doubles the credits). Failure jams the locker and either trips an alarm (noise 32, which wakes the deck) or snaps back on the forcer's hand (18 damage).
- **Crew terminal** (`terminal`: a console):
  - **Pull the deck plans** (INT, .5, 5 s). Success maps every room and every cache on the minimap (`intel`); failure sets off a security siren (noise 35).
  - **Leave it.**
- **Something in the locker:** a container rolled `ambush`. When the squad reaches it, the sharpest eyes may notice (PER check, base .35).
  - **Shoot it first:** the loot is lost and the hostile dies.
  - **Open it carefully** (NRV, .5): kill it as it lunges and keep the loot, or the ambush springs.
  - **Leave it.**
- **Terminals** are nudgeable too.
- **More encounters** (door controls, vents, the power junction, fire, the locked storeroom and the set pieces) are in 7.12.

### 7.7 Stats, practice and nerve (`stats.js`)
- **Stats:** eight, rated 1–10, with 5 as the baseline: STR, SPD, STA, ACC, PER, INT, NRV, LCK. With `d = stat - 5`:
  - `spread = (1-.06·d_acc)·(heavy|breacher ? 1-.03·d_str : 1)`
  - `acquire = 1-.07·d_per`
  - `reload = 1-.04·d_spd`
  - `armor = 1-.04·d_str`
  - `search = 1-.07·d_int`
  - `sight = +.8·d_per` m
  - `hp = +6·d_sta`
  - `medic = 1+.1·d_int`
  - `focus = 1-.07·d_nrv` (the name stayed; it now scales the high-alert energy drain)
  - `stamina = 1+.1·d_sta`
  - `drain = 1-.05·d_sta`
  - `stagger = heavy ? 1+.06·d_str : 1`
  - `aura = .25·d_per`
  - `crit = .03·max(0, d_lck)` (×1.8 damage)
  - `escapes = d_lck ≥ 2 ? 1 : 0` (luck 7+ survives one killing blow per mission)
  - `find = .05·max(0, d_lck)`
  - `climb = 1+.035·d_spd`
  - `uplink = 1-.05·d_int`
  - `statPace = 1+.035·d_spd`; a trooper's own pace is `(1+(cadence-1)*.5)·statPace`.
  - **All stats at 5 must equal the neutral modifiers exactly**, so golden digests are unchanged.
- **Jobs:** best INT searches, works locks and runs the uplink. Best PER spots. The slowest man sets the pace. The least fit man decides how long the squad can run.
- **Practice counters** (bookkeeping only during a run):

  | Stat | Earned by |
  |---|---|
  | ACC | hits |
  | PER | first to spot +1, checks +.3 |
  | INT | searches +1, stims +1, uplink +3 |
  | STR | heavy/breacher kills +.5 |
  | STA | damage/30, running |
  | SPD | running, climbs +.15 |
  | NRV | clawed +.3, kills within 3 m +1, high alert, holding on +.5 |
  | LCK | crits, escapes +2, lucky finds +1 |
  | Encounter stat | +2 on success, +1 on failure |

- **Nerve:** a trooper clawed below half health with nerve under 5 may **panic** for 2.2 s.
  - Chance `.1·(5-nrv)`, rolled on the `nerve` stream.
  - Panic means spread ×2.2, acquire time ×1.6, and "PANIC" on the HUD.
  - A squad-mate with nerve 8+ within 4 m cuts the chance by 60% (bark `steady`: "Stay with me, {name}!").
  - Nerve 5+ never panics.

### 7.8 Combat and fire discipline (`combat.js`)
- **Fire discipline** (the "mental state"):
  - **Cautious:** return fire only, within 5 s of being attacked.
  - **Normal:** fire at **anything that moves**: vermin and *unidentified moving survivors* (friendly fire) included, but not sleepers.
  - **High alert:** weapons up, fastest reactions, every hostile including sleepers. It burns **energy** (1.5/s × nerve mod, reduced by the neural upgrade), refilled by kills (+12), vermin shot (+20), food and drinks (7.12). The squad drops to normal at 0 and needs 10 to enter.
  - Marines can never hit each other: they are not in the ray mask.
- **Targeting:**
  - Retarget every 0.2–0.3 s.
  - Score = distance, +3 if behind, +4 for a critter, +2 if dormant, −4 for the current target (sticky, so no thrashing). A dragger scores −10, a screamer −8 and a fleeing alien −2 (7.12).
  - Explosive barrels score `−12·(awake aliens within 0.75·R that are safe to hit)`; a forced barrel scores −50 once safe.
  - Breachers dislike targets beyond 70% of range.
  - Acquire delay: .2 on high alert; otherwise by stance: engaged .32, alert .42, casual .62; props .12. Multiplied by the PER mod, and ×1.6 while panicking.
- **Fire:**
  - Bursts of `int(burst)` at `rate × (stim 1.2) × (high alert 1.1)`, with a pause of `pause × U(.7, 1.4)` afterwards.
  - Spread multipliers:
    - ×ACC mod
    - ×.6 crouched
    - ×1.8 running
    - ×.8 high alert
    - ×.75 on stim
    - ×2.2 panic
    - × the morale level's spread, and ×1.35 with an arm wound (7.12)
    - ×1.7 against a moving target, ×2.4 against one leaping, dropping or springing
  - Hitscan through Rapier raycasts. Misses can hit props more than 3 m out.
  - Damage `int(dmg) × stim 1.15`, plus luck crits. Breacher falloff `clamp(1.25-d/range, .25, 1)` and stagger .35.
  - Noise radius = the weapon's `noise`.
  - Reload `W.reload × SPD mod`. A `dry` bark when empty.
- **Firing drills, suppression, the shove, specialists and morale** are in 7.12.

### 7.9 Aliens (`alien.js`): four-armed hunched predators
- **States:** `dormant` → `hunt` → `leap` / `attack`, plus `vent` and `emerge`.
- **Sensing (dormant):** checked every 6 ticks. They wake on:
  - **footsteps**: 6 m × pace hearing, in the same room;
  - **closeness**: 3.2 m;
  - **sight**: 18 m, or 9 m with flashlights off, same deck;
  - **noise** (gunfire, doors, explosions) whose radius reaches them;
  - being shot or caught in a blast.
- **Hunting:**
  - Choose the prey minimising `|dx| + 3|dy| + 6 (other room)`, +4 for a man down. Survivors count as prey. A flanker's or stalker's prey sticks.
  - On the same floor: leap if 2.2 < |dx| < its breed's leap range, with line of sight and not pinned (a 0.45 s arc landing at its stand-off). Else take the high road (7.12) or chase at its breed's speed.
  - Otherwise follow a vent-enabled route, re-pathing every 0.5 s.
  - **Closed doors are forced** in 1.1 s (`door-forced`).
  - Vents: invisible, no hitbox, travel time `(dist+2)/6.5`, then emerge (ceiling 0.45 s, wall 0.6 s).
- **Attack:** a swing every 0.85 s for 16–25 damage.
- **Line of reach:** on the floor, |dy| ≤ 2.2, within its breed's reach, and line of sight from claw to body. Closed doors, walls and floors block strikes, so **aliens cannot strike through doors**.
- **Stagger:** 0.12 s default, breacher .35, explosion .9. Everything runs at ×.25 while staggered.

### 7.10 Director (`director.js`)
- **Pacing cycle:** calm (first one 30 s, then `U(22, 40) × mods.calm`) → build-up 4–7 s ("buildup" event) → **ambush**.
- **Grace:** nothing happens while the leader is within 2 rooms of the airlock.
- **Slow-down:** the timer runs at ×0.2 during fights.
- **Ambush:**
  - `n = min(reserve, 1 + floor(progress·2.5 + U·1.8))`, spawned from vents 1–2 hops from the leader.
  - 45% chance they drop from a ceiling vent in the leader's room.
  - Vent travel takes 2.5–5 s.
- **Uplink waves:** every 4.5 s (the first after 2 s), 1–2 spawn, while fewer than 9 are awake.
- The **reserve is finite**: it is the hostile budget.

### 7.11 Critters, survivors, hazards, loot, barks
- **Critters** (neutral vermin, HP 6):
  - Wander, waiting 0.5–4 s between moves.
  - Bolt at ×2.2 speed from a marine within 4.2 m.
  - Normal fire discipline shoots them, and each one shot refills 20 energy (bark `eat`).
- **Survivors** (stranded engineers, HP 45):
  - Hide and cower.
  - Flee from awake aliens within 10 m, or from noise (a 2% chance per step while within 12 m).
  - **Identified** by a marine within 6 m with line of sight. They then wave (1.6 s) and **evacuate on their own** to the Kestrel: they route to the dock, open doors, and climb.
  - Rescue pays 200 cr on extraction.
  - Aliens hunt them too.
  - While unidentified and running, normal fire discipline can kill them (toast "FRIENDLY FIRE" / "CIVILIAN LOST").
- **Hazards:**
  - Explosive fuel barrels: blast radius 4.2, damage `115·(1-d/R)^1.2` with line of sight, noise 45. They chain to other barrels after 0.14 s. Aliens are woken, knocked back and staggered .9.
  - Consoles are breakable (wreck models swap in).
  - Stray rounds hit props.
  - Troopers deliberately shoot a barrel when hostiles crowd it and it is blast-safe.
- **Loot (`loot.js`):**
  - Rarities:

    | Rarity | Label | Colour | Weight | Affixes | Value |
    |---|---|---|---|---|---|
    | common | "Standard" | `#b8c0b0` | 58 | 0 | 40 |
    | rare | | `#4aa3ff` | 29 | 1 | 120 |
    | epic | | `#b45cff` | 11 | 2 | 300 |
    | legendary | | `#ff9a2a` | 2.5 | 3 | 700 |

    Non-common weights are scaled ×(1+luck).
  - Affixes: dmg .12–.32, rate .10–.25, mag .25–.60, acc .15–.35, reload .15–.35, range .12–.25, stagger .2–.4.
  - Names:
    - "Standard Carbine"
    - "Mk.II Warden Carbine" (rare), "Mk.III …" (epic)
    - legendary: `"Last Word" Marksman rifle`
    - Lists:

      | Class | Names |
      |---|---|
      | carbine | Kestrel, Warden, Sentinel, Longshift, Vigil |
      | heavy | Hellstorm, Grinder, Bulwark, Thunderhead, Deckclearer |
      | breacher | Doorkicker, Knockback, Hullbuster, Short Answer, Bruiser |
      | marksman | Longreach, Needle, Farsight, Last Word, Stillwater |

  - **Treasure salvage:**

    | Item | Value (cr) |
    |---|---|
    | Captain's chronometer | 180 |
    | Encrypted data core | 260 |
    | Xeno-crystal shard | 340 |
    | Officer's medal | 140 |
    | Nav-logs of a lost fleet | 420 |
    | Gold-plated sidearm | 300 |
    | Sealed medical research | 380 |
    | Prototype power cell | 280 |

    The value scales `×(1+.25·threat)·U(.85, 1.2)`, and treasure is only banked if the run is won.
  - Food rations and energy drinks turn up in containers (7.12).
  - Aim for roughly 2 weapons, 1 treasure and 6 fuel barrels per ship.
- **Barks (`barks.js`, stream `barks`):** 2–4 lines per key, with a per-key squad-wide cooldown (1.5–60 s). Short, professional, tense.

  | Key | Example line |
  |---|---|
  | contact | "Contact!", "Got movement - contact!" |
  | clear | "Clear. Stay frosty." |
  | lost | "It's still out there." |
  | door_stack | "Stacking up." |
  | rear | "Watching our six." |
  | ladder_cover | "Go, go - I have the shaft." |
  | ladder_top | "Up. Holding the hatch." |
  | motion | "Tracker: {n} meters and closing." |
  | nest | "Smell that? We are in their nest." |
  | down | "{name} is down!" |
  | quiet | "Too quiet." |
  | entry | "Slice it. Slow." |
  | winded | "Suits are overheating - slow down!" |
  | sleeper | "Something is curled up in there." |
  | bound | "Set. Move up." |
  | check_vent | "Duct here... clear." |
  | behind | "On our six!" |
  | above | "Above us - in the ceiling!" |
  | lucky | "Armour held... somehow." |
  | panic | "Get it off me! GET IT OFF!" |
  | steady | "Eyes on me, {name}. Keep firing." |
  | nudge | "Roger - heading there." |
  | in_position | "Set. Awaiting orders." (cooldown 6 s) |
  | reload | "Changing mags!" |
  | dry | "I'm dry!" |

  - Scripted one-off lines bypass cooldowns.
  - Barks use their own RNG stream, so they never perturb the simulation.

### 7.12 The hive, the kit and the ship

These systems are built on top of everything above. Each has its own module and tests.

**Config blocks** (`config.js`; `ENERGY` replaces the old `FOCUS`, and `PACE` is slower):

```js
export const ENERGY = { MAX: 100, DRAIN: 1.5, PER_KILL: 12, PER_CRITTER: 20, FOOD: 25, DRINK: 40, MIN_TO_ENTER: 10 };
export const PACE = { SPEED: { cautious: 0.95, normal: 1.7, run: 3.3 }, HEARING: { cautious: 0.45, normal: 1, run: 1.8 },
  STAMINA_MAX: 100, DRAIN: 3, REGEN_FAST: 1.2, REGEN_MOVING: 2.5, REGEN_RESTING: 6, MIN_TO_RUN: 25 };
SIGHT.POWERLESS_AURA = 0.4;   // x awareness radius in a room with its power out
export const ALIEN_TYPES = {
  drone:    { label: 'Drone', scale: 1, hp: 90, speed: 1, damage: [16, 25], attackTime: 0.85, leap: 5, climb: 0.35, stagger: 1, force: 1, tint: null, weight: 56, deep: 42, drag: 0.5 },
  runner:   { label: 'Runner', scale: 0.76, hp: 48, speed: 1.3, damage: [9, 15], attackTime: 0.6, leap: 6.5, climb: 0.55, stagger: 1.3, force: 0.8, tint: '#c8d4a0', weight: 24, deep: 20, stalk: 0.3, flee: 0.35, hear: 1.8 },
  creeper:  { label: 'Creeper', scale: 0.9, hp: 70, speed: 0.95, damage: [18, 27], attackTime: 0.8, leap: 4, climb: 0.95, stagger: 1, force: 1, tint: '#8f9cc8', weight: 14, deep: 20, stalk: 0.6, flee: 0.3, drag: 0.4, shy: true },
  brute:    { label: 'Brute', scale: 1.4, hp: 230, speed: 0.7, damage: [28, 40], attackTime: 1.15, leap: 0, climb: 0, stagger: 0.35, force: 2, tint: '#c88070', weight: 6, deep: 18, drag: 0.7 },
  spitter:  { label: 'Spitter', scale: 0.85, hp: 80, speed: 0.9, damage: [8, 12], attackTime: 0.9, leap: 0, climb: 0.5, stagger: 1.1, force: 0.8, tint: '#b0c848', weight: 0, deep: 12, ranged: true },
  screamer: { label: 'Screamer', scale: 0.95, hp: 75, speed: 0.85, damage: [8, 13], attackTime: 0.8, leap: 0, climb: 0.15, stagger: 1.2, force: 0.8, tint: '#d89ab0', weight: 0, deep: 5, screams: true },
  brood:    { label: 'Brood mother', scale: 1.75, hp: 480, speed: 0.5, damage: [30, 44], attackTime: 1.3, leap: 0, climb: 0, stagger: 0.22, force: 2.5, tint: '#7a5a8e', weight: 0, deep: 0, births: true },
};
export const PACK = { FLANK: { DX: 3 }, STALK: { DIST: 9, NEAR: 14, GAP: 5.5, PATIENCE: 35 }, FLEE: { HP: 0.3, LURK: [10, 18] }, SHY: { RANGE: 9, BRAVE: 4 }, DRAG: { SPEED: 0.42, DROP: 22 } };
export const SCREAM = { RANGE: 24, WINDUP: 1.1, CALL: [1, 2], EVERY: 14, MAX: 3, CUT: 0.3 };
export const BROOD = { CHANCE: 0.3, EVERY: 8, MAX: 6, BONUS: 120 };
export const SPIT = { RANGE: [5, 16], EVERY: 2.6, WINDUP: 0.4, FLIGHT: 0.6, GRAVITY: 12, DAMAGE: [9, 14], SPLASH: 0.9, COVER: 2.6, POOL: { R: 1.1, TIME: 6, DPS: 4 } };
export const COVER = { VAULT: { jump: 0.6, crouch: 0.5, barricade: 0.9 }, SMASH: 1.4, BARRICADE: { W: 1.2, H: 1.15 } };
export const CRAWL = { CEILING: 0.7, WALL: 0.6, SPRING: 0.42, DROP: 0.36, MIN_DX: 5.5, COOL: [3, 7], WALL_REACH: 3.5, SLEEP_HIGH: 0.55 };
export const KIT = { CHARGES: 3, GRENADES: 3, FLARES: 3, BARRICADES: 1 };
export const SENTRY = { RANGE: 14, RATE: 5, DAMAGE: [10, 16], HIT: 0.85, AMMO: 160, NOISE: 24 };
export const AUTODOC = { HEAL: 45, FAIL: 0.35 };
export const EGGS = { HATCH: [1, 2], SHOOT: 0.35 };
export const POD = { survivor: 35, alien: 35, cache: 30 };
export const GRENADE = { RANGE: [4.5, 14], FLIGHT: 0.75, R: 3.4, SAFE: 1.5, DAMAGE: 120, NOISE: 32, CLUSTER: 2, BIG: 200, COOL: 4 };
export const FLARE = { AURA: 1.8 };
export const DRILL = { LOW: 0.3, TOPUP: 0.6, COVER: 0.5 };
export const SUPPRESS = { HIT: 0.2, MAX: 1.5, MIN: 0.5, SLOW: 0.6 };
export const SHOVE = { REACH: 1.8, PUSH: 1.5, STAGGER: 0.7, DAMAGE: 6, BASE: 0.3, PRESSED: 0.3, BREACHER: 0.25, COOL: 3 };
export const ABILITY = { SNIPE: 2.5, SPOT: 12, HOLD: { rate: 1.3, spread: 0.8 }, DOOR: 0.5, DRESSINGS: 3, DRESSING: 22, HURT: 0.5, REACH: 4.5, DRESS_EVERY: 6 };
export const MORALE = { START: 65, REST: 60, DRIFT: 0.4, VETERAN: 15,
  KILL: 1.5, BIG_KILL: 6, LOST: -22, DOWNED: -12, TAKEN: -10, REVIVED: 8, SCREAM: -5, AMBUSH: -4, DARK: -4, BROOD: 20, CLEAR: 15, RESCUED: 4,
  LEVELS: [{ name: 'steady', min: 80, spread: 0.92, acquire: 0.9, nerve: 0 }, { name: 'holding', min: 35, spread: 1, acquire: 1, nerve: 0 },
           { name: 'shaken', min: 15, spread: 1.15, acquire: 1.12, nerve: 0.1 }, { name: 'breaking', min: 0, spread: 1.3, acquire: 1.25, nerve: 0.2 }] };
export const DOWN = { REVIVE: 3.2, HP: 0.2, STIM_HP: 0.45, HITBOX: 0.5, WOUNDS: { leg: { pace: 0.8, climb: 0.8 }, arm: { spread: 1.35, reload: 1.25 } } };
// sim/shipevents.js: DISTRESS_BONUS = 120
```

**New RNG streams.**
- World: `crawl`, `breeds`, `wounds`, `hive`, `melee`, `sentry`, and `distress` (in ShipEvents).
- Generation, appended after `placeEncounters`, in order: `breeds`, `brood`, `rations`, `oddities`, `events`.
- Nothing else reshuffles.

**Breeds.**
- `makeAlien(rng, x, y, room, state, {type = 'drone', surface = 'floor', side = 0})`. An unknown type falls back to a drone. It copies the breed's stats:
  - claw reach `1.25 + (scale−1)·0.6`;
  - stand-off `0.7 + 0.25·scale` (it was a fixed 0.95);
  - hitbox width `0.9·scale`;
  - ladder climb at `ALIEN.CLIMB × speed`;
  - forcing a door takes `1.1/force` s (and clears `locked`);
  - stagger taken × `stagger`;
  - it leaps only if `leap > 0` and `2.2 < |dx| < leap`, and it isn't pinned.
- **Pick by depth:** `k = clamp(room.dist/maxDist + threat·.15, 0, 1)`, and each breed's weight is `weight + (deep − weight)·k`.

  | End of the ship | drone | runner | creeper | brute | spitter | screamer |
  |---|---|---|---|---|---|---|
  | airlock | 56 | 24 | 14 | 6 | | |
  | bow | 42 | 20 | 20 | 18 | 12 | 5 |

  - Generation picks one per sleeper; `world.breed()` picks one per director spawn and per ambush locker.
- **Fixed types:**
  - a screamer's call: 60% runner, else drone;
  - brood births and egg hatches: runners;
  - a cryo-pod alien: a drone.
- The renderer tints everything but `M_Glow` with the breed's tint and scales the model.

**The high road (walls and ceilings, `sim/alien.js`).**
- **New states:** `spring`, `drop`, `vault`, `smash`, `scream`, `spit`. `dormant` can now be up high (the `lurk` animation).
- **Surfaces.** An alien's `(x, y)` is its feet:
  - `floor`;
  - `ceiling`: `y = room.y1`, hanging;
  - `wall`: `x` = the wall's face (`wallFace(room, side)` = `x0+WALL/2` or `x1−WALL/2`) and `side` −1 (left) or +1 (right).
- **Ceiling spans** (`gen/level.js ceilingSpans`): the stretch from wall face to wall face, minus each ladder or stair opening above the room. Spans of 0.6 m or less are dropped. `ceilingAt(level, room, x)` is cached per room and returns null over an opening.
- **The hunt order on the same floor:**
  1. Attack if in reach and `canReach`.
  2. Carry on to a chosen wall.
  3. Shy (creepers).
  4. Flank.
  5. Leap.
  6. The high road.
  7. Walk.
- **The high road:**
  - It needs `climb > 0`, its cooldown ready, and `|dx| ≥ 5.5`.
  - It resets the cooldown to `crawl.float(3, 7)`, then rolls `climb`.
  - The ceiling span at its x must reach over the prey.
  - If a wall face is within 3.5 m inside the span, it scuttles to the walk limit and climbs from `y0+0.2` at `speed·0.6` (`alien-climb`); at the top it is on the ceiling. Otherwise it **springs** straight up: 0.42 s, ease-out, flipping to `ceiling` halfway.
- **On a wall:**
  - It drops (onto the prey if there is one) if the prey has left the room, isn't walking, or is within 2.2 m in x.
  - Otherwise it climbs, and at the ceiling faces into the room.
- **On the ceiling:**
  - It crawls at `speed·0.7` toward `clamp(m.x, span0+0.3, span1−0.3)`.
  - It **drops** on arrival, or within `standOff+0.35` of the prey.
  - It drops at once if it is fleeing, the span ends, or the prey leaves the room.
  - A spitter may spit from up there.
- **The drop** (0.36 s): off a wall it moves 0.9 m out into the room, then falls quadratically to the floor. It lands **swinging** (`attackT = attackTime·0.6`, `alien-drop`) if its prey is within reach + 0.8, else it hunts.
- **Claws only strike from the floor:** `canReach` is false unless `surface === 'floor'`.
- **Knocked off:** a hit with raw stagger ≥ 0.3 knocks a crawler down. Breacher pellets have .35; barrel and grenade blasts pass .9.
- **Shot dead up high:** it falls under 20 m/s²; off a wall it shifts 0.8 m into the room.
- **Vents:** a climber coming out of a ceiling vent with a span there may roll `climb` to stay on the ceiling (hunting, `wakeT` 0.3).
- **Sleepers** (`placeBreeds`) roll `SLEEP_HIGH·climb` to sleep high.
  - 45% cling to the nearer bulkhead at `y0 + float(low, 4)`, where `low` is `DOOR_H + 0.4` if that wall has a door, else 1.8.
  - The rest hang from the ceiling if a span holds them with a 0.5 m margin, else they stay on the floor.
  - Up high, they listen to the floor below.
- **Seeing them:** `vis/sight.js bodyPoint(t, k = .55)` gives a point k of the body's height off its surface: on the ceiling `{x, y − h·k}`, on a wall `{x − side·h·k, y}`, on the floor `{x, y + h·k}`.
  - `canSee`, `alienSees` (head at k .65), the hitbox (centred at k .5), aim, line of sight, awareness pitch and threat glances all use it.
  - Spread is ×2.4 against `leap`, `drop` and `spring`.
  - The first sighting of one off the floor: bark `ceiling`.

**Pack habits** (`PACK`, stream `hive`):
- **Flank:** a climber with no prey yet, whose packmate on the floor is already closing from the same side and nearer, takes the ceiling over the squad to the man in the room **farthest from it** (at least 3 m beyond the near man).
  - It rolls `climb × 1.5`, and needs a span over him.
  - Event `flank`; another marine barks. Its prey sticks while he is alive, up, and in the line.
- **Stalk:** woken unseen by steps or noise, it rolls `stalk`.
  - It shadows the rear man within 9 m in his room, or follows his route through doors and vents.
  - It strikes (`stalker`) when any of these happens:
    - someone within 14 m reloads;
    - a gap of more than 5.5 m opens in the line (it goes for the man behind the gap);
    - it is seen or hurt;
    - 35 s pass (it goes for the rear man).
  - A scout within 12 m with LOS outs it (`stalker-spotted`, bark `spotted`).
- **Hit and run:** hit below 30% HP while hunting, a runner or creeper rolls `flee` (once per alien).
  - It bolts for the nearest open vent in this room or the next, lurks in the ducts 10–18 s, and comes back out of a vent near the leader at full HP (`alien-return`).
  - It drops off walls and ceilings first. A welded vent cancels it.
- **Shy:** a creeper on the same floor, at least reach + 1.2 m away, that is lit backs off at `speed·0.6` facing the light, or climbs out of it. After 4 s it ignores the light; the first time emits `alien-shy`.
  - Lit means its room has a flare, or flashlights are on and a squad man in the room within 9 m has its body in his beam (`inBeam`: the cone only, not the aura).
- **Hearing:**
  - Noise wakes within `radius × hear` (runners 1.8).
  - Footsteps reach `HEAR_STEPS × PACE.HEARING × (powerOut ? 1.5 : 1) × (1 + (hear−1)·0.4)`.
- **Drag:** when a claw lands on a **downed** man, an alien that rolls `drag` grips him and hauls him at `speed·0.42` toward the nearest floor (not ceiling) unwelded vent in his room.
  - At the vent he is **taken** (`taken`, then killed), and the alien lurks.
  - It lets go after 22 damage, if it dies, if he's no longer down or in the room, or if the vent is welded (`drag-dropped`).
  - Nobody else targets a man being dragged.
- **The squad's target priorities:** dragger −10, screamer −8, a fleeing alien −2 (lower is better).

**Spitter, Screamer, Brood mother.**
- **Spitter:**
  - Spits only at a man on his feet, on the same deck, in line of sight.
  - It backs off at `speed·0.8` when closer than 5 m (on the floor; pinned at a wall it fights) and closes in beyond 16 m.
  - In between, every 2.6 s it winds up 0.4 s and lobs a glob from `bodyPoint .7` at `(m.x, m.y+1)`: flight `0.6·clamp(d/8, .7, 1.4)`, g = 12, gone after 2.5 s.
  - The glob hits geometry, cover, a marine (|dx| < .45 and y within his body) or the floor.
  - **Cover:** a man crouched or in Cover with an obstacle's near edge 0–2.6 m toward the spitter takes it on the cover.
    - Cover heights: barricade 1.15, crouch-under obstacle 2.2, jump-over debris 0.8.
    - A barricade loses 12 of its 160 HP.
  - Otherwise standing men within 0.9 m take 9–14 × armour, and a floor or body hit leaves a **pool** (r 1.1, 6 s, 4 dps in ≥ 2 HP chunks).
  - Acid counts as being fired on (weapons free under Cautious) and never touches a downed man.
- **Screamer:**
  - Hunting, with fewer than 3 screams and its timer ready, with the target in its room or seen, it rears up for 1.1 s (`scream-start`; weapons free) and screams.
  - **Every sleeper within 24 m** (any room) wakes, and 1–2 come from the reserve out of nearby vents (60% runner). Event `scream {woke, called}`. Then 14 s until the next.
  - A hit with stagger ≥ 0.3, or 30 damage during the wind-up, cuts it off (`scream-cut`; 4 s before it tries again).
- **Brood mother:**
  - Placed with chance `min(.8, .3 + threat·.12)` in the deepest nest that has a sleeper, replacing the first one there, on the floor.
  - Awake, she births a runner 1.2 m behind her every 8 s (the first after 2 s), while she has births left (6) and the reserve has hostiles (`birth`).
  - Killing her pays 120 cr and +20 morale (`brood-dead`). She can't be shoved, leaps 0, climbs 0. At most one per ship.

**Cover, chokepoints, the barricade.**
- **Doorways:** an alien whose next step is a door waits while another is going through it. They take a doorway **one at a time**.
- **Vaulting:** a floor alien crossing an obstacle vaults it in `(barricade .9 | debris .6 | under a beam .5) / max(.6, speed/ALIEN.SPEED)` s.
  - It lands 0.3 m past it, on a 0.9 m arc (it skitters under beams).
  - It is exposed meanwhile (`alien-vault`).
- **Smashing:** a brute at a barricade smashes it in 1.4 s (noise 14, `barricade-down`).
- **The barricade** (one in the kit; 160 HP; a `jump` obstacle 1.2 m wide):
  - **Placement:** `B` puts it 1.5 m beyond the outermost squad man in the leader's room on the threat's side (the side of the nearest awake alien in the room, else the heading), clamped to `[wl+0.8, wr−0.8]`.
  - It is refused within 1.8 m of another obstacle or 1.4 m of a portal end.
  - **Cover** with a threat present and a barricade left puts it down too.
  - The squad vaults it like debris. Bark `barricade`.

**Down, not dead.**
- **Going down:**
  - At 0 HP a marine goes **down** instead of dying: HP 0, out of `squad.order` (the line closes up), a 0.5 m hitbox, his flashlight off, alert extended (`downed`, bark `medic`). There is **no bleed-out clock**.
  - The Luck escape still comes first, when he isn't already down.
  - **A claw on a downed man finishes him**, or a dragger takes him. Any other damage that brings him to 0 (a blast) kills him. Spit and acid ignore him.
  - Barks `finished` / `taken`, then `down`.
  - Aliens still count him as prey, at +4 cost.
- **Rescue (`doctrine.rescue()`):**
  - Not during an action, a traversal, a pending turn, a decision or Cover. It waits for the fight to end unless urgent (the player clicked "Get NAME up").
  - The reviver is the best medic mod (INT) walking in his room within 14 m, else the point man within 1.6 m.
  - If nobody is there, self-led routes go back for him (an override, bark `going_back`). **Standard waits for a click.**
- **The revive (`squad.startRevive`):**
  - It takes `3.2/max(1, medic)` s, with a walk-up. It uses a stim unless the stims order is `hoard`.
  - Urgent revives continue in a fight.
  - It is cancelled if he dies, is dragged, or gets up; if the reviver goes down the point man takes over.
  - He comes back (`world.revive`) at `max(1, round(min(1, (stim ? .45 : .2)·medic)·maxHp))` HP.
  - If he has no wound yet he gets one (stream `wounds`, 50/50):
    - **leg:** the squad's pace (`slowest()`) and his climb ×0.8;
    - **arm:** spread ×1.35, reload ×1.25.
  - He rejoins at the rear and walks into the line (`revived`).
- **End of the mission:**
  - Everyone down or dead is a loss.
  - When the uplink completes, men down on the command deck are carried out; the rest die.
  - `results().troopers[]` carries each man's `wound`.

**Ship events** (`sim/shipevents.js`; none on a clock). Placed by stream `events`:
- **How many:** 0/1/2 per ship (weights 2/5/3).
- **Pool weights:**

  | Event | Weight | Raised by |
  |---|---|---|
  | power failure | 1.2 | 0.3 with the blackout mod |
  | fire | 1 | 2 with the Fuel leak mod |
  | distress call | 1 | 2 with the Distress call mod |

- No duplicates.
- "Deep" means dist ≥ 2, not the airlock, cockpit or the dock.
- Checked every 0.25 s:
- **Power failure:**
  - **Setup:** the deck must have 2+ deep rooms and a console without an encounter, which becomes the **junction**.
  - **Trigger:** when the leader first enters one of the deck's deep rooms, every room on it loses power (`power-out`, bark `power_out`).
  - **While it is out:**
    - the squad's aura ×0.4 (unless a flare);
    - aliens hear steps ×1.5;
    - Auto lights treat it as dark;
    - the kit counts it as dark;
    - lamps go out;
    - the minimap greys;
    - morale −4.
  - **Restoring it:** "Restore the power" at the junction:
    - reset the breakers (INT .6, 4 s);
    - hot-wire it (STR .5, 1.5 s, "quick - but it bites": a failure burns the worker 22, and it can be retried);
    - leave it dark.
- **Fire in a doorway:**
  - **Setup:** a door with both sides deep (weight 3 on the main path).
  - **Trigger:** it ignites when the leader is in a room beside it, not traversing, with the whole squad in his room.
  - It blocks squad and aliens: aliens route round it, or replan if it lights mid-path.
  - The squad stops at it. Choices:
    - put it out (INT .6, 3 s; a failure burns the worker 10);
    - push through it (STA .55; every man takes 4–9 burns on success, 10–18 on failure, × armour);
    - find another way (turn around).
  - "Deal with the fire" replaces the door marker.
- **Distress call:**
  - **Setup:** placed in a deep non-nest room with `dist ≥ max(3, maxDist−3)`.
  - **Trigger:** after `int(3, 5)` rooms explored, a survivor appears there (stream `distress`).
  - It shows a pulsing **beacon** on the minimap ("Answer the distress call"). The thorough route goes for it.
  - Finding them pays +120 cr (`distress-answered`).

**Door controls, vents, keycards.**
- **Interactables:**
  - every known door gets "Door controls", id `k{portal}`, drawn 2.5 m up; or "Cut the door open" if it is welded;
  - every unwelded vent in a known room gets "Weld the vent shut", id `v{id}`;
  - clicking sends the squad (`errands()` offers the choice within 1.6 m).
- **Door controls:**
  - **seal** an open door: 0.8 s; it fails if the doorway is occupied;
  - **weld** it: STR .7, 4 s, one welding charge; a tech does it with his own torch, INT .75, free; alarm 16;
  - **cut** a welded door: STR .6, 5 s, a charge; alarm 28; a failure loses the charge.
  - The charge is spent before the roll, and refunded if the doorway is busy.
- **Vent:** weld it (STR .75, 3 s, a charge; or the tech's INT .8, free; alarm 12). Nothing comes out of it again.
- **Effects:**
  - Welded doors block aliens, and the squad's routes once its charges are gone. A self-led squad cuts one on its route if it has a charge.
  - The nav graph drops vent edges at welded vents.
  - Aliens in a duct whose exit gets welded reroute to a linked open vent, or go back to the reserve.
- **Locked storeroom** (stream `oddities`, chance .6):
  - **The room:** a dead end off the main path, dist ≥ 2, not a nest or the reactor, whose one portal is a door. That door is `locked`.
  - **The prize:** a weapon at luck `1.1 + threat·.15`, or treasure at threat + 1, in a loot box (a new `safe` if needed).
  - **The keycard:** a `body` (dead crewman) on the main path nearer the airlock carries it (`keycard`).
  - **"Unlock the door" choices:**
    - use the card (1 s);
    - cut through (STR .65, 5 s, a charge, alarm 28; a failure loses the charge and it stays locked);
    - leave it locked (turn around).
  - **Auto-choice:** the card, else cut if loot isn't `leave` and charges > 1, else leave.
  - **Routing:** squad routes and the sweep go round a locked door they can't open, until the player clicks it. Aliens forcing it unlock it.

**The kit** (`sim/kit.js`). `world.kit = {charges: 3, grenades: 3, flares: 3, barricades: 1, keycards: 0}`.
- Kit use is a replayable command; a refusal emits `kit-refused`.
- **Grenade (`Q`):**
  - **The thrower:** the man in walk or crouch, not reloading or signalling, with the best throw.
  - **The spot:** visible awake aliens 4.5–14 m from `(m.x, m.y+1.5)` in line of sight. Its value is the aliens within 2.72 m (`R·.8`), with big ones (200+ HP) counting 2.
  - **Never** with a marine (even downed) or an unrescued survivor within 4.9 m of the spot, nor within 3.9 m of the objective or an unfinished terminal or junction.
  - **The lob:** from `(m.x + facing·.4, m.y+1.7)`, apex `clamp(room.y1 − max(y0, ty) − .4, .2, 1.2)`, flight `.75·clamp(d/9, .6, 1.3)`. Bark `grenade`; cooldown 4 s.
  - **The blast:** `hazards.explode(x, y, by, {r: 3.4, damage: 120, noise: 32, grenade: true})`. It staggers .9, so it knocks crawlers off.
- **Flare (`E`):**
  - Lands at `lead.x + heading·4`, clamped to `[wl+.5, wr−.5]`, and **lights its room for the rest of the mission** (`room.flare`).
  - There the aura is ×1.8, power failure is ignored, and every alien counts as lit (creepers back off).
  - One per room.
  - Dark rooms are those without a flare that are powered out, dim or flickering, or on a blackout ship.
- **Kit order (`K`):**
  - `use` (the squad decides):
    - engaged and off cooldown, it throws when a spot is worth 2+;
    - entering a dark room that holds a nest, the command deck or something awake, it flares it.
  - `save`: only on your call.

**Firing drills, suppression, the shove.**
- **Reloads** emit `reload {topup}`. Barks `topup` / `reload`, and a mate with a target may bark `covering`.
- **Top-ups:** no target, the squad not engaged, magazine under 60%, and nobody else in the room reloading.
- **Staggered reloads:** a man at 30% or less, not mid-burst, changes mags only while another man in the room has a target and isn't reloading, nobody else is reloading, and nothing is within 3 m. **One at a time.**
- **Covering:** after a burst, the pause halves while a roommate reloads or a man is down or being revived.
- **Suppression:** each hit adds 0.2 s to a hostile (×2 from a heavy repeater, max 1.5, decaying 1/s). Above 0.5 it is **pinned**: movement ×0.6 and no leaps. Its claws are unaffected.
- **The shove** (`sim/melee.js`, stream `melee`):
  - **When:** a man on foot, his cooldown ready, facing an alien that is clawing him on the floor within `|dx| < 1.8, |dy| < 1`. Not brutes or the brood mother.
  - **Cooldown:** 3 s (breacher ×.6), set before the roll.
  - **Chance:** `.3 + .06·(STR−5)`, +.3 if reloading or dry, +.25 for a breacher.
  - **Effect:** 6 damage (breacher ×2), a push of 1.5 m (breacher ×1.6) within the walk limits, a stagger of .7 (breacher ×1.7); back to hunting. The `bash` clip plays, he practises STR .5, event `shove`.

**Specialists.** A marine's `role` is his archetype; the original four go by weapon (carbine → veteran, heavy, breacher, marksman).

| Role | Ability |
|---|---|
| veteran | morale never drops below 15 while he stands in the line |
| heavy | in Cover, fire rate ×1.3 and spread ×.8; his rounds pin twice as hard |
| breacher | shoves hard and often; doors take half the time while one stands (0.45 s) |
| marksman | ×2.5 damage on anything dormant or stalking |
| scout | outs a stalker within 12 m in line of sight |
| tech | welds doors and vents with no charge, on INT (.75 door, .8 vent) |
| medic | three field dressings |
| rookie | nothing extra |

- **The medic's dressings:** out of a fight, a man in his room within 4.5 m under 50% HP gets +22, 6 s apart (`dressing`).

**Morale** (`sim/morale.js`):
- 0–100, starting at 65. Out of a fight it drifts toward 60 at 0.4/s.
- Changes: alien kill +1.5 (+6 if 200+ HP), marine lost −22, down −12, taken −10, revived +8, scream −5, ambush −4, power failure −4, brood mother +20, ship clear +15, rescue +4.
- Levels:

  | Level | From | Spread | Acquire | Extra panic chance |
  |---|---|---|---|---|
  | steady | 80 | ×.92 | ×.9 | |
  | holding | 35 | ×1 | ×1 | |
  | shaken | 15 | ×1.15 | ×1.12 | +.1 |
  | breaking | 0 | ×1.3 | ×1.25 | +.2 |

- `nerveCheck` uses `.1·(5−nrv) + level.nerve`.
- On a level change it emits `morale {level, value, worse}`.
  - Below 35: the rear man barks `shaken`.
  - Back to holding: `rallied`. To steady: `steady_squad`.
  - Toasts: SQUAD SHAKEN / SQUAD BREAKING / SQUAD RALLIED.

**Energy and stamina.**
- **Energy** replaces focus:
  - **Drain:** high alert burns `1.5 × nerve mod × (1 − .15·neural)` per second, and entering it needs 10 (bark `no_energy`).
  - **At 0:** the squad drops to normal (`energy_out`). Under a high-alert order the doctrine goes back on alert at 50.
  - **Refills:**

    | Source | Energy |
    |---|---|
    | alien kill | +12 |
    | vermin shot | +20 (bark `eat`) |
    | food ration | +25 |
    | energy drink | +40 |

  - **Rations:** `placeRations` (stream `rations`) turns 75% of `empty`, 30% of `credits` and 30% of cabinet `medkit` results into food (55%) or drinks (45%).
- **Stamina:**
  - Running drains 3/s × the drain mod (about 33 s from full).
  - It regains 1.2/s at a stop on a fast pace, 2.5 walking, and 6 resting.
  - A spent squad walks until everyone is back above half.

**The orders bar** (changing the doctrine mid-mission).
- **The seventh knob:** `kit` (`use` | `save`, default `use`).
  - The doctrine string has 7 fields: `route.roe.pace.loot.stims.light.kit`. Old 6-field strings get `use`.
  - The high-alert label adds "burns energy".
- **`world.setOrder(knob, value)`** queues a replayable command. `doctrine.setOrder`:
  - checks the value and that it differs;
  - refuses `loot: all` under Standard;
  - applies `fitOrders`;
  - on a route change: drops the goal, and the override if Standard-ness flipped (that hands the route over);
  - applies fire discipline at once (alert is refused without energy);
  - toggles lights at once for on and off (auto is left to `manage`);
  - applies pace at once unless it's fast;
  - emits `orders`, bark `order_ack`.
- `missionOptions(cfg, knob)` marks `loot: all` off under Standard. `nextOrder(cfg, knob)` cycles, skipping off options.

**Set pieces** (`placeOddities`, stream `oddities`). Each is an encounter card with who and the odds.
- **Placement:** each piece takes a free spot clear of door and ladder zones and other props. In a full room it replaces clutter (barrel, bigcrate, shelf, bunk, table) at least 0.8× its width; bodies never replace clutter.
- **The pieces:**

  | Set piece | Where | Choices | Outcome |
  |---|---|---|---|
  | **Sentry turret** | 55%; dist ≥ 2, not a nest; armory, engineering, storage, cargo or corridor | Hack it (INT .55, 4 s) or leave it | Hacked, it fights for the squad from `y0+1.25`: the nearest awake alien within 14 m in LOS, 5 rds/s, 85% hits (`sentry` stream), 10–16 damage (stagger .15), noise 24, 160 rounds, credited with its kills, its head swinging to the target. A botched hack jams it (alarm 30). Auto-choice: hack if the odds are ≥ .35. |
  | **Autodoc** | the first medbed of every medbay | Run a cycle (INT .7, 5 s) or save it for later | Everyone in the line +45 (×.35 on a failure), and the first wounded man is **mended**. One use. Auto-choice: treat if anyone is wounded or under 70%. |
  | **Egg cluster** | 70% of nests | Burn them (a flare, 1.5 s); shoot them (loud, alarm 24; 35% one runner hatches); sneak past (NRV .6; a failure hatches 1–2) | Hatches come from the reserve, so none if it is empty. Auto-choice: burn if the kit is `use` and there's a flare, else sneak if stealthy or cautious, else shoot. |
  | **Cryo pod** | 45%; dist ≥ 2, not a nest; medbay, quarters or storage | The best PER reads it first (`checkChance(per, .45)`). Open it (2.5 s); shoot it through the glass (only if read as hostile: a reserve kill, alarm 14); leave it | Inside (`POD`): a survivor 35, a hostile drone 35 ("frozen solid. Dead." if the reserve is empty), a sealed cache 30. |
  | **Dead crew** | 1–3 bodies in inside rooms, dist ≥ 1, not nests | Searched as containers ("Search the dead crewman") | Loot `body`: credits 3, ammo 3, stim 1, medkit 1, empty 3. One may carry the keycard. |

- **Encounter mechanics:**
  - `options` may be a function `(prop, world)`.
  - An option with `needs` is off when that kit count is 0; the card greys it with "nothing left in the kit for it".
  - If the assigned man goes down, the best man standing takes over.
  - A `back` option turns the squad around.
  - A turret or autodoc that was left stays clickable.

**Climbs never strand anyone** (`squad.js`):
- Under Standard the squad only drops to hold once the climb is over (`!sq.ladder`, cleared 1.4 s after everyone is up).
- **Stepping off:** at the top of a ladder or stairs the point man steps off toward the side with room for everyone (`stepOffSide()` flips the heading if the room ahead is shorter than the line).
- **Leader waits:** he waits short of a stopping feature (0.45 m) while anyone is still on the climb.
- **Followers pack:** if the landing is short, everyone closes up evenly between the top and him.
- **Errands:** a finished errand (going back for a man who has since died) is dropped at once on every route. If the man on a task becomes point, the task is dropped.
- **Door feature order:** welded → door controls; burning (not braved) → fire; locked → keydoor; then the old logic. A burning door is a stop.
- `slowest()` includes a leg wound, and `assignTask` skips men who are down or out of the line.

**World step additions:**
1. after the physics step: `updateAcid`;
2. after hazards: `updateSentries`, `updateMelee`, `updateMedic`, `gear.update`, `morale.update`;
3. after the airlock: `shipEvents.update`.

**New barks:**
- **Hive:** `ceiling`, `flank`, `stalker`, `flee`, `dragged`, `dropped`, `taken`, `screamer`, `screamed`, `scream_cut`, `birth`, `brood_dead`, `shy`, `spotted`.
- **Downed men:** `medic`, `reviving`, `revived`, `finished`, `going_back`.
- **Kit and drills:** `grenade`, `flare`, `barricade`, `covering`, `topup`, `shove`, `dressing`.
- **Ship events:** `power_out`, `fire`, `distress`.
- **Squad state:** `eat`, `order_ack`, `shaken`, `rallied`, `steady_squad`.
- **Renamed:** `focus_out` / `no_focus` become `energy_out` / `no_energy`.
- **Cooldowns:** e.g. ceiling 10, flank 12, birth 30, grenade 1, steady_squad 45.

**New events:**
- **Aliens and the hive:** `alien-climb`, `alien-drop`, `alien-vault`, `alien-flee`, `alien-return`, `alien-shy`, `flank`, `stalker`, `stalker-spotted`, `dragged`, `drag-dropped`, `taken`, `scream-start`, `scream`, `scream-cut`, `birth`, `brood-dead`, `spit`, `acid`.
- **Squad and wounds:** `downed`, `revive-start`, `revived`, `mended`, `dressing`, `shove`, `morale`, `energy`, `orders`.
- **Kit and cover:** `grenade`, `flare`, `kit-refused`, `barricade`, `barricade-down`.
- **Ship events:** `power-out`, `power-on`, `fire`, `fire-out`, `distress`, `distress-answered`.
- **Doors and vents:** `welded`, `cut`, `vent-welded`, `unlocked`, `keycard`.
- **Set pieces:** `sentry-online`, `sentry-shot`, `sentry-dry`, `hatch`, `eggs-burnt`, `eggs-shot`, `pod-opened`, `autodoc`.

**New interactables:**

| What | Id | Label |
|---|---|---|
| door controls | `k{portal}` | "Door controls" / "Cut the door open" |
| a vent | `v{id}` | "Weld the vent shut" |
| the distress beacon | `distress` | "Answer the distress call" |
| a burning doorway | `p{portal}` | "Deal with the fire" |
| a man down | `d{id}` | "Get NAME up" |
| the junction | | "Restore the power" |
| set pieces | | "Hack the sentry", "Use the autodoc", "Deal with the eggs", "Check the cryo pod", "Search the dead crewman" |
| a locked door | | "Unlock the door" |

---

## 8. Vision and physics

- **`vis/sight.js`:** one set of rules shared by gameplay and fog.
  - Eye at `x + facing·.15`, `y + (crouch ? 1.15 : 1.65)·scale`.
  - 360° **aura** of 6.5 m (+PER).
  - A **flashlight cone** of ±32°, reaching 22 m (the marksman 30, +PER), aimed by the weapon pitch. It reaches only 9 m with the flashlights off.
  - Nothing is seen while on a ladder.
  - `canSee` also needs a Rapier line of sight.
  - The aura is ×1.8 in a flared room and ×0.4 in a powered-out one (`roomAura`).
  - `bodyPoint(t, k)` gives the point to look and aim at, on the floor, a wall or the ceiling (7.12). `inBeam` is the torch cone alone.
- **`vis/polygon.js`:**
  - Angular-sweep visibility polygon from box edges near the eye, plus a range square.
  - Three rays per endpoint (±1e-4 rad).
  - Output is a Float32Array. Also provides `inside()`.
- **`physics.js`:**
  - Rapier 2D, gravity −18.
  - Groups `WORLD 1, MARINE 2, ALIEN 4, CRITTER 8, DEBRIS 16, PROP 32, SURVIVOR 64`, packed as `(membership<<16)|filter`.
  - All solids are cuboids on one fixed body. Door colliders toggle with `setEnabled`. Each room has a floor lip for debris.
  - Characters are **kinematic sensor hitboxes** moved each step (0.8 m wide marines, 0.9 aliens, 0.5 critters, 0.6 survivors).
  - `raycast` and `los` helpers.
  - Debris (casings, gibs, shrapnel): at most 90 dynamic bodies with CCD, oldest removed first.

---

## 9. Rendering (`src/render`)

- **Renderer:**
  - `WebGLRenderer({antialias: !retro, powerPreference: 'high-performance'})`, ACES filmic tone mapping, exposure 1.
  - Pixel ratio `min(dpr, 2)`; in retro mode 1/3 with CSS `image-rendering: pixelated` and camera snapping to texels.
  - Post chain: `RenderPass` → **Darkness (fog-of-war) ShaderPass** → `UnrealBloomPass(256², strength .55, radius .45, threshold .92)` → **Grade** pass → `OutputPass`.
  - The Grade pass applies a vignette (.9), film grain (.018), and a red edge pulse for damage (plus a pulsing red during the uplink).
- **Camera:**
  - Orthographic side-on at z = 60, **12.5 m view height**; the wheel zooms between 8 and 26.
  - Follows the **interpolated** squad centre plus a look-ahead of `heading·3.2`, with y at leader + 2.3. Easing: x `1-exp(-3.2dt)`, y `1-exp(-2.4dt)`.
  - Trauma-based shake and recoil kick.
  - Hit-stop and shake per event:

    | Event | Hit-stop | Shake |
    |---|---|---|
    | alien kill | .045 | .18 |
    | marine killed | .12 | .6 |
    | explosion | .06 | .75 |

- **Starfield:** a shader plane behind everything, with three parallax layers (two star layers with twinkle, one faint nebula). It shows through real window openings.
- **Level view:** each room is built from the roomkit and merged into **one batch per room** (`mergeGeometries` per material, mirrored pieces flip winding).
  - Back-wall panels every 2 m, weighted by room type (no two windows close together).
  - Lamps every 6 m, red or white. Blackout dims them to 20%.
  - On decks that can lose power, lamp fixtures are separate objects with their own materials, so a power failure can put them out (emissive ×.04, eased) and the pool lights fade.
  - Ceiling pipes and lamps; slime, biomass (nests) and cobwebs in corners (all on the `dress` stream).
  - Vents, ladders and stairs (mirrored), slabs with `floor_trim`, shaft rims, bulkheads with door frames, hull ends (`hull_airlock` / `hull_dock`), and outer plating above and below for the silhouette.
  - The dock room shows the `dropship`, `dock_tube` sections and bay lamps.
  - Every piece has a box fallback, so the game runs before any art exists.
  - **Doors** are roller shutters: `scale.y = 1 - open·.94`.
  - **Welds** are white-hot plates on doors and vents (emissive `0xff7a2a`, cooling over 5 s), removed when cut.
  - Doorway fires and flares get their own flickering lamps (fire `0xff6a20`, flare `0xff3a28`).
  - Set-piece props come from `props.glb`. The `cryopod_door` swings open; the `turret_head` turns to face its target.
  - **Props** are placed at their render depth. Lids and doors swing open on hinges (−1.7 rad, easeOutCubic) when searched.
  - Weapon cases glow in their rarity colour. Destroyed props swap to wreck models.
  - Flickering lamps mostly stay steady with occasional sags (no per-frame buzz).
- **Lights** (a fixed count, so shaders never recompile):
  - Hemisphere `0x6f86a0/0x1a1512` at .35, and a directional light at .25.
  - One **SpotLight flashlight per marine** (`0xeef2ff`, 32°, penumbra .6, intensity 45) at the light socket, aimed along facing and pitch. It dims when a squad-mate stands in front, with hysteresis, and sputters below 30 HP.
  - **Fake volumetric beam:** an open cone, additive shader `edge^1.5 × fall`, where `along` is clamped **before** `pow`, because a negative input gives NaN. It is scaled to the raycast distance to the first wall, so beams stop at walls.
  - **6 pooled lamp point lights** go to the nearest lamps. Slots fade out and in; they never pop.
  - **3 pooled muzzle lights** placed ahead of the barrel with a soft decay, and 1 blast light.
- **Fog of war (`visMask.js`):**
  - A 6 px/m world-space mask of the level. Each marine's visibility polygon is drawn with **MAX blending**, shaded by aura, torch cone and muzzle flash.
  - A persistent `explored` target accumulates `step(.06, mask)`.
  - The **Darkness pass** runs before bloom:
    - Visible areas are fully lit.
    - Explored areas are dim, desaturated and clamped.
    - Never-seen areas are black.
    - Space outside the hull is never darkened, and the docked Kestrel is always visible.
  - It also scrubs NaN/Inf with a **bit test** (`floatBitsToUint(c) & 0x7f800000u`), because the D3D compiler behind Chrome on Windows strips `isnan()`.
- **Actors:**
  - GLB characters are cloned with `SkeletonUtils.clone`, each with its own mixer.
  - Sockets are the `socket_*` nodes.
  - `M_Accent` materials are cloned and tinted per trooper. The `var_*` parts are shown per loadout.
  - **Breeds:** the alien's tint goes on every mesh but `M_Glow`, and its root is scaled per breed.
  - **Crawlers roll onto their surface:** upside down on the ceiling, or rotated ±90° onto a left or right wall. The roll slerps at `dt·12`. On the ceiling the 3/4 yaw is mirrored so the face still shows.
  - A man down lies in the `die` pose with his flashlight off. A man taken is hidden.
  - Flat shading, and a **rim light** injected via `onBeforeCompile` (marines `0xc8d8c0` × .16, aliens `0xb090ff` × .22).
  - **3/4 turn:** characters face ±X, turned 0.42 rad toward the camera, and turn their back to the camera on ladders.
  - 0.18 s crossfades. One-shots are die, reload, jump, hit, leap, signal and bash. `scream` is held for as long as the scream lasts.
  - Loops start at a per-entity phase. Switching between locomotion clips keeps the stride phase.
  - **Speed-matched locomotion:** `timeScale = actual/stride·cadence`, clamped .3–2.5; negative when backing up.
  - **Gait layer after the mixer** (height scale, lean, hip sway, bounce, swagger): re-applied from the mixer's own value each frame so it never accumulates on held poses (unit-tested).
  - Upper-body and head pitch follow the look; head glances over the shoulder.
  - Placeholders (capsule and box) are used when the art is missing.
  - Skinned meshes have `frustumCulled = false`.
- **FX (all pooled):**
  - Tracers (per weapon), star-shaped muzzle flashes, sparks (500), blood (500; alien acid green-yellow, human red).
  - Acid splat and scorch decals on the back wall (400-entry ring buffer).
  - Rapier casings and gibs.
  - Explosions (barrels and grenades): fireball shader, shockwave ring, 40 sparks, shrapnel, scorch, blast light, shake and hit-stop.
  - Kit and hazards:
    - grenades in flight (6 pooled, red blink);
    - acid globs (12, `0xb8ff40`) and pools (16, `0x88d020`, bubbling);
    - doorway fire (flame particles 70/s rising, smoke);
    - flares (red burn forever);
    - shove sparks;
    - egg burn;
    - cryo vapour;
    - weld and cut sparks.
  - A red damage vignette.
  - Prebuild the fireball pool so the first blast doesn't compile a shader.
- **Portraits:** render each trooper's head from the real 3D marine (`idle_alert`, perspective fov 24, 128² with MSAA, key + rim lights) into data URLs for the HUD, Command and Briefing screens. The fallback is an SVG helmet.
- **Performance:**
  - Under 300 draw calls, 60 fps in Chrome.
  - Mixer updates are skipped for characters out of view.
  - Shaders are precompiled at level start by making everything visible and calling `renderer.compile`.

---

## 10. HUD and screens (`src/ui`, DOM + CSS)

**Look.** The reference layout is a classic squad-shooter HUD:
- squad portraits top-left
- minimap top-right
- weapon and ammo bottom-left
- an icon action bar bottom-centre
- a big "OBJECTIVE:" block bottom-right

**Styling:**
- Font: Share Tech Mono, uppercase, letter-spacing .5px, 15px.
- CSS variables:
  ```
  --ink:#d7ddd0; --ink-dim:#8f9a8c; --panel:rgba(12,15,16,.82); --panel-solid:#111517; --edge:#4b5650;
  --edge-hi:#7d8a80; --hp:#5fa24a; --hp-dark:#213a1c; --warn:#d9a32b; --danger:#c6362a; --accent:#7fc25a;
  --glow:rgba(127,194,90,.35)
  ```
- `.panel` = `var(--panel)` background, 2px `--edge` border, shadow `inset 0 0 0 1px #000, 0 2px 8px rgba(0,0,0,.6)`.
- Breakpoint at 900px.

**Squad panel** (top-left): one row per trooper.
- 58px portrait with a "POINT" strip on the leader.
- Line: `RANK NAME` + archetype + `- HP: <b>hp/max</b> | AMMO: <b>n</b>`, with a status tag: KIA / **DOWN** (pulsing red) / PANIC / RELOADING / DRY. Plus a wound tag: LEG WOUND or ARM WOUND (`#e0a080`).
- The weapon name in its rarity colour.
- HP bar 260×9 with a lagging pale trail; it turns red below 35%.
- A 3px breath bar, 260 wide, blue, amber below 30%.
- 20 magazine pips.
- The portrait flashes red on damage. A man down has a red border and is greyed and darkened. The dead are greyed.

**Minimap** (top-right), a 300×120 canvas:
- Seen and explored rooms (nests tinted, powered-out rooms dark), doors (open or closed colours; a burning door is a flickering orange bar; a locked storeroom door is gold), ladders.
- The distress beacon, as a pulsing gold ring.
- Caches from intel, a pulsing objective triangle.
- Header: "DECK n · ROOMTYPE" and "x/y ROOMS · SEED".
- **Motion tracker:** blips for moving aliens and critters (including in vents) within 30 m (+5 per upgrade).
  - A sweep ring and **pings** faster as contacts close (0.35–1.4 s).
  - Seen blips are bright red; unseen ones fade with the sweep.

**Action bar** (bottom-centre), left to right:
1. **Cover [C]** (turns red "In cover" when on) and **Turn back [T]** (amber while pending). These are 62×58 icon tiles with gradient and inset bevel, and 36px stroke SVG icons.
2. **Kit buttons** in a column (`.kitb`, 122px): Grenade [Q], Flare [E], Barricade [B], each with its icon and what's left.
   - At 0 they dim.
   - Refusals toast "NO CLEAR THROW", "ROOM ALREADY LIT", "NO ROOM FOR IT" or "NO … LEFT".
3. **Orders bar:** seven `.ord` tiles, 92px, in two rows of 4 and 3: Route [R], Fire [F], Pace [G], Loot [L], Stims [H], Lights [V], Kit [K].
   - Each shows its short value: "Your call", "Direct", "Sweep"; "High alert" in `#f08060`.
   - The Fire tile carries the energy meter (`#e0a050`), with "(spent)" when alert is ordered but out. The Pace tile carries the most winded man's breath.
   - A click opens a menu above it with each option's detail. Options that don't apply are greyed ("Not with Standard orders").
   - The key cycles that order.

**Weapon panel** (bottom-left): rifle SVG, total squad rounds, credits (+salvage).

**Objective** (bottom-right, 21px, heavy shadow):
- `SHIPNAME · THREAT n`.
- "OBJECTIVE: REACH THE COMMAND DECK. {n}M TO GO.", then "UPLOAD NAV-LOCK. HOLD THE COMMAND DECK." with a cyan uplink bar.
- `CIVILIANS: n/m SAFE · LIFESIGNS: n` (or CLEAR).
- `STATE: HIGH ALERT/NORMAL/CAUTIOUS`.
- A status line (11px dim), replacing the old orders line and focus bar: `[AWAITING ORDERS · | MOVING ON YOUR ORDER · ] [RUNNING · ] ENERGY ▬ · MORALE STEADY|HOLDING|SHAKEN|BREAKING · N STIMS · N CHARGES [· KEYCARD] [· SENTRY]`.
  - "AWAITING ORDERS" is in the warn colour, pulsing, under Standard.
  - The energy bar is 60×5 and turns red below 25%.
  - Morale colours: steady `#9fe07a`, shaken `#f0a050`, breaking red.

**Toasts** (34px red glow, centre): "KESTREL 21 DOCKED - BOARDING" (at 0.3 s), then under Standard "YOUR CALL: CLICK A SPOT OR AN OBJECT TO MOVE THE SQUAD" (at 2.9 s, 4 s long), "CONTACT", "AMBUSH", "HOLD THE DECK", "FRIENDLY FIRE", "CIVILIAN LOST", "SHIP CLEAR", "LOCK CYCLED". From the newer systems: "NAME DOWN", "NAME DRAGGED", "NAME TAKEN", "SENTRY ONLINE" / "SENTRY DRY", "THEY'RE HATCHING" / "ONE HATCHED", "AUTODOC CYCLE", "SQUAD SHAKEN" / "SQUAD BREAKING" / "SQUAD RALLIED", "THE DECK IS AWAKE", "POWER FAILURE" / "POWER RESTORED", "FIRE".

**Loot cards** (right, border in the tier colour, stay 3.8 s):
- weapons;
- salvage ("Worth N cr if we get it home");
- survivors ("Heading for the Kestrel - keep the route clear");
- supplies ("Ration packs": +25 energy; "Energy drinks": +40);
- the keycard ("Somewhere aboard there's a door for this.");
- the brood mother killed (+120 cr);
- ship events ("Deck N: power failure", "A survivor on deck N", "Caller found").

**Barks:** speech bubbles anchored above heads (`socket_head`), 2.4 s, stacked so they never overlap.

**Interact layer (`interact.js`):**
- Hover within 34 px of an interactable shows a pulsing ring and a tag, e.g. "Breach the door ▸ click".
  - Ring colours: accent; orange for barrels, `#ff7a20` for fire, `#ffd060` for the distress beacon, red for a man down. Door controls and vents get a smaller 28px blue-grey ring.
- Under Standard, when nothing is under the cursor, **any point on the floor of a seen or explored room** is a target.
  - Screen → world through the camera bounds, clamped to the walk limits.
  - It shows a flat 46×14 ring on the floor and the tag "Move here".
  - A click sends `command('move', {room, x})`.
- A click sends `nudge`.
- A dashed amber spinning **ORDER marker** stays on the target until it's done.
- **Encounter card:** in-world, 340px, amber border.
  - Title and text.
  - Numbered options: label, note, and "who · NN%" coloured good ≥ 65% / bad < 40%. Options the kit can't pay for are disabled ("nothing left in the kit for it").
  - A draining 8 s clock and "or the squad follows its orders".

**Screens.** All screens are dark radial-gradient overlays. `h1` has a glow; buttons are accent-green.
- **Title:**
  - "HULL BREACH" plus two paragraphs:
    > A dead ship drifts in the dark. Your four-trooper boarding team enters at the rear airlock and must reach the command deck at the bow to lock its navigation core.

    > Pick the four who go and set their standing orders. Once aboard they run themselves - each by his own stats - and your part is to read the ship, pull them into cover when things come out of the vents, and turn them back when the way ahead is wrong.
  - A keys grid: C, T, Q E B (grenade, flare, barricade), K (kit), R F G (route, fire discipline, pace), L H V (loot, stims, flashlights), 1-3, Space, P, wheel.
  - CONTINUE CAMPAIGN / NEW CAMPAIGN (with a confirm dialog).
  - A seed input and QUICK PLAY.
- **Command** ("KESTREL 21 · COMMAND", credits / threat / extractions / kills): one two-column page.
  - **Roster** cards: 3D portrait, rank, name, level, rarity-coloured weapon, archetype chip, stat bars.
  - **Recruit** (three volunteers).
  - **Armoury**: click a stashed weapon, then a trooper.
  - **Choose derelict**: 3 offer cards with modifier chips, `DANGER ▮▮▯▯ · PAY ×r`.
  - **DEPLOY ▶**.
  - **Upgrades**: `■□□` tiers with prices.
  - **Memorial**.
- **Briefing** (shared by the campaign and quick play):
  - Pick 4 trooper cards; a slot strip reads POINT / #2 / #3 / REAR.
  - Line-up with ▲/▼ reordering.
  - **Ship intel** with the stats its anomalies call for: "Matters here: Accuracy, Nerve".
  - **Squad summary**: tech & medic (best INT), sharpest eyes (best PER), who sets the pace (worst SPD), who tires first (worst STA), and averages.
  - **Standing orders**: 4 preset buttons (Standard selected by default) plus segmented knobs.
    - The subtitle reads "you lead - they handle the rest" under Standard, else "the squad runs itself by these".
    - Under Standard, `disabledOptions` greys out every Route option and Loot "Search everything": the buttons are disabled at .3 opacity with a strike-through, the Route label gets an accent "your call", and a note explains why. The route is yours, and a squad that only moves on your word won't go looking for every crate, though they still search what they pass.
    - The preset text adds " · orders adjusted" when the knobs differ from the preset. Without a preset: "Custom orders - the squad runs itself."
  - DEPLOY ▶ / "PICK N MORE".
- **Debrief:**
  - "EXTRACTION SUCCESSFUL" / "SQUAD LOST".
  - Payout table (line items, total, balance) and recovered gear.
  - Squad cards: XP bar, promotions, stat bars with **growth**, "Stat a → b" with what earned it, and "Getting better at X NN%".
  - "RETURN TO THE KESTREL ▶".
- **Quick-play end screen:**
  - "NAV-LOCK SECURED / THE DERELICT IS OURS" or "SQUAD LOST / THE HULK CLAIMS FOUR MORE".
  - Stats table: time, troopers extracted, hostiles and vermin killed, caches looted, credits, rooms explored.
  - NEW SHIP / RETRY SEED.
- **Pause:** "PAUSED" overlay.
- **Debug overlay:** fps, render ms, draw calls, tris, aliens (active), debris, squad state, director phase.
- **Stat bars (`statbars.js`):**
  - 2-column grid of the 8 stats, each a 5px green gradient bar.
  - Banked practice shows as a gold sliver; a gold tick marks the growth ceiling (core + 3).
  - Gains shown as `+n`.

---

## 11. Audio: recorded CC0 effects over procedural WebAudio (`src/audio`)

**The mixer (`sfx.js`).**
- The AudioContext is created and unlocked on the first input.
- Chain: master .55 (M mutes) → compressor (−16 dB, ratio 6) → destination.
- One shared 1.5 s noise buffer.
- `out(x, vol, muffle)` handles every sound's position:
  - gain `vol × max(.08, 1 − |x − camX|/40)`;
  - stereo pan `clamp((x − camX)/18, ±.9)`;
  - optional 500 Hz lowpass for sounds heard through walls.
- `play(key, x, vol, {muffle, gap, rate, jitter, when, loop, take})` plays a recorded take at `vol × MIX[key]`.
  - It returns **false when that recording isn't loaded**, and the caller then **synthesises** the old procedural version instead.
  - So synthesis plays until each recording has loaded, stands in for anything missing, and is all you hear with `?sfx=synth`.
  - `gap` skips a repeat of the same sound within that many seconds, e.g. a pack waking at once.
- `MIX` (exported; each key must exist in the manifest and vice versa):
  ```js
  export const MIX = {
    ambience: 0.5, ambience_drone: 0.32, ambience_thud: 0.3, ambience_beep: 0.16, spark: 0.18, alarm: 0.16,
    shot_carbine: 0.55, shot_heavy: 0.7, shot_heavy_tail: 0.7, shot_breacher: 0.75, shot_marksman: 0.6, reload: 0.3,
    alien_hiss: 0.4, alien_growl: 0.45, alien_screech: 0.45, alien_attack: 0.5, alien_death: 0.35, alien_hit: 0.3,
    armor_hit: 0.3, explosion: 0.9, explosion_sub: 0.7, clang: 0.4, door: 0.4, airlock: 0.45, footstep: 0.2,
    tracker: 0.25, ui_prompt: 0.3, ui_ok: 0.3, ui_fail: 0.3, ui_order: 0.25, loot: 0.3,
  };
  ```
- **Guns:**
  - Each weapon has **its own shot budget**: skip when more than 10 are recent; decays 20/s. No gun can crowd the others out.
  - Recorded shots use pitch jitter .04.
  - The heavy's shots are cut dry out of a burst. A `shot_heavy_tail` (the room ringing after the last round) is queued `1.3/rate` s behind each shot and **cancelled by the same shooter's next shot**, so it only sounds when a burst stops.
- **Ambience:**
  - The synthesised hull drone (saws at 43 / 43.4 Hz + a 64.7 Hz triangle + noise, LP 180 Hz, 0.07 Hz "breathing" LFO) plays from the first gesture on its own fader.
  - Once the recordings load it fades out (τ 1.5 s) while two looping recorded beds (`ambience` stereo room tone + `ambience_drone`) fade in over 5 s.
  - Every 3–12 s, at a random x within ±24 m: 50% a terminal beep (40% muffled), 35% a muffled hull thud (rate .75–1.05), 15% a spark.
- **Uplink hold:** a muffled looping ship's siren (`alarm`), stopped on uplink-done, won or lost.
- **Distant sounds:** `distant(key)` plays muffled 18–32 m to one side at rate .85–.95. Build-up is a growl at ×2.2; waves are a screech.
- **Event → sound:**

  | Event | Recorded sound |
  |---|---|
  | shot | `shot_<weapon>` (+ heavy tail) |
  | hit on a prop | `armor_hit` ×.5 (gap .08) |
  | hit on a creature | `alien_hit` (gap .06) |
  | alien kill | `alien_death` |
  | critter kill | `alien_death` at ×.45, rate 1.6 |
  | marine or civilian death | low synth stinger |
  | alien-wake | 60% `alien_hiss` / 40% `alien_growl`, muffled if unseen |
  | alien-leap | `alien_screech` |
  | strike | `alien_attack` + `armor_hit` ×.8 |
  | explosion | `explosion` + `explosion_sub` |
  | prop destroyed, door forced | `clang` |
  | vent-emerge | `clang` + a wake sound |
  | vent-enter | `clang` ×.6, muffled |
  | door-work | `ambience_beep` ×2.5 (the door panel) |
  | door | `door` (closing: ×.8, rate .92) |
  | airlock-cycle | `airlock` |
  | reload | `reload` |
  | loot | `loot` |
  | encounter prompt | `ui_prompt` |
  | encounter success / failure | chime / `ui_fail` + stinger |
  | ambush | `alien_screech` + stinger |
  | ship-clear | `ui_ok` |
  | player order | `ui_order` |
  | footsteps | `footstep` (cadence by pace) |
  | tracker ping | `tracker`: ×1 with blips (rate `1 + max(0, 30 − nearest)/40`), ×.35 and rate .94 when clear |

  Still synthesised: the minor-triad stingers (ambush/win; low for death/loss), the stim hiss, UI click.

  The newer systems reuse the same sounds, with no new files:
  - **Aliens and the hive:**
    - drop → the leap screech;
    - climb → a soft clang;
    - scream → `alien_screech` slowed (rate .7), plus distant growls for those called;
    - a scream cut off → `alien_hit`;
    - birth → a slowed hiss + splat;
    - brood mother dead → a slowed `alien_death`;
    - dragged → a growl + the low stinger;
    - taken → clang + hiss;
    - flee and shy → short hisses;
    - spit → a pitched `alien_hit`;
    - acid → a sizzle of `spark`.
  - **Squad and kit:**
    - downed → the low stinger;
    - revived → `ui_ok`;
    - dressing → a quiet `ui_ok`;
    - morale getting worse → a stinger;
    - grenade → a clang at the thrower;
    - flare → slowed `spark`s;
    - shove → `armor_hit` + `alien_hit`;
    - barricade → clangs;
    - welds → `spark` + clang;
    - cut → `explosion_sub` + clang.
  - **Ship events:**
    - `power(on)`: a synthesised sawtooth sweep (170→28 Hz down, 40→150 Hz up) with a hull thud or `ui_ok`;
    - **burning doorways crackle**: band-passed noise bursts every 0.06–0.24 s;
    - distress → `ui_prompt` + a tracker ping.
  - **Set pieces:**
    - sentry online → `ui_ok` + tracker;
    - sentry shots → `shot_carbine` pitched up;
    - hatching → hiss + splat;
    - eggs burnt → slowed `spark`;
    - cryo pod opening → a pitched-up `airlock`;
    - autodoc → `ui_ok`;
    - keycard → `loot`;
    - unlocked → `spark` if cut, else `door`.
- **Procedural fallbacks** (the original sounds, kept as they were):
  - Gunshots per weapon, all noise + oscillator:
    - carbine: noise LP 3200→400 + square 140→50 + a HP tick
    - heavy: shorter, fatter
    - breacher: long low boom + pump clack
    - marksman: sharp HP crack + BP tail + square thump
  - Screech: saw + square + band noise; pitch .7 for death, 1.3 for a leap.
  - Also: claw, splat, door servo + clunk, metal clang (triangles at 320/471/689 Hz), reload (click, click, beep), footstep, tracker ping (pitch rises as contacts close), loot chime, explosion boom with debris ticks.

**The loader (`samples.js`).**
- After the first gesture, fetch `assets/audio/manifest.json` and decode every take (`decodeAudioData`), sound by sound. A failure only warns and that sound falls back to synthesis.
- `pick(key)` chooses a random take, **never the same one twice running**.
- `play()` jitters the pitch (±4% by default).
- **Every MP3 decodes with about 25 ms of encoder delay in front.** The manifest stores it per file as `lead`, measured at build time.
  - Playback starts at `lead`.
  - Loops use `loopStart = lead`, `loopEnd = lead + dur`, so they wrap inside the audio with no dropout.

**The recorded set (`public/assets/audio`).**
- 31 sounds, 107 takes, about 2.6 MB of MP3, all CC0. There were 30 and 102 before the polish pass added `shot_heavy_tail` and the eight carbine shots.
- `manifest.json` = `{version: 1, sounds: {key: {loop, files: [{file, dur, lead, from, url}]}}}`.
- `CREDITS.md` has a table of every file with its title, author, cut and source URL.

**The build pipeline (`tools/audio`, Windows + headless Chrome; needs `curl` and `unzip` on PATH).**
1. **`fetch-sfx.mjs`** downloads candidates into `tools/out/sfx-src` (git-ignored) and writes `sources.json`.
   - Freesound: fetch each sound page, **require `publicdomain/zero/1.0` on it**, then download the HQ preview (no account needed).
   - Packs, downloaded as zips and unpacked:
     - Kenney: `sci-fi-sounds`, `impact-sounds`, `interface-sounds`.
     - OpenGameArt: "60 CC0 sci-fi SFX", "50 CC0 sci-fi SFX", "80 CC0 creature SFX" 1 and 2.
2. **`analyze-sfx.mjs [filter]`** decodes every candidate in headless Chrome (Vite + puppeteer, OfflineAudioContext). It finds the separate events in each file (single shots in a burst, steps in a walk, hisses in a session), with their loudness and brightness, into `analysis.json`. A filtered run keeps the other entries.
3. **`build-sfx.mjs`** has a hand-tuned `SELECTION` of takes, cut points and loudness targets. It:
   - cuts and decodes in Chrome;
   - slices single shots out of a full-auto burst at each onset;
   - trims leading near-silence, so a gun starts on the shot and not on the click of its action;
   - applies fades (in 3 ms, out 40 ms by default);
   - **crossfades loops** so they don't seam;
   - normalises to a peak dBFS or RMS target, never above −1 dBFS;
   - mixes to mono (ambience stays stereo);
   - encodes with lamejs at 44.1 kHz (96 kbps mono, 128 kbps stereo);
   - measures each file's encoder delay by cross-correlating the decoded MP3 against its PCM;
   - writes the MP3s, `manifest.json` and `CREDITS.md`.

`SELECTION` (FS = Freesound id; K = Kenney pack file; OGA = OpenGameArt pack file):

| key | takes | target |
|---|---|---|
| ambience (loop, stereo) | FS 829563 "Spaceship_Ambience_Interior" 20–68 s, xfade 4 | RMS −21 |
| ambience_drone (loop) | FS 534018 "Sci-fi Ambient Drone" 15.2–48.9 s, xfade 3 | RMS −23 |
| ambience_thud | FS 402495 at 5.85–7.4, 7.5–9.6, 11.35–13.6, 16.1–18.6 | peak −3 |
| ambience_beep | OGA 50 sci-fi terminal_01,02,04–09 + beep_01–03; FS 431901, 363251 (.05–1.55), 260103 (0–1.5) | −6 |
| door | FS 543404, 543654 | −3 |
| airlock | FS 607265 3.35–8.7 (clunk, bang, hiss) | −2 |
| shot_carbine | FS 854226–854233 (qubodup M4A1 single shots), first .6 s, trim .25 | −1 |
| shot_heavy | FS 482122: 6 shots sliced from an ~11 rds/s burst, skipping 2 | −1 |
| shot_heavy_tail | FS 482122 1.37–1.598 | −6 |
| shot_breacher | FS 773873 (–.95), 473846 (–1.6), 418435 (.15–), trim .25 | −1.5 |
| shot_marksman | FS 163460, 351777 (.68–1.7), trim .25 | −1.5 |
| reload | FS 256912 (.5–3.45), 432141 (–1.95) | −3 |
| alien_hiss | FS 545484 at .7–4.8, 7.9–10.6, 45.1–49.2, 52.2–54.9; FS 763384 | −3 |
| alien_growl | FS 545484 at 20–21.5, 22.5–25.7, 27.5–31.1, 32.3–37.7 | −3 |
| alien_screech | FS 565024 (2.45–4.9), FS 556535 (.1–2.6, 7.35–9.32), OGA creature alien_02/03, creature-2 alien_07 | −2 |
| alien_attack | OGA creature-2 attack_02–04, creature alien_06 | −3 |
| alien_death | OGA creature-2 die_01–04 | −2 |
| alien_hit | OGA creature-2 slime_02/03/07, K sci-fi slime_000 | −8 |
| armor_hit | K impact impactPlate_heavy_000/001/003 | −4 |
| explosion | FS 609587, 244394 (–3.5, fade 1.2), K sci-fi explosionCrunch_001/004 | −1 |
| explosion_sub | K sci-fi lowFrequency_explosion_000 | −2 |
| clang | FS 209772 (.2–2.0), K sci-fi impactMetal_000/001/003, K impact impactPlate_heavy_000/002/004 | −3 |
| footstep | FS 698697, 7 single steps | −6 |
| tracker | FS 478187 at .15–.65, 1.21–1.71, 4.45–4.95 | −6 |
| alarm (loop) | FS 420661 0–8.3, xfade .4 | RMS −20 |
| spark | FS 396470 (3 cuts), FS 512471 | −4 |
| ui_prompt / ui_ok / ui_fail / ui_order / loot | K interface question_001 / confirmation_002 / error_003 / select_003 (–.25) / confirmation_004 | −6 (order −9) |

**The sound board (`sfx.html` + `src/sfxboard.js`).**
- Plays every game event through `Sfx.bind()` on a stub world, exactly as a run does, e.g. a burst at the weapon's rate from one shooter so the heavy's tail follows.
- Recorded / Synth switch, ambience toggle, position slider (−30..30 m).
- Every take listed with its source.
- `window.__sfx`.

---

## 12. Campaign (`src/meta`), the roguelike layer

- **Flow:** title → Command → Briefing → run → Debrief → Command.
  - Each run is its own page load (clean WebGL state).
  - The campaign lives in localStorage: key `hullbreach.profile.v1` (schema version 2, with `migrate()` from v1); the pending run is under `hullbreach.run.v1`.
  - **Reloading mid-run abandons the operation**: no rewards and nobody lost. There is no save-scumming.
- **Profile:** `{version: 2, seed, credits: 150, threat: 0, runs, wins, bestThreat, roster, squad, memorial, stash, upgrades, totals, seedCounter}`.
- **Levels:** XP thresholds `[0, 100, 250, 450, 700, 1000, 1400, 1900]`; ranks `PVT. PVT. CPL. CPL. SGT. SGT. LT. CPT.`.
  - XP: kill 12, survive 60, objective 90, rescue 40 each, clear 60.
- **Upgrades** (3 tiers each):

  | Upgrade | Costs | Effect |
  |---|---|---|
  | Armour plating | 150/320/600 | +10 HP |
  | Stim supply | 120/260/480 | +1 stim |
  | Suit cooling | 100/220/420 | +20% stamina |
  | Neural link | 140/300/560 | high alert burns energy 15% slower |
  | Tracker boost | 90/200/380 | +5 m tracker |
  | Salvage crew | 160/340/640 | +15% salvage value |

- **Settlement (`applyRun`):**
  - Credits recovered.
  - On a win, add:
    - salvage sold × salvage upgrade;
    - contract `(250 + 120·threat) × pay multiplier`;
    - civilians rescued × 200.
  - **A wipe keeps only 25% insurance.**
  - Each win raises **threat** by 1 (more hostiles, better loot and pay).
  - **Permadeath:** the dead go to the memorial with their rank, kills, ops, threat and cause.
  - Weapons brought home go to the stash if not common. Recruiting costs `90 + 30·alive` and is free below 4 alive.
- **Derelict offers (`ships.js`):** choose 1 of 3, seeded by `profile.seed/seedCounter` and stable until you deploy.
  - Sizes:

    | Size | Cols | Decks | Pay | Note |
    |---|---|---|---|---|
    | Corvette | 20 | 3 | −.15 | offer 0 is always one |
    | Freighter | 24 | 3 | ±0 | |
    | Cruiser | 28 | 4 | +.3 | +1 danger |

  - Each offer has 0/1/2 modifiers, weighted 2/5/3:

    | Modifier | Effect | Pay |
    |---|---|---|
    | Infested | hostiles ×1.4 | +.35 |
    | Blackout | "Main power is dead - flashlights only" | +.2 |
    | Treasure hauler | ×2.2 strongboxes and salvage | |
    | Armoury ship | ×2 weapons, +.6 luck | |
    | Distress call | +2 survivors | +.1 |
    | Hive ship | nests ×1.8, hostiles ×1.15 | +.25 |
    | Restless | calm ×.55 | +.25 |
    | Fuel leak | barrels ×2.2 | +.1 |

  - Names: `PREFIX NAME`, from prefixes ISV, MCV, FTR, CSS, UMS and names such as "Morrow's Lament", "Quiet Meridian", "Cold Harvest", "Saint Adair", "Long Dark", "Veritas Drift", "Iron Orison", "Pale Lantern", "Hollow Crown", "Kepler Widow", "Ninth Ember", "Grace Under Ice".
- **Troopers (`candidates.js`):**
  - Eight **archetypes** on an equal **44-point budget**, so none is strictly better. Core stats in the order STR SPD STA ACC PER INT NRV LCK:

    | Archetype | Description | STR | SPD | STA | ACC | PER | INT | NRV | LCK |
    |---|---|---|---|---|---|---|---|---|---|
    | veteran | "Steady all-rounder" | 6 | 5 | 6 | 6 | 6 | 5 | 6 | 4 |
    | heavy | | 8 | 3 | 8 | 5 | 5 | 4 | 7 | 4 |
    | breacher | | 7 | 6 | 6 | 4 | 5 | 4 | 8 | 4 |
    | marksman | | 4 | 5 | 5 | 9 | 7 | 5 | 5 | 4 |
    | scout | | 4 | 7 | 6 | 5 | 7 | 5 | 5 | 5 |
    | tech | "Locks, terminals, searches - fragile" | 4 | 5 | 5 | 5 | 6 | 9 | 5 | 5 |
    | medic | | 4 | 5 | 6 | 4 | 6 | 8 | 6 | 5 |
    | rookie | "Green and jumpy, but born lucky" | 5 | 6 | 6 | 5 | 5 | 5 | 4 | 8 |

  - Candidates jitter two points without breaking the budget.
  - **Looks follow stats:** height from STR; cadence, lean and bounce from SPD; sway from STR; swagger from NRV.
  - Names come from 24 surnames (VOSS, REYES, OKAFOR, LINDQVIST, MARSH, IBARRA, KANE, …) and tints from 8.
  - The **starting four** are fixed: VOSS (veteran), REYES (heavy), OKAFOR (breacher), LINDQVIST (marksman), with the config tints and profiles. Voss starts at XP 250.
  - Quick play offers 8 seeded candidates (one per archetype, ids `c0..c7`).
- **Learning by doing (`growth.js`):**
  - At the debrief, practice becomes stat points.
  - Base cost per point at stat 5:

    | Stat | acc | per | int | str | sta | spd | nrv | lck |
    |---|---|---|---|---|---|---|---|---|
    | Cost | 50 | 12 | 8 | 4 | 3 | 4 | 5 | 2 |

  - Costs scale `×max(.5, 1+.3·(v-5))`, so they are cheaper where the trooper is weak.
  - Stats cap at core + 3 (and 10). Leftover practice banks as progress.
  - Tune so an active trooper earns about 1–2 points per mission early on.

---

## 13. Blender art pipeline (`tools/blender`, headless Blender 5.2 via CLI)

### Runner and checks
- **`tools/run-blender.mjs`:**
  - Finds Blender via `BLENDER`, else the newest `C:/Program Files/Blender Foundation/Blender*/blender.exe`, else `blender` on PATH.
  - Builds `ASSETS = marine, alien, critter, survivor, props, roomkit, dock`, or only the ones named on the command line. `--preview` also renders contact sheets to `tools/out/previews/`.
  - Runs 3 workers, each doing `blender --background --factory-startup --python-exit-code 1 --python tools/blender/<asset>.py -- --out public/assets/models [--preview tools/out/previews]`.
  - Prints `✔ asset (secs)` plus lines starting with `EXPORTED|PREVIEW|WARN|STATS`; on failure, `✘` plus the last 40 lines.
  - Merges every `*.meta.json` into `manifest.json = {built: Date.now(), models}`.
- **`tools/check-glb.mjs`:** parses each GLB's JSON chunk and verifies:
  - every clip, socket and node named in the meta exists;
  - skins are present when there are clips;
  - every primitive has `COLOR_0`.
  - It prints tris, clips and materials.
- **Loader:** `GLTFLoader().setMeshoptDecoder(MeshoptDecoder)`. It loads `manifest.json`, then each file with `?v=built`.
- **Viewer (`viewer.html`):** models and clips list, speed slider, turntable, tri/height/socket stats, game lighting, `?model=&clip=&t=&yaw=` for screenshots, `window.__viewer`.

### Library (`tools/blender/lib`)

| Module | Contents |
|---|---|
| `common.py` | `script_args()`, `reset_scene(fps=30)`, `material(name, roughness, metallic, emissive, strength)` |
| `rig.py` | `build_armature`, `skin`, `socket` |
| `anim.py` | `Clip(arm, name, frames, loop, **meta).cycle([...poses]).done()` |
| `chars.py` | math helpers, mesh primitives, `Poser`, `sampled_clip`, review renders |
| `env.py` | environment `Geo` builder, palettes, grime, shape helpers, contract checks, preview sheets |
| `export.py` | `export_glb`, `write_meta`, `bounds` |
| `preview.py` | Workbench renders |

- **`common.py`:**
  - `material(...)`: Principled BSDF with a `Color` vertex-colour node wired into Base Color, so the exporter writes `COLOR_0`.
  - `paint(obj, rgb, jitter, ao)`: per-face colour jitter plus a fake AO that darkens downward faces, stored in a `Color` BYTE_COLOR corner attribute.
  - `weather(obj, worn="#9a968a", dirt="#2a2419", chip=.7, fleck=.03, grime=.9, mud=.35, scorch=.05, stains=True, seed=None)`: battle wear on top of `paint()`. It is deterministic, seeded by `zlib.crc32(obj.name)`.
    - **Chips:** bevelled faces are chipped back to `worn` (mixed .4–.8 with probability `chip`). `_bevel` tags them in an `edge` int face layer.
    - **Flecks** elsewhere (`fleck`, mixed .15–.3).
    - **Scorches** (shade .4–.65).
    - **Stains:** soot and dust on a 0.13 m world-cell crc32 hash.
    - **Mud** on faces below `mud` (40%).
    - **Grime** rising from the boots: `((grime−z)/grime)^1.3 · U(.55, .85)`.
  - bmesh primitives: `box` (with bevel and taper), `cyl`, `sphere` (with `cut`), `prism`, `merge`.
  - `part(name, bm, mat, rgb, bone)`: a coloured object whose vertex group is 100% weighted to one bone (rigid skinning).
  - `join`.
- **`rig.py`:**
  - `build_armature(name, [(bone, head, tail, parent)])`: every bone's local X = world +X, so rotating +a° about X swings the tip up → forward (−Y) → down → back.
  - `skin(parts, arm)`: join the parts and add an Armature modifier.
  - `socket(name, arm, bone, world_loc)`: an empty parented to the bone. Call `view_layer.update()` first.
- **`anim.py`:** Blender 5 **slotted actions**.
  - Key `rotation_euler` and `location` of **every bone at every key**, so nothing stale leaks between crossfades.
  - Give each action a fake user and stash it in a muted NLA track.
  - `done()` returns the meta `{name, loop, duration, ...}`.
- **`chars.py`:**
  - Math helpers and eased `curve()` keyframing.
  - Mesh primitives: `limb` (tapered, twisted), `plate`, `lathe` (surface of revolution), `arc_band`, `shard` (curved spike), `shell` (chitin band), `mirror_x`.
  - `Poser`: FK over rest matrices, plus an analytic **two-bone IK** with pole and hinge, a `tip` offset so fists land on grips, and `follow()` for shoulder pads.
  - `sampled_clip(arm, poser, name, frames, fn(t), step)` keys a pose function.
  - Review renders: `review_sheet`, `turnaround`, `lineup`.
  - `paint_camo`.
- **`env.py`:**
  - `Geo(seed)` builds static meshes deterministically with baked lighting: top faces brighter, down faces darker, key light from the upper left.
  - Palettes `PAL`, emissive `GLOWS`:

    | Material | Colour | Strength |
    |---|---|---|
    | `M_Glow` | teal | 1.4 |
    | `M_GlowRed` | | 3.0 |
    | `M_GlowWhite` | | 2.2 |
    | `M_GlowAmber` | | 2.0 |
    | `M_GlowBlue` | | 1.6 |
    | `M_Rarity` | white, tinted by the engine | 1.6 |

  - Grime: `wall_grime` / `prop_grime` darken low and high edges and add noisy stains.
  - Shapes: `bx`, `tube` / `pipe` / `sag` (cables), `studs` (rivets), `inset`, `ring`, `chamfer_rect`, `stripes` (hazard), `blob` / `lump` (organics).
  - `stencil(text)` in a 5×7 pixel font ("SUPPLY 7", "AMMO", "DANGER", "KESTREL"…).
  - Contract checks: `check_extent`, and `check_clear`, which casts BVH rays to prove an opening is see-through.
  - Labelled preview `sheet`s ("Standard" view transform; AgX washes the dark palette out).
- **`export.py`:** exporter options, exactly:
  ```python
  GLTF_OPTS = dict(export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
    export_skins=True, export_animations=True, export_animation_mode="ACTIONS",
    export_force_sampling=True, export_optimize_animation_size=True,
    export_anim_single_armature=True, export_vertex_color="ACTIVE", export_image_format="NONE",
    export_cameras=False, export_lights=False, export_extras=True,
    export_meshopt_compression_enable=True)   # EXT_meshopt_compression: 4.5 MB -> 2.5 MB
  ```
  - Drop options the running Blender doesn't know, with a `WARN`.
  - `write_meta(out, name, meta)` writes `<name>.meta.json` with **LF line endings** (`newline="\n"`).
  - `bounds` returns an AABB in glTF axes.
- **`preview.py`:** Workbench, vertex colours, cavity, orthographic camera. `contact_sheet` renders one row per clip.
- **Smoke test:** `spike.py` is a 2-bone test GLB with 2 clips, written to `tools/out/spike`.
- **Scene mock-ups:** `mockup.py` renders a room and the docked ship at game scale.

### Conventions
- 1 unit = 1 m. Blender Z is up. glTF export maps Blender (x, y, z) to three.js (x, z, −y).
- Characters face **−Y** in Blender (+Z in three.js). The game camera looks from Blender −Y, so **front faces carry the detail**, and back (+Y) faces are culled on the environment.
- Clips are **in place**; the stride speed at 1× goes in the clip meta `speed` (m/s, vertical for climb).
- Material names the engine depends on:
  - `M_Base`: vertex-coloured.
  - `M_Accent`: light neutral colours that the engine multiplies by the trooper tint.
  - `M_Glow*`: emissive, blooms in game.
  - `M_Rarity`: tinted by the engine.
- Keep palettes dark and desaturated; let emissives and flashlights carry the contrast.
- **Print `STATS` tri counts and enforce budgets. Render previews with `--preview` and look at them before committing art.**

### Asset contract (`tools/blender/README.md`; the engine depends on these names)

**`marine.glb`: power-armoured trooper.**
- About 2.1 m, feet at z = 0. **Grimdark power armour**:
  - massive studded pauldrons riding high (`PAD_GROW (1.13, 1.13, 1.1)`, lifted 3.5 cm, brass rivets round each rim);
  - a tall gorget the helmet sits down in (with a `GorgetFront`);
  - a brass **winged-chevron** unit badge on the chest;
  - red-wax **oath seals** with parchment strips (thigh, left pad);
  - heavier vambraces, cuffs, gauntlets, greaves and boots;
  - a backpack with exhaust stacks.
- Every part except the glows goes through `weather()`: chip .7 / fleck .03 on hard parts, 0 on leather, cloth, black, dark, parchment and wax; scorch .03 / .06. **Battered and grimy. Original designs: no third-party insignia.**
- Rig: 20 bones (hips, spine, chest, head, and per side pad, upper_arm, forearm, hand, thigh, shin, foot), plus `gun` and `mag`.
- **Clips** (30 fps):

  | Clip | Duration | Loop | Speed / notes |
  |---|---|---|---|
  | `idle_casual` | 2.4 | loop | |
  | `walk_casual` | 1.0 | loop | speed 1.72 |
  | `run` | 0.7 | loop | 3.27, port arms |
  | `idle_alert` | 3.0 | loop | head scan |
  | `walk_alert` | 2.0 | loop | 1.72 |
  | `crouch_alert` | 2.4 | loop | kneel |
  | `crouch_walk` | 1.1 | loop | 0.88 |
  | `aim` | 2.0 | loop | |
  | `walk_aim` | 0.9 | loop | 1.19 |
  | `shoot` | 0.4 | loop | 3 recoil kicks |
  | `crouch_aim` | 2.0 | loop | |
  | `crouch_shoot` | 0.4 | loop | |
  | `aim_up` | 2.0 | loop | covering a shaft above |
  | `aim_down` | 2.0 | loop | kneeling at a hatch |
  | `signal` | 1.2 | once | fist raised, 2 pumps: "clear" |
  | `reload` | 2.2 | once | mag drops, new mag, rack the charging handle |
  | `jump` | 0.67 | once | |
  | `climb` | 0.73 | loop | vertical 1.43, rungs 0.35, back to camera, weapon slung |
  | `interact` | 1.6 | loop | bent over, searching |
  | `hit` | 0.4 | once | |
  | `die` | 1.4 | once | ends face-down, gun dropped; also the pose of a man down |
  | `bash` | 0.47 | once | the shove: a stock strike with a step in |

  Hands are **IK-planted on shared grip points**. Casual carries the muzzle about 45° down, alert at the hip, engaged shouldered.
- **Loadouts:**
  - `marine_base` plus 16 variant meshes on the same armature, `var_{helmet,pads,pack,weapon}_{...}`.
  - Helmets, pads and packs: `command|heavy|breacher|marksman`. Weapons: `carbine|heavy|breacher|marksman`.
  - All weapons share the grip and fore-end points.
  - Variant designs:
    - **command:** rebreather snout, crest, antenna, half-cape, comms mast with a beacon.
    - **heavy:** bucket helm with a visor slit, 3-lame pauldrons, ammo drum and feed belt.
    - **breacher:** gas mask with filters, asymmetric big left pad, breaching charges.
    - **marksman:** scope monocle, camo hood and cowl, sensor pod.
- **Sockets:**
  - `socket_muzzle_<w>` / `socket_light_<w>` per weapon; plain `socket_muzzle` / `socket_light` are the carbine's.
  - `socket_eye`.
  - `socket_head`, about 0.3 m above the helmet, for barks.
- **Budget:** base + one loadout ≤ 6.5k tris; whole file ≤ 13k (built: base 2.2k, loadouts about 4.1–4.5k).
- **Palette:**

  | Part | Colour |
  |---|---|
  | olive armour | `#40472f` / `#323827` / `#4c533a` (camo for the marksman: `#454d34 #3a3f2a #5c5238 #2d3124 #615c42`) |
  | brass trim | `#7d6232` |
  | parchment / wax | `#c4b48a` / `#7a1712` |
  | black undersuit | `#16181a` |
  | gunmetal | `#2c3034` |
  | dark-red casing | `#5c1a17` |
  | tintable accent | `#bdb6a4` |
  | visor lenses | red glow `#ff3a22` |

**`alien.glb`: original four-armed hunched predator** (mantis-like).
- Anatomy: scythe forelimbs above small grasping hands, digitigrade legs, a banded tail, an arrow-head skull with horns and fangs, three pairs of small glowing eyes, glowing gill slits.
- About 1.6 m hunched and 2 m long. 30 bones, ≤ 5k tris (built: 3.6k).
- **Clips:**

  | Clip | Duration | Loop | Notes |
  |---|---|---|---|
  | `idle` | 2.4 | loop | |
  | `lurk` | 3.0 | loop | low dormant breathing |
  | `skitter` | 0.4 | loop | speed 5.94; runs on four limbs using the blade tips |
  | `climb` | 0.5 | loop | speed 3.2 |
  | `leap` | 0.47 | once | |
  | `attack` | 1.7 | loop | meta `swing: .85`; alternating claw swings |
  | `hit` | 0.37 | once | |
  | `die` | 1.2 | once | |
  | `scream` | 1.2 | held for the scream | rears back, jaw wide, claws spread, shaking |

- The engine scales and tints it per breed (7.12) and rolls it onto walls and ceilings.
- Sockets: `socket_head`, `socket_mouth`. Materials: `M_Base`, `M_Glow`.
- Colours:

  | Part | Colour |
  |---|---|
  | bone-white chitin | `#c9bda0` |
  | violet-crimson flesh | `#3a1c2e` |
  | gums | `#6a2030` |
  | sickly-yellow eyes | `#ffd23a` |

**`critter.glb`: six-legged vermin.**
- About 0.5 m, ≤ 800 tris (built: 734).
- Pale grub body `#d2c4a2` with a dark chitin plate and mandibles.
- Clips: `idle` 2.0, `scurry` (speed 1.92, alternating tripod) 0.33, `die` 0.8 (rolls onto its back).

**`survivor.glb`: stranded engineer.**
- 1.75 m, about 1.9k tris.
- Pale jumpsuit on `M_Accent`, orange hi-vis vest, hard hat with a glowing lamp, tool belt, breather mask.
- Clips:

  | Clip | Duration | Loop | Notes |
  |---|---|---|---|
  | `cower` | 2.0 | loop | |
  | `idle` | 3.0 | loop | hand-wringing |
  | `walk` | 0.8 | loop | 1.7 |
  | `run` | 0.6 | loop | 3.33, flailing |
  | `wave` | 1.5 | once | |
  | `hit` | 0.4 | once | |
  | `die` | 1.33 | once | falls on its back |

- Sockets: `socket_head`, `socket_light`.

**`props.glb`: one top-level node per prop.**
- Origin at the floor-contact centre; width along X within ±10% of `w`; front face at −Y, centred on y = 0.
- **Hinged child** `<kind>_lid` or `<kind>_door`, with its origin at the hinge. Lids rotate about local X, doors about local Z.
- Budget 1500 tris (3000 for `reactor` and `control_panel`).
- Nodes (w in m):

  | Node | w | Notes |
  |---|---|---|
  | `crate` | 1.2 | stencil "SUPPLY 7", contents |
  | `locker` | 1.0 | 2.2 m tall; helmet and fatigues inside, keypad glow |
  | `chest` | 1.3 | |
  | `cabinet` | 1.4 | wall-mounted at z 1.0, red cross, "MEDICAL" |
  | `ammo_rack` | 1.6 | grille door |
  | `barrel` | 0.9 | hazard band, slime ooze |
  | `bigcrate` | 2.6 | 2.2 m corrugated container |
  | `console` | 1.8 | glowing keys and screens |
  | `bunk` | 2.4 | |
  | `medbed` | 2.4 | ECG arm |
  | `shelf` | 2.0 | |
  | `table` | 2.2 | |
  | `reactor` | 3.4 | 4 m tall, teal glowing rings |
  | `pilot_seat` | 1.2 | |
  | `control_panel` | 2.4 | 48 glowing buttons, nav screen, beacon, "NAVIGATION CORE" |
  | `debris` | 1.5 | wreckage pile about 0.8 m high; the squad jumps it |
  | `beam` | 1.8 | fallen girder from 1.3 to 2.2 m; the squad crouches under |
  | `airlock_hatch` | 1.0 | pillar with a red lamp |
  | `barrel_explosive` | 0.9 | red with yellow bands, "FUEL" |
  | `barrel_wreck` | 1.0 | burst petals, soot, embers |
  | `console_broken` | 1.8 | |
  | `weapon_case` | 1.4 | `M_Rarity` strip, rifle on pegs |
  | `safe` | 1.0 | strongbox: gold, data cores, "CAPT" |
  | `scorch` | 2.0 | wall decal |
  | `barricade` | 1.2 | an olive plate leaning back 7° on struts, vision slit, studs, "SHIELD-4" |
  | `turret` | 1.0 | pedestal sentry; child **`turret_head`** (twin barrels along +X, red sensor eye, "SENTRY") that the engine mirrors to face its target |
  | `eggs` | 1.6 | a resin mat of five veined eggs, two split and glowing inside, slime |
  | `cryopod` | 1.3 | 2 m pod with a figure-shadow inside, blue glow strips, "CRYO-3"; hinged frosted **`cryopod_door`** |
  | `body` | 2.0 | a dead crewman face down in an orange suit, blood, a lit torch, an ID card on a lanyard |

- A `validate()` step warns on width, floor, centring, origin and hinge errors.

**`roomkit.glb`: modular level pieces, one top-level node each.**
- Deck interior 4.5 m high. Depth runs from the back wall at y = +2.0 (three.js z −2) to the front floor edge at y = −1.0. Pieces are placed only at (x, deck floor), so **model each at its correct depth**.

  | Node | Extent / notes |
  |---|---|
  | `wall_plain`, `wall_pipes`, `wall_vent`, `wall_window`, `wall_screen`, `wall_shelves`, `wall_hazard` | x ∈ [−1, 1], z ∈ [0, 4.5], back face at y = 2.0, relief to y = 1.55. Shared frame bands: kick, lower panel, rail at 1.45–1.6, upper panel, conduits at 3.87/3.99, sloped cornice 4.1–4.5, half-ribs with studs. `wall_window` has a **real opening** (about 1.4 × 1.6 m at z ≈ 2.5) that the starfield shows through. |
  | `floor_trim` | x ∈ [−1, 1], z ∈ [−0.5, 0], y ∈ [−1, −0.9] (the engine builds the slab) |
  | `ceiling_pipes`, `ceiling_lamp` | hanging from 4.5 down to at most 3.7 |
  | `bulkhead_door` | x ±0.3, full depth, solid lintel from z 3.0, posts only at the back, so the opening is **see-through** |
  | `bulkhead_solid` | |
  | `door_panel` | x ±0.25, z 0–3, y −0.9..1.6, **origin at the top centre**. A roller shutter with horizontal slats and hazard edges; the engine scales it along Z (0.05 = open). |
  | `hull_end`, `hull_airlock` | x ±0.6, z −0.5..4.5; `hull_airlock` has a big round outer hatch |
  | `ladder` | rails at y ≈ 1.45, rungs every 0.35, rises 5 m plus a 1 m handrail |
  | `stairs` | x 0..5 rising 0 → 5, y 0.6..1.6, railing on the −Y side; rises toward +X (the engine mirrors it) |
  | `shaft_rim` | |
  | `vent_wall` | |
  | `vent_ceiling` | |
  | `lamp_red`, `lamp_white` | at z ≈ 3.6 |
  | `slime` | green drips `#56782c` |
  | `cobweb` | corner fan |
  | `biomass` | purple-brown resin with sacs and amber pustules; marks nests |

- Budget 1500 per piece.
- Environment palette:

  | Colour | Hex |
  |---|---|
  | back wall | `#15181a` |
  | ribs | `#262a2e` |
  | gunmetal panels | `#353a3e` / `#2f3337` |
  | steel | `#484f55` |
  | rust | `#5a3a22` |
  | hazard yellow | `#a8852a` |
  | pipes | `#3e454b` |
  | cables | `#131416` |

  Plus teal / white / red lamps. Heavily bevelled industrial shapes, rivets, pipes, cables, grime.

**`dock.glb`: the boarding intro.**
- **`dropship`:** the *Kestrel 21*, in cut-away. A troop bay with 2 × 5 harness seats, a weapon rack, jump lights, and stencils "21" and "KESTREL"; a nose out to x −18.3; thrusters. Max x at 0, about 6k tris.
- **`dock_tube`:** 2 m tiles of rubber bellows with steel hoops and running lights.
- **`hull_dock`:** the derelict airlock hull with a walk-through doorway, a seal ring and clamps.
- Military palette: blue-grey `#46505c` and yellow `#c9a13a`.

---

## 14. Tools and tests

- **`tools/shot.mjs`:** headless-Chrome screenshots via puppeteer-core.
  - Starts a Vite server on a free port.
  - Chrome is found via `CHROME`, the default Windows Chrome path, or Edge.
  - Flags: `--use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`, or `--swiftshader`.
  - Options: `--q --out --size 1600x900 --eval --until --timeout --wait --shots --interval --clip x,y,w,h`.
  - Waits for `__game.ready` or `__viewer.ready` and saves to `shots/`.
  - Echoes console errors, prints `__game.state()`, and exits 1 on page errors.
- **`tools/dev/balance.mjs [N] [--json] [--doctrine=direct|recon|assault|salvage] [--squad=all5|starters|random] [--mortal]`:** plays N seeds headless (god pass, then mortal pass).
  - The default doctrine is `direct` (`DEFAULT_DOCTRINE`). Standard is refused: it never moves without a player.
  - Reports won / lost / stuck, average time, kills, dead per run, rooms, loot.
- **`tools/dev/threat.mjs`:** the threat ladder 0–5 over campaign offers.
- **`tools/dev/campaign-e2e.mjs`:** drives title → new campaign → deploy → briefing → autoplay run → debrief → Command in headless Chrome, with screenshots. It picks the **Assault** preset in the briefing, so the run plays itself.
- **`tools/dev/flicker.mjs [seed] [seconds] [--calm] [--fixedcam] [--room=] [--min=] [--after=]`:** plays in real time and flags regions that flash dark or bright for 1–2 frames.
  - Box-filters 8×8 blocks and interpolates neighbours by the render clock.
  - **Compensates for camera motion.**
  - Writes frame, previous-frame and diff PNGs.
- **`tools/dev/nanhunt.mjs [seconds] [--off]`:** reads back the HDR buffer every frame and counts Inf/NaN half-floats.
- **`tools/dev/sfx-levels.mjs`:** plays each `/sfx.html` event in headless Chrome and measures its loudness at the master bus, recorded vs synthesised, for balancing `MIX`.
- **`tools/dev/sfx-audit.mjs [seed=A1] [seconds=120] [speed=1]`:** plays a ship in real time (autoplay, god, HMR off) and accounts for every sound:
  - simulation events emitted;
  - sounds started, recorded or synthesised;
  - sounds dropped (shot budget, repeat gaps);
  - each gun's actual level in the mix;
  - how hard the master compressor works.
  - Every shot should play; none dropped.
- **Tests** (vitest; `beforeAll(initPhysics)`; step 1/60):
  - **`gen.test.js`:**
    - RNG determinism.
    - Level determinism.
    - **400 seeds `T0..T399`:** every room reachable; main path ≥ 9 from the airlock (deck 0) to the cockpit (top deck); props inside walk limits and outside clear zones; doors on the same deck; verticals span exactly one deck inside both rooms; no aliens within 2 rooms of the airlock; the squad spawns in the dock.
    - Routes on 80 seeds; the vent route ≤ the marine route.
  - **`sim.test.js`:**
    - Trail sampling and reversal.
    - Each ROE targets the right things (cautious return-fire only; normal hits moving unidentified survivors; alert hits sleepers).
    - Autoplay + god wins seeds A1–F6; mortal G7–I9 run 900 s without error.
    - The airlock door opens.
    - Leader death mid-ladder: walkers stay on floors and the squad still wins.
    - One climber at a time with shaft cover.
    - Door drill poses.
    - "Clear" after a fight, then casual.
    - Four distinct weapons; the breacher fires 7 pellets.
    - Barrel chain reaction.
    - No strikes without line of reach; a closed door blocks.
    - Regroup at the top.
    - Turn-around swaps the leader.
    - Formation statistics: gap variance, min gap ≥ 0.8, pitch range, look kinds, checks of six, kneeling.
  - **`doctrine.test.js`:**
    - Preset round-trip.
    - Every autonomous preset (Recon, Assault, Salvage) wins A1 / C3 / E5. Standard is tested in `manual.test.js`.
    - A thorough route visits more rooms.
    - Loot leave vs all.
    - Pace fast / stealthy.
    - Stims early vs hoard.
    - The specialist walks up and returns.
    - Nerve panic rates (all-5 never; a steady mate cuts it).
  - **`encounters.test.js`:** placement determinism and frequency; terminal download maps the ship; hack odds rise with INT; timeout auto-choice; autoplay wins encounter ships.
  - **`nudge.test.js`:** nudged door, crate under "leave", barrel shot only when blast-safe; nudge input replays identically.
  - **`meta.test.js`:** starters; win and loss settlement (25% insurance, memorial); recruiting; v1 → v2 migration; upgrades; stash equip; offers stable and playable; campaign squad deploys; all-5 = neutral mods; stat directions; 44-point budget; candidate pool; growth costs and caps.
  - **`manual.test.js`** (Standard, point and click):
    - `disabledOptions` / `fitOrders`.
    - The squad holds for 30 s without orders.
    - "Board the derelict", then a floor click in the airlock: they go there, stop and hold.
    - A clicked door is breached and passed, then they hold on the far side.
    - An encounter waits well past its 8 s clock until the player chooses; then they hold.
    - Turn around reverses the line and holds.
  - **`audio.test.js`:**
    - The manifest's sound keys equal `MIX`'s keys.
    - Every sound `sfx.js` plays by name (`play('…')` / `distant('…')`) is in `MIX`, plus `shot_<weapon>` for every weapon.
    - Every file exists with `dur > .05` and `lead` between 20 and 50 ms.
    - Every source URL is on freesound.org, kenney.nl or opengameart.org, and every file is credited in `CREDITS.md`.
    - The whole set is under 4 MB.
  - **`aliens.test.js`:**
    - breed stats differ (brute HP > 2× drone, slower, harder claws; runner faster and smaller);
    - brutes are ≥ 1.8× commoner at depth;
    - all 7 breeds appear over 40 ships, with > 5 sleeping on ceilings and > 2 on walls;
    - ceiling spans avoid shaft openings;
    - `bodyPoint`;
    - real runs with > 5 drops and every strike from the floor;
    - a crawler shot dead falls; stagger knocks it off.
  - **`hive.test.js`:**
    - flank;
    - a stalker strikes on a reload and follows between rooms;
    - hit and run heals;
    - creepers shy of torches;
    - runners hear further;
    - drag, let go, taken;
    - scream and cut, waking only sleepers in range;
    - the squad targets a screamer first;
    - the brood mother: at most one, in the deepest nest, birthing from the reserve, paying her bonus.
  - **`cover.test.js`:**
    - one at a time through a doorway;
    - slow vaults and a brute smashing the barricade;
    - Cover deploys the barricade toward the threat;
    - a spitter keeps its distance;
    - acid in the open vs behind cover;
    - pools burn.
  - **`doors.test.js`:**
    - door controls offer the choices;
    - welded doors stop aliens;
    - a weld costs a charge (greyed at 0);
    - a self-led squad cuts a welded door on its route;
    - welded vents get no routes or ambushes;
    - clicking a vent sends them to weld it.
  - **`downed.test.js`:**
    - a lethal blow downs;
    - no clock;
    - a claw finishes;
    - the medic revives at the rear with a wound (with or without a stim);
    - a click sends the squad;
    - leg and arm wound effects;
    - everyone down is a loss;
    - the uplink carries out only those on the command deck.
  - **`events.test.js`:**
    - 0–2 events, all kinds seen;
    - power out and restore (aura shrinks);
    - a botched hot-wire bites and can be retried;
    - fire on the route handled;
    - aliens route round fire;
    - distress: survivor, beacon, answered for ≥ 120.
  - **`kit.test.js`:**
    - grenade throw and blast, never near our own or a needed terminal;
    - no auto-throw at a single small alien;
    - Kit use / save;
    - flares (aura, one per room, creepers lit, auto-flare in a dark nest);
    - the barricade button;
    - the 7-field doctrine string;
    - drills (top-up, staggered reload, pinning);
    - the shove while reloading;
    - every specialist;
    - morale (downs, revives, kills, breaking without a veteran, drift).
  - **`oddities.test.js`:**
    - generation constraints (eggs only in nests, autodoc = medbed, pod types, locked room shape, one keycard on the main path nearer the airlock);
    - keydoor card / cut / greyed;
    - a click resets `passed`;
    - a salvage sweep still wins;
    - turret shoots until dry, and a botched hack jams it;
    - autodoc heals and mends once;
    - eggs burn or hatch (none from an empty reserve);
    - cryo pods read, shot, frosted.
  - **`orders.test.js`:**
    - fire discipline and lights change at once with an ack;
    - Standard ↔ Direct hand-over;
    - `nextOrder` skips;
    - no "everything" loot under Standard;
    - energy drains to normal and re-entry is refused;
    - kill, critter, food and drink refills;
    - alert resumes at 50%;
    - rations are stocked (> 1.5 per ship);
    - stamina drains at `PACE.DRAIN × drain` and winded squads walk until half.
  - `manual.test.js` also asserts that nobody holds on a climb and that a second ladder at the top of the first still wins.
  - `doctrine.test.js` lets a tech at work be reloading.
  - **`vis.test.js`:** visibility polygon on a two-room fixture (a closed door blocks; a lintel shadows).
  - **`render.test.js`:** the gait layer doesn't accumulate over 600 frozen frames.
  - **`determinism.test.js`** + `tests/helpers.js` `digest(world)`:
    - Same seed replays identically.
    - **Golden digests** of A1 (autoplay + god, 240 s) and G7 (autoplay mortal, 240 s) pin behaviour, so a refactor that should change nothing (e.g. stats all at 5) proves it. In this repo they are `84250f7f` and `8cd36f04`; a rebuild pins its own.
    - Update a golden only in a commit meant to change behaviour, and say why.

---

## 15. Milestones (each one runs in Chrome and is committed)

1. **Scaffold and pipeline spike:**
   - Vite, vitest, fixed-step loop, Rapier init, RNG streams, events, the asset loader.
   - The Blender `lib/` and a 2-bone spike GLB with 2 clips that loads and animates.
   - run-blender, check-glb, the shot tool.
   - The procedural ship generator and nav planner, with 400-seed tests.
   - `viewer.html`.
   - `docs/PLAN.md`.
2. **Simulation:**
   - The squad auto-advances and halts at loot, ladders, stairs, doors and dead ends. Followers replay the trail; turning around reverses the order and the trail.
   - Aliens: dormant/wake, vent travel, door forcing, leap and melee.
   - ROE, burst hitscan and reloads.
   - The pacing director and the uplink finale.
   - Headless tests, including autoplay wins.
   - Write the asset contract README.
3. **Playable shell:**
   - The level view from the kit (box fallbacks) batched per room.
   - Visibility mask, explored memory and darkness pass.
   - Flashlight spots and beams; pooled lamp and muzzle lights.
   - GLB actors with crossfades and speed-matched locomotion.
   - Pooled FX.
   - DOM HUD after the reference layout; procedural audio.
   - Rim-lit characters, damage vignette, frame-stats overlay, README.
   - HUD portraits rendered from the 3D marine.
4. **Art pass:**
   - marine, alien and critter (IK-planted hands and feet), then props and roomkit (meshopt-compressed).
   - Rebuild, check-glb, and inspect the previews.
   - Clip flashlight beams at the first wall.
5. **Squad professionalism:**
   - Stances (casual / alert / engaged), door and ladder drills, the clear call, per-situation spacing.
   - Four loadouts with distinct weapons (engine side, then the marine art with 21 clips and 16 variant meshes).
   - The bark library.
   - Individual heights and gaits.
   - Pace with stamina; cautious / normal / high alert with focus.
6. **Ship content:**
   - The fixed hostile budget, life signs and clear bonus.
   - Survivor art and simulation.
   - Explosive barrels and breakable consoles with explosion FX.
   - Loot rarities and salvage.
   - The boarding intro (dock, tube, dropship art, lock cycle).
7. **Campaign:**
   - Profile, roster, XP and ranks, upgrades, permadeath, ship offers.
   - Command and Debrief screens; one run per page load.
   - Blackout, the tracker upgrade, the threat-ladder probe, the campaign e2e tool.
8. **Polish and robustness:**
   - Fix gait accumulation, walk glitches, stance flapping, strikes through doors, and stair / ladder regroups.
   - Build the **flicker hunter** and fix every single-frame glitch it finds: first-frame negative dt, camera following raw positions, twitchy facing, target thrashing, lamp pool popping, muzzle strobing, shader compiles on first sight, rear troopers spawning inside the dropship.
   - Build the **NaN hunter**: the beam `pow()` fix and the NaN scrub.
   - Rebuild all art with LF metadata.
9. **People, not robots:** loose formation, sectors, checks, bounds, reactions, kneeling front rank, upper-body pitch and head glances.
10. **Determinism safety net:** replay test, golden digests, `balance.mjs --json`.
11. **Stats refactor:** 8 stats 1–10 and archetypes, candidates, profile v2 with migration, roster stat bars. All-5 must leave the goldens unchanged.
12. **Doctrine engine:** standing orders, presets, the URL form, steering, the turn-around override.
13. **HUD cut to Cover + Turn around; the Briefing screen:** remove the old action buttons, the decision card and the map-click routing.
14. **Learning by doing:** practice counters, growth at the debrief, "getting better at".
15. **Click-to-nudge:** interactables, command queue, order marker.
16. **Encounters:** locker, terminal, ambush, with odds and an 8 s timer.
17. **Specialists and nerve:** walk-up for jobs, panic, removal of dead steering code, README refresh.
18. **Standard orders become point-and-click:**
    - route `manual`, now the briefing default: hold until clicked, "Move here" on the floor, "Board the derelict", arrive and hold;
    - encounters wait for the player, a new click walks away from them, and Turn around reverses in place;
    - the briefing greys out Route and "Search everything";
    - Recon, Assault and Salvage stay autonomous;
    - tools and tests keep the autonomous `direct` default, and the campaign e2e picks Assault;
    - `manual.test.js`.
19. **Recorded sound:** 30 CC0 sounds (102 takes, about 2.5 MB of MP3) from Freesound, Kenney and OpenGameArt, credited in `CREDITS.md`.
    - `tools/audio` fetch (licence-checked), analyse, build.
    - `samples.js` and the `MIX`, with synthesis as the fallback and `?sfx=synth`.
    - Stereo hull beds, hull thuds, beeps and sparks; the uplink siren; doors, airlock, guns, reloads, aliens, explosions, footsteps, tracker, UI.
    - `/sfx.html` sound board, `sfx-levels.mjs`, `audio.test.js`.
    - README "Sound" section.
20. **Sound polish from an audit** (`sfx-audit.mjs`: every shot plays, none dropped):
    - Carbine: eight single M4A1 shots, each ringing out, so it now sits about −4 dB in the mix instead of −8.
    - Heavy: dry shots from a clean burst, plus a cancellable burst tail.
    - Measure and skip the ~25 ms MP3 encoder delay; loops wrap inside the audio (no 42 ms dropout).
    - Guns start on the shot.
    - Per-gun shot budgets.
    - Critter deaths squeal; a civilian's death gets the low stinger.
21. **Aliens:**
    - four breeds that crawl walls and ceilings (drone, runner, creeper, brute; generation and director picks on their own streams);
    - the high road (up a bulkhead or a spring, along the ceiling, drop swinging; knocked off by heavy hits; falls when shot dead up there; sleepers on ceilings and bulkheads; `bodyPoint`);
    - the orders bar (seven tiles, keys, replayable `setOrder`);
    - energy replaces focus;
    - fast pace drains stamina slowly.
22. **Climbs never strand anyone:** step off toward the room, wait short of the next stop, pack the landing; a 120-ship sweep finds no stuck squads.
    - Alien kills refill energy again (+12).
    - **Grimdark marines:** bigger studded pauldrons, a tall gorget, the winged-chevron badge, oath seals, heavier limbs, a darker palette, and `weather()` on every part.
23. **Downed marines and wounds, ship events (power, fire, distress), door controls and vents (seal, weld, cut), cover and chokepoints (one at a time, vaulting, the barricade), the Spitter.**
24. **The hive:** flanking, stalking, hit and run, creepers shy of light, runners' hearing, dragging; the Screamer and the Brood mother.
25. **Kit, firing drills, the shove, specialists and morale:**
    - grenades, flares and the barricade on Q, E and B, with the Kit order;
    - staggered reloads, top-ups and covering fire;
    - suppression;
    - the `bash` clip;
    - a README refresh.
26. **Set pieces:** sentry turret, autodoc, eggs, cryo pods, dead crew and keycard doors, with their props and the `scream` clip.
    - Fixes: a finished errand is dropped on every route; acid counts as being fired on.

After every milestone:
- `npm test` passes.
- `npm run shot -- --q "seed=A1&go=1&autoplay=1"` shows the game.
- Balance over 30–40 seeds with `tools/dev/balance.mjs` stays near the targets below.

---

## 16. Definition of done

- `npm install && npm run dev` plays in Chrome at 60 fps, with under 300 draw calls.
- `npm test` is green.
- `npm run assets` rebuilds every GLB headless, and `npm run check-glb` passes.
- **Balance targets** (30 seeds, mortal, original four):
  - Direct (`DEFAULT_DOCTRINE`, the autonomous default; this was "Standard" before Standard became point-and-click) wins about 30/30 in about 230 s with about 0.03–0.1 dead per run.
  - Assault wins 30/30 in about 175 s with no loot (about 0.07–0.10 dead per run).
  - Salvage takes about 450 s and visits about 18 rooms.
  - Recon is the riskiest: about 26/30, since a squad that only returns fire gets dropped on first.
  - A 120-ship sweep (Standard and self-led) finds no squad stuck on a climb.
- **Checks:**
  - The NaN hunt is clean.
  - The flicker check shows only gunfire and explosions.
  - A calm run with a parked camera shows zero flicker.
  - `sfx-audit` shows every shot played and none dropped.
  - `/sfx.html` plays every event, recorded and synth.
  - Under Standard the squad never moves without a click.
- **README:** quick start (including the `/viewer.html` and `/sfx.html` pages), URL parameters (`?brief=`, `?seed=&go=1&squad=&doc=`, `&autoplay=1`, `&retro=1`, `&debug=1`, `&nofog=1`, `&god=1`, `&sfx=synth`), controls, campaign, troopers and stats, standing orders and the orders bar (Standard is the player's game; the other three run themselves), the kit, the gameplay loop (breeds, the high road, pack habits, down not dead, ship events, door controls, firing drills, the shove, specialists, morale, set pieces), architecture, key design decisions, **Sound** (sources, the board, the mix and how to change the set), and the art pipeline.
