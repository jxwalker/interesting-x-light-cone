/**
 * Minkowski spacetime in 2+1 dimensions, units with c = 1. Pure: no DOM, no three.js.
 *
 * Events are (t, x, y). A boost with velocity v (|v| < 1) in the direction at angle θ in the
 * x-y plane maps Home's coordinates to those of an observer moving at v relative to Home:
 *   t' = γ (t − v n·r),   r' = r + (γ − 1)(n·r) n − γ v t n,   n = (cos θ, sin θ)
 * which along x is the familiar t' = γ(t − v x), x' = γ(x − v t), y' = y.
 * Interval convention: s² = Δt² − Δx² − Δy² ("time part minus space part").
 */

export interface Ev {
  t: number;
  x: number;
  y: number;
}

export type PairType = "timelike" | "lightlike" | "spacelike";

/** 3×3 matrix, row-major, acting on column vectors (t, x, y). */
export type Mat3 = Float64Array;

/** Largest speed the UI and the maths accept (keeps γ finite). */
export const V_MAX = 0.999;

export const clampV = (v: number) => Math.max(-V_MAX, Math.min(V_MAX, Number.isFinite(v) ? v : 0));

/** Time-stretch factor γ = 1/√(1 − v²). */
export function gammaOf(v: number): number {
  const c = clampV(v);
  return 1 / Math.sqrt(1 - c * c);
}

/** Rapidity φ = atanh v: the quantity that simply adds when boosts along one line compose. */
export function rapidity(v: number): number {
  return Math.atanh(clampV(v));
}

export function speedFromRapidity(phi: number): number {
  return Math.tanh(phi);
}

/** Relativistic velocity addition along one line: (u + v) / (1 + u v). */
export function addVelocities(u: number, v: number): number {
  return (u + v) / (1 + u * v);
}

/** The Lorentz boost Λ(v, θ): Home coordinates → coordinates of an observer moving at v along θ. */
export function boostMatrix(v: number, angle = 0, out: Mat3 = new Float64Array(9)): Mat3 {
  const b = clampV(v);
  const g = 1 / Math.sqrt(1 - b * b);
  const c = Math.cos(angle), s = Math.sin(angle);
  const k = g - 1;
  out[0] = g;
  out[1] = -g * b * c;
  out[2] = -g * b * s;
  out[3] = -g * b * c;
  out[4] = 1 + k * c * c;
  out[5] = k * c * s;
  out[6] = -g * b * s;
  out[7] = k * c * s;
  out[8] = 1 + k * s * s;
  return out;
}

export function mulMat(a: Mat3, b: Mat3, out: Mat3 = new Float64Array(9)): Mat3 {
  const r = new Float64Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  out.set(r);
  return out;
}

export function apply(m: Mat3, e: Ev, out: Ev = { t: 0, x: 0, y: 0 }): Ev {
  const t = m[0] * e.t + m[1] * e.x + m[2] * e.y;
  const x = m[3] * e.t + m[4] * e.x + m[5] * e.y;
  const y = m[6] * e.t + m[7] * e.x + m[8] * e.y;
  out.t = t;
  out.x = x;
  out.y = y;
  return out;
}

/** Shorthand: event as seen by an observer moving at v along θ. */
export function boost(e: Ev, v: number, angle = 0): Ev {
  return apply(boostMatrix(v, angle), e);
}

/** Squared interval s² = Δt² − Δx² − Δy² (same in every frame). */
export function interval2(a: Ev, b: Ev): number {
  const dt = b.t - a.t, dx = b.x - a.x, dy = b.y - a.y;
  return dt * dt - dx * dx - dy * dy;
}

/**
 * Classify a pair by the sign of s². "Lightlike" means |s²| ≤ eps·(Δt² + Δr²): on the cone
 * up to a relative tolerance (exactly zero is unreachable with real numbers you can drag).
 */
export function classify(a: Ev, b: Ev, eps = 1e-9): PairType {
  const dt = b.t - a.t, dx = b.x - a.x, dy = b.y - a.y;
  const s2 = dt * dt - dx * dx - dy * dy;
  const scale = dt * dt + dx * dx + dy * dy;
  if (Math.abs(s2) <= eps * Math.max(scale, 1e-12)) return "lightlike";
  return s2 > 0 ? "timelike" : "spacelike";
}

/** Separation of two events in one frame: time apart and distance apart. */
export function separation(a: Ev, b: Ev): { dt: number; dr: number } {
  return { dt: b.t - a.t, dr: Math.hypot(b.x - a.x, b.y - a.y) };
}

/** Proper time along a world line (a polyline of events): Σ √(Δt² − Δx² − Δy²). */
export function properTime(path: Ev[]): number {
  let tau = 0;
  for (let i = 1; i < path.length; i++) tau += Math.sqrt(Math.max(0, interval2(path[i - 1], path[i])));
  return tau;
}

