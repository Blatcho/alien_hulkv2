# Replay: the prompt sequence that grew this repo

`PROMPT.md` describes the finished game in one message. This file takes the other route: the same game as a **conversation**. It is an opening request and then one follow-up per round of changes, in the order the commit history shows them. Use it if you want the rebuild to evolve the way the original did. That route reproduces the intermediate designs too:
- rules of engagement become fire discipline;
- traits and perks become stats;
- manual decisions become a doctrine the squad follows by itself;
- then the player takes the lead again with point-and-click Standard orders;
- procedural sound becomes recorded CC0 sound, with the synthesis kept as a fallback;
- focus becomes energy, and a marine at zero HP goes down instead of dying.

**How to use it:**
- Paste each prompt into Claude Code in VS Code.
- Run step 1 in **plan mode**.
- Let each step finish, commit and verify before sending the next.
- Each step lists the commits it should produce, so you can compare against this repo (`git log --reverse`).

**Timeline.** The original took about three days:
- 25 Sep: steps 1–9
- 26 Sep: steps 10–15
- 27 Sep: steps 16–21
- 1–2 Oct: steps 22–27

All of it was on the `vertical-slice` branch. Steps 1–18 were merged as PR #1 and steps 19–21 as PR #3. Steps 22–27 are on `vertical-slice`, not yet merged into `main`.

---

## Step 1: the brief (plan mode; attach your HUD reference image)

> I want to build a browser game for Chrome: a 2D side-scrolling squad game in the spirit of Alien Breed and Space Hulk, but with **everything original** (no Games Workshop or Team17 names, no 40k or *Alien* designs).
>
> - A squad of 4 power-armoured marines boards a **procedurally generated derelict ship** with several decks. They enter at the rear airlock and **auto-advance** to the control panel in the cockpit at the bow.
> - The player doesn't steer. They set **rules of engagement**:
>   - cautious: return fire only;
>   - normal: visible hostiles;
>   - chaotic: anything that moves, including neutral critters.
> - The player makes **choices at loot and at navigation points** (doors, ladders, stairs, forks). Auto-opening doors is a setting.
> - The enemies are original four-armed predators. They sleep in rooms and vents, wake on sight or noise, travel through the vents, leap and claw.
> - There are neutral critters, loot containers and credits.
> - **Rendering:** three.js with an orthographic side-on camera. Characters are **3D skeletal models generated in Blender**, not sprite sheets. I have Blender 5.2 installed. **Drive it from the command line (headless Python scripts), not MCP.** Generate all models and animations with scripts, export GLB, and render preview images so you can check the art yourself.
> - **Physics:** Rapier (2D) for line of sight, hitscan and debris.
> - **Fog of war:** each marine sees 360° close up plus a flashlight cone. Remembered areas stay dim. Muzzle flashes light things up.
> - **HUD** like the attached image:
>   - squad portraits with HP and ammo bars, top-left;
>   - a rules-of-engagement selector;
>   - an action bar (Move/Hold, Attack, Cover, Flashlight, Stim-pack);
>   - a minimap with a motion tracker (radar dots and a ping);
>   - the objective and seed;
>   - decision prompts, and start and end screens.
> - **Feel:** hit-stop, screen shake, tracers, sparks, acid blood, squad barks, pulsing emergency lights, procedural WebAudio sound.
> - Everything deterministic from a `?seed=` URL parameter, with an autoplay mode for tests.
>
> Ask me anything you need, then write a plan with milestones. Each milestone must run in Chrome and be committed. You should be able to test headlessly (vitest for the simulation, headless Chrome screenshots for the game).

**Answers to give when Claude asks:**
- **Art style:** crisp flat-shaded low-poly with vertex colours by default, plus a "retro" low-resolution pixel toggle.
- **Scope:** vertical slice first (one complete ship, the full loop, HUD, win and lose). The roguelike meta layer comes after I review it.
- **Environment:** I'll move the repo out of OneDrive before we start. Windows, Node 24, Chrome; Blender is in Program Files.

