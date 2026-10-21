/**
 * The demo's state: events, the selected pair, the current (eased) boost, the "now" sheet,
 * the twin trip and the auto-played opening. Pure TypeScript (no DOM / three.js), driven by
 * step(dt) so the recorder can advance it deterministically.
 */
import {
  apply,
  boostMatrix,
  classify,
  flipSpeed,
  gammaOf,
  interval2,
  measureRod,
  properTimeAt,
  rapidity,
  twinTrip,
  type Ev,
  type Mat3,
  type PairType,
  type TwinTrip,
} from "./physics";

export interface EventItem {
  id: number;
  /** Home-frame coordinates (t, x, y). */
  e: Ev;
  /** 0 → 1 landing animation. */
  pop: number;
  /** 1 → 0 violet pulse after an order flip. */
  pulse: number;
}

export interface PairView {
  a: number; // indices into events
  b: number;
  type: PairType;
  grow: number;
  selected: boolean;
}

export interface PairInfo {
  a: number;
  b: number;
  /** Time apart in the current frame (B minus A). */
  dt: number;
  /** Distance apart in the current frame. */
  dr: number;
  /** s² = Δt² − Δr²: the same in every frame. */
  s2: number;
  type: PairType;
  /** Speed (along the boost direction) at which their order reverses, if any. */
  flipV: number | null;
}

export interface Shows {
  grid: boolean;
  ghost: boolean;
  hyper: boolean;
  rod: boolean;
  flat: boolean;
}

export const V_UI = 0.95;
export const T_MIN = -8;
export const T_MAX = 12;
export const MAX_EVENTS = 10;
export const ROD_L0 = 4;
/** Relative tolerance for calling a dragged pair "on the light cone". */
export const LIGHT_EPS = 2e-3;

export const FLIP_A: Ev = { t: 2, x: 2.5, y: -3 };
export const FLIP_B: Ev = { t: 4, x: -2.5, y: -3 };
const DECOR: Ev[] = [
  { t: 7, x: 9, y: 2 },
  { t: -3, x: -7, y: 3 },
  { t: 6, x: -9.5, y: -1 },
  { t: -5, x: 8, y: -6 },
];

