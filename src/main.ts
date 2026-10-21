import "./styles.css";
import { Model, T_MAX, T_MIN, V_UI } from "./model";
import { addVelocities, apply, boostMatrix, classify, rapidity, selfTest, type Ev } from "./physics";
import { Scene2D } from "./scene2d";
import { AMBER, CYAN, TEAL, type Layout, type View } from "./view";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const params = new URLSearchParams(location.search);
const recording = params.get("record") === "1";
if (recording) document.documentElement.classList.add("ix-record");
const force2d = params.get("renderer") === "2d";

const model = new Model();
const stage = $("stage");
let view: View;
let frames = 0;
let fps = 60;

// ───────────────────────── renderer selection ─────────────────────────

async function makeWebGL(): Promise<View> {
  const probe = document.createElement("canvas");
  const ctx = probe.getContext("webgl2") || probe.getContext("webgl");
  if (!ctx) throw new Error("WebGL unavailable");
  (ctx.getExtension("WEBGL_lose_context") as { loseContext?: () => void } | null)?.loseContext?.();
  const { Scene3D } = await import("./scene3d");
  return new Scene3D(stage, { hq: recording });
}

function switchTo2D(reason: string): void {
  if (view?.kind === "2d") return;
  console.warn(`[light-cone] using Canvas2D fallback: ${reason}`);
  try {
    view?.dispose();
  } catch {
    /* ignore */
  }
  stage.querySelectorAll("canvas").forEach((c) => c.remove());
  view = new Scene2D(stage);
  $("badge").hidden = false;
  bindCanvas(view.canvas);
  onResize();
}

async function boot(): Promise<void> {
  if (force2d) {
    view = new Scene2D(stage);
    $("badge").hidden = false;
    bindCanvas(view.canvas);
    onResize();
  } else {
    try {
      view = await makeWebGL();
      view.canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        switchTo2D("webglcontextlost");
      });
      bindCanvas(view.canvas);
      onResize();
      view.render(1 / 60, model); // compile now so init errors surface here
    } catch (err) {
      switchTo2D(`WebGL init failed: ${(err as Error)?.message ?? err}`);
    }
  }
  window.__ixRecord.ready = true;
  requestAnimationFrame(loop);
}

// ───────────────────────── layout ─────────────────────────

const dock = $("dock");
const adv = $("adv");
const intro = $("intro");

function computeLayout(w: number, h: number): Layout {
  const phone = w <= 760;
  if (phone) {
    const top = intro.getBoundingClientRect().bottom + 2;
    const bottom = dock.getBoundingClientRect().top - 2;
    const avail = Math.max(140, bottom - top);
    return { cx: w / 2, cy: top + avail * 0.5, size: Math.min(avail * 0.94, w * 0.92), phone: true };
  }
  const left = dock.getBoundingClientRect().right + 10;
  const right = adv.hidden ? w - 10 : adv.getBoundingClientRect().left - 10;
  const regionW = Math.max(220, right - left);
  return { cx: left + regionW * 0.5, cy: h * 0.5, size: Math.min(h * 0.84, regionW * 0.9), phone: false };
}

function onResize(): void {
  const w = innerWidth, h = innerHeight;
  const phoneAdv = w <= 760 && !adv.hidden;
  dock.classList.toggle("mini", phoneAdv);
  dock.style.bottom = phoneAdv ? `${adv.offsetHeight}px` : "";
  view?.resize(w, h, computeLayout(w, h));
}
addEventListener("resize", onResize);

// ───────────────────────── pointer: orbit / tap / drag ─────────────────────────

let dropMode = false;
let drag: { id: number; x0: number; y0: number; x: number; y: number; moved: boolean; ev: number } | null = null;
const touches = new Map<number, { x: number; y: number }>();
let pinch0 = 0;

function userTouched(): void {
  model.stopWow();
}

/** Snap a dragged event onto its partner's light cone when it's very close (lightlike pairs are reachable). */
function snapToCone(e: Ev, partner: Ev | null): Ev {
  if (!partner) return e;
  const dt = e.t - partner.t, dr = Math.hypot(e.x - partner.x, e.y - partner.y);
  if (dr < 0.3) return e;
  const s2 = dt * dt - dr * dr;
  if (Math.abs(s2) < 0.035 * (dt * dt + dr * dr)) return { ...e, t: partner.t + Math.sign(dt || 1) * dr };
  return e;
}