**Expected plan:** `docs/PLAN.md`. Its milestones are:
0. Scaffold and spike
1. Generation and nav
2. Squad movement
3. Art pass
4. Vision and lighting
5. Combat
6. HUD and interactables
7. Feel and performance

**Expected commit:** `Scaffold Vite project, Blender GLB pipeline and procedural ship generator`.

## Step 2: build the vertical slice

> Plan approved. Build milestones 1–7. Commit as you go.

**Expected commits:**
- `Simulation: squad controller, aliens, critters, combat, director`
- `Playable game shell: renderer, fog of war, HUD, audio`
- `Rim-lit characters, softer damage vignette, frame stats overlay, README`
- `Squad: new point man resumes an unfinished traversal…`
- `HUD portraits rendered from the 3D marine model`
- `Loader: meshopt decoder…`
- `Character art: marine, alien, critter generated in Blender`
- `Environment art: props and room kit; meshopt-compressed GLBs`
- `Clip flashlight beams at the first wall`

## Step 3: a squad that behaves like a trained team

> The marines should look and act like a professional squad.
>
> - Give them three weapon stances chosen from context:
>   - **casual** (weapon lowered about 45°);
>   - **alert** (weapon at the hip);
>   - **engaged** (weapon at eye level).
> - Drills:
>   - **Doors:** #2 kneels to cover the door and the rear man watches behind.
>   - **Ladders:** one climber at a time. The next man covers the shaft (aim up) and the first man up kneels to cover the hatch.
>   - **Searching:** the others hold overwatch.
>   - **Uplink:** they defend the deck.
>   - **After a fight:** weapons stay up for a few seconds, then someone calls **"Clear!"** with a hand signal and another answers. Then they go alert, and later casual.
> - Four **loadouts** with distinct weapons, each with its own tracers, flashes and sound:
>   - a command carbine;
>   - a heavy repeater;
>   - a breacher shotgun (pellets, falloff, stagger);
>   - a marksman rifle (long scoped sight).
> - Build the matching helmet, pad and backpack variants in Blender as separate meshes on one rig. Hands must stay on every weapon's grip.
> - Add a bark library with cooldowns on its own RNG stream.
>
> More context drills:
> - room-entry alert;
> - a wounded call-out;
> - weapons up when a dormant hostile is in view.
>
> Then retune the reactions.

**Expected commits:** `Stances, squad drills and loadouts (engine side)`, `More context drills…`, `Marine art: three stances, covering poses, hand signal, four loadouts` (21 clips, 16 variant meshes).

## Step 4: small fixes

> - The clear call should come from someone with a free hand, and only close motion should cancel it.
> - Zoom the camera out to about 12.5 m of view height.
> - Stack overlapping barks so they never cover each other.
> - Fix the medkit bark wording.

## Step 5: individuality, pace and mental state

> - Every trooper should have their own **height and gait**: cadence, forward lean, hip sway, bounce and shoulder swagger, layered on top of the shared clips. Loops start at different phases.
> - Add movement **pace**:
>   - sneak: quiet, aliens hear less;
>   - normal;
>   - run: drains stamina and drops back automatically when it's empty.
> - Replace chaotic ROE with a **mental state**:
>   - cautious (return fire only);
>   - normal (fire on anything that moves, including vermin and unidentified survivors);
>   - **high alert** (weapons up, fastest reactions, all hostiles). High alert burns a **focus** bar that only kills refill.
> - Show HUD meters on the action buttons. Keys: Z sneak, Shift run, 1–5 for decisions.

## Step 6: make each ship a fixed fight, and add people and things that blow up