const smooth = (a: number, b: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

export type FlipListener = (a: number, b: number, v: number, nowFirst: number) => void;

export class Model {
  events: EventItem[] = [];
  /** Selected event ids (up to two, oldest first). */
  sel: number[] = [];
  private nextId = 1;

  /** Where the speed slider points; the boost eases toward it in rapidity. */
  vTarget = 0;
  private phi = 0;
  angle = 0;
  angleTarget = 0;
  /** Home time of the "now" sheet (eased toward Ttarget). */
  T = -1;
  Ttarget = -1;
  rocketV = 0.8;
  trip = 10;
  /** The rocket's thread is drawn up to this Home time (the opening draws it). */
  draw = Infinity;
  show: Shows = { grid: true, ghost: true, hyper: false, rod: false, flat: false };
  /** 0..1, set on each boost: the glass cone shimmers ("unchanged"). */
  shimmer = 0;
  /** Seconds of sim time. */
  clock = 0;
  /** Sim time when the boost last moved noticeably. */
  lastBoostMove = -10;

  m: Mat3 = boostMatrix(0, 0);
  twin: TwinTrip = twinTrip(0.8, 10);

  /** Opening sequence (auto-played on load). */
  wow = { active: true, t: 0 };
  private grow = new Map<string, number>();
  private signs = new Map<string, number>();
  onFlip: FlipListener | null = null;

  constructor() {
    this.restoreExample(true);
    this.recompute();
  }

  get v(): number {
    return Math.tanh(this.phi);
  }
  get gamma(): number {
    return gammaOf(this.v);
  }
  get rapidity(): number {
    return this.phi;
  }

  // ───────────── events ─────────────

  setEvents(list: Ev[], selIdx: number[] = [], instant = false): void {
    this.events = list.map((e) => ({ id: this.nextId++, e: { ...e }, pop: instant ? 1 : 0, pulse: 0 }));
    this.sel = selIdx.filter((i) => i < this.events.length).map((i) => this.events[i].id);
    this.grow.clear();
    this.signs.clear();
    if (instant) for (const p of this.pairs()) this.grow.set(this.key(p.a, p.b), 1);
  }

  addEvent(e: Ev): number {
    if (this.events.length >= MAX_EVENTS) {
      // recycle the oldest event that isn't selected
      const k = this.events.findIndex((ev) => !this.sel.includes(ev.id));
      this.events.splice(k < 0 ? 0 : k, 1);
    }
    const item: EventItem = { id: this.nextId++, e: { ...e }, pop: 0, pulse: 0 };
    this.events.push(item);
    // a new firework pairs with the most recently chosen one
    const prev = this.sel.length ? this.sel[this.sel.length - 1] : this.events.length > 1 ? this.events[this.events.length - 2].id : -1;
    this.sel = prev >= 0 && prev !== item.id ? [prev, item.id] : [item.id];
    this.signs.clear();
    return this.events.length - 1;
  }

  moveEvent(index: number, e: Ev): void {
    const ev = this.events[index];
    if (!ev) return;
    ev.e = { ...e };
  }

  /** The opening's events: a spacelike pair A, B (flips at 0.40 c) plus a few decorations. */
  restoreExample(instant = false): void {
    this.setEvents([FLIP_A, FLIP_B, ...DECOR], [0, 1], instant);
  }

  /** Everything Clear throws away, so Undo can put it back exactly. */
  snapshot(): { events: Ev[]; sel: number[] } {
    return { events: this.events.map((e) => ({ ...e.e })), sel: this.selIndex() };
  }

  /** Make events i and j the selected pair (A = i, B = j). */
  selectPair(i: number, j: number): void {
    const a = this.events[i]?.id, b = this.events[j]?.id;
    if (a === undefined || b === undefined || a === b) return;
    this.sel = [a, b];
  }

  clear(): void {
    this.events = [];
    this.sel = [];
    this.grow.clear();
    this.signs.clear();
  }

  /** Tap an event: it becomes the newest of the selected pair. */
  select(index: number): void {
    const id = this.events[index]?.id;
    if (id === undefined) return;
    if (this.sel.includes(id)) {
      if (this.sel.length === 2 && this.sel[0] === id) return;
      this.sel = this.sel.filter((s) => s !== id);
      this.sel.push(id);
      return;
    }
    this.sel.push(id);
    if (this.sel.length > 2) this.sel.shift();
  }

  selIndex(): number[] {
    return this.sel.map((id) => this.events.findIndex((e) => e.id === id)).filter((i) => i >= 0);
  }

  /** Event in the current observer's coordinates. */
  display(e: Ev, out?: Ev): Ev {
    return apply(this.m, e, out);
  }

  private key(a: number, b: number): string {
    const ia = this.events[a].id, ib = this.events[b].id;
    return ia < ib ? `${ia}-${ib}` : `${ib}-${ia}`;
  }

  pairs(): PairView[] {
    const out: PairView[] = [];
    const s = this.selIndex();
    for (let i = 0; i < this.events.length; i++)
      for (let j = i + 1; j < this.events.length; j++) {
        const type = classify(this.events[i].e, this.events[j].e, LIGHT_EPS);
        const selected = s.length === 2 && s.includes(i) && s.includes(j);
        out.push({ a: i, b: j, type, grow: this.grow.get(this.key(i, j)) ?? 0, selected });
      }
    return out;
  }

  pairInfo(): PairInfo | null {
    const s = this.selIndex();
    if (s.length < 2) return null;
    const [a, b] = s;
    const A = this.display(this.events[a].e), B = this.display(this.events[b].e);
    const ea = this.events[a].e, eb = this.events[b].e;
    const type = classify(ea, eb, LIGHT_EPS);
    return {
      a,
      b,
      dt: B.t - A.t,
      dr: Math.hypot(B.x - A.x, B.y - A.y),
      s2: interval2(ea, eb),
      type,
      flipV: type === "spacelike" ? flipSpeed(ea, eb, this.angle) : null,
    };
  }

  // ───────────── twin trip ─────────────

  setTrip(v: number, T: number): void {
    this.rocketV = Math.max(0.05, Math.min(V_UI, v));
    this.trip = Math.max(2, Math.min(T_MAX, T));
    this.twin = twinTrip(this.rocketV, this.trip);
  }

  /** Clock readings where each world line crosses the "now" sheet (Home time T). */
  clocks(): { home: number; rocket: number } {
    const T = this.T;
    let rocket: number;
    if (T <= 0) rocket = T;
    else if (T <= this.trip) rocket = properTimeAt(this.twin.path, T);
    else rocket = this.twin.rocketTicks + (T - this.trip);
    return { home: T, rocket };
  }

  /** Rocket position at Home time t (it waits at Home before leaving and after landing). */
  rocketAt(t: number): Ev {
    const p = this.twin.path;
    if (t <= 0 || t >= this.trip) return { t, x: 0, y: 0 };
    const half = this.trip / 2;
    const x = t <= half ? (p[1].x * t) / half : (p[1].x * (this.trip - t)) / half;
    return { t, x, y: 0 };
  }

  rod(): { a: Ev; b: Ev; length: number; rest: number } {
    const tObs = Math.max(-9, Math.min(12, this.T));
    const r = measureRod(ROD_L0, this.rocketV, this.v, this.angle, tObs, -5, 7);
    return { ...r, rest: ROD_L0 };
  }

  // ───────────── presets ─────────────

  presetTwin(): void {
    this.setTrip(0.8, 10);
    this.vTarget = 0;
    this.angleTarget = 0;
    this.Ttarget = 10;
  }

  presetFlip(): void {
    this.setEvents([FLIP_A, FLIP_B, DECOR[0], DECOR[1]], [0, 1]);
    this.vTarget = 0;
    this.angleTarget = 0;
    this.Ttarget = 3;
  }

  presetCause(): void {
    this.setEvents([{ t: 1, x: -1, y: -3 }, { t: 5, x: 1.5, y: -3 }, DECOR[0], DECOR[2]], [0, 1]);
    this.vTarget = 0;
    this.angleTarget = 0;
    this.Ttarget = 3;
  }

  /** Stop the opening; anything it was animating snaps to the user's control. */
  stopWow(): void {
    if (!this.wow.active) return;
    this.wow.active = false;
    this.draw = Infinity;
  }

  // ───────────── stepping ─────────────

  private runWow(dt: number): void {
    const w = this.wow;
    w.t += dt;
    const t = w.t;
    // 0.3–3.3 s: the sheet rises and the rocket's thread is drawn up to it
    if (t < 3.3) {
      const T = lerp(-1, this.trip, smooth(0.3, 3.3, t));
      this.Ttarget = this.T = T;
      this.draw = T;
      this.vTarget = 0;
    } else if (t < 6.6) {
      this.draw = Infinity;
      // sheet settles back to t = 4 while the speed sweeps to 0.8 c, holds, and returns
      this.Ttarget = this.T = lerp(this.trip, 4, smooth(3.3, 4.6, t));
      const up = smooth(3.4, 4.9, t), down = smooth(5.6, 6.5, t);
      this.vTarget = Math.tanh(rapidity(0.8) * (up - down));
    } else if (t < 8.3) {
      if (this.selIndex().length < 2) this.sel = this.events.slice(0, 2).map((e) => e.id);
      this.vTarget = -Math.tanh(rapidity(0.55) * smooth(6.7, 8.2, t));
    } else {
      w.active = false;
    }
  }

  step(dt: number): void {
    this.clock += dt;
    if (this.wow.active) this.runWow(dt);
    const k = 1 - Math.exp(-dt * 9); // ~0.4 s ease
    const phiT = rapidity(this.vTarget);
    const dphi = (phiT - this.phi) * (this.wow.active ? 1 - Math.exp(-dt * 14) : k);
    this.phi += dphi;
    if (Math.abs(phiT - this.phi) < 1e-5) this.phi = phiT;
    let da = this.angleTarget - this.angle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.angle += da * k;
    if (Math.abs(dphi) > 1e-4 || Math.abs(da) > 1e-4) {
      this.lastBoostMove = this.clock;
      this.shimmer = Math.min(1, this.shimmer + Math.abs(dphi) * 4 + Math.abs(da));
    }
    this.shimmer = Math.max(0, this.shimmer - dt * 0.9);
    if (!this.wow.active) this.T += (this.Ttarget - this.T) * k;
    boostMatrix(this.v, this.angle, this.m);

    for (const ev of this.events) {
      ev.pop = Math.min(1, ev.pop + dt * 2.6);
      ev.pulse = Math.max(0, ev.pulse - dt * 0.7);
    }
    for (const p of this.pairs()) {
      const key = this.key(p.a, p.b);
      const g = this.grow.get(key) ?? 0;
      const ready = Math.min(this.events[p.a].pop, this.events[p.b].pop) > 0.5;
      if (ready && g < 1) this.grow.set(key, Math.min(1, g + dt * 2.2));
    }
    this.detectFlips();
  }

  /** Watch every spacelike pair: when the current frame reverses their order, pulse them. */
  private detectFlips(): void {
    const n = this.events.length;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = this.events[i], b = this.events[j];
        if (classify(a.e, b.e, LIGHT_EPS) !== "spacelike") continue;
        const dt = this.display(b.e).t - this.display(a.e).t;
        const s = Math.abs(dt) < 1e-9 ? 0 : Math.sign(dt);
        const key = this.key(i, j);
        const prev = this.signs.get(key);
        if (s !== 0) {
          if (prev !== undefined && prev !== s) {
            a.pulse = b.pulse = 1;
            // report the exact crossing speed, not the (eased, possibly overshot) current one
            this.onFlip?.(i, j, flipSpeed(a.e, b.e, this.angle) ?? this.v, s > 0 ? i : j);
          }
          this.signs.set(key, s);
        }
      }
  }

  /** Re-derive everything after a discontinuous change (presets, sliders while paused). */
  recompute(): void {
    this.twin = twinTrip(this.rocketV, this.trip);
    boostMatrix(this.v, this.angle, this.m);
  }

  finite(): boolean {
    const nums = [this.v, this.phi, this.T, this.angle, ...this.m];
    for (const e of this.events) nums.push(e.e.t, e.e.x, e.e.y);
    return nums.every(Number.isFinite);
  }
}
