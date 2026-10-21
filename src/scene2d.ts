/**
 * Canvas2D fallback: the classic flat t-x spacetime diagram (y = 0 slice) driven by the same
 * model and controls. The light cone is the pair of 45° lines; everything else is boosted.
 */
import { apply, atProperTime, boostMatrix, type Ev } from "./physics";
import { type Model, ROD_L0 } from "./model";
import { AMBER, CYAN, H_CONE, PEARL, R_MAX, TEAL, T_BOT, T_TOP, TYPE_COLOR, VIOLET, clipSegment, inRegion, lerpEv, type Layout, type View } from "./view";

export class Scene2D implements View {
  readonly kind = "2d" as const;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private layout: Layout = { cx: 640, cy: 360, size: 400, phone: false };
  private k = 10;
  private ox = 0;
  private oy = 0;
  private time = 0;
  private evScreen: { x: number; y: number; vis: boolean }[] = [];
  /** Screen boxes already taken this frame (labels, event dots), so clock tags can dodge them. */
  private placed: [number, number, number, number][] = [];

  constructor(container: HTMLElement) {
    const c = document.createElement("canvas");
    c.id = "canvas";
    c.setAttribute("aria-label", "Flat spacetime diagram: time up, space across, light at 45 degrees.");
    container.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext("2d")!;
  }

  resize(w: number, h: number, layout: Layout): void {
    this.w = w;
    this.h = h;
    this.layout = layout;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    const span = Math.max(T_TOP - T_BOT, 2 * R_MAX * (layout.phone ? 0.9 : 0.75)) + 1.5;
    this.k = layout.size / span;
    this.ox = layout.cx;
    this.oy = layout.cy + ((T_TOP + T_BOT) / 2) * this.k;
  }

  private sx(x: number): number {
    return this.ox + x * this.k;
  }
  private sy(t: number): number {
    return this.oy - t * this.k;
  }

  private seg(p: Ev, q: Ev, color: string, width: number, alpha = 1, glow = 0): void {
    const c = clipSegment(p, q);
    if (!c) return;
    const a = lerpEv(p, q, c[0]), b = lerpEv(p, q, c[1]);
    const g = this.ctx;
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = width;
    if (glow) {
      g.shadowColor = color;
      g.shadowBlur = glow;
    }
    g.beginPath();
    g.moveTo(this.sx(a.x), this.sy(a.t));
    g.lineTo(this.sx(b.x), this.sy(b.t));
    g.stroke();
    g.restore();
  }

  render(dt: number, model: Model): void {
    this.time += dt;
    this.placed = [];
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, this.h);
    bg.addColorStop(0, "#0b1424");
    bg.addColorStop(1, "#06080c");
    g.fillStyle = bg;
    g.fillRect(0, 0, this.w, this.h);
    const m = model.m;
    const D = (e: Ev) => apply(m, e);
    const L = 86;