function bindCanvas(c: HTMLCanvasElement): void {
  c.addEventListener("pointerdown", (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    view.poke();
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      drag = null;
      return;
    }
    const ev = view.pickEvent(e.clientX, e.clientY);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, ev };
    c.setPointerCapture(e.pointerId);
    c.classList.add("grabbing");
  });
  c.addEventListener("pointermove", (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) view.zoom(pinch0 / d);
      pinch0 = d;
      return;
    }
    if (!drag || drag.id !== e.pointerId) {
      c.style.cursor = view.pickEvent(e.clientX, e.clientY) >= 0 ? "pointer" : dropMode ? "crosshair" : "";
      return;
    }
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.moved = true;
    if (!drag.moved) return;
    if (drag.ev >= 0) {
      const item = model.events[drag.ev];
      if (!item) return;
      userTouched();
      const anchor = model.display(item.e);
      const d = view.dragPoint(e.clientX, e.clientY, anchor);
      if (!d) return;
      let home = apply(boostMatrix(-model.v, model.angle), d);
      const sel = model.selIndex();
      const partner = sel.length === 2 && sel.includes(drag.ev) ? model.events[sel[0] === drag.ev ? sel[1] : sel[0]].e : null;
      home = snapToCone(home, partner);
      model.moveEvent(drag.ev, home);
    } else {
      view.orbit(dx, dy);
    }
  });
  const end = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch0 = 0;
    if (!drag || drag.id !== e.pointerId) return;
    c.classList.remove("grabbing");
    if (!drag.moved && e.type === "pointerup") {
      if (drag.ev >= 0) {
        userTouched();
        model.select(drag.ev);
      } else if (dropMode) {
        const p = view.dropPoint(e.clientX, e.clientY, model);
        if (p) placeFirework(p);
        else say("Tap on the floor (the glass ‘now’ sheet inside the instrument) to place a firework.", "info", 2.5);
      }
    }
    if (drag.ev < 0) view.release();
    drag = null;
  };
  c.addEventListener("pointerup", end);
  c.addEventListener("pointercancel", end);
  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    view.zoom(Math.exp(e.deltaY * 0.001));
  }, { passive: false });
}

// ───────────────────────── controls ─────────────────────────

const speed = $<HTMLInputElement>("speed");
const time = $<HTMLInputElement>("time");
let speedHeld = false;
let timeHeld = false;
let lastCauseChip = -10;

function setRange(el: HTMLInputElement, v: number): void {
  const s = String(v);
  if (el.value !== s) el.value = s;
  const min = Number(el.min), max = Number(el.max);
  el.style.setProperty("--p", `${((Number(el.value) - min) / (max - min)) * 100}%`);
}

speed.addEventListener("pointerdown", () => (speedHeld = true));
time.addEventListener("pointerdown", () => (timeHeld = true));
addEventListener("pointerup", () => {
  speedHeld = false;
  timeHeld = false;
});
speed.addEventListener("input", () => {
  userTouched();
  let v = Number(speed.value);
  if (Math.abs(v) < 0.012) v = 0; // a little detent at Home
  model.vTarget = v;
  const pi = model.pairInfo();
  if (pi?.type === "timelike" && Math.abs(v) > 0.35 && model.clock - lastCauseChip > 4) {
    lastCauseChip = model.clock;
    chip("Can't flip: one could cause the other", "gold");
  }
});
time.addEventListener("input", () => {
  userTouched();
  model.Ttarget = Number(time.value);
});

function ride(v: number): void {
  userTouched();
  model.angleTarget = 0;
  model.vTarget = v;
  $<HTMLInputElement>("boost-angle").value = "0";
}
$("ride-home").addEventListener("click", () => ride(0));
$("ride-out").addEventListener("click", () => ride(model.rocketV));
$("ride-back").addEventListener("click", () => ride(-model.rocketV));

// ── fireworks: add (two taps → A and B), clear (with undo), restore the example ──

const addBtn = $("events-add");
/** Ids of fireworks placed since Add fireworks was switched on. */
let placed: number[] = [];

