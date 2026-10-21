/**
 * WebGL scene (three.js): a walnut plinth with a polished brass top engraved with the x-y grid;
 * a clear double cone of glass rising from it (the light cone, never transformed); Home's silver
 * space-time lattice, Home's frosted "now" sheet, the amber Home and teal Rocket world lines with
 * brass clock beads, and glowing firework events, all pushed through the exact Lorentz matrix of
 * the current observer. ACES tone mapping, bloom, PCF soft shadows, vignette and grain.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { apply, atProperTime, boostMatrix, type Ev } from "./physics";
import { type Model, ROD_L0 } from "./model";
import {
  AMBER,
  CYAN,
  GOLD,
  H_CONE,
  PEARL,
  R_MAX,
  TEAL,
  T_BOT,
  T_TOP,
  TYPE_COLOR,
  VIOLET,
  clipSegment,
  inRegion,
  lerpEv,
  type Layout,
  type View,
} from "./view";
import { brass, dot, drawClock, drawLabel, pool, walnut } from "./textures";

/** World units per spacetime unit. */
const S = 0.1;
const Y_BASE = T_BOT * S;
const DISC_R = 15.5 * S;
/** Long enough that Home's lattice still fills the display at 0.95 c. */
const L_FAR = 86;
const FOCUS = new THREE.Vector3(0, 0.08, 0);
const HERO_H = 2.95;

const cAmber = new THREE.Color(AMBER);
const cTeal = new THREE.Color(TEAL);
const cCyan = new THREE.Color(CYAN);
const cViolet = new THREE.Color(VIOLET);
const cGold = new THREE.Color(GOLD);
const cPearl = new THREE.Color(PEARL);
const typeCol = {
  timelike: new THREE.Color(TYPE_COLOR.timelike),
  lightlike: new THREE.Color(TYPE_COLOR.lightlike),
  spacelike: new THREE.Color(TYPE_COLOR.spacelike),
};

const toW = (e: Ev, out = new THREE.Vector3()) => out.set(e.x * S, e.t * S, -e.y * S);
const fromW = (p: THREE.Vector3): Ev => ({ t: p.y / S, x: p.x / S, y: -p.z / S });

