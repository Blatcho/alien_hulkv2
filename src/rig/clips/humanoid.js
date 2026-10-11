// Animation clips for the humanoid rigs. Poses map bone name -> angle (deg); rootX/rootY shift the
// hip; `rot` rotates the whole body. Keys use normalised time t in [0,1]; durations in ms.
// Conventions: limbs 0 = hanging straight down, NEGATIVE swings the tip forward. Torso/head
// positive = lean forward. Weapon angle is relative to the forearm (0 = blade continuing the arm
// upward; +90 = pointing forward).

function clip(duration, keys, { loop = false, events = [], linear = false } = {}) {
  return { duration, keys, loop, events, linear };
}

const K = (t, pose) => ({ t, pose });

export function humanoidClips(o = {}) {
  const w = o.weaponRest !== undefined ? o.weaponRest : 10;   // weapon angle at rest
  const s = o.shieldRest !== undefined ? o.shieldRest : 20;
  const idleArm = o.idleArm !== undefined ? o.idleArm : 8;
  const tail = o.tail || false;
  const T = (a, b) => tail ? { tail1: a, tail2: b } : {};
  const c = {};

  c.idle = clip(1600, [
    K(0, { torso: 0, head: 0, arm_u_near: idleArm, arm_l_near: -10, arm_u_far: idleArm + 4, arm_l_far: -12, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, weapon: w, shield: s, rootY: 0, ...T(30, 20) }),
    K(0.5, { torso: 2, head: -2, arm_u_near: idleArm + 3, arm_l_near: -14, arm_u_far: idleArm + 7, arm_l_far: -16, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, weapon: w, shield: s, rootY: 2, ...T(38, 30) }),
  ], { loop: true });

  // Run: 4 keys. Near leg forward at t=0, back at t=0.5.
  const run = (lean, bob, stride) => clip(560, [
    K(0, { torso: lean, head: -4, leg_u_near: -stride, leg_l_near: 10, leg_u_far: stride * 0.8, leg_l_far: 60, arm_u_near: stride * 0.7, arm_l_near: -40, arm_u_far: -stride * 0.7, arm_l_far: -60, weapon: w, shield: s, rootY: bob, ...T(50, 30) }),
    K(0.25, { torso: lean + 3, head: -2, leg_u_near: 5, leg_l_near: 30, leg_u_far: 10, leg_l_far: 20, arm_u_near: 0, arm_l_near: -50, arm_u_far: 0, arm_l_far: -50, weapon: w, shield: s, rootY: -bob, ...T(40, 40) }),
    K(0.5, { torso: lean, head: -4, leg_u_near: stride * 0.8, leg_l_near: 60, leg_u_far: -stride, leg_l_far: 10, arm_u_near: -stride * 0.7, arm_l_near: -60, arm_u_far: stride * 0.7, arm_l_far: -40, weapon: w, shield: s, rootY: bob, ...T(50, 30) }),
    K(0.75, { torso: lean + 3, head: -2, leg_u_near: 10, leg_l_near: 20, leg_u_far: 5, leg_l_far: 30, arm_u_near: 0, arm_l_near: -50, arm_u_far: 0, arm_l_far: -50, weapon: w, shield: s, rootY: -bob, ...T(40, 40) }),
  ], { loop: true, events: [{ t: 0.05, name: 'step' }, { t: 0.55, name: 'step' }] });
  c.run = run(o.runLean !== undefined ? o.runLean : 14, 3, 42);
  c.walk = clip(900, [
    K(0, { torso: 3, leg_u_near: -22, leg_l_near: 6, leg_u_far: 20, leg_l_far: 30, arm_u_near: 16, arm_l_near: -20, arm_u_far: -12, arm_l_far: -24, weapon: w, shield: s, rootY: 1, ...T(36, 24) }),
    K(0.25, { torso: 4, leg_u_near: 0, leg_l_near: 20, leg_u_far: 4, leg_l_far: 10, arm_u_near: 4, arm_l_near: -22, arm_u_far: 4, arm_l_far: -22, weapon: w, shield: s, rootY: -1, ...T(30, 30) }),
    K(0.5, { torso: 3, leg_u_near: 20, leg_l_near: 30, leg_u_far: -22, leg_l_far: 6, arm_u_near: -12, arm_l_near: -24, arm_u_far: 16, arm_l_far: -20, weapon: w, shield: s, rootY: 1, ...T(36, 24) }),
    K(0.75, { torso: 4, leg_u_near: 4, leg_l_near: 10, leg_u_far: 0, leg_l_far: 20, arm_u_near: 4, arm_l_near: -22, arm_u_far: 4, arm_l_far: -22, weapon: w, shield: s, rootY: -1, ...T(30, 30) }),
  ], { loop: true, events: [{ t: 0.05, name: 'step' }, { t: 0.55, name: 'step' }] });

  c.jump = clip(400, [
    K(0, { torso: 6, head: -6, leg_u_near: -40, leg_l_near: 60, leg_u_far: 10, leg_l_far: 30, arm_u_near: 50, arm_l_near: -70, arm_u_far: 40, arm_l_far: -60, weapon: w, shield: s, ...T(60, 40) }),
    K(1, { torso: 2, head: -4, leg_u_near: -30, leg_l_near: 50, leg_u_far: 20, leg_l_far: 40, arm_u_near: 70, arm_l_near: -40, arm_u_far: 60, arm_l_far: -30, weapon: w, shield: s, ...T(70, 50) }),
  ]);
  c.fall = clip(500, [
    K(0, { torso: -2, head: 4, leg_u_near: -20, leg_l_near: 30, leg_u_far: 15, leg_l_far: 50, arm_u_near: 90, arm_l_near: -20, arm_u_far: 80, arm_l_far: -20, weapon: w, shield: s, ...T(80, 60) }),
    K(1, { torso: -4, head: 6, leg_u_near: -26, leg_l_near: 34, leg_u_far: 18, leg_l_far: 56, arm_u_near: 110, arm_l_near: -10, arm_u_far: 100, arm_l_far: -10, weapon: w, shield: s, ...T(90, 70) }),
  ], { loop: true });
  c.land = clip(180, [
    K(0, { torso: 18, head: -8, leg_u_near: -40, leg_l_near: 70, leg_u_far: 10, leg_l_far: 60, arm_u_near: 30, arm_l_near: -50, arm_u_far: 30, arm_l_far: -50, weapon: w, shield: s, rootY: 14, ...T(50, 40) }),
    K(1, { torso: 2, head: 0, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, arm_u_near: idleArm, arm_l_near: -10, arm_u_far: idleArm, arm_l_far: -12, weapon: w, shield: s, rootY: 0, ...T(30, 20) }),
  ]);

  c.hurt = clip(320, [
    K(0, { torso: -22, head: -16, leg_u_near: -20, leg_l_near: 20, leg_u_far: 16, leg_l_far: 10, arm_u_near: -60, arm_l_near: -40, arm_u_far: -50, arm_l_far: -40, weapon: w, shield: s, rootY: 4, ...T(10, 0) }),
    K(0.6, { torso: -14, head: -10, leg_u_near: -16, leg_l_near: 16, leg_u_far: 12, leg_l_far: 10, arm_u_near: -40, arm_l_near: -30, arm_u_far: -30, arm_l_far: -30, weapon: w, shield: s, rootY: 2, ...T(20, 10) }),
    K(1, { torso: 0, head: 0, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, arm_u_near: idleArm, arm_l_near: -10, arm_u_far: idleArm, arm_l_far: -12, weapon: w, shield: s, rootY: 0, ...T(30, 20) }),
  ]);
  c.death = clip(800, [
    K(0, { torso: -20, head: -20, leg_u_near: -10, leg_l_near: 20, leg_u_far: 10, leg_l_far: 10, arm_u_near: -70, arm_l_near: -30, arm_u_far: -60, arm_l_far: -30, weapon: w, shield: s, rootY: 0, rot: 0, ...T(10, 0) }),
    K(0.5, { torso: -30, head: -30, leg_u_near: -40, leg_l_near: 50, leg_u_far: 10, leg_l_far: 40, arm_u_near: -100, arm_l_near: -20, arm_u_far: -90, arm_l_far: -20, weapon: w, shield: s, rootY: 20, rot: -45, ...T(0, -10) }),
    K(1, { torso: -30, head: -40, leg_u_near: -60, leg_l_near: 30, leg_u_far: -30, leg_l_far: 30, arm_u_near: -120, arm_l_near: -10, arm_u_far: -110, arm_l_far: -10, weapon: w + 30, shield: s, rootY: 44, rot: -88, ...T(-10, -20) }),
  ]);
  c.dodge = clip(380, [
    K(0, { torso: 30, head: -10, leg_u_near: -60, leg_l_near: 90, leg_u_far: -40, leg_l_far: 90, arm_u_near: -80, arm_l_near: -80, arm_u_far: -80, arm_l_far: -80, weapon: w, shield: s, rootY: 10, rot: 0, ...T(60, 50) }),
    K(1, { torso: 30, head: -10, leg_u_near: -60, leg_l_near: 90, leg_u_far: -40, leg_l_far: 90, arm_u_near: -80, arm_l_near: -80, arm_u_far: -80, arm_l_far: -80, weapon: w, shield: s, rootY: 10, rot: 360, ...T(60, 50) }),
  ], { linear: true });

  // --- attacks ---------------------------------------------------------------------------
  // Generic sword slash (overhead -> forward sweep). Hit window at 0.38..0.55.
  c.slash = clip(620, [
    K(0, { torso: -8, head: 4, leg_u_near: -20, leg_l_near: 16, leg_u_far: 16, leg_l_far: 10, arm_u_near: 120, arm_l_near: -60, arm_u_far: 20, arm_l_far: -40, weapon: w - 40, shield: s, rootY: 0 }),
    K(0.3, { torso: -14, head: 8, leg_u_near: -24, leg_l_near: 16, leg_u_far: 18, leg_l_far: 10, arm_u_near: 150, arm_l_near: -70, arm_u_far: 20, arm_l_far: -40, weapon: w - 50, shield: s, rootY: -2 }),
    K(0.45, { torso: 22, head: -6, leg_u_near: -36, leg_l_near: 30, leg_u_far: 20, leg_l_far: 40, arm_u_near: -80, arm_l_near: -20, arm_u_far: 30, arm_l_far: -30, weapon: w + 30, shield: s, rootX: 6, rootY: 4 }),
    K(0.62, { torso: 26, head: -8, leg_u_near: -40, leg_l_near: 34, leg_u_far: 24, leg_l_far: 44, arm_u_near: -110, arm_l_near: -10, arm_u_far: 30, arm_l_far: -30, weapon: w + 60, shield: s, rootX: 8, rootY: 6 }),
    K(1, { torso: 4, head: 0, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, arm_u_near: idleArm, arm_l_near: -10, arm_u_far: idleArm, arm_l_far: -12, weapon: w, shield: s, rootX: 0, rootY: 0 }),
  ], { events: [{ t: 0.3, name: 'swing' }, { t: 0.38, name: 'hit_on' }, { t: 0.6, name: 'hit_off' }, { t: 0.7, name: 'recover' }] });

  // Spear thrust: hold spear horizontal, lunge forward.
  c.thrust = clip(700, [
    K(0, { torso: -6, head: 2, leg_u_near: -16, leg_l_near: 10, leg_u_far: 14, leg_l_far: 10, arm_u_near: 60, arm_l_near: -30, arm_u_far: 40, arm_l_far: -60, weapon: 70, rootY: 0 }),
    K(0.35, { torso: -12, head: 4, leg_u_near: -20, leg_l_near: 10, leg_u_far: 16, leg_l_far: 10, arm_u_near: 80, arm_l_near: -20, arm_u_far: 50, arm_l_far: -60, weapon: 60, rootX: -6, rootY: 0 }),
    K(0.5, { torso: 20, head: -4, leg_u_near: -50, leg_l_near: 40, leg_u_far: 24, leg_l_far: 50, arm_u_near: -60, arm_l_near: -40, arm_u_far: -20, arm_l_far: -60, weapon: 100, rootX: 16, rootY: 6 }),
    K(0.65, { torso: 20, head: -4, leg_u_near: -50, leg_l_near: 40, leg_u_far: 24, leg_l_far: 50, arm_u_near: -70, arm_l_near: -40, arm_u_far: -20, arm_l_far: -60, weapon: 100, rootX: 18, rootY: 6 }),
    K(1, { torso: 0, head: 0, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, arm_u_near: 60, arm_l_near: -30, arm_u_far: 40, arm_l_far: -60, weapon: 70, rootX: 0, rootY: 0 }),
  ], { events: [{ t: 0.35, name: 'swing' }, { t: 0.42, name: 'hit_on' }, { t: 0.66, name: 'hit_off' }, { t: 0.75, name: 'recover' }] });

  // Heavy overhead (axe / two-handed). Long windup.
  c.overhead = clip(1100, [
    K(0, { torso: -10, head: 6, leg_u_near: -16, leg_l_near: 10, leg_u_far: 14, leg_l_far: 10, arm_u_near: 140, arm_l_near: -30, arm_u_far: 130, arm_l_far: -40, weapon: w - 30, rootY: 0 }),
    K(0.4, { torso: -22, head: 10, leg_u_near: -20, leg_l_near: 12, leg_u_far: 16, leg_l_far: 12, arm_u_near: 170, arm_l_near: -20, arm_u_far: 160, arm_l_far: -30, weapon: w - 40, rootY: -4 }),
    K(0.52, { torso: 34, head: -10, leg_u_near: -46, leg_l_near: 50, leg_u_far: 20, leg_l_far: 60, arm_u_near: -70, arm_l_near: -30, arm_u_far: -60, arm_l_far: -40, weapon: w + 70, rootX: 10, rootY: 10 }),
    K(0.7, { torso: 36, head: -10, leg_u_near: -46, leg_l_near: 50, leg_u_far: 20, leg_l_far: 60, arm_u_near: -80, arm_l_near: -30, arm_u_far: -70, arm_l_far: -40, weapon: w + 80, rootX: 10, rootY: 12 }),
    K(1, { torso: 4, head: 0, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, arm_u_near: idleArm, arm_l_near: -10, arm_u_far: idleArm, arm_l_far: -12, weapon: w, rootX: 0, rootY: 0 }),
  ], { events: [{ t: 0.42, name: 'swing' }, { t: 0.5, name: 'hit_on' }, { t: 0.68, name: 'hit_off' }, { t: 0.8, name: 'recover' }] });

  // Wide horizontal sweep (boss). Hits both sides-ish; long range.
  c.sweep = clip(1000, [
    K(0, { torso: -6, head: 4, arm_u_near: 60, arm_l_near: -90, arm_u_far: 50, arm_l_far: -90, weapon: w + 90, leg_u_near: -14, leg_l_near: 10, leg_u_far: 12, leg_l_far: 10, rootY: 0 }),
    K(0.4, { torso: -10, head: 6, arm_u_near: 100, arm_l_near: -100, arm_u_far: 90, arm_l_far: -100, weapon: w + 120, leg_u_near: -14, leg_l_near: 10, leg_u_far: 12, leg_l_far: 10, rootY: -2 }),
    K(0.55, { torso: 24, head: -6, arm_u_near: -100, arm_l_near: -40, arm_u_far: -90, arm_l_far: -40, weapon: w + 90, leg_u_near: -40, leg_l_near: 30, leg_u_far: 30, leg_l_far: 50, rootX: 12, rootY: 6 }),
    K(0.7, { torso: 26, head: -6, arm_u_near: -120, arm_l_near: -30, arm_u_far: -110, arm_l_far: -30, weapon: w + 90, leg_u_near: -40, leg_l_near: 30, leg_u_far: 30, leg_l_far: 50, rootX: 12, rootY: 6 }),
    K(1, { torso: 4, head: 0, arm_u_near: idleArm, arm_l_near: -10, arm_u_far: idleArm, arm_l_far: -12, weapon: w, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, rootX: 0, rootY: 0 }),
  ], { events: [{ t: 0.42, name: 'swing' }, { t: 0.5, name: 'hit_on' }, { t: 0.72, name: 'hit_off' }, { t: 0.8, name: 'recover' }] });

  c.guard = clip(400, [
    K(0, { torso: -4, head: 0, arm_u_near: 30, arm_l_near: -60, arm_u_far: -40, arm_l_far: -90, weapon: w, shield: 90, leg_u_near: -16, leg_l_near: 12, leg_u_far: 14, leg_l_far: 10 }),
    K(1, { torso: -4, head: 0, arm_u_near: 32, arm_l_near: -62, arm_u_far: -42, arm_l_far: -92, weapon: w, shield: 90, leg_u_near: -16, leg_l_near: 12, leg_u_far: 14, leg_l_far: 10 }),
  ], { loop: true });

  c.stagger = clip(500, [
    K(0, { torso: -30, head: -20, arm_u_near: -40, arm_l_near: -40, arm_u_far: -40, arm_l_far: -40, weapon: w, shield: s, leg_u_near: 20, leg_l_near: 20, leg_u_far: -10, leg_l_far: 20, rootY: 4 }),
    K(0.5, { torso: -24, head: -16, arm_u_near: -30, arm_l_near: -30, arm_u_far: -30, arm_l_far: -30, weapon: w, shield: s, leg_u_near: 16, leg_l_near: 16, leg_u_far: -8, leg_l_far: 16, rootY: 2 }),
    K(1, { torso: 0, head: 0, arm_u_near: idleArm, arm_l_near: -10, arm_u_far: idleArm, arm_l_far: -12, weapon: w, shield: s, leg_u_near: -6, leg_l_near: 8, leg_u_far: 8, leg_l_far: 4, rootY: 0 }),
  ]);
  return c;
}