function setDropMode(on: boolean): void {
  dropMode = on;
  placed = [];
  addBtn.setAttribute("aria-pressed", String(on));
  addBtn.classList.toggle("on", on);
  if (on) transient = null; // the "Tap the floor" caption takes over at once
}

/** Place a firework (Home coordinates). The second one of a round becomes B, the first A, and the mode switches off. */
function placeFirework(p: Ev): number {
  userTouched();
  hideToast();
  const idx = model.addEvent(p);
  placed.push(model.events[idx].id);
  if (placed.length >= 2) {
    const [a, b] = placed.slice(-2).map((id) => model.events.findIndex((e) => e.id === id));
    if (a >= 0 && b >= 0) model.selectPair(a, b);
    setDropMode(false);
    say("Your two fireworks are A and B. Now drag ‘Your speed’ and read the verdict below.", "info", 4);
  }
  return idx;
}

addBtn.addEventListener("click", () => {
  userTouched();
  setDropMode(!dropMode);
});

const toast = $("events-toast");
let toastUntil = 0;
let undoSnap: ReturnType<Model["snapshot"]> | null = null;

function showToast(text: string, seconds: number): void {
  setText("events-toast-text", text);
  toast.hidden = false;
  toastUntil = model.clock + seconds;
}
function hideToast(): void {
  toast.hidden = true;
  undoSnap = null;
}

function clearEvents(): void {
  userTouched();
  if (!model.events.length) return;
  undoSnap = model.snapshot();
  model.clear();
  setDropMode(false);
  showToast("Cleared all fireworks.", 6);
  say("Cleared. Press ‘Add fireworks’ and tap the floor twice, or Restore the example.", "info", 5);
}
function undoClear(): void {
  if (!undoSnap) return;
  userTouched();
  model.setEvents(undoSnap.events, undoSnap.sel, true);
  hideToast();
  say("Fireworks are back.", "info", 2.5);
}
function restoreExample(): void {
  userTouched();
  hideToast();
  setDropMode(false);
  model.restoreExample();
  say("Example restored: A and B are outside each other's light cones. Drag ‘Your speed’ left past 0.40 c.", "flip", 4);
}
$("events-clear").addEventListener("click", clearEvents);
$("events-undo").addEventListener("click", undoClear);
$("events-restore").addEventListener("click", restoreExample);

const advBtn = $("btn-advanced");
function setAdv(open: boolean): void {
  adv.hidden = !open;
  advBtn.setAttribute("aria-expanded", String(open));
  onResize();
  if (open) drawCombine();
}
advBtn.addEventListener("click", () => setAdv(adv.hidden));
$("btn-adv-close").addEventListener("click", () => setAdv(false));

const presets: Record<string, () => void> = {
  "preset-twin": () => {
    model.presetTwin();
    syncTrip();
    say("Twin paradox: the rocket flies out at 0.80 c and back. Slide Time to the top to compare clocks.", "info", 3.5);
  },
  "preset-flip": () => {
    model.presetFlip();
    say("Two fireworks outside each other's light cones. Drag ‘Your speed’ left, past 0.40 c.", "flip", 3.5);
  },
  "preset-cause": () => {
    model.presetCause();
    say("One firework is inside the other's cone. Try any speed: their order never changes.", "cause", 3.5);
  },
};
for (const [id, fn] of Object.entries(presets)) {
  $(id).addEventListener("click", () => {
    userTouched();
    fn();
  });
}

function syncTrip(): void {
  setRange($<HTMLInputElement>("rocket-speed"), model.rocketV);
  setRange($<HTMLInputElement>("trip"), model.trip);
}
$("rocket-speed").addEventListener("input", (e) => {
  userTouched();
  model.setTrip(Number((e.target as HTMLInputElement).value), model.trip);
});
$("trip").addEventListener("input", (e) => {
  userTouched();
  model.setTrip(model.rocketV, Number((e.target as HTMLInputElement).value));
});
$("boost-angle").addEventListener("input", (e) => {
  userTouched();
  model.angleTarget = (Number((e.target as HTMLInputElement).value) * Math.PI) / 180;
});
const toggles: [string, keyof Model["show"]][] = [
  ["show-grid", "grid"],
  ["show-ghost", "ghost"],
  ["show-hyper", "hyper"],
  ["show-rod", "rod"],
  ["flat-view", "flat"],
];
for (const [id, key] of toggles) {
  const el = $<HTMLInputElement>(id);
  el.checked = model.show[key];
  el.addEventListener("change", () => {
    model.show[key] = el.checked;
    if (key === "rod" && el.checked) say("The glass rod is 4 long in the rocket's frame. Ride with the rocket and it measures 4; at Home it shrinks to 4/γ.", "info", 4);
    if (key === "hyper" && el.checked) say("Hyperbolas of equal interval: as you change speed, A and B slide along their shells, never off them.", "info", 4);
  });
}

