// Breaking point (config BREAK): clawed below a third of his health, a trooper on his feet breaks -
// once, until he's patched up past REARM. Which way depends on the man: low nerve freezes, quick
// feet run, strong arms and steady nerves go berserk (his stats weigh it, then chance - own RNG
// stream):
//   freeze   hunkers down where he is: won't fire, won't move - and the squad won't leave him
//            (squad.js holds while anyone is frozen or has bolted)
//   flee     drops to the rear of the line and bolts back along the trail (squad.js stepFlee),
//            then hides there until it's over and falls back in
//   berserk  fires faster and wilder at every hostile in sight and shoves whatever gets close
//            (combat.js, melee.js)
// It passes once nothing awake has been near him for a few seconds - or when he's healed.
import { BREAK } from '../core/config.js';

/** What the HUD calls each state (a man who bolted is HIDING once he's stopped running). */
export const BREAK_TAGS = { freeze: 'FROZEN', flee: 'FLEEING', hide: 'HIDING', berserk: 'BERSERK' };

/** Is this trooper frozen, running or hiding (not firing, and the squad waits for him)? */
export const brokenDown = (m) => !!m.breakdown && m.breakdown.mode !== 'berserk';

/** Anything awake within r metres of him? */
const threatNear = (world, m, r) => world.aliens.some((a) => a.alive && a.state !== 'dormant' && a.state !== 'vent' && Math.hypot(a.x - m.x, a.y - m.y) < r);

/** Clawed hard (world.damage, a hostile's blow or acid): does he break? */
export function breakingPoint(world, m) {
  if (m.breakdown || m.broke || m.down || !m.alive || m.hp <= 0 || m.hp >= m.maxHp * BREAK.HP) return;
  if (m.mode !== 'walk' && m.mode !== 'crouch') return; // not halfway up a ladder
  const sq = world.squad;
  if (sq.task?.m === m || sq.action?.by === m) return; // a job in his hands holds him together
  const stat = (k) => m.stats?.[k] ?? 5;
  const ways = [
    ['freeze', Math.max(0.5, 11 - stat('nrv'))],
    ['berserk', stat('str') + stat('nrv') * 0.6],
    // Nowhere to run alone: the last man standing freezes or fights.
    ['flee', sq.order.length > 1 ? stat('spd') + (10 - stat('nrv')) * 0.5 : 0],
  ].filter(([, w]) => w > 0);
  const mode = world.breakRng.weighted(ways);
  m.broke = true;
  m.breakdown = { mode, t: 0, calm: 0, phase: mode === 'flee' ? 'run' : null, ran: 0 };
  if (mode === 'flee') sq.toRear(m);
  else if (mode === 'freeze') m.target = null;
  world.emit('breakdown', { marine: m, mode });
  world.barks.say(m, `break_${mode}`, 1);
  if (mode !== 'berserk') world.barks.later(0.9, sq.order.find((o) => o !== m), 'break_wait', 1, { name: m.name });
}

/** Each step: a man who's been patched up has it in him again; a breakdown runs its course. */
export function updateBreakdowns(world, dt) {
  for (const m of world.marines) {
    if (m.broke && m.hp >= m.maxHp * BREAK.REARM) m.broke = false;
    const b = m.breakdown;
    if (!b) continue;
    if (!m.alive || m.down) { m.breakdown = null; continue; }
    // Everyone else gone: there's no rear to run to - he stands (and freezes) where he is.
    if (b.mode === 'flee' && world.squad.leader === m) { b.mode = 'freeze'; b.phase = null; }
    b.t += dt;
    b.calm = threatNear(world, m, BREAK.CALM_R) ? 0 : b.calm + dt;
    if ((b.t >= BREAK.MIN && b.calm >= BREAK.CALM) || m.hp >= m.maxHp * BREAK.REARM || b.t >= BREAK.MAX) {
      m.breakdown = null;
      world.emit('breakdown-over', { marine: m, mode: b.mode });
      world.barks.say(m, 'break_over', 1);
    }
  }
}

/** Still running from it? (squad.js stepFlee: he stops and hides when he's run far enough or it's behind him) */
export const stillRunning = (world, m) => m.breakdown.ran < BREAK.FLEE.DIST && threatNear(world, m, BREAK.FLEE.SAFE);