> - **Fixed hostile budget per ship:** some sleep in rooms, the rest are the director's reserve for vent ambushes and finale waves. Show a life-signs counter, and pay a bonus when the ship is cleared.
> - **Survivors:** stranded engineers hide in the ship.
>   - Model one in Blender: jumpsuit, hi-vis vest, hard hat with a lamp. Clips: cower, idle, walk, run, wave, hit, die.
>   - Once a marine identifies them they evacuate to our ship by themselves. Aliens hunt them too.
>   - Unidentified runners can be shot under normal fire discipline.
> - **Destructible scenery:**
>   - Explosive fuel barrels with area damage, chain reactions and noise.
>   - Breakable consoles.
>   - Stray rounds hit props.
>   - Troopers shoot a barrel when hostiles crowd it.
>   - Big explosion FX: fireball, shockwave, sparks, shrapnel, scorch, light, shake, hit-stop, boom.
> - **Loot:**
>   - Weapons in 4 rarities (standard, rare, epic, legendary) with rolled bonuses. Give them to a trooper or stash them for the ship.
>   - Weapons cases, strongboxes and treasure salvage that only pays if we get home.
> - **Boarding intro:** our dropship, the *Kestrel*, is docked. The squad walks through a boarding tube into the airlock, the outer door seals behind them and the lock cycles. Survivors evacuate to it. Model the dropship, tube and docking hull in Blender, plus the explosive barrel, wrecks, weapons case, strongbox and scorch decal.

**Expected commits:** `Fixed hostile budget…`, `Survivor NPC art…`, `Destructible scenery…`, `Environment art: docked boarding ship…`, `Loot and survivors (sim)`, `Boarding intro from the docked Kestrel…`.

## Step 7: the roguelike campaign

> Now the meta layer.
>
> - **Persistent profile:** credits, threat level, roster, memorial, weapon stash, ship upgrades.
> - **Troopers:** recruits with random traits and gaits; XP → promotions → perk choices.
> - **Upgrades:** armour, stims, suit cooling, neural link, tracker boost, salvage crew.
> - **Permadeath.**
> - **Settlement:** payouts; a wipe keeps only 25% insurance; threat +1 per extraction.
> - **Ship choice:** choose 1 of 3 derelicts with a size, modifiers (Infested, Blackout, Treasure hauler, Armoury ship, Distress call, Hive ship, Restless, Fuel leak) and a pay multiplier. The generator must honour the modifiers.
> - **Screens:** title → Command (squad, armoury, upgrades, recruiting, memorial, pick a derelict) → run → Debrief (payout, XP, promotions with perk picks, the fallen, recovered gear) → Command.
> - Each run is its own page load. Reloading mid-run abandons the op (no save-scumming).
> - Write an end-to-end tool that drives the whole loop in headless Chrome.
> - Blackout should dim the ship's lighting, and the tracker upgrade should extend its range.
> - Add a threat-ladder balance probe.
> - Update the README.

## Step 8: bugs I saw while playing

> - Torsos sometimes spin and walks glitch.
> - Aliens can hit through closed doors.
> - Stairs need the same climb and regroup drill as ladders.
>
> Fix all of it and add tests.

**Expected commit:** `Fix spinning torsos and walk glitches; aliens can't strike through doors; climb regroup drill for stairs too`. The gait layer must be re-applied from the mixer value each frame.

## Step 9: the flicker

> I keep seeing single-frame visual glitches: dark or bright flashes. Build an automated **flicker hunter** that plays real-time runs in headless Chrome and flags screen regions that flash for 1–2 frames, with diff images. Find the root causes and fix them.

**Expected commits:**
- `Fix visual glitches found by an automated flicker hunt`. Fixes:
  - first-frame negative dt;
  - camera following raw positions;
  - twitchy facing;
  - target thrashing;
  - lamp pool popping;
  - muzzle strobing;
  - shader compiles on first sight;
  - troopers spawning in the dropship wall.
- `Rebuild all art from the Blender scripts; write asset metadata with LF line endings`.

## Step 10: flicker hunter false positives, and the black box

> The flicker detector flags every moving shot: about 800 false spikes a minute during a pan. Make it camera-compensated and box-filtered.
>
> Also: with flashlights on I sometimes get a big black rectangle for one frame. Find it.