// The beast fights with claws: faster, lunging swipes.
export function beastClips() {
  const c = humanoidClips({ tail: true, idleArm: 20, runLean: 22 });
  const T = (a, b) => ({ tail1: a, tail2: b });
  // hunched idle with heavy breathing and tail sway
  c.idle = clip(1500, [
    K(0, { torso: 4, head: -8, arm_u_near: 24, arm_l_near: -10, arm_u_far: 28, arm_l_far: -14, leg_u_near: -14, leg_l_near: 24, leg_u_far: 10, leg_l_far: 12, rootY: 0, ...T(40, 20) }),
    K(0.5, { torso: 8, head: -10, arm_u_near: 28, arm_l_near: -16, arm_u_far: 32, arm_l_far: -20, leg_u_near: -14, leg_l_near: 26, leg_u_far: 10, leg_l_far: 14, rootY: 3, ...T(52, 36) }),
  ], { loop: true });
  // Claw swipe 1: near arm horizontal swipe. Hit 0.3..0.5
  c.attack1 = clip(380, [
    K(0, { torso: -4, head: 2, arm_u_near: 110, arm_l_near: -40, arm_u_far: 30, arm_l_far: -30, leg_u_near: -20, leg_l_near: 20, leg_u_far: 14, leg_l_far: 14, rootY: 0, ...T(60, 30) }),
    K(0.22, { torso: -8, head: 4, arm_u_near: 130, arm_l_near: -50, arm_u_far: 30, arm_l_far: -30, leg_u_near: -24, leg_l_near: 22, leg_u_far: 16, leg_l_far: 14, rootY: -2, ...T(70, 40) }),
    K(0.42, { torso: 22, head: -6, arm_u_near: -100, arm_l_near: -30, arm_u_far: 50, arm_l_far: -40, leg_u_near: -40, leg_l_near: 40, leg_u_far: 24, leg_l_far: 40, rootX: 10, rootY: 4, ...T(30, 10) }),
    K(0.6, { torso: 24, head: -6, arm_u_near: -120, arm_l_near: -20, arm_u_far: 50, arm_l_far: -40, leg_u_near: -40, leg_l_near: 40, leg_u_far: 24, leg_l_far: 40, rootX: 10, rootY: 4, ...T(24, 8) }),
    K(1, { torso: 6, head: -6, arm_u_near: 24, arm_l_near: -12, arm_u_far: 28, arm_l_far: -14, leg_u_near: -14, leg_l_near: 24, leg_u_far: 10, leg_l_far: 12, rootX: 0, rootY: 0, ...T(40, 20) }),
  ], { events: [{ t: 0.22, name: 'swing' }, { t: 0.3, name: 'hit_on' }, { t: 0.55, name: 'hit_off' }, { t: 0.5, name: 'recover' }] });
  // Claw swipe 2: far arm uppercut-ish rake
  c.attack2 = clip(400, [
    K(0, { torso: 10, head: -6, arm_u_near: -40, arm_l_near: -40, arm_u_far: 90, arm_l_far: -30, leg_u_near: -30, leg_l_near: 30, leg_u_far: 20, leg_l_far: 30, rootY: 2, ...T(30, 10) }),
    K(0.22, { torso: 0, head: 0, arm_u_near: -20, arm_l_near: -50, arm_u_far: 120, arm_l_far: -40, leg_u_near: -26, leg_l_near: 26, leg_u_far: 18, leg_l_far: 24, rootY: 0, ...T(50, 20) }),
    K(0.45, { torso: 26, head: -10, arm_u_near: 30, arm_l_near: -60, arm_u_far: -120, arm_l_far: -30, leg_u_near: -40, leg_l_near: 40, leg_u_far: 26, leg_l_far: 44, rootX: 12, rootY: 6, ...T(20, 0) }),
    K(0.62, { torso: 28, head: -10, arm_u_near: 30, arm_l_near: -60, arm_u_far: -140, arm_l_far: -20, leg_u_near: -40, leg_l_near: 40, leg_u_far: 26, leg_l_far: 44, rootX: 12, rootY: 6, ...T(20, 0) }),
    K(1, { torso: 6, head: -6, arm_u_near: 24, arm_l_near: -12, arm_u_far: 28, arm_l_far: -14, leg_u_near: -14, leg_l_near: 24, leg_u_far: 10, leg_l_far: 12, rootX: 0, rootY: 0, ...T(40, 20) }),
  ], { events: [{ t: 0.22, name: 'swing' }, { t: 0.32, name: 'hit_on' }, { t: 0.58, name: 'hit_off' }, { t: 0.55, name: 'recover' }] });
  // Claw 3: both-arm lunge slam, bigger knockback
  c.attack3 = clip(520, [
    K(0, { torso: -10, head: 6, arm_u_near: 140, arm_l_near: -60, arm_u_far: 140, arm_l_far: -60, leg_u_near: -20, leg_l_near: 20, leg_u_far: 16, leg_l_far: 16, rootY: 0, ...T(70, 50) }),
    K(0.3, { torso: -18, head: 10, arm_u_near: 165, arm_l_near: -70, arm_u_far: 165, arm_l_far: -70, leg_u_near: -30, leg_l_near: 40, leg_u_far: 20, leg_l_far: 30, rootY: -6, ...T(80, 60) }),
    K(0.45, { torso: 34, head: -14, arm_u_near: -90, arm_l_near: -20, arm_u_far: -90, arm_l_far: -20, leg_u_near: -50, leg_l_near: 50, leg_u_far: 30, leg_l_far: 60, rootX: 22, rootY: 8, ...T(20, 0) }),
    K(0.65, { torso: 36, head: -14, arm_u_near: -100, arm_l_near: -10, arm_u_far: -100, arm_l_far: -10, leg_u_near: -50, leg_l_near: 50, leg_u_far: 30, leg_l_far: 60, rootX: 24, rootY: 8, ...T(10, -10) }),
    K(1, { torso: 6, head: -6, arm_u_near: 24, arm_l_near: -12, arm_u_far: 28, arm_l_far: -14, leg_u_near: -14, leg_l_near: 24, leg_u_far: 10, leg_l_far: 12, rootX: 0, rootY: 0, ...T(40, 20) }),
  ], { events: [{ t: 0.3, name: 'swing' }, { t: 0.4, name: 'hit_on' }, { t: 0.62, name: 'hit_off' }, { t: 0.72, name: 'recover' }] });
  // Heavy: charged overhead rend. Long windup, huge hit.
  c.heavy = clip(900, [
    K(0, { torso: -14, head: 10, arm_u_near: 150, arm_l_near: -60, arm_u_far: 150, arm_l_far: -60, leg_u_near: -16, leg_l_near: 16, leg_u_far: 14, leg_l_far: 14, rootY: 0, ...T(70, 50) }),
    K(0.45, { torso: -26, head: 14, arm_u_near: 175, arm_l_near: -80, arm_u_far: 175, arm_l_far: -80, leg_u_near: -24, leg_l_near: 30, leg_u_far: 20, leg_l_far: 30, rootY: -8, ...T(90, 70) }),
    K(0.56, { torso: 40, head: -16, arm_u_near: -60, arm_l_near: -50, arm_u_far: -60, arm_l_far: -50, leg_u_near: -54, leg_l_near: 56, leg_u_far: 30, leg_l_far: 70, rootX: 26, rootY: 14, ...T(10, -10) }),
    K(0.75, { torso: 42, head: -16, arm_u_near: -70, arm_l_near: -40, arm_u_far: -70, arm_l_far: -40, leg_u_near: -54, leg_l_near: 56, leg_u_far: 30, leg_l_far: 70, rootX: 26, rootY: 14, ...T(0, -20) }),
    K(1, { torso: 6, head: -6, arm_u_near: 24, arm_l_near: -12, arm_u_far: 28, arm_l_far: -14, leg_u_near: -14, leg_l_near: 24, leg_u_far: 10, leg_l_far: 12, rootX: 0, rootY: 0, ...T(40, 20) }),
  ], { events: [{ t: 0.45, name: 'swing' }, { t: 0.52, name: 'hit_on' }, { t: 0.74, name: 'hit_off' }, { t: 0.82, name: 'recover' }] });
  c.charge = clip(600, [
    K(0, { torso: -16, head: 10, arm_u_near: 160, arm_l_near: -70, arm_u_far: 160, arm_l_far: -70, leg_u_near: -20, leg_l_near: 24, leg_u_far: 16, leg_l_far: 20, rootY: -2, ...T(80, 60) }),
    K(1, { torso: -20, head: 12, arm_u_near: 168, arm_l_near: -74, arm_u_far: 168, arm_l_far: -74, leg_u_near: -22, leg_l_near: 26, leg_u_far: 18, leg_l_far: 22, rootY: -4, ...T(90, 70) }),
  ], { loop: true });
  c.air_attack = clip(420, [
    K(0, { torso: 10, head: -6, arm_u_near: 120, arm_l_near: -40, arm_u_far: 120, arm_l_far: -40, leg_u_near: -40, leg_l_near: 60, leg_u_far: 10, leg_l_far: 40, ...T(70, 50) }),
    K(0.4, { torso: 40, head: -14, arm_u_near: -80, arm_l_near: -20, arm_u_far: -80, arm_l_far: -20, leg_u_near: -50, leg_l_near: 60, leg_u_far: 20, leg_l_far: 50, ...T(30, 10) }),
    K(1, { torso: 30, head: -10, arm_u_near: -90, arm_l_near: -10, arm_u_far: -90, arm_l_far: -10, leg_u_near: -40, leg_l_near: 50, leg_u_far: 20, leg_l_far: 50, ...T(40, 20) }),
  ], { events: [{ t: 0.2, name: 'swing' }, { t: 0.3, name: 'hit_on' }, { t: 0.7, name: 'hit_off' }, { t: 0.7, name: 'recover' }] });
  return c;
}

export function batClips() {
  const c = {};
  c.fly = clip(260, [
    K(0, { wing_near: -60, wing_far: -50, torso: 0, rootY: -3 }),
    K(0.5, { wing_near: 50, wing_far: 60, torso: 6, rootY: 3 }),
  ], { loop: true });
  c.idle = c.fly;
  c.run = c.fly;
  c.hurt = clip(200, [K(0, { wing_near: -80, wing_far: -80, torso: -20 }), K(1, { wing_near: -70, wing_far: -70, torso: -10 })]);
  c.death = clip(500, [K(0, { wing_near: -90, wing_far: -90, torso: 0, rot: 0 }), K(1, { wing_near: 20, wing_far: 20, torso: 0, rot: 180, rootY: 30 })]);
  c.attack = clip(400, [
    K(0, { wing_near: -70, wing_far: -70, torso: -10 }),
    K(0.4, { wing_near: 60, wing_far: 60, torso: 30, rootX: 14 }),
    K(1, { wing_near: -40, wing_far: -40, torso: 0, rootX: 0 }),
  ], { events: [{ t: 0.3, name: 'hit_on' }, { t: 0.6, name: 'hit_off' }, { t: 0.7, name: 'recover' }] });
  return c;
}