/**
 * Speed below which the order of two events (b after a) is the same as for Home, and above
 * which it reverses. Only spacelike pairs have one: v_flip = Δt / Δr_∥ along the boost direction.
 * Returns null when no boost (|v| < 1) can flip them.
 */
export function flipSpeed(a: Ev, b: Ev, angle = 0): number | null {
  const dt = b.t - a.t;
  const along = (b.x - a.x) * Math.cos(angle) + (b.y - a.y) * Math.sin(angle);
  if (Math.abs(along) < 1e-12) return null;
  const v = dt / along;
  return Math.abs(v) < 1 ? v : null;
}

export interface TwinTrip {
  /** Rocket's world line in Home coordinates: out at speed v along x, then back. */
  path: Ev[];
  homeTicks: number;
  rocketTicks: number;
  gamma: number;
}

/** Twin trip: Rocket goes out at v for Home-time T/2 and back; Home waits T. */
export function twinTrip(v: number, T: number): TwinTrip {
  const s = Math.abs(clampV(v));
  const half = T / 2;
  const path: Ev[] = [
    { t: 0, x: 0, y: 0 },
    { t: half, x: s * half, y: 0 },
    { t: T, x: 0, y: 0 },
  ];
  const home: Ev[] = [path[0], path[2]];
  return { path, homeTicks: properTime(home), rocketTicks: properTime(path), gamma: gammaOf(s) };
}