**Expected commits:**
- `Flicker hunter: camera-compensated, box-filtered…`
- `Fix single-frame black box with flashlights on (NaN in beam shader)`: clamp before `pow()`; a NaN scrub by bit test, because D3D strips `isnan()`; `nanhunt.mjs`.

## Step 11: they move like robots

> The marines still move like robots.
>
> - **Loose formation:** own pace, drifting spacing, stragglers jogging to catch up.
> - **Sectors:** point looks ahead, #2 high (vents, hatches), #3 low (crates, bodies), rear behind. Weapons and torches pitch onto what they look at, and the sight cone follows.
> - **Checks:** brief stops to check vents and bodies; the rear man checks six.
> - **Point man:** pauses at unexplored rooms and advances in bounds when something is on the tracker.
> - **Reactions:** noises pull eyes round; contacts on another deck point weapons at the ceiling or floor.
> - **Firefights:** the front rank kneels while the rear covers the other way.
>
> Report balance before and after.

## Step 12: safety net before a big refactor

> Before we change the trooper model, add a determinism safety net: a replay test and golden digests of two autoplay runs, so we can prove a refactor changes nothing. Add `--json` to the balance probe.

## Step 13: stats instead of traits and perks

> Replace traits and perks with **8 stats rated 1–10**, where 5 is the baseline. They are Strength, Speed, Stamina, Accuracy, Perception, Intelligence, Nerve and Luck.
>
> - They drive the existing hooks, plus these new ones:
>   - personal stamina: the squad only runs while everyone has breath;
>   - squad pace = its slowest man;
>   - climb speed;
>   - awareness radius;
>   - heavy-weapon stagger;
>   - searches and uplink by the squad's best mind;
>   - luck on its own stream (crits, a lucky escape, better finds).
> - All 5s must reproduce the current behaviour exactly (goldens unchanged).
> - 8 **archetypes** on an equal points budget: veteran, heavy, breacher, marksman, scout, tech, medic, rookie. Looks follow stats.
> - Migrate old saves instead of wiping them. Show stat bars on the roster.

## Step 14: the squad runs itself

> I want the player to set **standing orders** before deployment, and the squad to make its own decisions by them. Knobs:
> - **route:** direct, or sweep side rooms (with a time limit);
> - **fire discipline:** cautious / normal / high alert;
> - **pace:** stealthy / steady / fast;
> - **loot:** leave / on the way / everything;
> - **stims:** early / critical / hoard, used by the medic;
> - **flashlights:** on / auto / off.
>
> Presets: Standard, Recon, Assault, Salvage.
>
> Decisions happen once the squad has stacked up, so the drills still play. **Cover** is a full stop. **Turn around** should not U-turn straight back at the next door. Give the orders a compact URL form for quick play.
>
> Then:
> - Cut the in-mission HUD down to **Cover + Turn around** (plus 1–3 later).
> - Add a **Briefing screen**, shared by the campaign and quick play:
>   - ship intel with the stats its anomalies call for;
>   - pick four and their order (point to rear);
>   - a squad summary: tech & medic, sharpest eyes, who sets the pace, who tires first;
>   - doctrine presets and knobs.
> - Quick play: title → briefing over the ship's 8 seeded candidates → play.
> - Recruiting offers three volunteers.

## Step 15: learning by doing

> Troopers should improve at what they actually do during a mission:
> - hits → Accuracy
> - spotting first and checks → Perception
> - searches, stims and the uplink → Intelligence
> - heavy work → Strength
> - punishment taken and running → Stamina
> - running and climbing → Speed
> - close calls → Nerve
> - lucky breaks → Luck
>
> At the debrief, practice becomes points. They get dearer the better the trooper already is, and cap at core + 3. Show the gains and what each trooper is "getting better at".

## Step 16: point at things

> Instead of buttons, let me **point at things in the scene**: doors, ladders and stairs, unsearched crates, survivors, fuel barrels. Only in rooms the squad has seen.
> - Hovering shows a ring and a tag ("Breach the door - click").
> - Clicking makes it the squad's goal: route through it, search it even under "leave it", reach the survivor, or shoot the barrel once nobody is in the blast.
> - Keep an order marker on the target until it's done, and acknowledge the order with a bark.
> - Input must go through a command queue so it replays deterministically.
>
> Also raise the default test timeout to 30 s (whole-ship sims flake at 5 s).

