// Global tuning constants. Everything that defines "feel" lives here so it can be tuned in one place.
export const WIDTH = 1600;
export const HEIGHT = 900;
// The world keeps the original 1280x720 design scale (ground at y=600); the larger canvas shows
// more of it, so characters appear 20% smaller. VIEW_TOP is the world y at the top of the screen.
export const DESIGN_HEIGHT = 720;
export const VIEW_TOP = DESIGN_HEIGHT - HEIGHT;
export const BG_SCALE = HEIGHT / DESIGN_HEIGHT;   // screen-fixed parallax layers are scaled to fill the taller view
export const ZOOM_STEPS = [0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3];
export const DEFAULT_ZOOM = 1.0;

export const GRAVITY = 3100;   // heavy, fast arcs; jump impulses below are matched so heights stay similar

export const PLAYER = {
  runSpeed: 350,
  runAccel: 1900,              // wind-up: a beat to reach full stride
  airAccel: 1150,
  friction: 2300,              // momentum carries a little after the stick is released
  turnSkidSpeed: 170,          // reversing above this speed plants the feet and skids
  turnSkidMs: 140,
  jumpVelocity: -1060,
  jumpCutMultiplier: 0.5,      // releasing jump early shortens the arc
  coyoteTime: 110,             // ms after leaving a ledge during which jump still works
  jumpBuffer: 120,             // ms a jump press is remembered before landing
  maxFallSpeed: 1750,
  hardLandFall: 330,           // fall distance (px) that triggers the heavy landing squat
  hardLandLock: 210,           // ms of recovery after a hard landing (attacks and jumps still cancel it)
  dodgeSpeed: 560,             // backstep: horizontal speed away from facing
  dodgeHop: -380,              // backstep: small hop
  dodgeDuration: 300,
  dodgeInvuln: 240,
  dodgeStamina: 18,
  doubleJumpVelocity: -940,
  blockDamageMult: 0.2,        // damage taken through a raised guard
  blockStamina: 14,            // stamina per blocked hit
  wallSlideSpeed: 240,         // max fall speed while clinging to a wall
  wallJumpVX: 440, wallJumpVY: -980,
  wallJumpLock: 150,           // ms after a wall jump during which the stick cannot steer back into the wall
  wallCoyote: 110,             // ms after leaving a wall during which a wall jump still counts
  stairsUpSpeed: 0.86,         // run speed multiplier climbing a stair slope
  climbSpeed: 230,
  climbOffset: 18,             // how far the body hangs to the side of a ladder's centre line
  parryWindow: 160,            // ms after raising the guard during which a hit is parried
  parryStagger: 900,
  lightStamina: 12,
  heavyStamina: 30,
  staminaRegen: 28,            // per second
  staminaRegenDelay: 500,      // ms after spending before regen resumes
  hurtInvuln: 700,
  bodyWidth: 46,
  bodyHeight: 108,
};

export const COMBAT = {
  hitStopMs: 70,
  heavyHitStopMs: 120,
  knockback: 260,
  heavyKnockback: 520,
  critChanceBase: 0.06,
  critMultiplier: 1.8,
};

export const DEPTH = {
  bgFar: -100,
  world: 0,
  props: 5,
  pickups: 8,
  enemies: 10,
  player: 20,
  fx: 30,
  foreground: 50,
  hud: 100,
};
