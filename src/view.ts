/** Renderer-agnostic view interface (WebGL scene or Canvas2D fallback) and shared constants. */
import type { Ev } from "./physics";
import type { Model } from "./model";

export const AMBER = "#ffae4a";
export const TEAL = "#2fd1c5";
export const CYAN = "#6fe7ff";
export const VIOLET = "#b48cff";
export const GOLD = "#ffd36e";
export const PEARL = "#f1e9ff";

export const TYPE_COLOR = { timelike: GOLD, lightlike: CYAN, spacelike: VIOLET } as const;

/** The displayed slab of spacetime (observer coordinates, c = 1). */
export const T_TOP = 14;
export const T_BOT = -11;
export const R_MAX = 14;
/** Height of each glass cone (future and past). */
export const H_CONE = 11;

/** Where the hero should land on screen (CSS px). */
export interface Layout {
  cx: number;
  cy: number;
  /** Desired on-screen height of the instrument. */
  size: number;
  phone: boolean;
}

export interface View {
  readonly kind: "webgl" | "2d";
  readonly canvas: HTMLCanvasElement;
  resize(w: number, h: number, layout: Layout): void;
  render(dt: number, model: Model): void;
  /** Index of the event under the pointer, or −1. */
  pickEvent(clientX: number, clientY: number): number;
  /** Where a tap lands on the "now" sheet, in Home coordinates (null if off the instrument). */
  dropPoint(clientX: number, clientY: number, model: Model): Ev | null;
  /** Drag target for an event, in observer (display) coordinates, keeping its depth. */
  dragPoint(clientX: number, clientY: number, anchor: Ev): Ev | null;
  /** Screen position (client px) of a point in observer coordinates (tests and tooling). */
  project(d: Ev): { x: number; y: number };
  orbit(dx: number, dy: number): void;
  release(): void;
  zoom(f: number): void;
  /** User interaction: pauses the idle camera drift. */
  poke(): void;
  setStepped?(on: boolean): void;
  /** Tests: hold cosmetic motion (camera drift, shimmer, dust, grain) so pixel diffs show only state changes. */
  setFrozen?(on: boolean): void;
  dispose(): void;
}

/** Clip the segment p→q (observer coords) to the displayed cylinder; returns [s0, s1] ⊂ [0,1] or null. */
export function clipSegment(p: Ev, q: Ev, rMax = R_MAX, tBot = T_BOT, tTop = T_TOP): [number, number] | null {
  let s0 = 0, s1 = 1;
  const dt = q.t - p.t;
  if (Math.abs(dt) < 1e-12) {
    if (p.t < tBot || p.t > tTop) return null;
  } else {
    let a = (tBot - p.t) / dt, b = (tTop - p.t) / dt;
    if (a > b) [a, b] = [b, a];
    s0 = Math.max(s0, a);
    s1 = Math.min(s1, b);
  }
  // |p + s d|² ≤ r²  (space part)
  const dx = q.x - p.x, dy = q.y - p.y;
  const A = dx * dx + dy * dy, B = 2 * (p.x * dx + p.y * dy), C = p.x * p.x + p.y * p.y - rMax * rMax;
  if (A < 1e-12) {
    if (C > 0) return null;
  } else {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    s0 = Math.max(s0, (-B - sq) / (2 * A));
    s1 = Math.min(s1, (-B + sq) / (2 * A));
  }
  return s1 > s0 ? [s0, s1] : null;
}

export const lerpEv = (p: Ev, q: Ev, s: number): Ev => ({ t: p.t + (q.t - p.t) * s, x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s });

export function inRegion(e: Ev, pad = 0): boolean {
  return e.t >= T_BOT - pad && e.t <= T_TOP + pad && Math.hypot(e.x, e.y) <= R_MAX + pad;
}