## Step 17: encounters

> Add **choose-your-own-adventure set pieces with stat checks**, chosen in the scene:
> - **Sealed weapons locker:** hack (INT, quiet) or force (STR, loud). Success upgrades what's inside; failure trips an alarm or hurts the man forcing it.
> - **Crew terminal:** pull the deck plans (INT), which maps the ship and every cache.
> - **Something in the locker:** sharp eyes (PER) may spot a hostile hiding in a container. Shoot it first (the loot is lost) or open it carefully (NRV).
>
> Each option names who would do it and the odds. I get 8 seconds (click or 1–3), then the standing orders decide. Place them on a new generation stream so the rest of the ship generates exactly as before. Practice from attempts should feed learning by doing.

## Step 18: specialists and nerve

> - Whoever is best at a job should **step out of the line** and walk up to do it while the others cover, then fall back into his slot.
> - Add **nerve**: a badly hurt trooper with shaky nerve may panic for a moment (firing wild, slow to react), unless a steady squad-mate is beside him. Nerve 5+ never panics.
> - Remove the old manual steering code.
> - Update the README.
>
> Report balance with 4 random candidates.

**Expected commit:** `Specialists step out of line for their jobs; nerve and panic; dead steering code removed`. PR #1 was merged here.

## Step 19: I want to play it, not watch it

> Make **Standard** orders point-and-click, and make it the default in the briefing.
>
> - The squad **holds position** until I click either:
>   - a spot on the floor of a room they know ("Move here"), or
>   - something in the scene: a door, ladder, crate, terminal, survivor or barrel. At the start, that includes the outer airlock door: "Board the derelict".
> - They go there, stop, and hold again: #2 covers ahead, the rear watches back. The HUD says "AWAITING ORDERS".
> - They still handle doors and ladders on the way, fights, stims and flashlights themselves.
> - Encounters wait for me (no auto-answer). A new click walks away from an unanswered encounter.
> - **Turn around** reverses the line in place.
> - In the briefing, grey out what can't apply under Standard, with a note saying why:
>   - Route, because the route is mine;
>   - Loot "Search everything", because a squad that only moves on my word doesn't go looking; they still search what they pass.
> - Keep Recon, Assault and Salvage autonomous (for multi-team play later).
> - Tools and tests should keep the autonomous direct route as the simulation's default, and the balance probe should default to it. The campaign e2e should pick Assault so it still plays itself.

**Expected commit:** `Standard orders become point-and-click: the squad moves only where the player sends it`. It adds route `manual`, `moveTo`/`floorSpot`, `disabledOptions`/`fitOrders`, the `in_position` bark and `tests/manual.test.js`.

## Step 20: real sound

> The synthesised sound is thin. Replace it with **recorded sound effects**, **CC0 only**, from Freesound, Kenney and OpenGameArt:
> - stereo hull ambience and a drone bed, with hull thuds, terminal beeps and sparks over them;
> - doors, the airlock cycle, a door-panel beep;
> - gunfire per weapon, and reloads;
> - alien hisses, growls, screeches, strikes, deaths and hits;
> - explosions, metal clangs, footsteps, the motion tracker;
> - a siren during the uplink hold;
> - interface sounds for encounters, loot and orders.
>
> Tooling:
> - Write tools to **fetch** the candidates (check every Freesound page is CC0 before downloading), **analyse** them (find the single events in each file), and **build** the set: cut, mono, loudness-matched, crossfaded loops, small MP3s, a manifest, and a `CREDITS.md` crediting every file.
> - Keep the procedural sound as the fallback until each recording has loaded, for anything missing, and with `?sfx=synth`.
> - Add a `/sfx.html` sound board to audition every event and take, and a tool that measures the mix against the synth versions.
> - Add a test that keeps the manifest, the mix and the credits in sync.
> - Add a "Sound" section to the README.