    // base
    g.fillStyle = "rgba(200,150,80,0.25)";
    g.fillRect(this.sx(-15.5), this.sy(T_BOT), 31 * this.k, 6);
    // ghost (your own square grid)
    if (model.show.ghost) {
      for (let x = -14; x <= 14; x += 2) this.seg({ t: T_BOT, x, y: 0 }, { t: T_TOP, x, y: 0 }, "#7fa2dc", 1, 0.2);
      for (let t = -10; t <= 14; t += 2) this.seg({ t, x: -R_MAX, y: 0 }, { t, x: R_MAX, y: 0 }, "#7fa2dc", 1, 0.2);
    }
    // Home's lattice, boosted
    if (model.show.grid) {
      for (let x = -L; x <= L; x += 2) this.seg(D({ t: -L, x, y: 0 }), D({ t: L, x, y: 0 }), "#cfd8e6", 1, x === 0 ? 0.5 : 0.22);
      for (let t = -L; t <= L; t += 2) this.seg(D({ t, x: -L, y: 0 }), D({ t, x: L, y: 0 }), "#cfd8e6", 1, t === 0 ? 0.5 : 0.22);
    }
    // the light cone: never transformed
    const H = H_CONE;
    for (const s of [-1, 1]) {
      this.seg({ t: -H, x: s * H, y: 0 }, { t: H, x: -s * H, y: 0 }, CYAN, 2, 0.85 + model.shimmer * 0.15, 8 + model.shimmer * 14);
    }
    // invariant hyperbolas
    const sel = model.selIndex();
    if (model.show.hyper) {
      for (const i of sel) {
        const e = model.events[i].e;
        const k = e.t * e.t - e.x * e.x - e.y * e.y;
        if (Math.abs(k) < 0.05) continue;
        g.save();
        g.strokeStyle = k > 0 ? TYPE_COLOR.timelike : VIOLET;
        g.globalAlpha = 0.45;
        g.lineWidth = 1.5;
        for (const branch of [-1, 1]) {
          g.beginPath();
          let started = false;
          for (let j = -60; j <= 60; j++) {
            const u = j / 12;
            const p = k > 0 ? { t: (e.t >= 0 ? 1 : -1) * Math.sqrt(k) * Math.cosh(u), x: Math.sqrt(k) * Math.sinh(u) * branch } : { t: Math.sqrt(-k) * Math.sinh(u), x: branch * Math.sqrt(-k) * Math.cosh(u) };
            if (!inRegion({ ...p, y: 0 })) {
              started = false;
              continue;
            }
            if (!started) g.moveTo(this.sx(p.x), this.sy(p.t));
            else g.lineTo(this.sx(p.x), this.sy(p.t));
            started = true;
          }
          g.stroke();
        }
        g.restore();
      }
    }
    // Home's "now" sheet: t' = T/γ − v cosθ x'
    const c0 = model.T / model.gamma, sl = model.v * Math.cos(model.angle);
    this.seg({ t: c0 + sl * R_MAX, x: -R_MAX, y: 0 }, { t: c0 - sl * R_MAX, x: R_MAX, y: 0 }, "#dff4ff", 3, 0.5, 6);
    // world lines
    this.seg(D({ t: -L, x: 0, y: 0 }), D({ t: L, x: 0, y: 0 }), AMBER, 2.5, 1, 10);
    const tw = model.twin;
    const drawTo = Math.min(model.trip, model.draw);
    if (drawTo > 0) {
      const pts: Ev[] = [tw.path[0]];
      if (drawTo > tw.path[1].t) pts.push(tw.path[1]);
      pts.push(model.rocketAt(drawTo));
      for (let i = 1; i < pts.length; i++) this.seg(D(pts[i - 1]), D(pts[i]), TEAL, 2.5, 1, 10);
    }
    const bead = (e: Ev, col: string) => {
      const d = D(e);
      if (!inRegion(d)) return;
      const f = model.T >= e.t - 0.05 ? Math.exp(-Math.max(0, model.T - e.t) * 2.2) : 0;
      g.save();
      g.fillStyle = "#e0ad58";
      g.shadowColor = col;
      g.shadowBlur = 4 + f * 16;
      g.beginPath();
      g.arc(this.sx(d.x), this.sy(d.t), 3.5 + f * 1.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    };
    for (let k = -30; k <= 30; k++) bead({ t: k, x: 0, y: 0 }, AMBER);
    for (let k = 0; k <= Math.floor(tw.rocketTicks + 1e-9); k++) {
      const e = atProperTime(tw.path, k);
      if (e.t > drawTo + 1e-6) break;
      bead(e, TEAL);
    }
    // rod
    if (model.show.rod) {
      const r = model.rod();
      this.seg({ ...r.a, y: 0 }, { ...r.b, y: 0 }, "#bff7f0", 5, 0.8, 8);
      const u = model.rocketV, gu = 1 / Math.sqrt(1 - u * u);
      for (const off of [0, ROD_L0 / gu]) this.seg(D({ t: -L, x: -5 + off - u * L, y: 7 }), D({ t: L, x: -5 + off + u * L, y: 7 }), TEAL, 1, 0.35);
      if (inRegion(r.a)) this.text(`rod ${r.length.toFixed(2)}`, this.sx((r.a.x + r.b.x) / 2), this.sy(r.a.t) - 10, TEAL, "center");
    }
    // connectors + events
    for (const p of model.pairs()) {
      if (p.grow <= 0) continue;
      const A = D(model.events[p.a].e), B = D(model.events[p.b].e);
      this.seg(A, lerpEv(A, B, p.grow), TYPE_COLOR[p.type], p.selected ? 3.5 : 1, p.selected ? 1 : 0.4, p.selected ? 14 : 0);
    }
    this.evScreen = [];
    model.events.forEach((ev, i) => {
      const d = D(ev.e);
      const x = this.sx(d.x), y = this.sy(d.t);
      const vis = inRegion(d, 0.5);
      this.evScreen.push({ x, y, vis });
      if (!vis) return;
      const r = 6 * (0.4 + 0.6 * ev.pop) * (1 + ev.pulse * 0.5);
      this.placed.push([x - r - 4, y - r - 4, x + r + 4, y + r + 4]);
      g.save();
      g.fillStyle = ev.pulse > 0.05 ? VIOLET : PEARL;
      g.shadowColor = ev.pulse > 0.05 ? VIOLET : "#d9c8ff";
      g.shadowBlur = 12 + ev.pulse * 20;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.restore();
      const si = sel.indexOf(i);
      if (si >= 0) {
        g.save();
        g.strokeStyle = CYAN;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, r + 5, 0, Math.PI * 2);
        g.stroke();
        g.restore();
        this.badge(si === 0 ? "A" : "B", x + 15, y - 15);
      }
    });
    // clocks
    const clk = model.clocks();
    const hp = D({ t: model.T, x: 0, y: 0 });
    if (inRegion(hp)) this.text(`Home ${clk.home.toFixed(1)}`, this.sx(hp.x) + 10, this.sy(hp.t) - 6, AMBER, "left", true);
    const rp = D(model.rocketAt(model.T));
    if (inRegion(rp) && drawTo >= Math.min(model.T, model.trip) - 1e-6) this.text(`Rocket ${clk.rocket.toFixed(1)}`, this.sx(rp.x) + 10, this.sy(rp.t) + 14, TEAL, "left", true);
    // axis hints
    this.text("time ↑", this.sx(0) + 6, this.sy(T_TOP) + 14, "rgba(220,230,240,0.6)", "left");
    this.text("space →", this.sx(R_MAX) - 4, this.sy(T_BOT) - 8, "rgba(220,230,240,0.6)", "right");
  }

  /** A/B badge next to a selected event: dark disc, cyan ring, letter. */
  private badge(s: string, x: number, y: number): void {
    const g = this.ctx;
    g.save();
    g.beginPath();
    g.arc(x, y, 9, 0, Math.PI * 2);
    g.fillStyle = "rgba(4, 18, 26, 0.9)";
    g.shadowColor = "rgba(111, 231, 255, 0.8)";
    g.shadowBlur = 6;
    g.fill();
    g.shadowBlur = 0;
    g.lineWidth = 1.5;
    g.strokeStyle = CYAN;
    g.stroke();
    g.font = "700 11px system-ui, -apple-system, 'Segoe UI', sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#eaffff";
    g.fillText(s, x, y + 0.5);
    g.restore();
    this.placed.push([x - 10, y - 10, x + 10, y + 10]);
  }

  private text(s: string, x: number, y: number, color: string, align: CanvasTextAlign, dodge = false): void {
    const g = this.ctx;
    g.save();
    g.font = "600 12px system-ui, -apple-system, 'Segoe UI', sans-serif";
    g.textAlign = align;
    const w = g.measureText(s).width;
    const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
    const box = (dy: number): [number, number, number, number] => [x0 - 2, y + dy - 12, x0 + w + 2, y + dy + 4];
    const hits = (b: [number, number, number, number]) => this.placed.some((q) => b[0] < q[2] && q[0] < b[2] && b[1] < q[3] && q[1] < b[3]);
    let dy = 0;
    if (dodge) dy = [0, 16, -16, 32, -32].find((d) => !hits(box(d))) ?? 0;
    this.placed.push(box(dy));
    y += dy;
    g.fillStyle = color;
    g.shadowColor = "rgba(0,0,0,0.9)";
    g.shadowBlur = 4;
    g.fillText(s, x, y);
    g.restore();
  }

  pickEvent(clientX: number, clientY: number): number {
    const r = this.canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    let best = -1, bd = (this.layout.phone ? 22 : 16) ** 2;
    this.evScreen.forEach((p, i) => {
      if (!p.vis) return;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  }

  private toDisplay(clientX: number, clientY: number): Ev {
    const r = this.canvas.getBoundingClientRect();
    return { t: (this.oy - (clientY - r.top)) / this.k, x: (clientX - r.left - this.ox) / this.k, y: 0 };
  }

  dropPoint(clientX: number, clientY: number, model: Model): Ev | null {
    const d = this.toDisplay(clientX, clientY);
    if (!inRegion(d)) return null;
    return apply(boostMatrix(-model.v, model.angle), d);
  }

  project(d: Ev): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + this.sx(d.x), y: r.top + this.sy(d.t) };
  }

  dragPoint(clientX: number, clientY: number, anchor: Ev): Ev | null {
    const d = this.toDisplay(clientX, clientY);
    return { t: d.t, x: d.x, y: anchor.y };
  }

  orbit(): void {}
  release(): void {}
  zoom(): void {}
  poke(): void {}
  dispose(): void {
    this.canvas.remove();
  }
}
