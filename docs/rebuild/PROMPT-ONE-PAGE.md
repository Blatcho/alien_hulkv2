# Build "Hull Breach": a derelict-boarding squad roguelike for the browser (one-page prompt)

Build this complete game in an empty git repo. Plan first (`docs/PLAN.md`), then build milestone by milestone. Each milestone runs in Chrome, is verified with tests and headless screenshots, and is committed. Keep it original: Space Hulk and Alien Breed are influences only, so use none of their names, factions or iconography.

**Stack.** Vite, plain ES modules (no TypeScript, no UI framework), three.js, `@dimforge/rapier2d-compat`, vitest, and puppeteer-core for the headless tools. Tunables live in `src/core/config.js`. Folders:
- `core/`: fixed 60 Hz loop, seeded RNG streams, URL params.
- `gen/`: the procedural ship.
- `nav/`: the portal graph and breadcrumb trail.
- `sim/`: pure data, with no three.js or DOM.
- `meta/`: the campaign.
- `physics/`, `vis/`.
- `render/`, `ui/` (DOM HUD), `audio/`.

The sim is **deterministic**: every system has its own RNG stream and input goes through a command queue. Golden-digest tests pin replays, and autoplay tests play whole ships to the win. Movement is scripted along the nav graph; Rapier only answers raycasts (line of sight, hitscan) and throws cosmetic debris. Expose `window.__game` (`state`, `stepFrames`, `command`, `world`, `view`) for tests.

**The game.** A side-on cut-away of a multi-deck derelict (default 24 columns × 3 decks), built from a spanning tree plus loops. Rooms are joined by doors, ladders, stairs and vents (vents are for aliens), with props, loot, survivors, set pieces and ship events (fires, power failures). The four-trooper team docks the dropship *Kestrel 21* at the rear airlock, fights to the command deck at the bow, then holds while an uplink completes. The mood is dark and grimy: flashlight beams, fog of war that remembers what was seen, a motion tracker, speech-bubble barks, hit-stop, screen shake and acid blood.

**Control is indirect.** The marines run themselves by stats and **standing orders**:
- Route, fire discipline, pace, loot, stims, flashlights, kit.
- **Manual** is the default: the squad holds until you click a floor spot or an object, goes there, and holds again.
- The presets Recon, Assault and Salvage route themselves.
- Paces: stealthy is a quiet crouch-walk (0.95 m/s), steady a jog (3.3), fast a stamina-draining sprint (4.6).

Keys:
- `C` cover, `T` turn back.
- Kit: `Q` grenade, `E` flare, `D` Defend (two sentry guns either side of the squad that stay and keep firing), `K` kit order.
- Orders: `R F G L H V` cycle them.
- `1`–`3` answer encounters (choose-your-own-adventure cards that show who acts and the odds).
- `Space` pause, `P` pixel mode, `M` mute, `+`/`-` or the wheel to zoom.

**The squad's simulation:**
- **Movement:** a point man, with followers replaying his trail; drills at doors and ladders; stances (casual, alert, engaged); people-like looking around.
- **Combat:** ROE, bursts, staggered reloads, the shove.
- **Down, not dead:** fallen troopers wait to be revived and then carry wounds.
- **Morale, energy and stamina.**
- **Breaking point:** below 30% HP a trooper freezes, flees or goes berserk, weighted by his stats.

**Hostiles:** seven breeds that crawl floors, walls and ceilings: drone, runner, creeper, brute, spitter, screamer and the brood mother.
- They have pack habits: flanking, stalking, fleeing, dragging men off.
- A **director** paces calm, build-up and ambush from a fixed hostile budget, plus waves during the uplink.
- **The horde** comes at most once per ship. Noise and commotion heat the ship (heat halves every 45 s). Past a threshold, a per-second roll triggers a 10 s countdown while the squad braces. Then a swarm of about 20 (more with threat and difficulty), mostly runners and drones, pours from vents on both sides. It is its own pool, separate from the ambush budget.