**Expected commit:** `Sound: recorded CC0 effects for the ship, doors, guns and aliens, synthesis as fallback`. It produces 30 sounds and 102 takes, about 2.5 MB.

## Step 21: the guns sound weak

> In play the carbine sounds thin and echoey, and the heavy buries it. Audit a real-time run: are shots being dropped? Then fix the mix.

**Expected commit:** `Sound: punchier rifles, clean heavy MG with a burst tail, MP3 delay and loop seams fixed`. The changes:
- `tools/dev/sfx-audit.mjs`: 176/176 shots played.
- Carbine: eight single M4A1 shots.
- Heavy: dry burst slices plus a cancellable tail.
- Measure the ~25 ms MP3 encoder delay per file and skip it; loops wrap inside the audio.
- Guns start on the shot.
- Per-gun shot budgets.
- Critter death squeal; a civilian's death gets the low stinger.

The set ends at 31 sounds and 107 takes. PR #3 was merged here.

## Step 22: aliens that come from above

> The aliens are all the same and only come along the floor.
>
> - **Breeds**, tinted and scaled, with more of the big ones deeper in:
>   - **drones** (the baseline);
>   - small fast **runners**;
>   - **creepers** that live on the ceilings;
>   - big slow **brutes** (230 HP, 28–40 claws, shrug off stagger, force doors fast).
>   - Generation and director spawns should pick breeds on their own RNG streams.
> - **The high road.** In the squad's room a climber goes up the nearest bulkhead (or springs straight up), crawls along the ceiling over the squad and drops on someone, landing swinging.
>   - Some sleep on ceilings and bulkheads.
>   - Ceilings stop at ladder and stair openings.
>   - A breacher blast knocks a crawler off; shot dead up there, it falls.
>   - Sight, aim and hitboxes must use the body wherever it hangs. Roll the model onto the surface.
> - **An orders bar:** the six standing orders as tiles beside Cover and Turn back. Click for the options, or press R F G L H V to cycle. Apply them as replayable commands. Switching to or from Standard hands the route over.
> - **Energy replaces focus:** high alert burns it and only eating refills it: vermin the squad shoots, or food and energy drinks found in containers.
> - **Fast pace:** running should drain stamina slowly (about 33 s from full), and the stops on a fast pace barely give it back.

**Expected commit:** `Aliens: four breeds that crawl walls and ceilings; orders bar; energy for high alert; slower stamina`. Goldens re-pinned; recon drops to 26/30.

## Step 23: stuck on ladders, and the marines look too clean

> - Under Standard the squad gets stuck on ladders and stairs: the point man holds on the top step with the others on the rungs.
>   - Make sure nobody is ever stranded on a climb.
>   - Sweep 120 ships to prove it.
> - Alien kills should refill energy again (+12).
> - The marines should look grimdark and battered:
>   - bigger, higher studded pauldrons;
>   - a tall gorget the helmet sits down in;
>   - a winged-chevron unit badge;
>   - red-wax oath seals with parchment strips;
>   - heavier forearms, greaves and boots;
>   - a darker palette.
>   - Weather every part: paint chipped to metal along the bevelled edges, grime rising up the legs, mud on the boots, scorches, soot and dust.

**Expected commit:** `Climbs never strand anyone; kills refill energy again; grittier, grimdark marines`. This adds `weather()` to `lib/common.py`.

## Step 24: down not dead, the ship fights back, and doors