// combine two speeds
const cu = $<HTMLInputElement>("combine-u"), cv = $<HTMLInputElement>("combine-v");
function drawCombine(): void {
  const u = Number(cu.value), v = Number(cv.value), w = addVelocities(u, v);
  $("combine-u-val").textContent = u.toFixed(2);
  $("combine-v-val").textContent = v.toFixed(2);
  $("combine-out").textContent = `${u.toFixed(2)} ⊕ ${v.toFixed(2)} = ${w.toFixed(3)} c   (φ: ${rapidity(u).toFixed(2)} + ${rapidity(v).toFixed(2)} = ${rapidity(w).toFixed(2)})`;
  const c = $<HTMLCanvasElement>("combine-plot");
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = c.clientWidth || 280, H = c.clientHeight || 74;
  c.width = W * dpr;
  c.height = H * dpr;
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  // top bar: u then v laid end to end (naive sum); bottom bar: the real combination
  const row = (y: number, label: string, a: number, b: number, sum: number, scale: number, limit: number | null) => {
    g.fillStyle = "rgba(214,226,238,0.75)";
    g.font = "12px system-ui, sans-serif";
    g.fillText(label, 4, y + 4);
    const x0 = 70, x1 = W - 6, mid = (x0 + x1) / 2, k = (x1 - x0) / 2 / scale;
    g.fillStyle = "rgba(255,255,255,0.14)";
    g.fillRect(mid - 0.5, y - 10, 1, 20);
    if (limit !== null) {
      g.fillStyle = "rgba(111,231,255,0.55)";
      for (const s of [-1, 1]) g.fillRect(mid + s * limit * k - 0.5, y - 10, 1, 20);
    }
    const bar = (from: number, len: number, yy: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(mid + Math.min(from, from + len) * k, yy, Math.abs(len) * k, 5);
    };
    bar(0, a, y - 7, AMBER);
    bar(a, b, y - 7, TEAL);
    bar(0, sum, y + 2, CYAN);
  };
  row(20, "speed", u, v, w, 2, 1);
  row(54, "rapidity", rapidity(u), rapidity(v), rapidity(w), Math.max(2, Math.abs(rapidity(u)) + Math.abs(rapidity(v))), null);
}
cu.addEventListener("input", drawCombine);
cv.addEventListener("input", drawCombine);

// ───────────────────────── intro card ─────────────────────────

const explain = $("explain");
const helpBtn = $("btn-help");
const INTRO_KEY = "light-cone:intro-seen";

function setExplain(open: boolean, remember = true): void {
  if (explain.hidden === !open) return;
  explain.hidden = !open;
  helpBtn.setAttribute("aria-expanded", String(open));
  if (open) $("btn-explain-ok").focus({ preventScroll: true });
  else if (remember) {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* private mode */
    }
  }
}
helpBtn.addEventListener("click", () => setExplain(explain.hidden));
$("btn-explain-x").addEventListener("click", () => setExplain(false));
$("btn-explain-ok").addEventListener("click", () => setExplain(false));
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !explain.hidden) setExplain(false);
});
document.addEventListener("pointerdown", (e) => {
  const t = e.target as Node;
  if (!explain.hidden && !explain.contains(t) && !helpBtn.contains(t)) setExplain(false);
}, true);
{
  let seen = false;
  try {
    seen = localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    /* ignore */
  }
  if (!seen && !recording && params.get("intro") !== "0") setExplain(true, false);
}

// ───────────────────────── caption + chips ─────────────────────────

type Tone = "home" | "boost" | "flip" | "cause" | "info" | "rocket";
const caption = $("caption");
const captionText = $("caption-text");
let capKey = "";
let transient: { text: string; tone: Tone; until: number } | null = null;

function say(text: string, tone: Tone, seconds: number): void {
  transient = { text, tone, until: model.clock + seconds };
}

