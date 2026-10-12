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
  // Low, forward-loaded stance: hips down, shoulders over the knees, claws hanging ready.
  c.idle = clip(1700, [
    K(0, { torso: 16, head: -14, arm_u_near: 34, arm_l_near: -34, arm_u_far: 40, arm_l_far: -40, leg_u_near: -30, leg_l_near: 46, leg_u_far: 4, leg_l_far: 26, rootY: 8, ...T(44, 24) }),
    K(0.5, { torso: 20, head: -16, arm_u_near: 38, arm_l_near: -40, arm_u_far: 44, arm_l_far: -46, leg_u_near: -32, leg_l_near: 50, leg_u_far: 4, leg_l_far: 28, rootY: 12, ...T(56, 40) }),
  ], { loop: true });
  // Lope: big driving strides, deep knee bend at contact, arms swinging low and back, head forward.
  c.run = clip(520, [
    K(0, { torso: 30, head: -16, leg_u_near: -56, leg_l_near: 26, leg_u_far: 44, leg_l_far: 78, arm_u_near: 46, arm_l_near: -74, arm_u_far: -34, arm_l_far: -60, rootY: 6, ...T(62, 38) }),
    K(0.25, { torso: 33, head: -14, leg_u_near: 4, leg_l_near: 44, leg_u_far: 10, leg_l_far: 24, arm_u_near: 8, arm_l_near: -70, arm_u_far: 4, arm_l_far: -66, rootY: -4, ...T(52, 48) }),
    K(0.5, { torso: 30, head: -16, leg_u_near: 44, leg_l_near: 78, leg_u_far: -56, leg_l_far: 26, arm_u_near: -34, arm_l_near: -60, arm_u_far: 46, arm_l_far: -74, rootY: 6, ...T(62, 38) }),
    K(0.75, { torso: 33, head: -14, leg_u_near: 10, leg_l_near: 24, leg_u_far: 4, leg_l_far: 44, arm_u_near: 4, arm_l_near: -66, arm_u_far: 8, arm_l_far: -70, rootY: -4, ...T(52, 48) }),
  ], { loop: true, events: [{ t: 0.02, name: 'step' }, { t: 0.52, name: 'step' }] });
  // Coiled launch: legs tucked hard, arms thrown back, body folded forward.
  c.jump = clip(380, [
    K(0, { torso: 26, head: -12, leg_u_near: -62, leg_l_near: 96, leg_u_far: -20, leg_l_far: 60, arm_u_near: 70, arm_l_near: -60, arm_u_far: 60, arm_l_far: -50, rootY: 0, ...T(70, 50) }),
    K(1, { torso: 18, head: -10, leg_u_near: -46, leg_l_near: 80, leg_u_far: -10, leg_l_far: 50, arm_u_near: 90, arm_l_near: -36, arm_u_far: 80, arm_l_far: -30, rootY: 0, ...T(80, 60) }),
  ]);
  // Falling: claws forward and down, knees up, braced for the ground.
  c.fall = clip(500, [
    K(0, { torso: 12, head: -4, leg_u_near: -40, leg_l_near: 50, leg_u_far: -6, leg_l_far: 44, arm_u_near: -36, arm_l_near: -40, arm_u_far: -28, arm_l_far: -40, rootY: 0, ...T(86, 64) }),
    K(1, { torso: 14, head: -2, leg_u_near: -46, leg_l_near: 56, leg_u_far: -10, leg_l_far: 50, arm_u_near: -44, arm_l_near: -36, arm_u_far: -36, arm_l_far: -36, rootY: 0, ...T(96, 72) }),
  ], { loop: true });
  // Soft landing: a quick dip through the knees.
  c.land = clip(190, [
    K(0, { torso: 32, head: -14, leg_u_near: -50, leg_l_near: 84, leg_u_far: 6, leg_l_far: 70, arm_u_near: 10, arm_l_near: -60, arm_u_far: 10, arm_l_far: -60, rootY: 16, ...T(50, 36) }),
    K(1, { torso: 16, head: -14, arm_u_near: 34, arm_l_near: -34, arm_u_far: 40, arm_l_far: -40, leg_u_near: -30, leg_l_near: 46, leg_u_far: 4, leg_l_far: 26, rootY: 8, ...T(44, 24) }),
  ]);
  // Hard landing: a deep three-point squat, one hand slammed to the ground, then rise.
  c.land_hard = clip(360, [
    K(0, { torso: 46, head: -20, leg_u_near: -74, leg_l_near: 104, leg_u_far: 0, leg_l_far: 92, arm_u_near: -84, arm_l_near: -36, arm_u_far: 20, arm_l_far: -70, rootY: 30, ...T(26, 8) }),
    K(0.35, { torso: 46, head: -20, leg_u_near: -74, leg_l_near: 104, leg_u_far: 0, leg_l_far: 92, arm_u_near: -84, arm_l_near: -36, arm_u_far: 20, arm_l_far: -70, rootY: 30, ...T(30, 10) }),
    K(1, { torso: 16, head: -14, arm_u_near: 34, arm_l_near: -34, arm_u_far: 40, arm_l_far: -40, leg_u_near: -30, leg_l_near: 46, leg_u_far: 4, leg_l_far: 26, rootY: 8, ...T(44, 24) }),
  ]);
  // Turn skid: feet planted, leading leg braced against the momentum, body leaning back into the turn.
  c.skid = clip(160, [
    K(0, { torso: 6, head: -8, leg_u_near: -58, leg_l_near: 16, leg_u_far: 30, leg_l_far: 60, arm_u_near: 60, arm_l_near: -50, arm_u_far: 40, arm_l_far: -60, rootY: 12, ...T(70, 50) }),
    K(1, { torso: 10, head: -8, leg_u_near: -50, leg_l_near: 20, leg_u_far: 26, leg_l_far: 56, arm_u_near: 50, arm_l_near: -50, arm_u_far: 34, arm_l_far: -60, rootY: 10, ...T(60, 44) }),
  ]);
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
  // Heavy: ground slam. Both arms rise, the beast leaps up a touch, then slams claws into the earth.
  c.heavy = clip(820, [
    K(0, { torso: -12, head: 8, arm_u_near: 150, arm_l_near: -60, arm_u_far: 150, arm_l_far: -60, leg_u_near: -16, leg_l_near: 16, leg_u_far: 14, leg_l_far: 14, rootY: 0, ...T(70, 50) }),
    K(0.3, { torso: -28, head: 14, arm_u_near: 180, arm_l_near: -70, arm_u_far: 180, arm_l_far: -70, leg_u_near: -30, leg_l_near: 44, leg_u_far: 24, leg_l_far: 40, rootY: -14, ...T(90, 70) }),
    K(0.46, { torso: 48, head: -18, arm_u_near: -40, arm_l_near: -60, arm_u_far: -40, arm_l_far: -60, leg_u_near: -70, leg_l_near: 90, leg_u_far: 10, leg_l_far: 80, rootX: 18, rootY: 26, ...T(0, -20) }),
    K(0.7, { torso: 52, head: -18, arm_u_near: -36, arm_l_near: -70, arm_u_far: -36, arm_l_far: -70, leg_u_near: -72, leg_l_near: 92, leg_u_far: 10, leg_l_far: 82, rootX: 18, rootY: 28, ...T(-10, -24) }),
    K(1, { torso: 6, head: -6, arm_u_near: 24, arm_l_near: -12, arm_u_far: 28, arm_l_far: -14, leg_u_near: -14, leg_l_near: 24, leg_u_far: 10, leg_l_far: 12, rootX: 0, rootY: 0, ...T(40, 20) }),
  ], { events: [{ t: 0.3, name: 'swing' }, { t: 0.44, name: 'slam' }, { t: 0.44, name: 'hit_on' }, { t: 0.66, name: 'hit_off' }, { t: 0.78, name: 'recover' }] });
  c.charge = clip(600, [
    K(0, { torso: -16, head: 10, arm_u_near: 160, arm_l_near: -70, arm_u_far: 160, arm_l_far: -70, leg_u_near: -20, leg_l_near: 24, leg_u_far: 16, leg_l_far: 20, rootY: -2, ...T(80, 60) }),
    K(1, { torso: -20, head: 12, arm_u_near: 168, arm_l_near: -74, arm_u_far: 168, arm_l_far: -74, leg_u_near: -22, leg_l_near: 26, leg_u_far: 18, leg_l_far: 22, rootY: -4, ...T(90, 70) }),
  ], { loop: true });
  c.air_attack = clip(420, [
    K(0, { torso: 10, head: -6, arm_u_near: 120, arm_l_near: -40, arm_u_far: 120, arm_l_far: -40, leg_u_near: -40, leg_l_near: 60, leg_u_far: 10, leg_l_far: 40, ...T(70, 50) }),
    K(0.4, { torso: 40, head: -14, arm_u_near: -80, arm_l_near: -20, arm_u_far: -80, arm_l_far: -20, leg_u_near: -50, leg_l_near: 60, leg_u_far: 20, leg_l_far: 50, ...T(30, 10) }),
    K(1, { torso: 30, head: -10, arm_u_near: -90, arm_l_near: -10, arm_u_far: -90, arm_l_far: -10, leg_u_near: -40, leg_l_near: 50, leg_u_far: 20, leg_l_far: 50, ...T(40, 20) }),
  ], { events: [{ t: 0.2, name: 'swing' }, { t: 0.3, name: 'hit_on' }, { t: 0.7, name: 'hit_off' }, { t: 0.7, name: 'recover' }] });
  // Defend: arms crossed in front, low crouch; loops with a tense breath.
  c.guard = clip(900, [
    K(0, { torso: 10, head: -6, arm_u_near: -70, arm_l_near: -110, arm_u_far: -60, arm_l_far: -120, leg_u_near: -30, leg_l_near: 36, leg_u_far: 22, leg_l_far: 30, rootY: 8, ...T(40, 20) }),
    K(0.5, { torso: 12, head: -7, arm_u_near: -72, arm_l_near: -112, arm_u_far: -62, arm_l_far: -122, leg_u_near: -30, leg_l_near: 38, leg_u_far: 22, leg_l_far: 32, rootY: 10, ...T(48, 28) }),
  ], { loop: true });
  // Blocked a hit: recoil backward then return to the guard pose.
  c.guard_hit = clip(260, [
    K(0, { torso: -6, head: 4, arm_u_near: -50, arm_l_near: -100, arm_u_far: -40, arm_l_far: -110, leg_u_near: -24, leg_l_near: 30, leg_u_far: 26, leg_l_far: 30, rootX: -10, rootY: 10, ...T(20, 10) }),
    K(1, { torso: 10, head: -6, arm_u_near: -70, arm_l_near: -110, arm_u_far: -60, arm_l_far: -120, leg_u_near: -30, leg_l_near: 36, leg_u_far: 22, leg_l_far: 30, rootX: 0, rootY: 8, ...T(40, 20) }),
  ]);
  // Parry: a sharp outward sweep of the near arm that knocks the attack aside.
  c.parry = clip(320, [
    K(0, { torso: 6, head: -4, arm_u_near: -60, arm_l_near: -110, arm_u_far: -60, arm_l_far: -120, leg_u_near: -30, leg_l_near: 36, leg_u_far: 22, leg_l_far: 30, rootY: 8, ...T(40, 20) }),
    K(0.35, { torso: 18, head: -8, arm_u_near: -130, arm_l_near: -10, arm_u_far: -40, arm_l_far: -100, leg_u_near: -40, leg_l_near: 40, leg_u_far: 26, leg_l_far: 40, rootX: 8, rootY: 6, ...T(20, 0) }),
    K(1, { torso: 10, head: -6, arm_u_near: -70, arm_l_near: -110, arm_u_far: -60, arm_l_far: -120, leg_u_near: -30, leg_l_near: 36, leg_u_far: 22, leg_l_far: 30, rootX: 0, rootY: 8, ...T(40, 20) }),
  ]);
  // Ladder climb (loops, speed follows the climb): reach up with one claw while the opposite knee drives
  // up, pull through with the body hugging the rungs, then the other side. Rung grabs fire `rung`.
  const CLIMB_A = { torso: -6, head: -18, arm_u_near: 176, arm_l_near: -20, arm_u_far: 118, arm_l_far: -70, leg_u_near: -84, leg_l_near: 96, leg_u_far: -16, leg_l_far: 30, rootX: 2, rootY: 0, ...T(76, 64) };
  const CLIMB_B = { torso: -8, head: -16, arm_u_near: 150, arm_l_near: -44, arm_u_far: 146, arm_l_far: -48, leg_u_near: -50, leg_l_near: 64, leg_u_far: -50, leg_l_far: 64, rootX: 4, rootY: -6, ...T(70, 70) };
  const CLIMB_C = { torso: -6, head: -18, arm_u_near: 118, arm_l_near: -70, arm_u_far: 176, arm_l_far: -20, leg_u_near: -16, leg_l_near: 30, leg_u_far: -84, leg_l_far: 96, rootX: 2, rootY: 0, ...T(64, 76) };
  c.climb = clip(760, [K(0, CLIMB_A), K(0.25, CLIMB_B), K(0.5, CLIMB_C), K(0.75, { ...CLIMB_B, ...T(74, 66) })],
    { loop: true, events: [{ t: 0.02, name: 'rung' }, { t: 0.52, name: 'rung' }] });
  // Hanging still on the rungs: both claws hooked above, knees up, a slow breathing sway.
  c.climb_hold = clip(1500, [
    K(0, { torso: -6, head: -14, arm_u_near: 160, arm_l_near: -36, arm_u_far: 150, arm_l_far: -46, leg_u_near: -60, leg_l_near: 76, leg_u_far: -36, leg_l_far: 56, rootX: 2, rootY: 0, ...T(70, 60) }),
    K(0.5, { torso: -8, head: -12, arm_u_near: 158, arm_l_near: -40, arm_u_far: 148, arm_l_far: -50, leg_u_near: -62, leg_l_near: 78, leg_u_far: -38, leg_l_far: 58, rootX: 3, rootY: -3, ...T(76, 66) }),
  ], { loop: true });
  // Topping out: claws planted on the ledge, one knee thrown up over the edge, press up and stand.
  c.climb_top = clip(380, [
    K(0, { torso: 10, head: -16, arm_u_near: 160, arm_l_near: -60, arm_u_far: 150, arm_l_far: -60, leg_u_near: -70, leg_l_near: 90, leg_u_far: -30, leg_l_far: 50, rootX: 2, rootY: 0, ...T(70, 60) }),
    K(0.4, { torso: 40, head: -22, arm_u_near: -70, arm_l_near: -60, arm_u_far: -60, arm_l_far: -70, leg_u_near: -110, leg_l_near: 100, leg_u_far: -20, leg_l_far: 60, rootX: 14, rootY: 10, ...T(50, 30) }),
    K(0.75, { torso: 30, head: -16, arm_u_near: -30, arm_l_near: -60, arm_u_far: 10, arm_l_far: -60, leg_u_near: -60, leg_l_near: 80, leg_u_far: 10, leg_l_far: 50, rootX: 18, rootY: 16, ...T(44, 24) }),
    K(1, { torso: 16, head: -14, arm_u_near: 34, arm_l_near: -34, arm_u_far: 40, arm_l_far: -40, leg_u_near: -30, leg_l_near: 46, leg_u_far: 4, leg_l_far: 26, rootX: 0, rootY: 8, ...T(44, 24) }),
  ]);
  // Stairs up: a driving climb, knees punched high, body leaning into the slope, claws swinging low.
  c.stairs_up = clip(560, [
    K(0, { torso: 36, head: -16, leg_u_near: -80, leg_l_near: 70, leg_u_far: 30, leg_l_far: 40, arm_u_near: 40, arm_l_near: -70, arm_u_far: -30, arm_l_far: -60, rootY: 10, ...T(60, 40) }),
    K(0.25, { torso: 38, head: -14, leg_u_near: -40, leg_l_near: 30, leg_u_far: 0, leg_l_far: 50, arm_u_near: 10, arm_l_near: -70, arm_u_far: 0, arm_l_far: -66, rootY: -2, ...T(54, 48) }),
    K(0.5, { torso: 36, head: -16, leg_u_near: 30, leg_l_near: 40, leg_u_far: -80, leg_l_far: 70, arm_u_near: -30, arm_l_near: -60, arm_u_far: 40, arm_l_far: -70, rootY: 10, ...T(60, 40) }),
    K(0.75, { torso: 38, head: -14, leg_u_near: 0, leg_l_near: 50, leg_u_far: -40, leg_l_far: 30, arm_u_near: 0, arm_l_near: -66, arm_u_far: 10, arm_l_far: -70, rootY: -2, ...T(54, 48) }),
  ], { loop: true, events: [{ t: 0.02, name: 'step' }, { t: 0.52, name: 'step' }] });
  // Stairs down: shorter, braced steps, weight back, the leading foot feeling for the next tread.
  c.stairs_down = clip(520, [
    K(0, { torso: 8, head: -10, leg_u_near: -44, leg_l_near: 20, leg_u_far: 20, leg_l_far: 70, arm_u_near: 50, arm_l_near: -50, arm_u_far: 20, arm_l_far: -60, rootY: 8, ...T(64, 44) }),
    K(0.25, { torso: 10, head: -10, leg_u_near: -10, leg_l_near: 50, leg_u_far: 0, leg_l_far: 40, arm_u_near: 30, arm_l_near: -56, arm_u_far: 30, arm_l_far: -56, rootY: 2, ...T(58, 50) }),
    K(0.5, { torso: 8, head: -10, leg_u_near: 20, leg_l_near: 70, leg_u_far: -44, leg_l_far: 20, arm_u_near: 20, arm_l_near: -60, arm_u_far: 50, arm_l_far: -50, rootY: 8, ...T(64, 44) }),
    K(0.75, { torso: 10, head: -10, leg_u_near: 0, leg_l_near: 40, leg_u_far: -10, leg_l_far: 50, arm_u_near: 30, arm_l_near: -56, arm_u_far: 30, arm_l_far: -56, rootY: 2, ...T(58, 50) }),
  ], { loop: true, events: [{ t: 0.02, name: 'step' }, { t: 0.52, name: 'step' }] });
  // Wall cling: facing the wall, claws dug in above, knees drawn up against the stone, sliding slowly.
  c.wall_slide = clip(900, [
    K(0, { torso: -10, head: -16, arm_u_near: 150, arm_l_near: -50, arm_u_far: 140, arm_l_far: -60, leg_u_near: -70, leg_l_near: 80, leg_u_far: -40, leg_l_far: 60, rootX: 4, rootY: 0, ...T(60, 30) }),
    K(0.5, { torso: -12, head: -14, arm_u_near: 154, arm_l_near: -46, arm_u_far: 144, arm_l_far: -56, leg_u_near: -74, leg_l_near: 84, leg_u_far: -44, leg_l_far: 64, rootX: 4, rootY: -4, ...T(66, 36) }),
  ], { loop: true });
  // Wall kick: legs driven straight into the stone, body thrown out and away, claws trailing.
  c.wall_jump = clip(360, [
    K(0, { torso: 20, head: -12, arm_u_near: 90, arm_l_near: -60, arm_u_far: 80, arm_l_far: -50, leg_u_near: 30, leg_l_near: 20, leg_u_far: 40, leg_l_far: 10, rootY: 0, ...T(80, 60) }),
    K(1, { torso: 14, head: -10, arm_u_near: 100, arm_l_near: -30, arm_u_far: 90, arm_l_far: -30, leg_u_near: -40, leg_l_near: 70, leg_u_far: -10, leg_l_far: 50, rootY: 0, ...T(86, 64) }),
  ]);
  // Backstep: a quick hop backward, legs tucked, arms trailing forward.
  c.backstep = clip(340, [
    K(0, { torso: -14, head: 4, arm_u_near: -60, arm_l_near: -40, arm_u_far: -50, arm_l_far: -40, leg_u_near: -30, leg_l_near: 40, leg_u_far: 20, leg_l_far: 40, rootY: 2, ...T(60, 40) }),
    K(0.4, { torso: -26, head: 8, arm_u_near: -90, arm_l_near: -30, arm_u_far: -80, arm_l_far: -30, leg_u_near: 20, leg_l_near: 90, leg_u_far: 40, leg_l_far: 90, rootY: -14, ...T(80, 60) }),
    K(1, { torso: 2, head: -4, arm_u_near: 24, arm_l_near: -12, arm_u_far: 28, arm_l_far: -14, leg_u_near: -14, leg_l_near: 24, leg_u_far: 10, leg_l_far: 12, rootY: 0, ...T(40, 20) }),
  ]);
  // Double jump: a forward somersault (whole body rotates once) with legs tucked.
  c.double_jump = clip(520, [
    K(0, { torso: 10, head: -6, arm_u_near: 60, arm_l_near: -80, arm_u_far: 60, arm_l_far: -80, leg_u_near: -70, leg_l_near: 110, leg_u_far: -60, leg_l_far: 110, rot: 0, ...T(60, 40) }),
    K(0.7, { torso: 10, head: -6, arm_u_near: 60, arm_l_near: -80, arm_u_far: 60, arm_l_far: -80, leg_u_near: -70, leg_l_near: 110, leg_u_far: -60, leg_l_far: 110, rot: 360, ...T(60, 40) }),
    K(1, { torso: -4, head: 6, arm_u_near: 110, arm_l_near: -10, arm_u_far: 100, arm_l_far: -10, leg_u_near: -26, leg_l_near: 34, leg_u_far: 18, leg_l_far: 56, rot: 360, ...T(90, 70) }),
  ], { linear: true });
  return c;
}

