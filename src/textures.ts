/** Procedural canvas textures: engraved brass, walnut grain, soft dots, clock faces. */
import { makeRng } from "./physics";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function noise2(seed: number): (x: number, y: number) => number {
  const r = makeRng(seed);
  const N = 256;
  const t = Float32Array.from({ length: N * N }, () => r());
  const at = (i: number, j: number) => t[(j & (N - 1)) * N + (i & (N - 1))];
  return (x: number, y: number) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/**
 * Polished brass disc engraved with the x-y grid (1 unit spacing), rings and a degree scale.
 * `radius` is the disc radius in spacetime units; the texture maps the disc's bounding square.
 */
export function brass(size: number, radius: number): { color: HTMLCanvasElement; rough: HTMLCanvasElement } {
  const [c, g] = canvas(size, size);
  const [r, rg] = canvas(size, size);
  const px = size / (2 * radius); // pixels per unit
  const cx = size / 2;
  // brushed base: concentric lathe marks + warm variation
  const img = g.createImageData(size, size);
  const n = noise2(5);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cx;
      const rr = Math.hypot(dx, dy);
      const lathe = Math.sin(rr * 1.7) * 0.5 + 0.5;
      const cloud = n(x / 90, y / 90);
      const o = (y * size + x) * 4;
      const k = 0.86 + cloud * 0.12 + lathe * 0.04;
      img.data[o] = 214 * k;
      img.data[o + 1] = 168 * k;
      img.data[o + 2] = 98 * k;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  rg.fillStyle = "rgb(70,70,70)";
  rg.fillRect(0, 0, size, size);

  const engrave = (draw: (ctx: CanvasRenderingContext2D) => void, width: number, dark = 0.6) => {
    g.save();
    g.strokeStyle = `rgba(48,30,10,${dark})`;
    g.fillStyle = `rgba(48,30,10,${dark})`;
    g.lineWidth = width;
    draw(g);
    g.restore();
    rg.save();
    rg.strokeStyle = "rgb(190,190,190)";
    rg.fillStyle = "rgb(190,190,190)";
    rg.lineWidth = width;
    draw(rg);
    rg.restore();
  };
  const inner = radius - 1.6;
  // grid, clipped to the inner circle
  engrave((ctx) => {
    ctx.beginPath();
    ctx.arc(cx, cx, inner * px, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    for (let k = -Math.floor(inner); k <= Math.floor(inner); k++) {
      if (k % 5 === 0) continue;
      const p = cx + k * px;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
  }, Math.max(1, px * 0.035), 0.45);
  engrave((ctx) => {
    ctx.beginPath();
    ctx.arc(cx, cx, inner * px, 0, Math.PI * 2);
    ctx.clip();
    ctx.beginPath();
    for (let k = -10; k <= 10; k += 5) {
      const p = cx + k * px;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
  }, Math.max(1.5, px * 0.07), 0.6);
  // rings
  engrave((ctx) => {
    for (const rad of [5, 10, inner, radius - 0.35]) {
      ctx.beginPath();
      ctx.arc(cx, cx, rad * px, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, Math.max(1.5, px * 0.06), 0.65);
  // degree scale between inner and the rim
  engrave((ctx) => {
    ctx.beginPath();
    for (let d = 0; d < 360; d += 2) {
      const a = (d * Math.PI) / 180;
      const len = d % 30 === 0 ? 0.9 : d % 10 === 0 ? 0.6 : 0.32;
      const r0 = inner + 0.06, r1 = r0 + len;
      ctx.moveTo(cx + Math.cos(a) * r0 * px, cx + Math.sin(a) * r0 * px);
      ctx.lineTo(cx + Math.cos(a) * r1 * px, cx + Math.sin(a) * r1 * px);
    }
    ctx.stroke();
  }, Math.max(1, px * 0.04), 0.6);
  // axis letters (x to the right, y "into" the table)
  engrave((ctx) => {
    ctx.font = `600 ${Math.round(px * 0.9)}px Georgia, "Times New Roman", serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("x", cx + (inner - 0.9) * px, cx - 0.7 * px);
    ctx.fillText("y", cx + 0.7 * px, cx - (inner - 0.9) * px);
    ctx.font = `500 ${Math.round(px * 0.5)}px Georgia, serif`;
    for (let d = 0; d < 360; d += 30) {
      const a = (-d * Math.PI) / 180;
      const rr = inner + 1.2;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * rr * px, cx + Math.sin(a) * rr * px);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(String(d), 0, 0);
      ctx.restore();
    }
  }, 1, 0.55);
  return { color: c, rough: r };
}

/** Walnut grain (long figured stripes). */
export function walnut(w = 1024, h = 512, seed = 11): HTMLCanvasElement {
  const [c, g] = canvas(w, h);
  const img = g.createImageData(w, h);
  const n = noise2(seed), m = noise2(seed + 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const warp = n(u * 4, v * 9) * 2.2 + m(u * 18, v * 30) * 0.35;
      const ring = Math.sin((v * 34 + warp) * Math.PI);
      const fine = m(u * 300, v * 6) * 0.25;
      const k = 0.55 + 0.25 * Math.pow(ring * 0.5 + 0.5, 3) + fine * 0.6 + n(u * 2, v * 2) * 0.15;
      const o = (y * w + x) * 4;
      img.data[o] = 92 * k;
      img.data[o + 1] = 56 * k;
      img.data[o + 2] = 34 * k;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Soft round sprite. */
export function dot(size = 64): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.3, "rgba(255,255,255,0.4)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

/** A soft radial vignette pool (white; tint in the material). */
export function pool(size = 256): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.4, "rgba(255,255,255,0.35)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return c;
}

/** A small glowing clock face with a hand and the elapsed ticks. */
export function drawClock(ctx: CanvasRenderingContext2D, size: number, label: string, ticks: number, color: string): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  const r = size * 0.36;
  const cx = r + 6, cy = H / 2;
  ctx.save();
  ctx.fillStyle = "rgba(8,12,20,0.78)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  roundRect(ctx, 2, cy - r - 4, W - 4, 2 * r + 8, r + 4);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // dial
  ctx.beginPath();
  ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * (r - 8), cy - Math.cos(a) * (r - 8));
    ctx.lineTo(cx + Math.sin(a) * (r - 12), cy - Math.cos(a) * (r - 12));
    ctx.stroke();
  }
  const a = ((((ticks % 1) + 1) % 1) * Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.sin(a) * (r - 10), cy - Math.cos(a) * (r - 10));
  ctx.stroke();
  // text
  ctx.fillStyle = color;
  ctx.font = `600 ${Math.round(size * 0.2)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label, cx + r + 8, cy - 4);
  ctx.fillStyle = "#f4f8ff";
  ctx.font = `600 ${Math.round(size * 0.26)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";
  ctx.fillText(`${ticks.toFixed(1)} ticks`, cx + r + 8, cy + 1);
  ctx.restore();
}

/** A/B badge for the selected pair: a dark disc with a cyan ring and the letter. */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, color: string): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const r = Math.min(W, H) / 2 - 4;
  ctx.clearRect(0, 0, W, H);
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(4, 18, 26, 0.88)";
  ctx.shadowColor = "rgba(111, 231, 255, 0.8)";
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(2, r * 0.12);
  ctx.strokeStyle = "#6fe7ff";
  ctx.stroke();
  ctx.font = `700 ${Math.round(r * 1.15)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, H / 2 + r * 0.06);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