const chipEl = $("chip");
let chipUntil = 0;
function chip(text: string, tone: "violet" | "gold"): void {
  chipEl.textContent = text;
  chipEl.dataset.tone = tone;
  chipEl.hidden = false;
  chipEl.classList.remove("pop");
  void chipEl.offsetWidth;
  chipEl.classList.add("pop");
  chipUntil = model.clock + 2.6;
}

model.onFlip = (a, b, v, first) => {
  const sel = model.selIndex();
  const isSel = sel.includes(a) && sel.includes(b);
  if (isSel) {
    chip(`Order flipped at ${Math.abs(v).toFixed(2)} c`, "violet");
    const name = first === sel[0] ? "A" : "B";
    say(`Order flipped at ${Math.abs(v).toFixed(2)} c: for you, firework ${name} now happens first. Their interval hasn't changed.`, "flip", 3);
  }
};

const f2 = (x: number) => (Math.abs(x) < 0.005 ? "0.00" : x.toFixed(2)).replace("-", "−");
const f1 = (x: number) => (Math.abs(x) < 0.05 ? "0.0" : x.toFixed(1)).replace("-", "−");

function captionNow(): { text: string; tone: Tone } {
  if (transient && model.clock < transient.until) return transient;
  if (dropMode) return { text: `Tap the floor to place a firework${placed.length ? ` (${placed.length} of 2 placed)` : ""}.`, tone: "info" };
  const v = model.v, av = Math.abs(v);
  const pi = model.pairInfo();
  const rv = model.rocketV.toFixed(2);
  if (model.wow.active && model.wow.t < 3.4)
    return { text: `The teal rocket flies out at ${rv} c and back while Home's glass ‘now’ sheet rises: each bead is one tick of a clock.`, tone: "rocket" };
  const boosting = model.clock - model.lastBoostMove < 0.8;
  if (av > 0.02 && Math.abs(model.vTarget - model.rocketV) < 0.006 && !boosting)
    return { text: `Riding the rocket out at ${rv} c: its thread stands straight up and Home is the one moving away. Its clock still ends at ${model.twin.rocketTicks.toFixed(1)}.`, tone: "rocket" };
  if (av > 0.02 && Math.abs(model.vTarget + model.rocketV) < 0.006 && !boosting)
    return { text: `Riding the rocket home at ${rv} c: now the return leg is straight up. Switching frames at the turn is why the twins' stories differ.`, tone: "rocket" };
  if (av < 0.02) {
    if (model.T >= model.trip - 0.05 && model.T <= model.trip + 1.5)
      return { text: `Home's clock read ${f1(model.twin.homeTicks)} ticks, the rocket's only ${f1(model.twin.rocketTicks)}. The traveller really is younger.`, tone: "rocket" };
    if (pi?.type === "spacelike" && pi.flipV !== null)
      return { text: `These two fireworks are outside each other's light cones: at ${Math.abs(pi.flipV).toFixed(2)} c their order flips.`, tone: "flip" };
    if (pi?.type === "timelike") return { text: "One firework is inside the other's cone, so no speed can reverse them: cause stays before effect.", tone: "cause" };
    if (pi?.type === "lightlike") return { text: "These two fireworks sit exactly on each other's light cone: one flash of light links them, for everyone.", tone: "boost" };
    return { text: "You're at rest with Home. Up is time, the floor is space, the cone is light.", tone: "home" };
  }
  if (boosting || !pi) return { text: `Moving at ${av.toFixed(2)} c: Home's grid and ‘now’ sheet shear like scissors, but the light cone hasn't moved.`, tone: "boost" };
  const s2 = f2(pi.s2);
  if (pi.type === "spacelike" && pi.flipV !== null) {
    const homeDt = model.events[pi.b].e.t - model.events[pi.a].e.t;
    if (Math.sign(pi.dt) !== Math.sign(homeDt) && Math.abs(pi.dt) > 1e-3) {
      const first = pi.dt < 0 ? "B" : "A";
      return { text: `Past ${Math.abs(pi.flipV).toFixed(2)} c these fireworks swap order: for you, ${first} happens first. The interval (${s2}) is unchanged.`, tone: "flip" };
    }
  }
  if (pi.type === "timelike") return { text: `At ${av.toFixed(2)} c the time apart is ${f2(Math.abs(pi.dt))}, but A still comes first: cause before effect. Interval ${s2}, as always.`, tone: "cause" };
  return { text: `Time apart ${f2(pi.dt)} and distance apart ${f2(pi.dr)} changed, but the interval (${s2}) is exactly the same.`, tone: "boost" };
}

