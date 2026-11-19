/**
 * All gameplay tuning numbers live here (SPEC §0.4, Appendix A).
 * Units: meters, milliseconds, meters/second unless noted.
 */
const BASE = {
  // --- Simulation clock (SPEC §1.3, §3.1) ---
  TICK_HZ: 30,
  TICK_MS: 1000 / 30,
  MAX_CATCHUP_STEPS: 3,

  // --- Arena (A.2) ---
  ARENA_RADIUS: 5, // rings → 91 tiles
  TILE_WIDTH: 1.2, // across flats (pointy-top hex)
  SPAWN_RADIUS: 3 * 1.2, // ~3 rings from center
  SPAWN_ANGLE_OFFSET: Math.PI / 4,

  // --- Floor collapse (A.3) ---
  WARNING_MS: 1000,
  SINKING_MS: 400,
  EDGE_SHRINK_START_MS: 10_000,
  /** SPEC A.3 says 10 s; 20 s chosen so the floor lasts to sudden death — see DECISIONS.md D-M1-1. */
  EDGE_SHRINK_INTERVAL_MS: 20_000,
  EDGE_RIPPLE_STAGGER_MS: 300,
  RANDOM_TILE_START_MS: 15_000,
  /** SPEC A.3 says 1.5 s; 3 s chosen — see DECISIONS.md D-M1-1. */
  RANDOM_TILE_INTERVAL_MS: 3000,
  /** Before sudden death, edge shrink never takes rings below this (keeps a 7-tile final ring). */
  MIN_EDGE_RING_BEFORE_SUDDEN_DEATH: 2,
  NO_ISOLATION_UNTIL_MS: 30_000,
  SUDDEN_DEATH_AT_MS: 90_000,
  SUDDEN_DEATH_RANDOM_RATE_MULT: 3,
  SUDDEN_DEATH_EDGE_INTERVAL_MS: 4000,

  // --- Movement (A.4) ---
  PLAYER_RADIUS: 0.45,
  BASE_SPEED: 3.5, // maxSpeed = BASE_SPEED + SPEED_PER_AGILITY * agility
  SPEED_PER_AGILITY: 0.5,
  /** How quickly velocity approaches the input target (1/s). Lower = more slippery. */
  ACCEL_RATE: 7,
  /** Decay of over-speed (knockback) velocity while steering (1/s). Keeps shoves meaningful. */
  KNOCKBACK_DECAY_RATE: 3.3,
  /** Velocity decay while hit-stunned or falling (1/s). */
  STUN_DECAY_RATE: 1.5,

  // --- Shove (§3.1, A.4) ---
  /** Tuned so a full-speed charge pushes a passive player ≈ 1.8 m (1.5 tiles). See DECISIONS.md D-M1-2. */
  BASE_KNOCK: 0.78,
  MIN_SHOVE_SPEED: 1.2,
  POWER_MULT_BASE: 0.6, // powerMult = 0.6 + 0.2 * power
  POWER_MULT_PER_POINT: 0.2,
  ENDURANCE_MULT_BASE: 0.6, // enduranceMult = 0.6 + 0.2 * endurance
  ENDURANCE_MULT_PER_POINT: 0.2,
  HIT_STUN_MS: 150,
  /** A fall within this window after being shoved is credited to the shover. */
  SHOVE_CREDIT_MS: 2500,

  // --- Skills ---
  SLAM_WINDUP_MS: 400,
  SLAM_RADIUS: 2.0,
  SLAM_COOLDOWN_MS: 8000,
  /** Base outward speed of slam knockback, before power/endurance multipliers. */
  SLAM_KNOCK_SPEED: 4.5,
  DASH_DISTANCE: 4,
  DASH_DURATION_MS: 250,
  DASH_COOLDOWN_MS: 6000,
  DASH_KNOCK_MULT: 1.5,
  SHELL_DURATION_MS: 1500,
  SHELL_COOLDOWN_MS: 10_000,
  /** Multiplier on the full-force reflection a shelled turtle gives attackers. */
  SHELL_REFLECT_MULT: 1.0,

  // --- Ember spirits & lava rocks ---
  SPIRIT_RING_RADIUS: 7.2,
  /** rad/s the joystick's sideways part drifts a spirit around the ring. */
  SPIRIT_DRIFT_SPEED: 1.2,
  ROCK_FLIGHT_MS: 600,
  ROCK_RANGE: 9,
  ROCK_AIM_CONE_DEG: 30,
  ROCK_COOLDOWN_MS: 4000,
  ROCK_HIT_RADIUS: 0.9,
  ROCK_STAGGER_MS: 200,

  // --- Elimination (A.2) ---
  FALL_ELIMINATE_MS: 500,

  // --- Input validation (§2.4) ---
  MAX_INPUT_LENGTH: 1,
} as const;

/**
 * Shove impulse of a full-speed Elephant on a stationary Elephant. Assumes
 * Elephant stats power 5 / agility 2 / endurance 3 (characters.ts); derived
 * here from base numbers because characters.ts imports this file.
 */
const REFERENCE_SHOVE_SPEED =
  (BASE.BASE_KNOCK *
    (BASE.POWER_MULT_BASE + BASE.POWER_MULT_PER_POINT * 5) *
    (BASE.BASE_SPEED + BASE.SPEED_PER_AGILITY * 2)) /
  (BASE.ENDURANCE_MULT_BASE + BASE.ENDURANCE_MULT_PER_POINT * 3);

export const CONFIG = {
  ...BASE,
  REFERENCE_SHOVE_SPEED,
  /** Rock knockback: a flat 30% of a reference shove (not scaled by power/endurance). */
  ROCK_KNOCK_SPEED: 0.3 * REFERENCE_SHOVE_SPEED,
} as const;

export type Config = typeof CONFIG;