/** Point on a polyline world line at proper time τ (clamped to its ends). */
export function atProperTime(path: Ev[], tau: number): Ev {
  let left = Math.max(0, tau);
  for (let i = 1; i < path.length; i++) {
    const seg = Math.sqrt(Math.max(0, interval2(path[i - 1], path[i])));
    if (left <= seg || i === path.length - 1) {
      const f = seg > 0 ? Math.min(1, left / seg) : 0;
      const a = path[i - 1], b = path[i];
      return { t: a.t + (b.t - a.t) * f, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= seg;
  }
  return { ...path[path.length - 1] };
}

/** Proper time elapsed along a polyline up to coordinate (Home) time t. */
export function properTimeAt(path: Ev[], t: number): number {
  let tau = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (t <= a.t) break;
    const f = Math.min(1, (t - a.t) / (b.t - a.t));
    const seg = Math.sqrt(Math.max(0, interval2(a, b)));
    tau += seg * f;
    if (f < 1) break;
  }
  return tau;
}

/** Length contraction: a rod of rest length L0 moving at v is measured as L0/γ. */
export function contractedLength(L0: number, v: number): number {
  return L0 / gammaOf(v);
}

/**
 * Measure a rod honestly: a rod of rest length L0 lying along x and moving with velocity u
 * along x (Home frame). An observer moving at v along θ marks both ends at the same moment of
 * their own time t' = tObs and reports the distance. Returns the two marked ends (observer
 * coordinates) and the length. For θ = 0 this equals L0/γ_rel with v_rel = (u − v)/(1 − u v).
 */
export function measureRod(
  L0: number,
  u: number,
  v: number,
  angle: number,
  tObs: number,
  x0 = 0,
  y0 = 0,
): { a: Ev; b: Ev; length: number } {
  const m = boostMatrix(v, angle);
  const gu = gammaOf(u);
  const end = (offset: number): Ev => {
    // world line: (t, x0 + offset + u t, y0); find t where the observer's t' = tObs
    const p0: Ev = { t: 0, x: x0 + offset, y: y0 };
    const U: Ev = { t: 1, x: u, y: 0 };
    const q0 = apply(m, p0), dq = apply(m, U);
    const s = (tObs - q0.t) / dq.t; // dq.t = γ(1 − v u cosθ) > 0 always
    return { t: tObs, x: q0.x + dq.x * s, y: q0.y + dq.y * s };
  };
  const a = end(0), b = end(L0 / gu);
  return { a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
}

// ───────────────────────── self test ─────────────────────────

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SelfTest {
  intervalInvariant: boolean;
  coneInvariant: boolean;
  timelikeNeverFlips: boolean;
  spacelikeCanFlip: boolean;
  velocityAddition: boolean;
  twinTicks: boolean;
  noNaN: boolean;
  pass: boolean;
  details: {
    maxIntervalError: number;
    maxConeError: number;
    timelikePairs: number;
    spacelikeFlips: number;
    maxCompositionError: number;
    twin: { home: number; rocket: number };
    ms: number;
  };
}

/**
 * Headless checks of the physics: 200 random pairs × 50 random boosts keep s² to 1e-9;
 * light-cone points stay on the cone; no timelike pair ever reverses order while some spacelike
 * pair does; two boosts along x compose to one with (u+v)/(1+uv) (rapidities add); the twin trip
 * at 0.8 c over 10 gives 10 and 6 ticks; nothing goes NaN at 0.999 c.
 */
export function selfTest(seed = 2026): SelfTest {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const rnd = makeRng(seed);
  const r = (a: number, b: number) => a + (b - a) * rnd();
  const boosts: Mat3[] = [];
  for (let k = 0; k < 50; k++) boosts.push(boostMatrix(r(-0.95, 0.95), r(0, Math.PI * 2)));

  let maxIntervalError = 0;
  let timelikePairs = 0;
  let spacelikeFlips = 0;
  let timelikeFlipped = false;
  for (let i = 0; i < 200; i++) {
    const a: Ev = { t: r(-10, 10), x: r(-10, 10), y: r(-10, 10) };
    const b: Ev = { t: r(-10, 10), x: r(-10, 10), y: r(-10, 10) };
    const s2 = interval2(a, b);
    const kind = classify(a, b);
    if (kind === "timelike") timelikePairs++;
    const sign0 = Math.sign(b.t - a.t);
    let flipped = false;
    for (const m of boosts) {
      const a2 = apply(m, a), b2 = apply(m, b);
      const err = Math.abs(interval2(a2, b2) - s2) / Math.max(1, Math.abs(s2));
      maxIntervalError = Math.max(maxIntervalError, err);
      if (Math.sign(b2.t - a2.t) !== sign0) flipped = true;
    }
    if (kind === "timelike" && flipped) timelikeFlipped = true;
    if (kind === "spacelike" && flipped) spacelikeFlips++;
  }
  // also a deliberately chosen timelike pair against extreme boosts
  {
    const a: Ev = { t: 0, x: 0, y: 0 }, b: Ev = { t: 1, x: 0.99, y: 0 };
    for (let k = 0; k <= 40; k++) {
      const v = -0.999 + (k / 40) * 1.998;
      for (const th of [0, 1, 2, 3, 4, 5]) {
        const m = boostMatrix(v, th);
        if (apply(m, b).t - apply(m, a).t <= 0) timelikeFlipped = true;
      }
    }
    timelikePairs++;
  }

  let maxConeError = 0;
  for (let i = 0; i < 100; i++) {
    const t = r(-10, 10), ang = r(0, Math.PI * 2);
    const p: Ev = { t, x: t * Math.cos(ang), y: t * Math.sin(ang) };
    for (const m of boosts) {
      const q = apply(m, p);
      const s2 = q.t * q.t - q.x * q.x - q.y * q.y;
      maxConeError = Math.max(maxConeError, Math.abs(s2) / Math.max(1, q.t * q.t));
    }
  }

  let maxCompositionError = 0;
  for (let k = 0; k < 50; k++) {
    const u = r(-0.95, 0.95), v = r(-0.95, 0.95);
    const two = mulMat(boostMatrix(v, 0), boostMatrix(u, 0));
    const one = boostMatrix(addVelocities(u, v), 0);
    for (let i = 0; i < 9; i++) maxCompositionError = Math.max(maxCompositionError, Math.abs(two[i] - one[i]) / Math.max(1, Math.abs(one[i])));
    maxCompositionError = Math.max(maxCompositionError, Math.abs(rapidity(u) + rapidity(v) - rapidity(addVelocities(u, v))));
  }

  const twin = twinTrip(0.8, 10);

  let finite = true;
  {
    const m = boostMatrix(0.999, 0.7);
    const ev = apply(m, { t: 3, x: -2, y: 5 });
    const vals = [gammaOf(0.999), rapidity(0.999), ev.t, ev.x, ev.y, ...m, contractedLength(4, 0.999), twinTrip(0.999, 10).rocketTicks, measureRod(4, 0.6, 0.999, 1.1, 2).length];
    finite = vals.every(Number.isFinite);
    const s2 = interval2({ t: 0, x: 0, y: 0 }, ev);
    finite = finite && Math.abs(s2 - (9 - 4 - 25)) < 1e-6;
  }

  const res = {
    intervalInvariant: maxIntervalError < 1e-9,
    coneInvariant: maxConeError < 1e-9,
    timelikeNeverFlips: !timelikeFlipped && timelikePairs > 0,
    spacelikeCanFlip: spacelikeFlips > 0,
    velocityAddition: maxCompositionError < 1e-9,
    twinTicks: Math.abs(twin.homeTicks - 10) < 1e-9 && Math.abs(twin.rocketTicks - 6) < 1e-9,
    noNaN: finite,
  };
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    ...res,
    pass: Object.values(res).every(Boolean),
    details: {
      maxIntervalError,
      maxConeError,
      timelikePairs,
      spacelikeFlips,
      maxCompositionError,
      twin: { home: twin.homeTicks, rocket: twin.rocketTicks },
      ms: Math.round((t1 - t0) * 10) / 10,
    },
  };
}