function updateCaption(): void {
  const c = captionNow();
  const key = c.tone + c.text;
  if (key === capKey) return;
  capKey = key;
  caption.dataset.tone = c.tone;
  captionText.textContent = c.text;
}

// ───────────────────────── verdict + empty state ─────────────────────────

const verdictEl = $("pair-verdict");

/** One plain-English line about the selected pair, live with the current speed. */
function verdict(pi: NonNullable<ReturnType<Model["pairInfo"]>>): { text: string; tone: "flip" | "cause" | "light" } {
  const homeDt = model.events[pi.b].e.t - model.events[pi.a].e.t;
  const [first, second] = homeDt >= 0 ? ["A", "B"] : ["B", "A"];
  if (pi.type === "timelike")
    return { text: `${first} could cause ${second} (timelike): every speed agrees ${first} came first (${f2(Math.abs(pi.dt))} apart for you).`, tone: "cause" };
  if (pi.type === "lightlike") return { text: `One flash of light links them (lightlike): every speed agrees ${first} came first.`, tone: "light" };
  const head = "These can't affect each other (spacelike)";
  // v_flip = c·Δt/Δx along your direction of motion
  if (pi.flipV === null) return { text: `${head}, but no speed in this direction flips them: change Boost direction in Advanced.`, tone: "flip" };
  const fv = Math.abs(pi.flipV), dir = pi.flipV > 0 ? "right" : "left";
  if (fv < 0.005) return { text: `${head}: they happen at the same moment for Home; move either way and one goes first.`, tone: "flip" };
  if (Math.abs(pi.dt) < 1e-3) return { text: `${head}: at ${fv.toFixed(2)} c they happen at the same moment for you.`, tone: "flip" };
  if (Math.sign(pi.dt) !== Math.sign(homeDt)) {
    const now = pi.dt < 0 ? "B" : "A";
    return { text: `${head}: you're past ${fv.toFixed(2)} c, so for you ${now} now happens first.`, tone: "flip" };
  }
  return { text: `${head}: drag speed ${dir} past ${fv.toFixed(2)} c and their order flips.`, tone: "flip" };
}

function updateEmpty(): void {
  const n = model.events.length;
  setText(
    "pair-empty-lead",
    n === 0
      ? dropMode
        ? "Now tap the floor to place your first firework."
        : "No fireworks yet:"
      : n === 1
        ? "One firework placed. Tap the floor once more for B."
        : "Tap one glowing bead, then another, to compare them.",
  );
  const done = [dropMode || n > 0, n >= 2, false];
  const cur = done.indexOf(false);
  document.querySelectorAll<HTMLElement>("#pair-steps li").forEach((li, i) => {
    li.classList.toggle("done", done[i]);
    li.classList.toggle("now", i === cur);
  });
}

// ───────────────────────── readouts ─────────────────────────

const txtCache = new Map<string, string>();
function setText(id: string, s: string): void {
  if (txtCache.get(id) === s) return;
  txtCache.set(id, s);
  $(id).textContent = s;
}

