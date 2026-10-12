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

export const GRAVITY = 2400;

export const PLAYER = {
  runSpeed: 340,
  runAccel: 2600,
  airAccel: 1400,
  friction: 2800,
  jumpVelocity: -900,
  jumpCutMultiplier: 0.45,     // releasing jump early shortens the arc
  coyoteTime: 110,             // ms after leaving a ledge during which jump still works
  jumpBuffer: 120,             // ms a jump press is remembered before landing
  maxFallSpeed: 1500,
  dodgeSpeed: 560,             // backstep: horizontal speed away from facing
  dodgeHop: -330,              // backstep: small hop
  dodgeDuration: 300,
  dodgeInvuln: 240,
  dodgeStamina: 18,
  doubleJumpVelocity: -820,
  blockDamageMult: 0.2,        // damage taken through a raised guard
  blockStamina: 14,            // stamina per blocked hit
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