const FINISH_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.03 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      float v = smoothstep(0.9, 0.25, length(q * vec2(1.0, 1.2)));
      c.rgb *= mix(0.42, 1.0, v);
      c.rgb += (hash(vUv * 1024.0 + fract(uTime) * 91.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

const BACKDROP_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const BACKDROP_FRAG = /* glsl */ `
varying vec3 vDir;
void main() {
  float h = vDir.y;
  vec3 navy = vec3(0.016, 0.026, 0.050);
  vec3 coal = vec3(0.010, 0.010, 0.013);
  vec3 col = mix(coal, navy, smoothstep(-0.2, 0.7, h));
  float glow = pow(max(0.0, dot(vDir, normalize(vec3(0.0, 0.25, -1.0)))), 5.0);
  col += vec3(0.020, 0.040, 0.065) * glow;
  float warm = pow(max(0.0, dot(vDir, normalize(vec3(-1.0, 0.0, -0.4)))), 4.0);
  col += vec3(0.030, 0.018, 0.008) * warm;
  gl_FragColor = vec4(col, 1.0);
}`;

/** Home's lattice: positions are Home (t, x, y); the vertex shader applies the boost. */
const LATTICE_VERT = /* glsl */ `
uniform mat3 uM;
uniform float uS;
attribute float aW;
varying vec3 vD;
varying float vW;
void main() {
  vec3 d = uM * position;
  vD = d;
  vW = aW;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(d.y * uS, d.x * uS, -d.z * uS, 1.0);
}`;
const LATTICE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uClip;
varying vec3 vD;
varying float vW;
void main() {
  float r = length(vD.yz);
  if (vD.x < uClip.x || vD.x > uClip.y || r > uClip.z) discard;
  float edge = smoothstep(uClip.z, uClip.z - 2.5, r) * smoothstep(uClip.y, uClip.y - 2.5, vD.x) * smoothstep(uClip.x, uClip.x + 0.6, vD.x);
  gl_FragColor = vec4(uColor, uOpacity * edge * vW);
}`;

/** Fresnel glass shell (additive): bright silhouettes = thick glass; a shimmer band on boosts. */
const FRESNEL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FRESNEL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uBase;
uniform float uEdge;
uniform float uShimmer;
uniform float uSweep;
varying vec3 vN;
varying vec3 vV;
varying vec3 vW;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
  float rim = smoothstep(0.75, 1.12, abs(vW.y)) * 0.6;
  float band = exp(-pow((vW.y - uSweep) * 10.0, 2.0)) * uShimmer;
  vec3 col = uColor * (uBase + f * uEdge + rim * 0.25) + vec3(0.75, 0.95, 1.0) * band * (0.03 + 0.4 * f);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Instanced cylinders: cheap glowing threads rebuilt every frame. */
class Segs {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private q = new THREE.Quaternion();
  private m = new THREE.Matrix4();
  private s = new THREE.Vector3();
  private d = new THREE.Vector3();
  private mid = new THREE.Vector3();
  private static Y = new THREE.Vector3(0, 1, 0);
  constructor(private cap: number, material: THREE.Material, radial = 8) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, radial, 1, true);
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, white);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }
  begin(): void {
    this.n = 0;
  }
  add(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.Color): void {
    if (this.n >= this.cap) return;
    this.d.subVectors(b, a);
    const len = this.d.length();
    if (len < 1e-6) return;
    this.q.setFromUnitVectors(Segs.Y, this.d.multiplyScalar(1 / len));
    this.mid.addVectors(a, b).multiplyScalar(0.5);
    this.s.set(r, len, r);
    this.m.compose(this.mid, this.q, this.s);
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, color);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface EventObj {
  group: THREE.Group;
  core: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  halo: THREE.Sprite;
  ring: THREE.Sprite;
}

interface ClockSprite {
  sprite: THREE.Sprite;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  key: string;
}

export class Scene3D implements View {
  readonly kind = "webgl" as const;
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private renderPass: RenderPass;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(27, 16 / 9, 0.1, 120);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 60);
  private camera: THREE.Camera = this.persp;
  private flat = false;
  private w = 1;
  private h = 1;
  private mobile: boolean;
  private layout: Layout = { cx: 640, cy: 360, size: 400, phone: false };
  private lay = { cx: 0, cy: 0, size: 0 };
  // camera rig
  private yaw = -0.32;
  private pitch = 0.2;
  private yawV = 0;
  private pitchV = 0;
  private zoomF = 1.14;
  private zoomT = 1;
  private idle = 10;
  private frozen = false;
  private time = 0;
  private dragging = false;
  // objects
  private coneU = { uColor: { value: cCyan.clone().multiplyScalar(0.9) }, uBase: { value: 0.004 }, uEdge: { value: 0.26 }, uShimmer: { value: 0 }, uSweep: { value: 0 } };
  private latU = {
    uM: { value: new THREE.Matrix3() },
    uS: { value: S },
    uColor: { value: new THREE.Color(0.8, 0.85, 0.92) },
    uOpacity: { value: 0.3 },
    uClip: { value: new THREE.Vector3(T_BOT, T_TOP, R_MAX) },
  };
  private ghostU = {
    uM: { value: new THREE.Matrix3() },
    uS: { value: S },
    uColor: { value: new THREE.Color(0.45, 0.6, 0.85) },
    uOpacity: { value: 0.1 },
    uClip: { value: new THREE.Vector3(T_BOT, T_TOP, R_MAX) },
  };
  private lattice!: THREE.LineSegments;
  private ghost!: THREE.LineSegments;
  private sheet!: THREE.Mesh;
  private sheetPos!: THREE.BufferAttribute;
  private sheetEdge!: THREE.LineLoop;
  private sheetEdgePos!: THREE.BufferAttribute;
  private core!: Segs;
  private halo!: Segs;
  private beads!: THREE.InstancedMesh;
  private beadGlow!: THREE.InstancedMesh;
  private events: EventObj[] = [];
  private labels: THREE.Sprite[] = [];
  private conn!: THREE.LineSegments;
  private connPos!: THREE.BufferAttribute;
  private connCol!: THREE.BufferAttribute;
  private hyper: { mesh: THREE.Mesh; k: number }[] = [];
  private hyperMat!: THREE.ShaderMaterial;
  private rod!: THREE.Mesh;
  private rodLabel!: ClockSprite;
  private clocks: ClockSprite[] = [];
  private dust!: THREE.Points;
  private dustBase!: Float32Array;
  private hereLight!: THREE.PointLight;
  private herePin!: THREE.Sprite;
  private clipPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), T_TOP * S), new THREE.Plane(new THREE.Vector3(0, 1, 0), -T_BOT * S)];
  private dotTex: THREE.Texture;
  // scratch
  private v3 = new THREE.Vector3();
  private v3b = new THREE.Vector3();
  private col = new THREE.Color();
  private m4 = new THREE.Matrix4();
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();

  constructor(container: HTMLElement, opts: { hq?: boolean } = {}) {
    this.mobile = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) < 600;
    const canvas = document.createElement("canvas");
    canvas.id = "canvas";
    canvas.setAttribute("aria-label", "Glass light cone on a brass base. Drag to turn it. Tap one glowing bead, then another, to compare them; with Add fireworks on, tap the floor to place one.");
    container.appendChild(canvas);
    this.canvas = canvas;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false, preserveDrawingBuffer: !!opts.hq });
    } catch (e) {
      canvas.remove();
      throw e;
    }
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 1.5 : 2));
    this.dotTex = new THREE.CanvasTexture(dot());
    this.dotTex.colorSpace = THREE.SRGBColorSpace;

    this.scene.fog = new THREE.FogExp2(0x070a10, 0.05);
    this.buildEnvironment();
    this.buildBase();
    this.buildCone();
    this.buildSpacetime();
    this.buildFx();

    const samples = this.mobile ? 0 : 4;
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.45, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.finish = new ShaderPass(FINISH_SHADER);
    this.composer.addPass(this.finish);
  }

  // ───────────────────────────── build ─────────────────────────────

  private buildEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.03).texture;
    this.scene.environmentIntensity = 0.32;
    room.dispose();
    pmrem.dispose();

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(60, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: BACKDROP_VERT, fragmentShader: BACKDROP_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.renderOrder = -10;
    this.scene.add(sky);

    const key = new THREE.SpotLight(0xfff0dc, 38, 30, 0.3, 0.7, 1.5);
    key.position.set(0.6, 7.5, 1.4);
    key.target.position.set(0, Y_BASE, 0);
    key.castShadow = true;
    const sm = this.mobile ? 1024 : 2048;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.01;
    key.shadow.radius = 4;
    this.scene.add(key, key.target);
    if ((new URLSearchParams(location.search).get("dbg") ?? "").includes("nokey")) key.visible = false;
    const rim = new THREE.DirectionalLight(0xffa860, 2.2);
    rim.position.set(-5, 3, -5);
    const fill = new THREE.DirectionalLight(0x6f9cff, 0.9);
    fill.position.set(5, 2, 4);
    const front = new THREE.DirectionalLight(0xc8d6ff, 0.5);
    front.position.set(-2, 1, 7);
    this.scene.add(rim, fill, front, new THREE.HemisphereLight(0x22324e, 0x0b0705, 0.45));
    this.hereLight = new THREE.PointLight(0xd8f6ff, 0.9, 1.6, 2);
    this.scene.add(this.hereLight);
  }

  private buildBase(): void {
    const tex = brass(this.mobile ? 1024 : 2048, DISC_R / S);
    const map = new THREE.CanvasTexture(tex.color);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const rough = new THREE.CanvasTexture(tex.rough);
    const brassTop = new THREE.MeshPhysicalMaterial({ map, roughnessMap: rough, roughness: 0.42, metalness: 1, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 1.2 });
    const brassPlain = new THREE.MeshPhysicalMaterial({ color: 0xd6a85c, roughness: 0.28, metalness: 1, clearcoat: 0.5, envMapIntensity: 1.3 });
    const top = new THREE.Mesh(new THREE.CircleGeometry(DISC_R, 128), brassTop);
    top.rotation.x = -Math.PI / 2;
    top.position.y = Y_BASE - 0.001;
    top.receiveShadow = true;
    const side = new THREE.Mesh(new THREE.CylinderGeometry(DISC_R, DISC_R, 0.035, 128, 1, true), brassPlain);
    side.position.y = Y_BASE - 0.018;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(DISC_R, 0.012, 10, 160), brassPlain);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = Y_BASE - 0.002;
    // brass collar holding the foot of the past cone
    const collar = new THREE.Mesh(new THREE.TorusGeometry(H_CONE * S + 0.02, 0.026, 14, 160), brassPlain);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = Y_BASE + 0.012;
    collar.castShadow = true;
    this.scene.add(top, side, lip, collar);

    // walnut plinth and a walnut table
    const wood = new THREE.CanvasTexture(walnut(this.mobile ? 512 : 1024, this.mobile ? 256 : 512));
    wood.colorSpace = THREE.SRGBColorSpace;
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    const woodMat = new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.48, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.5 });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(DISC_R + 0.12, DISC_R + 0.2, 0.18, 128, 1), woodMat);
    plinth.position.y = Y_BASE - 0.035 - 0.09;
    plinth.receiveShadow = true;
    const tableTex = wood.clone();
    tableTex.repeat.set(2, 1);
    tableTex.needsUpdate = true;
    const tableMat = woodMat.clone();
    tableMat.map = tableTex;
    tableMat.color.setScalar(0.62);
    const table = new THREE.Mesh(new THREE.BoxGeometry(9, 0.2, 5), tableMat);
    table.position.set(0, Y_BASE - 0.215 - 0.1, 0.9);
    table.receiveShadow = true;
    this.scene.add(plinth, table);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x040507, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = Y_BASE - 3;
    this.scene.add(floor);
    // a warm pool of light on the brass under the cone
    const poolTex = new THREE.CanvasTexture(pool());
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(H_CONE * S, 64),
      new THREE.MeshBasicMaterial({ map: poolTex, color: cCyan.clone().multiplyScalar(0.16), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = Y_BASE + 0.004;
    this.scene.add(glow);
    if ((new URLSearchParams(location.search).get("dbg") ?? "").includes("nopool")) glow.visible = false;
  }

  private buildCone(): void {
    const H = H_CONE * S;
    const pts: THREE.Vector2[] = [];
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const y = -H + (2 * H * i) / N;
      pts.push(new THREE.Vector2(Math.max(0.004, Math.abs(y)), y));
    }
    const lathe = new THREE.LatheGeometry(pts, 128);
    const inner = lathe.clone();
    inner.scale(0.985, 1, 0.985);
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xeefaff,
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.07,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 3,
      ior: 1.5,
      specularIntensity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(lathe, glass);
    body.renderOrder = 6;
    const fres = new THREE.ShaderMaterial({
      uniforms: this.coneU,
      vertexShader: FRESNEL_VERT,
      fragmentShader: FRESNEL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const shellA = new THREE.Mesh(lathe, fres);
    const shellB = new THREE.Mesh(inner, fres);
    shellA.renderOrder = shellB.renderOrder = 7;
    this.scene.add(body, shellA, shellB);
    const dbg = new URLSearchParams(location.search).get("dbg") ?? "";
    if (dbg.includes("nobody")) body.visible = false;
    if (dbg.includes("noshell")) shellA.visible = shellB.visible = false;
    // etched 45° light rays and time graduations
    const etch: number[] = [];
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const c = Math.cos(a) * H, s = Math.sin(a) * H;
      etch.push(0, 0, 0, c, H, s, 0, 0, 0, c, -H, s);
    }
    for (const t of [-8, -6, -4, -2, 2, 4, 6, 8, 10]) {
      const r = Math.abs(t) * S, y = t * S;
      for (let k = 0; k < 96; k++) {
        const a0 = (k / 96) * Math.PI * 2, a1 = ((k + 1) / 96) * Math.PI * 2;
        etch.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
      }
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", new THREE.Float32BufferAttribute(etch, 3));
    const etched = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false }));
    etched.renderOrder = 8;
    this.scene.add(etched);
    // thick glass lips with a cyan rim glow, top and bottom
    const lipMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.3, clearcoat: 1, envMapIntensity: 3, depthWrite: false });
    const rimMat = new THREE.MeshBasicMaterial({ color: cCyan.clone().multiplyScalar(1.6), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (const y of [H, -H]) {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(H, 0.014, 12, 160), lipMat);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = y;
      const glowRing = new THREE.Mesh(new THREE.TorusGeometry(H, 0.005, 8, 160), rimMat);
      glowRing.rotation.x = Math.PI / 2;
      glowRing.position.y = y + (y > 0 ? 0.004 : 0.01);
      lip.renderOrder = glowRing.renderOrder = 9;
      this.scene.add(lip, glowRing);
    }
    const capTex = new THREE.CanvasTexture(pool());
    const cap = new THREE.Mesh(
      new THREE.CircleGeometry(H, 96),
      new THREE.MeshBasicMaterial({ map: capTex, color: cCyan.clone().multiplyScalar(0.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = H;
    this.scene.add(cap);
    // here-and-now: a bright point at the waist
    const pinMat = new THREE.SpriteMaterial({ map: this.dotTex, color: new THREE.Color(0.85, 0.97, 1).multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.herePin = new THREE.Sprite(pinMat);
    this.herePin.scale.setScalar(0.09);
    this.herePin.renderOrder = 12;
    this.scene.add(this.herePin);
  }

  private buildSpacetime(): void {
    // Home's lattice in Home coordinates: lines along t, along x, along y.
    const pos: number[] = [];
    const w: number[] = [];
    const L = L_FAR;
    const push = (a: [number, number, number], b: [number, number, number], weight: number) => {
      pos.push(...a, ...b);
      w.push(weight, weight);
    };
    for (let y = -40; y <= 40; y += 4) {
      const main = y === 0;
      const stepT = main ? 2 : 4;
      const wt = main ? 1 : 0.32 * Math.exp(-Math.abs(y) / 9);
      for (let x = -L; x <= L; x += stepT) push([-L, x, y], [L, x, y], wt); // along t
      for (let t = -L; t <= L; t += stepT) push([t, -L, y], [t, L, y], wt); // along x
    }
    for (let t = -L; t <= L; t += 4) for (let x = -L; x <= L; x += 4) push([t, x, -40], [t, x, 40], 0.1); // along y
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("aW", new THREE.Float32BufferAttribute(w, 1));
    const mk = (u: typeof this.latU) =>
      new THREE.ShaderMaterial({ uniforms: u, vertexShader: LATTICE_VERT, fragmentShader: LATTICE_FRAG, transparent: true, depthWrite: false });
    this.lattice = new THREE.LineSegments(g, mk(this.latU));
    this.ghost = new THREE.LineSegments(g, mk(this.ghostU));
    this.lattice.frustumCulled = this.ghost.frustumCulled = false;
    this.lattice.renderOrder = 2;
    this.ghost.renderOrder = 1;
    this.scene.add(this.ghost, this.lattice);

    // Home's "now" sheet: a frosted disc, re-tilted every frame
    const N = 96;
    const sp = new Float32Array((N + 1) * 3);
    const idx: number[] = [];
    for (let i = 0; i < N; i++) idx.push(0, 1 + ((i + 1) % N), 1 + i);
    const sg = new THREE.BufferGeometry();
    this.sheetPos = new THREE.BufferAttribute(sp, 3);
    sg.setAttribute("position", this.sheetPos);
    sg.setIndex(idx);
    const sheetMat = new THREE.MeshPhysicalMaterial({
      color: 0xd9f2ff,
      roughness: 0.55,
      metalness: 0,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
      clearcoat: 0.5,
      clearcoatRoughness: 0.4,
      emissive: cCyan.clone(),
      emissiveIntensity: 0.05,
      envMapIntensity: 1.2,
      clippingPlanes: this.clipPlanes,
    });
    this.sheet = new THREE.Mesh(sg, sheetMat);
    this.sheet.frustumCulled = false;
    this.sheet.renderOrder = 4;
    const ep = new Float32Array(N * 3);
    this.sheetEdgePos = new THREE.BufferAttribute(ep, 3);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute("position", this.sheetEdgePos);
    this.sheetEdge = new THREE.LineLoop(eg, new THREE.LineBasicMaterial({ color: new THREE.Color(0.7, 0.92, 1), transparent: true, opacity: 0.55, clippingPlanes: this.clipPlanes, depthWrite: false }));
    this.sheetEdge.frustumCulled = false;
    this.scene.add(this.sheet, this.sheetEdge);

    // glowing threads (world lines, the sheet's slice of the cone, selected pair, rod ends)
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.core = new Segs(320, coreMat, 8);
    this.halo = new Segs(320, haloMat, 8);
    this.core.mesh.renderOrder = 5;
    this.halo.mesh.renderOrder = 10;
    this.scene.add(this.core.mesh, this.halo.mesh);

    // brass clock beads + their tick glow
    const bg = new THREE.SphereGeometry(1, 20, 14);
    const brassMat = new THREE.MeshPhysicalMaterial({ color: 0xe0ad58, metalness: 1, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.8 });
    this.beads = new THREE.InstancedMesh(bg, brassMat, 64);
    this.beads.castShadow = true;
    this.beads.count = 0;
    this.beads.frustumCulled = false;
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.55 });
    this.beadGlow = new THREE.InstancedMesh(bg, glowMat, 64);
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < 64; i++) this.beadGlow.setColorAt(i, white);
    this.beadGlow.count = 0;
    this.beadGlow.frustumCulled = false;
    this.beadGlow.renderOrder = 11;
    this.scene.add(this.beads, this.beadGlow);

    // connectors between every pair of fireworks
    const maxPairs = 64;
    this.connPos = new THREE.BufferAttribute(new Float32Array(maxPairs * 6), 3);
    this.connCol = new THREE.BufferAttribute(new Float32Array(maxPairs * 6), 3);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", this.connPos);
    cg.setAttribute("color", this.connCol);
    this.conn = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.conn.frustumCulled = false;
    this.conn.renderOrder = 9;
    this.scene.add(this.conn);

    // invariant hyperboloids
    this.hyperMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: cViolet.clone().multiplyScalar(0.5) }, uBase: { value: 0.03 }, uEdge: { value: 0.5 }, uShimmer: { value: 0 }, uSweep: { value: 0 } },
      vertexShader: FRESNEL_VERT,
      fragmentShader: FRESNEL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    for (let i = 0; i < 2; i++) {
      const mat = this.hyperMat.clone();
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      mesh.visible = false;
      mesh.renderOrder = 6;
      this.hyper.push({ mesh, k: NaN });
      this.scene.add(mesh);
    }

    // glass rod (length contraction)
    this.rod = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 20, 1, false),
      new THREE.MeshPhysicalMaterial({ color: 0xbff7f0, roughness: 0.08, transparent: true, opacity: 0.55, clearcoat: 1, emissive: cTeal.clone(), emissiveIntensity: 0.35, envMapIntensity: 2.5 }),
    );
    this.rod.visible = false;
    this.rod.castShadow = true;
    this.scene.add(this.rod);
    this.rodLabel = this.makeTextSprite(256, 64);
    this.rodLabel.sprite.center.set(0.5, -0.2);

    // fireworks
    for (let i = 0; i < 10; i++) {
      const group = new THREE.Group();
      const mat = new THREE.MeshPhysicalMaterial({ color: cPearl.clone(), roughness: 0.06, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.92, emissive: cPearl.clone(), emissiveIntensity: 0.55, envMapIntensity: 2.4, iridescence: 0.8, iridescenceIOR: 1.6 });
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.04, 24, 16), mat);
      core.castShadow = true;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dotTex, color: cPearl.clone(), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.8 }));
      halo.scale.setScalar(0.22);
      const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ringTex(), color: cCyan.clone().multiplyScalar(1.5), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false }));
      ring.scale.setScalar(0.17);
      ring.renderOrder = 14;
      group.add(core, halo, ring);
      group.visible = false;
      this.events.push({ group, core, mat, halo, ring });
      this.scene.add(group);
    }
    for (const t of ["A", "B"]) {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      drawLabel(c.getContext("2d")!, t, "#eaffff");
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }));
      s.scale.setScalar(0.13);
      s.center.set(-0.2, -0.2);
      s.renderOrder = 15;
      s.visible = false;
      this.labels.push(s);
      this.scene.add(s);
    }
    // clock faces riding each traveller
    for (let i = 0; i < 2; i++) {
      const c = this.makeTextSprite(360, 112);
      c.sprite.scale.set((0.2 * 360) / 112, 0.2, 1);
      c.sprite.center.set(-0.04, 0.5);
      this.clocks.push(c);
    }
  }

  private makeTextSprite(w: number, h: number): ClockSprite {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, transparent: true }));
    sprite.scale.set((0.13 * w) / h, 0.13, 1);
    sprite.renderOrder = 16;
    this.scene.add(sprite);
    return { sprite, ctx: c.getContext("2d")!, tex, key: "" };
  }

  private ringTex(): THREE.Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.strokeStyle = "rgba(255,255,255,0.95)";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(32, 32, 26, 0, Math.PI * 2);
    g.stroke();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private buildFx(): void {
    const N = this.mobile ? 220 : 420;
    const p = new Float32Array(N * 3);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    for (let i = 0; i < N; i++) {
      p[i * 3] = rnd(-3.2, 3.2);
      p[i * 3 + 1] = rnd(-1.2, 2.2);
      p[i * 3 + 2] = rnd(-3, 2.5);
    }
    this.dustBase = p.slice();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    this.dust = new THREE.Points(
      g,
      new THREE.PointsMaterial({ map: this.dotTex, size: 0.016, color: 0xbfd2ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
    );
    this.scene.add(this.dust);
  }

  // ───────────────────────────── view API ─────────────────────────────

  resize(w: number, h: number, layout: Layout): void {
    this.w = w;
    this.h = h;
    this.layout = layout;
    if (!this.lay.size) this.lay = { cx: layout.cx, cy: layout.cy, size: layout.size };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const k = this.mobile ? 0.35 : 0.5;
    this.bloom.resolution.set(Math.max(64, w * k), Math.max(64, h * k));
    const ls = layout.phone ? 1.6 : 1;
    for (const c of this.clocks) c.sprite.scale.set(((0.2 * 360) / 112) * ls, 0.2 * ls, 1);
    this.rodLabel.sprite.scale.set(((0.13 * 256) / 64) * ls, 0.13 * ls, 1);
    for (const l of this.labels) l.scale.setScalar(0.13 * ls);
  }

  setStepped(): void {
    /* rendering is already deterministic per frame */
  }

  setFrozen(on: boolean): void {
    this.frozen = on;
    this.idle = 0;
    this.yawV = this.pitchV = 0;
    // settle layout and zoom easing so a frozen frame shows only physics changes
    this.lay = { cx: this.layout.cx, cy: this.layout.cy, size: this.layout.size };
    this.zoomF = this.zoomT;
  }

  setFlat(on: boolean): void {
    if (on === this.flat) return;
    this.flat = on;
    this.camera = on ? this.ortho : this.persp;
    this.renderPass.camera = this.camera;
  }

  orbit(dx: number, dy: number): void {
    if (this.flat) return;
    this.dragging = true;
    this.yawV = -dx * 0.006;
    this.pitchV = dy * 0.004;
    this.yaw += this.yawV;
    this.pitch = Math.max(-0.05, Math.min(1.1, this.pitch + this.pitchV));
    this.idle = 0;
  }
  release(): void {
    this.dragging = false;
  }
  zoom(f: number): void {
    this.zoomT = Math.max(0.6, Math.min(1.6, this.zoomT * f));
    this.idle = 0;
  }
  poke(): void {
    this.idle = 0;
  }

  private setRay(clientX: number, clientY: number): void {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  pickEvent(clientX: number, clientY: number): number {
    this.setRay(clientX, clientY);
    let best = -1, bestD = Infinity;
    const tol = this.layout.phone ? 0.09 : 0.065;
    this.events.forEach((o, i) => {
      if (!o.group.visible) return;
      const d = this.ray.ray.distanceSqToPoint(o.group.position);
      const along = this.v3.subVectors(o.group.position, this.ray.ray.origin).dot(this.ray.ray.direction);
      const tolHere = tol * Math.max(0.6, along / 8);
      if (d < tolHere * tolHere && along < bestD) {
        bestD = along;
        best = i;
      }
    });
    return best;
  }

  dropPoint(clientX: number, clientY: number, model: Model): Ev | null {
    this.setRay(clientX, clientY);
    let d: Ev | null = null;
    if (this.flat) {
      const p = this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), this.v3);
      if (p) d = fromW(p);
    } else {
      const v = model.v, th = model.angle;
      const n = new THREE.Vector3(v * Math.cos(th), 1, -v * Math.sin(th));
      const len = n.length();
      const plane = new THREE.Plane(n.multiplyScalar(1 / len), -((model.T / model.gamma) * S) / len);
      const p = this.ray.ray.intersectPlane(plane, this.v3);
      if (p) d = fromW(p);
    }
    if (!d || !inRegion(d)) return null;
    return apply(boostMatrix(-model.v, model.angle), d);
  }

  project(d: Ev): { x: number; y: number } {
    const p = toW(d, new THREE.Vector3()).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }

  dragPoint(clientX: number, clientY: number, anchor: Ev): Ev | null {
    this.setRay(clientX, clientY);
    const a = toW(anchor, this.v3b);
    const n = new THREE.Vector3();
    this.camera.getWorldDirection(n);
    if (!this.flat) {
      n.y = 0;
      if (n.lengthSq() < 1e-6) n.set(0, 0, -1);
      n.normalize();
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, a);
    const p = this.ray.ray.intersectPlane(plane, this.v3);
    return p ? fromW(p) : null;
  }

  // ───────────────────────────── per frame ─────────────────────────────

  private updateCamera(dt: number): void {
    if (this.frozen) {
      this.lay = { cx: this.layout.cx, cy: this.layout.cy, size: this.layout.size };
      dt = 0;
    }
    this.time += dt;
    this.idle += dt;
    const k = 1 - Math.exp(-dt * 6);
    this.lay.cx += (this.layout.cx - this.lay.cx) * k;
    this.lay.cy += (this.layout.cy - this.lay.cy) * k;
    this.lay.size += (this.layout.size - this.lay.size) * k;
    if (!this.dragging) {
      this.yaw += this.yawV;
      this.pitch = Math.max(-0.05, Math.min(1.1, this.pitch + this.pitchV));
      const damp = Math.exp(-dt * 4);
      this.yawV *= damp;
      this.pitchV *= damp;
      if (this.idle > 4) {
        // slow breathing orbit, about ±10°
        const target = -0.3 + Math.sin(this.time * 0.22) * 0.17;
        this.yaw += (target - this.yaw) * (1 - Math.exp(-dt * 0.35));
        this.pitch += (0.2 + Math.sin(this.time * 0.17) * 0.03 - this.pitch) * (1 - Math.exp(-dt * 0.35));
      }
    }
    this.zoomF += (this.zoomT - this.zoomF) * (1 - Math.exp(-dt * (this.time < 6 ? 0.8 : 5)));
    const { w, h } = this;
    const size = Math.max(80, this.lay.size);
    const offX = w / 2 - this.lay.cx, offY = h / 2 - this.lay.cy;
    if (this.flat) {
      const half = ((HERO_H * h) / size / 2) * this.zoomT;
      const aspect = w / h;
      this.ortho.left = -half * aspect;
      this.ortho.right = half * aspect;
      this.ortho.top = half;
      this.ortho.bottom = -half;
      this.ortho.position.set(FOCUS.x, FOCUS.y, 10);
      this.ortho.lookAt(FOCUS.x, FOCUS.y, 0);
      this.ortho.setViewOffset(w, h, offX, offY, w, h);
      this.ortho.updateProjectionMatrix();
    } else {
      const cam = this.persp;
      cam.aspect = w / h;
      const tan = Math.tan((cam.fov * Math.PI) / 360);
      const dist = ((HERO_H * h) / (2 * size * tan)) * this.zoomF;
      cam.position.set(FOCUS.x + Math.sin(this.yaw) * Math.cos(this.pitch) * dist, FOCUS.y + Math.sin(this.pitch) * dist, FOCUS.z + Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
      cam.lookAt(FOCUS);
      cam.setViewOffset(w, h, offX, offY, w, h);
      cam.updateProjectionMatrix();
    }
  }

  /** Add a clipped glowing line (observer coords). */
  private line(p: Ev, q: Ev, r: number, color: THREE.Color, halo = 1): void {
    const c = clipSegment(p, q);
    if (!c) return;
    const a = toW(lerpEv(p, q, c[0]), new THREE.Vector3());
    const b = toW(lerpEv(p, q, c[1]), new THREE.Vector3());
    this.core.add(a, b, r, color);
    if (halo > 0) this.halo.add(a, b, r * 3.2, this.col.copy(color).multiplyScalar(halo));
  }

  render(dt: number, model: Model): void {
    this.setFlat(model.show.flat);
    this.updateCamera(dt);
    const m = model.m;
    const v = model.v, g = model.gamma, th = model.angle, T = model.T;
    const nx = Math.cos(th), ny = Math.sin(th);
    const D = (e: Ev) => apply(m, e);

    // the cone never moves; it only shimmers when you boost
    this.coneU.uShimmer.value = Math.min(0.8, model.shimmer * 1.6);
    this.coneU.uSweep.value = -1.2 + ((this.time * 0.8) % 1) * 2.6;
    this.herePin.scale.setScalar(0.08 + Math.sin(this.time * 2.2) * 0.008);
    this.hereLight.intensity = 0.8 + model.shimmer * 0.6;

    // lattice
    const lm = this.latU.uM.value;
    lm.set(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    this.lattice.visible = model.show.grid;
    this.ghost.visible = model.show.ghost;
    this.latU.uOpacity.value = 0.22;
    this.ghostU.uOpacity.value = 0.08 + 0.12 * Math.min(1, Math.abs(v) * 4);

    // Home's "now" sheet (Home time T) in your coordinates: t' = T/γ − v n·r'
    const N = 96;
    const R = R_MAX;
    const c0 = T / g;
    const sp = this.sheetPos.array as Float32Array;
    const ep = this.sheetEdgePos.array as Float32Array;
    sp[0] = 0;
    sp[1] = c0 * S;
    sp[2] = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * R, y = Math.sin(a) * R;
      const t = c0 - v * (nx * x + ny * y);
      sp[3 + i * 3] = ep[i * 3] = x * S;
      sp[4 + i * 3] = ep[i * 3 + 1] = t * S;
      sp[5 + i * 3] = ep[i * 3 + 2] = -y * S;
    }
    this.sheetPos.needsUpdate = true;
    this.sheetEdgePos.needsUpdate = true;
    this.sheet.geometry.computeVertexNormals();
    this.sheet.geometry.computeBoundingSphere();

    this.core.begin();
    this.halo.begin();

    // where the sheet slices the glass cone (a conic section)
    if (Math.abs(c0) > 0.05) {
      const pts: Ev[] = [];
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        const cs = Math.cos(a - th);
        const r = c0 > 0 ? c0 / (1 + v * cs) : -c0 / (1 - v * cs);
        const t = c0 > 0 ? r : -r;
        pts.push({ t, x: Math.cos(a) * r, y: Math.sin(a) * r });
      }
      const cc = this.col.copy(cCyan).multiplyScalar(1.5);
      const colC = cc.clone();
      for (let i = 1; i < pts.length; i++) {
        if (Math.abs(pts[i].t) > H_CONE || Math.abs(pts[i - 1].t) > H_CONE) continue;
        this.line(pts[i - 1], pts[i], 0.005, colC, 0.5);
      }
    }

    // world lines
    const home = this.col.copy(cAmber).multiplyScalar(1.7).clone();
    this.line(D({ t: -L_FAR, x: 0, y: 0 }), D({ t: L_FAR, x: 0, y: 0 }), 0.011, home);
    const rocketCol = cTeal.clone().multiplyScalar(1.7);
    const tw = model.twin;
    const drawTo = Math.min(model.trip, model.draw);
    if (drawTo > 0) {
      const pts: Ev[] = [tw.path[0]];
      if (drawTo > tw.path[1].t) pts.push(tw.path[1]);
      pts.push(model.rocketAt(drawTo));
      for (let i = 1; i < pts.length; i++) this.line(D(pts[i - 1]), D(pts[i]), 0.011, rocketCol);
      // a bright spark at the drawing tip
      if (model.draw < model.trip) this.line(D(model.rocketAt(Math.max(0, drawTo - 0.25))), D(model.rocketAt(drawTo)), 0.02, cTeal.clone().multiplyScalar(3));
    }

    // clock beads: one per unit of each traveller's own (proper) time
    let nb = 0;
    const addBead = (e: Ev, base: THREE.Color, flash: number) => {
      const d = D(e);
      if (!inRegion(d) || nb >= 64) return;
      toW(d, this.v3);
      const r = 0.022 * (1 + flash * 0.35);
      this.m4.makeScale(r, r, r).setPosition(this.v3);
      this.beads.setMatrixAt(nb, this.m4);
      this.m4.makeScale(r * 1.7, r * 1.7, r * 1.7).setPosition(this.v3);
      this.beadGlow.setMatrixAt(nb, this.m4);
      this.beadGlow.setColorAt(nb, this.col.copy(base).multiplyScalar(0.12 + flash * 1.6));
      nb++;
    };
    const flashAt = (tHome: number) => (T >= tHome - 0.05 ? Math.exp(-Math.max(0, T - tHome) * 2.2) : 0);
    for (let k = -30; k <= 30; k++) addBead({ t: k, x: 0, y: 0 }, cAmber, flashAt(k));
    for (let k = 0; k <= Math.floor(tw.rocketTicks + 1e-9); k++) {
      const e = atProperTime(tw.path, k);
      if (e.t > drawTo + 1e-6) break;
      addBead(e, cTeal, flashAt(e.t));
    }
    this.beads.count = this.beadGlow.count = nb;
    this.beads.instanceMatrix.needsUpdate = true;
    this.beadGlow.instanceMatrix.needsUpdate = true;
    if (this.beadGlow.instanceColor) this.beadGlow.instanceColor.needsUpdate = true;

    // clocks where each world line crosses the sheet
    const clk = model.clocks();
    const hp = D({ t: T, x: 0, y: 0 });
    const rpHome = model.rocketAt(T);
    const rp = D(rpHome);
    const showRocket = drawTo >= Math.min(T, model.trip) - 1e-6;
    // labels sit on opposite sides so they never cover each other
    const side = rp.x >= hp.x - 1e-6 ? 1 : -1;
    const near = Math.hypot(hp.x - rp.x, hp.t - rp.t, hp.y - rp.y) < 0.6;
    this.placeClock(this.clocks[0], hp, "Home", clk.home, AMBER, 0, -side);
    this.placeClock(this.clocks[1], rp, "Rocket", clk.rocket, TEAL, near ? -1.9 : 0, near ? -side : side, showRocket);

    // fireworks
    const sel = model.selIndex();
    model.events.forEach((ev, i) => {
      const o = this.events[i];
      if (!o) return;
      const d = D(ev.e);
      o.group.visible = inRegion(d, 0.5);
      toW(d, o.group.position);
      const p = ev.pop;
      const pop = p < 1 ? 1 + Math.sin(p * Math.PI) * 0.6 - (1 - p) * 0.6 : 1;
      const pulse = ev.pulse;
      o.group.scale.setScalar(Math.max(0.05, pop * (1 + pulse * 0.5)));
      const base = this.col.copy(cPearl).lerp(cViolet, Math.min(1, pulse * 1.4));
      o.mat.emissive.copy(base);
      o.mat.emissiveIntensity = 0.5 + pulse * 1.6;
      (o.halo.material as THREE.SpriteMaterial).color.copy(base).multiplyScalar(0.8 + pulse * 2);
      const si = sel.indexOf(i);
      o.ring.visible = si >= 0;
      if (si >= 0) {
        const lbl = this.labels[si];
        lbl.visible = o.group.visible;
        lbl.position.copy(o.group.position);
      }
    });
    for (let i = model.events.length; i < this.events.length; i++) this.events[i].group.visible = false;
    for (let s = sel.length; s < 2; s++) this.labels[s].visible = false;

    // pair connectors (coloured by type, which every observer agrees on)
    const cp = this.connPos.array as Float32Array;
    const cc = this.connCol.array as Float32Array;
    let nl = 0;
    for (const pr of model.pairs()) {
      if (pr.grow <= 0) continue;
      const A = D(model.events[pr.a].e), B = D(model.events[pr.b].e);
      const Bg = lerpEv(A, B, pr.grow);
      const col = typeCol[pr.type];
      if (pr.selected) {
        this.line(A, Bg, 0.008, this.col.copy(col).multiplyScalar(2.4).clone(), 0.75);
        continue;
      }
      const c = clipSegment(A, Bg);
      if (!c || nl >= 64) continue;
      toW(lerpEv(A, Bg, c[0]), this.v3).toArray(cp, nl * 6);
      toW(lerpEv(A, Bg, c[1]), this.v3).toArray(cp, nl * 6 + 3);
      for (let k = 0; k < 2; k++) {
        cc[nl * 6 + k * 3] = col.r * 0.55;
        cc[nl * 6 + k * 3 + 1] = col.g * 0.55;
        cc[nl * 6 + k * 3 + 2] = col.b * 0.55;
      }
      nl++;
    }
    this.conn.geometry.setDrawRange(0, nl * 2);
    this.connPos.needsUpdate = true;
    this.connCol.needsUpdate = true;

    // invariant hyperboloids through the selected events (about here-and-now)
    for (let s = 0; s < 2; s++) {
      const hyp = this.hyper[s];
      const i = sel[s];
      if (!model.show.hyper || i === undefined) {
        hyp.mesh.visible = false;
        continue;
      }
      const e = model.events[i].e;
      const k = e.t * e.t - e.x * e.x - e.y * e.y;
      const sign = e.t >= 0 ? 1 : -1;
      const key = k + sign * 1e-7;
      if (!(Math.abs(key - hyp.k) <= 1e-4)) {
        hyp.k = key;
        hyp.mesh.geometry.dispose();
        hyp.mesh.geometry = this.hyperGeometry(k, sign);
        const mat = hyp.mesh.material as THREE.ShaderMaterial;
        mat.uniforms.uColor.value.copy(k > 0 ? cGold : cViolet).multiplyScalar(0.45);
      }
      hyp.mesh.visible = Math.abs(k) > 0.05;
    }

    // glass rod at rest in the rocket's (outbound) frame, measured along your "now"
    if (model.show.rod) {
      const rod = model.rod();
      const ok = inRegion(rod.a, 2) && inRegion(rod.b, 2);
      this.rod.visible = ok;
      if (ok) {
        const a = toW(rod.a, new THREE.Vector3()), b = toW(rod.b, new THREE.Vector3());
        const d = new THREE.Vector3().subVectors(b, a);
        const len = d.length();
        this.rod.position.addVectors(a, b).multiplyScalar(0.5);
        this.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
        this.rod.scale.set(0.016, Math.max(0.001, len), 0.016);
        this.rodLabel.sprite.visible = true;
        this.rodLabel.sprite.position.copy(this.rod.position).add(new THREE.Vector3(0, 0.03, 0));
        const key = `${rod.length.toFixed(2)}`;
        if (key !== this.rodLabel.key) {
          this.rodLabel.key = key;
          const c = this.rodLabel.ctx;
          drawLabelBox(c, `rod ${rod.length.toFixed(2)} (rest ${ROD_L0.toFixed(1)})`, TEAL);
          this.rodLabel.tex.needsUpdate = true;
        }
      } else this.rodLabel.sprite.visible = false;
      // the rod's two ends are world lines parallel to the rocket's outbound leg
      const u = model.rocketV;
      const gu = 1 / Math.sqrt(1 - u * u);
      for (const off of [0, ROD_L0 / gu]) {
        const p: Ev = { t: -L_FAR, x: -5 + off - u * L_FAR, y: 7 };
        const q: Ev = { t: L_FAR, x: -5 + off + u * L_FAR, y: 7 };
        this.line(D(p), D(q), 0.004, cTeal.clone().multiplyScalar(0.7), 0.3);
      }
    } else {
      this.rod.visible = false;
      this.rodLabel.sprite.visible = false;
    }

    this.core.end();
    this.halo.end();

    // dust
    const dp = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const arr = dp.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const b = this.dustBase;
      arr[i] = b[i] + Math.sin(this.time * 0.1 + i) * 0.05;
      arr[i + 1] = ((b[i + 1] + 1.2 + this.time * 0.012 * (1 + (i % 7) * 0.1)) % 3.4) - 1.2;
      arr[i + 2] = b[i + 2] + Math.cos(this.time * 0.08 + i * 0.3) * 0.05;
    }
    dp.needsUpdate = true;

    this.finish.uniforms.uTime.value = this.time;
    this.composer.render(dt);
  }

  private placeClock(c: ClockSprite, d: Ev, name: string, ticks: number, color: string, drop: number, side: number, show = true): void {
    const vis = show && inRegion(d);
    c.sprite.visible = vis;
    if (!vis) return;
    toW({ t: d.t + drop, x: d.x, y: d.y }, c.sprite.position);
    c.sprite.center.set(side > 0 ? -0.04 : 1.04, 0.5);
    const key = `${name}${ticks.toFixed(1)}`;
    if (key !== c.key) {
      c.key = key;
      drawClock(c.ctx, 112, name, ticks, color);
      c.tex.needsUpdate = true;
    }
  }

  private hyperGeometry(k: number, sign: number): THREE.BufferGeometry {
    const pts: THREE.Vector2[] = [];
    if (k > 0) {
      // two-sheeted: t = ±√(k + r²); keep the sheet holding the event
      for (let i = 0; i <= 48; i++) {
        const r = (i / 48) * R_MAX;
        const t = sign * Math.sqrt(k + r * r);
        if (t > T_TOP || t < T_BOT) break;
        pts.push(new THREE.Vector2(Math.max(0.001, r * S), t * S));
      }
    } else {
      // one-sheeted: r = √(t² − k)
      for (let i = 0; i <= 64; i++) {
        const t = T_BOT + (i / 64) * (T_TOP - T_BOT);
        const r = Math.sqrt(t * t - k);
        if (r > R_MAX) continue;
        pts.push(new THREE.Vector2(r * S, t * S));
      }
    }
    if (pts.length < 2) return new THREE.BufferGeometry();
    return new THREE.LatheGeometry(pts, 96);
  }

  dispose(): void {
    this.renderer.dispose();
    this.composer.dispose();
    this.canvas.remove();
  }
}

function drawLabelBox(ctx: CanvasRenderingContext2D, text: string, color: string): void {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.font = `600 ${Math.round(H * 0.42)}px ui-monospace, Menlo, Consolas, monospace`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(8,12,20,0.75)";
  ctx.beginPath();
  ctx.roundRect((W - tw) / 2 - 10, H * 0.12, tw + 20, H * 0.76, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2 + 1);
}