function updateHud(): void {
  const v = model.v, av = Math.abs(v);
  const dir = av < 0.005 ? "" : v > 0 ? " →" : " ←";
  setText("speed-val", av < 0.005 ? "0 c · at rest with Home" : `${av.toFixed(2)} c${dir}, time stretched ×${model.gamma.toFixed(2)}`);
  setText("time-val", f1(model.T));
  if (!speedHeld) setRange(speed, Math.round(model.vTarget * 1000) / 1000);
  else speed.style.setProperty("--p", `${((Number(speed.value) + V_UI) / (2 * V_UI)) * 100}%`);
  if (!timeHeld) setRange(time, Math.round(Math.max(T_MIN, Math.min(T_MAX, model.Ttarget)) * 100) / 100);
  else time.style.setProperty("--p", `${((Number(time.value) - T_MIN) / (T_MAX - T_MIN)) * 100}%`);
  setText("m-home", f1(model.twin.homeTicks));
  setText("m-rocket", f1(model.twin.rocketTicks));
  const rides: [string, boolean][] = [
    ["ride-home", Math.abs(model.vTarget) < 0.006],
    ["ride-out", Math.abs(model.vTarget - model.rocketV) < 0.006 && model.angleTarget === 0],
    ["ride-back", Math.abs(model.vTarget + model.rocketV) < 0.006 && model.angleTarget === 0],
  ];
  for (const [id, on] of rides) {
    const el = $(id);
    if (el.classList.contains("on") !== on) {
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", String(on));
    }
  }
  setText("ride-out", `Rocket out ${model.rocketV.toFixed(1)}`);
  setText("ride-back", `Rocket back`);
  const pi = model.pairInfo();
  const pair = $("pair");
  pair.classList.toggle("empty", !pi);
  const state = pi ? "pair" : "empty";
  if (pair.dataset.state !== state) {
    pair.dataset.state = state;
    $("pair-full").hidden = !pi;
    $("pair-empty").hidden = !!pi;
    onResize();
  }
  if (pi) {
    const vd = verdict(pi);
    setText("pair-verdict", vd.text);
    verdictEl.dataset.tone = vd.tone;
    setText("m-dt", f2(pi.dt));
    setText("m-dr", f2(pi.dr));
    setText("m-s2", f2(pi.s2));
    setText("m-type", pi.type);
    pair.dataset.type = pi.type;
    setText("m-flip", pi.type === "spacelike" ? (pi.flipV !== null ? `${Math.abs(pi.flipV).toFixed(2)} c ${pi.flipV > 0 ? "→" : "←"}` : "never (try another direction)") : pi.type === "timelike" ? "never (timelike)" : "never (lightlike)");
  } else {
    setText("m-dt", "—");
    setText("m-dr", "—");
    setText("m-s2", "—");
    setText("m-type", "no pair yet");
    pair.dataset.type = "";
    setText("m-flip", "—");
    setText("pair-verdict", "");
    updateEmpty();
  }
  if (!toast.hidden && model.clock > toastUntil) hideToast();
  if (!adv.hidden) {
    setText("m-phi", f2(model.rapidity));
    setText("m-rod", `${model.rod().length.toFixed(2)} (rest 4.00)`);
    setText("rocket-speed-val", `${model.rocketV.toFixed(2)} c`);
    setText("trip-val", `${model.trip}`);
    const deg = Math.round((((model.angleTarget * 180) / Math.PI) % 360 + 360) % 360);
    setText("boost-angle-val", `${deg}°`);
    // keep the Advanced track fills in step with drags, presets and Ride buttons
    syncTrip();
    const ang = $<HTMLInputElement>("boost-angle");
    setRange(ang, Number(ang.value) % 360 === deg ? Number(ang.value) : deg);
  }
  if (!chipEl.hidden && model.clock > chipUntil) chipEl.hidden = true;
  updateCaption();
}

// ───────────────────────── loop ─────────────────────────

let last = performance.now();
let fpsT = 0, fpsN = 0;
let stepped = false;

function loop(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!stepped) frame(dt);
  requestAnimationFrame(loop);
}

function frame(dt: number, draw = true): void {
  model.step(dt);
  if (draw && view) {
    try {
      view.render(dt, model);
    } catch (err) {
      if (view.kind === "webgl") switchTo2D(`render error: ${(err as Error)?.message ?? err}`);
      else throw err;
    }
  }
  updateHud();
  frames++;
  const now = performance.now();
  if (!fpsT) fpsT = now;
  fpsN++;
  if (now - fpsT >= 500) {
    fps = (fpsN * 1000) / (now - fpsT);
    fpsT = now;
    fpsN = 0;
  }
}

// ───────────────────────── test hooks ─────────────────────────

interface ConeInfo {
  renderer: "webgl" | "2d";
  v: number;
  gamma: number;
  rapidity: number;
  boostAngle: number;
  events: Ev[];
  selectedPair: number[];
  dt: number | null;
  dx: number | null;
  interval: number | null;
  pairType: string | null;
  homeTicks: number;
  rocketTicks: number;
  frames: number;
  fps: number;
  T: number;
  clocks: { home: number; rocket: number };
  wow: boolean;
  dropMode: boolean;
  show: Model["show"];
  caption: string;
  verdict: string;
  pairState: "pair" | "empty";
  undoVisible: boolean;
  nan: boolean;
}