**Troopers:**
- **Eight stats** (1–10, 5 is baseline): STR SPD STA ACC PER INT NRV LCK. They grow by practice, up to core + 3.
- **Eleven archetypes**, each with the same 44-point budget: veteran, heavy, breacher, marksman, scout, tech, medic, rookie, duelist, brawler and gunner.
  - **Duelist:** bolt pistol, plus a power sword that cleaves two.
  - **Brawler:** power fists, no gun. Knocks back even brutes; the gauntlets block 20% of claw damage.
  - **Gunner:** minigun. Spins up for 0.7 s, then fires 20 rounds/s; slows the squad.
- **Five ranks:** Private, Corporal, Sergeant, Lieutenant, Captain. They're coloured like gear tiers (grey, green, blue, purple, orange) on cards and names, and bring +0/4/8/12/16 stat points.
- **Weapons:** four rarities with rolled affixes.

**Screens** (the HUD scales with the screen):
- **Title:** plain text on black, with the keys, New Campaign, a seed field and Quick Play.
- **Briefing:**
  - trooper cards and **Randomize Troopers** (a fresh set of 8 candidates);
  - line-up order and squad summary;
  - order presets and knobs;
  - **difficulty**: enemies, strength, ship size, hordes.
- **HUD:**
  - squad panel with rank-coloured names, HP, breath and ammo;
  - minimap and tracker;
  - Cover / Turn-back buttons, kit buttons and the orders bar;
  - horde countdown, objective, life signs, energy and morale.
- **Campaign:**
  - **Command:** roster, armoury, upgrades, recruits, memorial, and a choice of 3 derelict offers by size and modifiers.
  - **Debrief:** pay, XP and promotions, stat growth, permadeath. Threat rises with every extraction.

**Rendering:**
- Orthographic three.js. Characters turn to a 3/4 view.
- Pooled lights (no shader recompiles), bloom, and fog of war from visibility polygons.
- **Pixel mode is the default**: about 450 lines, whole device pixels per art pixel.
- Walk and run clips play at the speed travelled. Reloads, strikes and bursts on the move play on the upper body only.

**Art:** every model is a Python script run in headless Blender (`blender --background --python …`, or the `bpy` module). Low-poly bmesh with vertex colours and battered weathering, rigidly skinned, exported as GLB with clips and meta JSON, and checked by `check-glb`.
- **Marine:** one rig, with variant meshes `var_helmet|pads|pack|weapon|melee_*` that share grip points.
  - Weapons: carbine, heavy repeater, breacher, marksman rifle, pistol, minigun (on a `spin` bone), fists.
  - Melee: power sword.
  - Glow materials: `M_Accent` (tinted per trooper), `M_Glow`, `M_Power`.
  - Clips: casual, alert and engaged idles and walks; run, aim, shoot, crouch, climb, reload, signal, hit, die, bash, slash, punch.
  - Sockets for muzzles and lights.
- Also: aliens, critters, survivors, props, the room kit and the dock.
- Preview contact sheets are rendered and reviewed.

**Sound:** WebAudio synthesis for everything, with recorded CC0 effects layered on top. They're fetched with a licence check, cut, levelled, and credited in `CREDITS.md`.

**Tools and delivery:**
- Vitest suites for generation, sim rules, every feature and golden digests.
- Dev scripts: balance autoplay, flicker and NaN hunts.
- A GitHub Actions workflow on push to `main`: `npm ci`, `npm test`, `npm run build -- --base=./`, then FTPS deploy with the secrets `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD` (and the optional variable `FTP_SERVER_DIR`).

**Done means:** Quick Play and a campaign both play end to end in Chrome with no console errors; autoplay wins seeded ships; replays are deterministic; and the README documents controls, systems and architecture.

*The exhaustive spec, with every constant, rule and asset name, is [`PROMPT.md`](PROMPT.md). It predates the horde, Defend, breakdowns, difficulty, ranks, the faster paces and the three melee/heavy troopers, which this page adds.*
