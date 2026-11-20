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

  // --- Eruption (SPEC §2.4) ---
  ERUPTION_MIN_MS: 30_000,
  ERUPTION_MAX_MS: 50_000,
  ERUPTION_TELEGRAPH_MS: 1500,
  ERUPTION_TARGETS_MIN: 3,
  ERUPTION_TARGETS_MAX: 4,
  ERUPTION_RADIUS: 1.5,
  ERUPTION_STUN_MS: 200,

  // --- Elimination (A.2) ---
  FALL_ELIMINATE_MS: 500,

  // --- Input validation (§2.4) ---
  MAX_INPUT_LENGTH: 1,

  // --- Bots (SPEC §3.4). Tuned with `pnpm --filter @lava-sumo/shared sim`; see DECISIONS.md "Solo Quick Play". ---
  BOT_THINK_MS: 100,
  /** A decision made at time t takes effect at t + reaction. */
  BOT_REACTION_MS: { easy: 600, medium: 300, hard: 120 },
  /** Uniform random [0, noise) added to every candidate direction's score. */
  BOT_NOISE: { easy: 1.0, medium: 0.8, hard: 0.15 },
  /** Chance to take a skill opportunity when one is seen at a think. */
  BOT_SKILL_USE: { easy: 0.08, medium: 0.5, hard: 1 },
  /** Candidate move directions per think (plus "stand still"). */
  BOT_DIRECTIONS: 16,
  /** Path samples (s ahead) used to score a direction; ≤ 0.9 m apart at top speed so holes are not skipped. */
  BOT_LOOKAHEAD_S: [0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8],
  /** Warned-tile safety: min(CAP, -1 + SLOPE × timeLeft / warnSenseMs). */
  BOT_WARNING_SAFETY_CAP: 0.5,
  BOT_WARNING_SAFETY_SLOPE: 1.5,
  /** Pressure: aim this far behind a near-edge opponent; within SNAP of that spot, push through them. */
  BOT_PRESSURE_BEHIND_M: 0.8,
  BOT_PRESSURE_SNAP_M: 0.5,
  /** Pressure/chase attraction falls off as 1 / (1 + FALLOFF × distance). */
  BOT_DISTANCE_FALLOFF: 0.3,
  /** Easy's wander direction changes every MIN..MAX ms. */
  BOT_WANDER_MIN_MS: 1500,
  BOT_WANDER_MAX_MS: 3000,
  /**
   * Threat penalties: MULT × ramp(distance, zone radius + MARGIN), evaluated at the threat's
   * impact time (at least MIN_HORIZON_S ahead).
   */
  BOT_THREAT: {
    SLAM: { MULT: 3, MARGIN: 0.5, MIN_HORIZON_S: 0.3 },
    DASH: { MULT: 2, MARGIN: 0.3, MIN_HORIZON_S: 0.2 },
    ERUPTION: { MULT: 2, MARGIN: 0.4, MIN_HORIZON_S: 0.2 },
    ROCK: { MULT: 1.5, MARGIN: 0.3, MIN_HORIZON_S: 0.1 },
  },
  /** Skill triggers. "sloppy" = Easy (skillSmart 0), "aimed" = Medium/Hard. */
  BOT_SKILL: {
    /** floorSafety above this counts as safe footing for a skill. */
    SAFE_FLOOR: 0.5,
    /** Slam when a target is within SLAM_RADIUS + offset. */
    SLAM_RANGE_OFFSET: { sloppy: 1, aimed: -0.2 },
    /** Dash at a target within DASH_DISTANCE + offset. */
    DASH_RANGE_OFFSET: { sloppy: 1, aimed: -0.3 },
    /** Escape-dash when our tile sinks within this many ms. */
    DASH_ESCAPE_SINK_MS: 300,
    /** Aimed dash: the floor this far short of the target must be safe this many ms after the press. */
    DASH_PROBE_BEHIND_M: 0.9,
    DASH_PROBE_MS: 300,
    /** Hard dash: the push must point at least this much toward the target's nearest hole. */
    DASH_ALIGN_MIN: 0.3,
    /** Dash target preference: alignment − this × distance. */
    DASH_DIST_PENALTY: 0.1,
    /** Sloppy shell: any opponent this close. */
    SHELL_SLOPPY_M: 1.2,
    /** Aimed shell: an opponent closing faster than CLOSING_MIN within CHARGE_M (+ closing × reaction). */
    SHELL_CHARGE_M: 1.6,
    SHELL_CLOSING_MIN: 1.5,
    /** Aimed shell also covers slam wind-ups (radius + margin) and eruption/rock blasts (radius + margin). */
    SHELL_WINDUP_MARGIN: 0.3,
    SHELL_BLAST_MARGIN: 0.3,
  },
  /** Spirits only pick targets this far inside ROCK_RANGE. */
  BOT_SPIRIT_RANGE_MARGIN: 0.3,
  BOT_WEIGHTS: {
    easy: {
      floor: 2, warnSenseMs: 500, edge: 1, edgeCap: 1.5, center: 0.05, pressure: 0.3, chase: 0.25,
      threat: 0, threatLead: 0, wander: 0.6, inertia: 0.2, skillSmart: 0, speed: 0.7,
    },
    medium: {
      floor: 4, warnSenseMs: 1000, edge: 1.4, edgeCap: 2.5, center: 0.25, pressure: 1.2, chase: 0.35,
      threat: 1.5, threatLead: 0, wander: 0, inertia: 0.25, skillSmart: 1, speed: 1,
    },
    hard: {
      floor: 5, warnSenseMs: 1800, edge: 1.8, edgeCap: 3, center: 0.2, pressure: 3, chase: 0.4,
      threat: 4, threatLead: 1, wander: 0, inertia: 0.25, skillSmart: 2, speed: 1,
    },
  },

  // --- Online multiplayer (net) ---
  NET_SNAP_MS: 50,
  NET_INTERP_DELAY_MS: 100,
  NET_COUNTDOWN_MS: 3000,
  NET_RECONNECT_MS: 15_000,
  NET_EMPTY_ROOM_MS: 30_000,
  NET_MAX_HUMANS: 4,
  NET_INPUT_MAX_PER_SEC: 15,
  NET_INPUT_KEEPALIVE_MS: 1000,
  NET_ABUSE_KICK_MS: 5000,
  NET_RESYNC_FRAC: 0.1,
  NET_HARD_RESYNC_MS: 250,
  NET_INPUT_MAX_QUEUE: 4,
  /** Server-side per-connection message limit (looser than the client's NET_INPUT_MAX_PER_SEC to absorb jitter). */
  NET_SERVER_MSG_MAX_PER_SEC: 30,
  /** A connected player silent this long during a match gets zero input until they speak again. */
  NET_SILENT_INPUT_MS: 2500,
  /** LOBBY/RESULTS rooms with no member message for this long are retired. */
  NET_IDLE_ROOM_MS: 600_000,
  NET_HTTP_TIMEOUT_MS: 8000,
  NET_CONNECT_TIMEOUT_MS: 8000,
  // --- Client match presentation ---
  GO_DISPLAY_MS: 600,
  SOLO_COUNTDOWN_MS: 3000,
  // Pause after the match ends before the results screen, so the last fall plays out.
  RESULTS_DELAY_MS: 1100,
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
  /** Eruption knockback: a flat 40% of a reference shove. */
  ERUPTION_KNOCK_SPEED: 0.4 * REFERENCE_SHOVE_SPEED,
} as const;

export type Config = typeof CONFIG;
