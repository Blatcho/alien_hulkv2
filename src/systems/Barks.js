// Speech bubbles: short lines over whoever says them, drawn by the HUD at the speaker's head.
export class Barks {
  constructor(game) { this.game = game; this.list = []; }
  say(who, text, seconds = 1.6, delay = 0) {
    // one bubble per speaker; a new line replaces the old
    this.list = this.list.filter((b) => b.who !== who);
    this.list.push({ who, text, t: -delay, dur: seconds, played: false });
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.t += dt;
      if (b.t >= 0 && !b.played) { b.played = true; this.game.audio.play('bark', { volume: 0.35, minGap: 150 }); }
      if (b.t > b.dur) this.list.splice(i, 1);
    }
  }
}
