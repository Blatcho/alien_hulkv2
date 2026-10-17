// Fixed-timestep game loop: the sim always advances in exact STEP increments (deterministic,
// stable physics), rendering runs once per animation frame with an interpolation alpha.
// Supports pause, slow-motion (timeScale) and hit-stop (brief freeze on big impacts).

export const STEP = 1 / 60;

export class Loop {
  /**
   * @param {(dt:number)=>void} update  fixed-step simulation update
   * @param {(alpha:number, frameDt:number)=>void} render
   */
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.acc = 0;
    this.last = 0;
    this.paused = false;
    this.timeScale = 1;
    this.hitStop = 0;
    this.running = false;
    this.frame = this.frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() { this.running = false; }

  /** Freeze the sim for `seconds` of real time (rendering continues). */
  freeze(seconds) { this.hitStop = Math.max(this.hitStop, seconds); }

  /** Advance the simulation by n fixed steps immediately (tests / headless). */
  stepFrames(n) {
    for (let i = 0; i < n; i++) this.update(STEP);
    this.render(1, STEP);
  }

  frame(now) {
    if (!this.running) return;
    // Schedule first: an exception in one frame must never stop the game.
    requestAnimationFrame(this.frame);
    // rAF timestamps can precede the performance.now() taken at start -> clamp to [0, 0.1].
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      if (this.hitStop > 0) this.hitStop -= dt;
      else if (!this.paused) {
        this.acc += dt * this.timeScale;
        let steps = 0;
        while (this.acc >= STEP && steps < 5) {
          this.update(STEP);
          this.acc -= STEP;
          steps++;
        }
        if (steps === 5) this.acc = 0; // spiral-of-death guard
      }
      this.render(this.acc / STEP, dt);
    } catch (err) {
      if (!this.errored) console.error('[game] frame error', err);
      this.errored = true;
    }
  }
}