declare global {
  interface Window {
    __coneInfo: () => ConeInfo;
    __coneSelfTest: () => ReturnType<typeof selfTest>;
    __coneAdvance: (seconds: number) => ConeInfo;
    __coneProject: (target: number | Ev) => { x: number; y: number } | null;
    __coneFreeze: (on: boolean) => void;
    __lightCone: {
      placeEvent: (x: number, t?: number, y?: number) => number;
      clear: () => void;
      undo: () => void;
      restore: () => void;
      select: (a: number, b: number) => void;
      setSpeed: (v: number) => void;
      info: () => ConeInfo;
    };
    __ixRecord: { ready: boolean; setStepped: (on: boolean) => void; stepFrame: (dt: number) => void };
  }
}
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
window.__coneInfo = () => {
  const pi = model.pairInfo();
  const sel = model.selIndex();
  return {
    renderer: view?.kind ?? "webgl",
    v: r4(model.v),
    gamma: r4(model.gamma),
    rapidity: r4(model.rapidity),
    boostAngle: r4(model.angle),
    events: model.events.map((e) => ({ t: r4(e.e.t), x: r4(e.e.x), y: r4(e.e.y) })),
    selectedPair: sel,
    dt: pi ? r4(pi.dt) : null,
    dx: pi ? r4(pi.dr) : null,
    interval: pi ? r4(pi.s2) : null,
    pairType: pi ? pi.type : sel.length === 2 ? classify(model.events[sel[0]].e, model.events[sel[1]].e) : null,
    homeTicks: r4(model.twin.homeTicks),
    rocketTicks: r4(model.twin.rocketTicks),
    frames,
    fps: Math.round(fps * 10) / 10,
    T: r4(model.T),
    clocks: model.clocks(),
    wow: model.wow.active,
    dropMode,
    show: { ...model.show },
    caption: captionText.textContent ?? "",
    verdict: verdictEl.textContent ?? "",
    pairState: pi ? "pair" : "empty",
    undoVisible: !toast.hidden,
    nan: !model.finite(),
  };
};
window.__coneSelfTest = () => selfTest();
window.__coneAdvance = (seconds: number) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 30) frame(1 / 30, false);
  return window.__coneInfo();
};
/** Screen position of event i, or of any Home-frame event {t, x, y}. */
window.__coneProject = (target: number | Ev) => {
  const e = typeof target === "number" ? model.events[target]?.e : target;
  return e && view ? view.project(model.display(e)) : null;
};
/** Tests only: pause cosmetic motion so screenshots differ only when the physics does. */
window.__coneFreeze = (on: boolean) => view?.setFrozen?.(on);
/**
 * Script the fireworks without tapping. placeEvent(x, t, y) places one at Home coordinates
 * (t defaults to the "now" sheet) exactly as a tap in Add-fireworks mode would: the second
 * call makes the two A and B and switches the mode off. Returns the new event's index.
 */
window.__lightCone = {
  placeEvent(x: number, t = model.T, y = 0) {
    if (!dropMode) setDropMode(true);
    const i = placeFirework({ t, x, y });
    updateHud();
    return i;
  },
  clear: () => (clearEvents(), updateHud()),
  undo: () => (undoClear(), updateHud()),
  restore: () => (restoreExample(), updateHud()),
  select(a: number, b: number) {
    userTouched();
    model.selectPair(a, b);
    updateHud();
  },
  setSpeed(v: number) {
    userTouched();
    model.vTarget = Math.max(-V_UI, Math.min(V_UI, v));
  },
  info: () => window.__coneInfo(),
};
// Deterministic fixed-dt stepping for scripts/record-demo.mjs ("capture": "frames").
window.__ixRecord = {
  ready: false,
  setStepped(on: boolean) {
    stepped = on;
    if (on) setExplain(false, false);
    view?.setStepped?.(on);
  },
  stepFrame(dt: number) {
    frame(Math.min(0.1, Math.max(1 / 240, dt || 1 / 30)));
  },
};

syncTrip();
drawCombine();
setRange(speed, 0);
setRange(time, model.T);
void boot();