> - **Downed, not dead:** a marine at zero HP goes down instead of dying.
>   - A squad-mate gets him up; the squad goes back for him if it has to.
>   - He comes back with a leg or arm wound that slows him or spoils his aim.
>   - A claw on a downed man finishes him. No bleed-out timer.
> - **Ship events, none on a clock:**
>   - a deck loses power when the squad reaches it (lights out, short sight, aliens hear better) until someone resets the junction;
>   - a doorway catches fire and blocks everyone until it is put out, braved or routed round;
>   - a distress call puts a survivor deep in the ship with a beacon, and a sweep answers it for a bonus.
> - **Door controls and vents:**
>   - seal or weld a door, cut a welded one with charges;
>   - weld a vent so nothing comes out of it.
>   - Aliens route round welded doors and vents.
> - **Cover and chokepoints:**
>   - aliens take a doorway one at a time;
>   - they vault anything on the walking line (slowly);
>   - a brute smashes the squad's barricade.
>   - Cover with something coming puts the barricade down.
> - **A Spitter breed:** it keeps its distance and lobs acid.
>   - A trooper crouched behind cover takes it on the cover.
>   - Acid pools burn whoever stands in them.

**Expected commit:** `Downed marines, ship events, door controls, cover and the Spitter`.

## Step 25: the hive should hunt like a pack

> - **Flanking:** with a packmate closing from the front, a climber goes over the squad on the ceiling and drops on the man at the far end.
> - **Stalking:** one woken unseen shadows the rear man and strikes when someone near it reloads, the line strings out, or it's seen or hurt.
> - **Hit and run:** badly hurt, a runner or creeper may bolt for a vent and come back healed.
> - Creepers back off from torchlight.
> - Runners hear gunfire from further off.
> - Something that reaches a man down may drag him off to a vent; shot hard enough, it lets go.
> - **A Screamer** wakes every sleeper in earshot and calls more out of the vents; a heavy hit cuts it off.
> - **A Brood mother** (one at most, in the deepest nest) births runners while awake; killing her pays.
> - The squad should put a dragger, a screamer or a bolter down first.

**Expected commit:** `The hive: flanking, stalking, hit and run, dragging; screamer and brood mother`.

## Step 26: kit, drills, specialists and morale

> - **The kit:** frag grenades, flares and the barricade, each on its own button (Q, E, B) with what's left.
>   - Grenades go into a pack or at something big, never with one of ours, a terminal still needed or the command deck in the blast.
>   - Flares light a room for the rest of the mission.
>   - A new Kit standing order (K): use it, or save it for the player's call.
> - **Firing drills:**
>   - a man running low changes mags while the others still fire, one at a time;
>   - magazines are topped up in a lull;
>   - the rest cover anyone reloading or down.
>   - Rounds coming in pin a hostile down.
> - **The shove:** one clawing at a man who can't shoot it gets driven back (Strength; a breacher hard and often).
> - **Specialists:**
>   - veteran: morale never breaks;
>   - heavy: holds the line in Cover;
>   - breacher: shoves, and doors in half the time;
>   - marksman: 2.5× on the unaware;
>   - scout: nothing shadows the squad near him;
>   - tech: welds with his own torch;
>   - medic: three field dressings.
> - **Squad morale:** kills, comrades back up and a dead brood mother lift it; men down or lost, screams and ambushes wear it down. Steady squads aim and react better; shaken ones worse, and panic gets in.
> - Update the README.

**Expected commit:** `Kit, firing drills, the shove, specialists and squad morale`.

## Step 27: set pieces

> Add new interaction points, placed on their own generation stream:
> - a **sentry turret** to hack (INT) that fights for the squad until its ammo runs out; a botched hack locks it out with an alarm;
> - an **autodoc** (a medbay bed) that heals everyone once and mends the worst wound;
> - **egg clusters** in nests: burn them with a flare, shoot them (loud, one may get out) or sneak past (NRV);
> - **cryo pods**: sharp eyes (PER) may read what's inside (a survivor, a hostile or a sealed cache); open it, shoot it through the glass, or leave it;
> - **dead crew** to search; one carries the keycard to a locked storeroom off the route, which can always be cut open with a charge.
>
> Model the barricade, turret, eggs, cryo pod (hinged frosted door) and crewman, a marine `bash` clip for the shove, and an alien `scream` clip.

**Expected commit:** `Set pieces: sentry turret, autodoc, eggs, cryo pods, dead crew and keycard doors`. This is the head of `vertical-slice` (`805c794`).