// The undead knight (painted rig `undead`, every humanoid enemy). Poses follow the concept sheet:
// a hunched IDLE with the sword hanging low, a lurching MARCH behind the shield, a two-handed WIND-UP
// over the head into a lunging ATTACK, the IMPACT recoil, and a COLLAPSE onto the knees.
// Sword convention as above: the blade continues the forearm at 180, points forward at 90.
export function undeadClips(o = {}) {
  const c = humanoidClips(o);
  const shield = !!o.shield;
  const w = 138;                     // blade hanging down-forward from the lowered arm
  const sh = shield ? 112 : 0;       // shield upright on the raised far forearm
  // far arm: with a shield it is carried bent in front of the chest, otherwise it swings free
  const farRest = shield ? { arm_u_far: -16, arm_l_far: -96, shield: sh } : { arm_u_far: 18, arm_l_far: -14, shield: 0 };
  const farGuard = { arm_u_far: -30, arm_l_far: -112, shield: sh };
  const IDLE = { torso: 12, head: 10, arm_u_near: 14, arm_l_near: -30, weapon: w, ...farRest, leg_u_near: -16, leg_l_near: 14, leg_u_far: 14, leg_l_far: 6, rootX: 0, rootY: 4 };
  c.idle = clip(1900, [
    K(0, IDLE),
    K(0.5, { ...IDLE, torso: 15, head: 12, arm_u_near: 17, arm_l_near: -34, leg_l_near: 16, leg_l_far: 8, rootY: 7 }),
  ], { loop: true });
  // march: a heavy lurch, the sword trailing low, the far arm (and shield) held up front
  const stride = (dur, lean, su, sl, bob, ev) => clip(dur, [
    K(0, { torso: lean, head: 8, leg_u_near: -su, leg_l_near: 10, leg_u_far: su * 0.7, leg_l_far: sl, arm_u_near: 24, arm_l_near: -26, weapon: w, ...(shield ? farGuard : { arm_u_far: -su * 0.6, arm_l_far: -30, shield: 0 }), rootY: bob }),
    K(0.25, { torso: lean + 3, head: 10, leg_u_near: 2, leg_l_near: 26, leg_u_far: 8, leg_l_far: 16, arm_u_near: 16, arm_l_near: -30, weapon: w, ...(shield ? farGuard : { arm_u_far: 4, arm_l_far: -24, shield: 0 }), rootY: -bob }),
    K(0.5, { torso: lean, head: 8, leg_u_near: su * 0.7, leg_l_near: sl, leg_u_far: -su, leg_l_far: 10, arm_u_near: 8, arm_l_near: -34, weapon: w, ...(shield ? farGuard : { arm_u_far: su * 0.6, arm_l_far: -16, shield: 0 }), rootY: bob }),
    K(0.75, { torso: lean + 3, head: 10, leg_u_near: 8, leg_l_near: 16, leg_u_far: 2, leg_l_far: 26, arm_u_near: 16, arm_l_near: -30, weapon: w, ...(shield ? farGuard : { arm_u_far: 4, arm_l_far: -24, shield: 0 }), rootY: -bob }),
  ], { loop: true, events: ev });
  const steps = [{ t: 0.05, name: 'step' }, { t: 0.55, name: 'step' }];
  c.walk = stride(820, 12, 26, 36, 2, steps);
  c.run = stride(540, 20, 40, 60, 4, steps);
  // stairs: high knee lift on the way up, short braced steps leaning back on the way down
  c.stairs_up = clip(640, [
    K(0, { torso: 20, head: 6, leg_u_near: -70, leg_l_near: 60, leg_u_far: 20, leg_l_far: 20, arm_u_near: 20, arm_l_near: -30, weapon: w, ...farRest, rootY: 6 }),
    K(0.25, { torso: 22, head: 6, leg_u_near: -30, leg_l_near: 20, leg_u_far: 10, leg_l_far: 40, arm_u_near: 14, arm_l_near: -32, weapon: w, ...farRest, rootY: -2 }),
    K(0.5, { torso: 20, head: 6, leg_u_near: 20, leg_l_near: 20, leg_u_far: -70, leg_l_far: 60, arm_u_near: 8, arm_l_near: -34, weapon: w, ...farRest, rootY: 6 }),
    K(0.75, { torso: 22, head: 6, leg_u_near: 10, leg_l_near: 40, leg_u_far: -30, leg_l_far: 20, arm_u_near: 14, arm_l_near: -32, weapon: w, ...farRest, rootY: -2 }),
  ], { loop: true, events: steps });
  c.stairs_down = clip(600, [
    K(0, { torso: -2, head: 16, leg_u_near: -30, leg_l_near: 6, leg_u_far: 10, leg_l_far: 50, arm_u_near: 26, arm_l_near: -24, weapon: w, ...farRest, rootY: 2 }),
    K(0.25, { torso: 0, head: 16, leg_u_near: -6, leg_l_near: 24, leg_u_far: 0, leg_l_far: 30, arm_u_near: 20, arm_l_near: -26, weapon: w, ...farRest, rootY: -2 }),
    K(0.5, { torso: -2, head: 16, leg_u_near: 10, leg_l_near: 50, leg_u_far: -30, leg_l_far: 6, arm_u_near: 14, arm_l_near: -28, weapon: w, ...farRest, rootY: 2 }),
    K(0.75, { torso: 0, head: 16, leg_u_near: 0, leg_l_near: 30, leg_u_far: -6, leg_l_far: 24, arm_u_near: 20, arm_l_near: -26, weapon: w, ...farRest, rootY: -2 }),
  ], { loop: true, events: steps });
  // slash: two-handed wind-up over the head, then a lunging horizontal cut. Hit 0.38..0.6.
  c.slash = clip(680, [
    K(0, { torso: -4, head: 4, arm_u_near: 110, arm_l_near: -50, weapon: 220, arm_u_far: 100, arm_l_far: -60, shield: sh, leg_u_near: -18, leg_l_near: 14, leg_u_far: 18, leg_l_far: 10, rootX: 0, rootY: 0 }),
    K(0.3, { torso: -14, head: 10, arm_u_near: 160, arm_l_near: -50, weapon: 240, arm_u_far: 150, arm_l_far: -60, shield: sh, leg_u_near: -24, leg_l_near: 16, leg_u_far: 22, leg_l_far: 12, rootX: -4, rootY: -4 }),
    K(0.45, { torso: 26, head: -4, arm_u_near: -100, arm_l_near: -20, weapon: 194, arm_u_far: 20, arm_l_far: -50, shield: sh, leg_u_near: -46, leg_l_near: 36, leg_u_far: 26, leg_l_far: 50, rootX: 10, rootY: 6 }),
    K(0.62, { torso: 30, head: -6, arm_u_near: -124, arm_l_near: -10, weapon: 200, arm_u_far: 24, arm_l_far: -50, shield: sh, leg_u_near: -48, leg_l_near: 38, leg_u_far: 28, leg_l_far: 52, rootX: 12, rootY: 8 }),
    K(1, { ...IDLE, weapon: w }),
  ], { events: [{ t: 0.3, name: 'swing' }, { t: 0.38, name: 'hit_on' }, { t: 0.6, name: 'hit_off' }, { t: 0.72, name: 'recover' }] });
  // thrust: the blade levelled, a long lunge forward. Hit 0.42..0.66.
  c.thrust = clip(720, [
    K(0, { torso: -4, head: 4, arm_u_near: 30, arm_l_near: -90, weapon: 158, ...farRest, leg_u_near: -16, leg_l_near: 10, leg_u_far: 14, leg_l_far: 10, rootX: 0, rootY: 0 }),
    K(0.35, { torso: -12, head: 6, arm_u_near: 50, arm_l_near: -110, weapon: 156, ...farRest, leg_u_near: -20, leg_l_near: 10, leg_u_far: 18, leg_l_far: 12, rootX: -8, rootY: 0 }),
    K(0.5, { torso: 22, head: -4, arm_u_near: -74, arm_l_near: -40, weapon: 182, arm_u_far: 40, arm_l_far: -30, shield: sh, leg_u_near: -52, leg_l_near: 40, leg_u_far: 24, leg_l_far: 54, rootX: 18, rootY: 6 }),
    K(0.66, { torso: 22, head: -4, arm_u_near: -82, arm_l_near: -36, weapon: 182, arm_u_far: 40, arm_l_far: -30, shield: sh, leg_u_near: -52, leg_l_near: 40, leg_u_far: 24, leg_l_far: 54, rootX: 20, rootY: 6 }),
    K(1, { ...IDLE, weapon: w }),
  ], { events: [{ t: 0.35, name: 'swing' }, { t: 0.42, name: 'hit_on' }, { t: 0.66, name: 'hit_off' }, { t: 0.76, name: 'recover' }] });
  // overhead: a slow two-handed chop (boss). Hit 0.5..0.68.
  c.overhead = clip(1100, [
    K(0, { torso: -8, head: 6, arm_u_near: 150, arm_l_near: -36, weapon: 214, arm_u_far: 140, arm_l_far: -46, shield: sh, leg_u_near: -16, leg_l_near: 10, leg_u_far: 14, leg_l_far: 10, rootX: 0, rootY: 0 }),
    K(0.4, { torso: -18, head: 10, arm_u_near: 178, arm_l_near: -30, weapon: 208, arm_u_far: 168, arm_l_far: -40, shield: sh, leg_u_near: -22, leg_l_near: 12, leg_u_far: 18, leg_l_far: 12, rootX: -4, rootY: -6 }),
    K(0.52, { torso: 32, head: -8, arm_u_near: -60, arm_l_near: -20, weapon: 190, arm_u_far: -50, arm_l_far: -30, shield: sh, leg_u_near: -46, leg_l_near: 50, leg_u_far: 20, leg_l_far: 60, rootX: 10, rootY: 12 }),
    K(0.7, { torso: 36, head: -8, arm_u_near: -56, arm_l_near: -16, weapon: 186, arm_u_far: -46, arm_l_far: -30, shield: sh, leg_u_near: -46, leg_l_near: 50, leg_u_far: 20, leg_l_far: 60, rootX: 10, rootY: 14 }),
    K(1, { ...IDLE, weapon: w }),
  ], { events: [{ t: 0.42, name: 'swing' }, { t: 0.5, name: 'hit_on' }, { t: 0.68, name: 'hit_off' }, { t: 0.8, name: 'recover' }] });
  // sweep: the blade drawn back level, then swung round in a wide arc (boss). Hit 0.5..0.72.
  c.sweep = clip(1000, [
    K(0, { torso: -6, head: 4, arm_u_near: 70, arm_l_near: -90, weapon: 296, arm_u_far: 40, arm_l_far: -80, shield: sh, leg_u_near: -14, leg_l_near: 10, leg_u_far: 12, leg_l_far: 10, rootX: 0, rootY: 0 }),
    K(0.4, { torso: -10, head: 6, arm_u_near: 100, arm_l_near: -100, weapon: 300, arm_u_far: 60, arm_l_far: -90, shield: sh, leg_u_near: -14, leg_l_near: 10, leg_u_far: 12, leg_l_far: 10, rootX: -6, rootY: -2 }),
    K(0.55, { torso: 24, head: -6, arm_u_near: -100, arm_l_near: -30, weapon: 196, arm_u_far: -40, arm_l_far: -40, shield: sh, leg_u_near: -40, leg_l_near: 30, leg_u_far: 30, leg_l_far: 50, rootX: 12, rootY: 6 }),
    K(0.7, { torso: 26, head: -6, arm_u_near: -126, arm_l_near: -20, weapon: 200, arm_u_far: -50, arm_l_far: -40, shield: sh, leg_u_near: -40, leg_l_near: 30, leg_u_far: 30, leg_l_far: 50, rootX: 12, rootY: 6 }),
    K(1, { ...IDLE, weapon: w }),
  ], { events: [{ t: 0.42, name: 'swing' }, { t: 0.5, name: 'hit_on' }, { t: 0.72, name: 'hit_off' }, { t: 0.8, name: 'recover' }] });
  // guard: shield braced in front, sword drawn back ready
  c.guard = clip(400, [
    K(0, { torso: -4, head: 2, arm_u_near: 40, arm_l_near: -60, weapon: 170, ...farGuard, leg_u_near: -18, leg_l_near: 14, leg_u_far: 16, leg_l_far: 10, rootY: 2 }),
    K(1, { torso: -6, head: 2, arm_u_near: 42, arm_l_near: -62, weapon: 170, ...farGuard, leg_u_near: -18, leg_l_near: 14, leg_u_far: 16, leg_l_far: 10, rootY: 2 }),
  ], { loop: true });
  // impact: thrown back, head snapped back, both arms flung up
  c.hurt = clip(340, [
    K(0, { torso: -26, head: -22, arm_u_near: -56, arm_l_near: -70, weapon: 150, arm_u_far: -100, arm_l_far: -30, shield: sh, leg_u_near: -18, leg_l_near: 20, leg_u_far: 20, leg_l_far: 10, rootX: -4, rootY: 4 }),
    K(0.6, { torso: -14, head: -12, arm_u_near: -30, arm_l_near: -50, weapon: 146, arm_u_far: -60, arm_l_far: -30, shield: sh, leg_u_near: -16, leg_l_near: 16, leg_u_far: 16, leg_l_far: 10, rootX: -2, rootY: 2 }),
    K(1, IDLE),
  ]);
  c.stagger = clip(520, [
    K(0, { torso: -34, head: -26, arm_u_near: -60, arm_l_near: -70, weapon: 150, arm_u_far: -110, arm_l_far: -30, shield: sh, leg_u_near: 20, leg_l_near: 20, leg_u_far: -14, leg_l_far: 24, rootX: -6, rootY: 6 }),
    K(0.5, { torso: -26, head: -18, arm_u_near: -40, arm_l_near: -60, weapon: 148, arm_u_far: -80, arm_l_far: -30, shield: sh, leg_u_near: 16, leg_l_near: 16, leg_u_far: -10, leg_l_far: 20, rootX: -4, rootY: 4 }),
    K(1, IDLE),
  ]);
  // collapse: the knees buckle, it drops onto them and folds forward, the sword slipping from the hand
  c.death = clip(1000, [
    K(0, { torso: -12, head: -10, arm_u_near: -30, arm_l_near: -50, weapon: 150, arm_u_far: -60, arm_l_far: -30, shield: sh, leg_u_near: -20, leg_l_near: 20, leg_u_far: 16, leg_l_far: 10, rootX: 0, rootY: 2 }),
    K(0.35, { torso: 18, head: 14, arm_u_near: -40, arm_l_near: -20, weapon: 150, arm_u_far: -50, arm_l_far: -20, shield: sh, leg_u_near: -30, leg_l_near: 90, leg_u_far: -20, leg_l_far: 80, rootX: 0, rootY: 44 }),
    K(0.6, { torso: 42, head: 36, arm_u_near: -36, arm_l_near: -10, weapon: 156, arm_u_far: -34, arm_l_far: -10, shield: sh, leg_u_near: 2, leg_l_near: 96, leg_u_far: 10, leg_l_far: 92, rootX: 2, rootY: 70 }),
    K(1, { torso: 66, head: 58, arm_u_near: -70, arm_l_near: 0, weapon: 160, arm_u_far: -64, arm_l_far: 0, shield: sh, leg_u_near: 4, leg_l_near: 96, leg_u_far: 12, leg_l_far: 92, rootX: 4, rootY: 76 }),
  ]);
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
