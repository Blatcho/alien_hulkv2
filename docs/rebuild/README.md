# Rebuild prompts

These prompts are reverse-engineered from this repository's `vertical-slice` branch at `805c794`, six commits ahead of `main` (PR #3, `03ca7a3`) and not yet merged. That point includes:
- point-and-click Standard orders and the recorded CC0 sound set;
- the seven alien breeds that crawl walls and ceilings, and their pack habits;
- down-not-dead with wounds;
- ship events, door welding, the kit;
- firing drills, the shove, specialists, morale, energy;
- the orders bar and the set pieces.

They aim to reproduce the same game with Claude Code in VS Code, with the art made by headless Blender driven from the CLI, not MCP.

| File | Use it when |
|---|---|
| [`PROMPT-ONE-PAGE.md`](PROMPT-ONE-PAGE.md) | You want the **whole game on one page**: the design, systems, stack, art pipeline and delivery as the game stands now (including the horde, Defend, breakdowns, difficulty, ranks and the duelist, brawler and gunner). It names the key numbers and leaves the rest to Claude; for every constant, use `PROMPT.md` alongside it. |
| [`PROMPT.md`](PROMPT.md) | You want **one prompt** that builds the finished game. It is a full spec: architecture, every tunable, simulation rules, the standing orders (including point-and-click Standard and the orders bar), the hive, the kit and the ship (breeds, pack habits, downed marines, ship events, door controls, morale, set pieces), rendering, HUD, sound (the recorded set with its exact sources, plus the synth fallback), campaign, the Blender asset contract, tests, tools, milestones and acceptance targets. Paste the whole file as your first message, in plan mode. |
| [`REPLAY.md`](REPLAY.md) | You want to rebuild it **the way it was actually built**: the opening brief and then 26 follow-up prompts, in commit order, with the commits each should produce. |

## Set up the same environment first
- Windows, with VS Code and the Claude Code extension.
- Keep the repo out of OneDrive.
- Blender 5.2 LTS in `C:/Program Files/Blender Foundation/`, or set `BLENDER` to its `blender.exe`.
- Node 24, npm 11, and Chrome. The headless tools use `--use-angle=d3d11`.
- For the sound fetcher: `curl` and `unzip` on PATH (Git for Windows has both), and web access to freesound.org, kenney.nl and opengameart.org.
- If you have the HUD reference image the original brief used, attach it to the first message. `PROMPT.md` describes that layout in words, so it works without the image.

## What was used to derive them
- The commit history. The messages carry the requests, the fixes and the balance numbers.
- `docs/PLAN.md`: the plan approved at the start, which records the original brief's decisions.
- `README.md`, `tools/blender/README.md` and `public/assets/audio/CREDITS.md`.
- A full read of `src/`, `tools/` and `tests/` on `main`, and of the `vertical-slice` diff since, which supplied the constants, rules, names, styling and the sound `SELECTION`.

## What won't come out identical
- **GLB binaries.** `paint()` seeds its colour jitter with Python's randomized `hash()` (only `weather()` is deterministic), so even this repo's scripts don't rebuild byte-identical files.
- **The sound files.** `PROMPT.md` pins every source (Freesound ids, pack file names), cut point and loudness target. But the MP3 bytes depend on the upstream files, which can change or disappear, and on the encoder.
- **Golden digest values and exact balance figures.** The golden digests on `vertical-slice` are `84250f7f` for A1 and `8cd36f04` for G7. Any re-implementation plays different trajectories, so treat the balance targets as ranges.
- **Code layout and wording.** Claude will write its own code to the spec. File names, public names, asset and sound keys, and numbers are pinned; everything else is its call.
