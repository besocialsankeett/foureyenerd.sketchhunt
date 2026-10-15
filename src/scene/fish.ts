import * as THREE from 'three';
import type { Boat } from './boat';
import type { Droplets } from './droplets';
import type { SoundName } from './fishing';
import { DESIGN_H, HORIZON_Y, worldY, type View } from './layout';
import type { Part } from './puppet';
import { REFLECT_LAYER, createSpriteMaterial, type SpriteShared } from './sprite';

/** Strips the body is cut into along its length, so it can flex. */
const COLS = 10;
/** How far along the body, from the nose, it turns about. */
const PIVOT = 0.42;
/** How much of the sideways swish shows, seen from a little above. */
const TILT = 0.45;
/** The water is seen at a low angle, so a distance up the page is twice that across the water. */
const FLAT = 0.5;
const GRAVITY = -1150;
const FISH_PER_TAG = 2;

/** The kinds of fish in the pond. Only the koi take the float. */
export type Species = 'koi' | 'goldfish' | 'bluegill';
/** A fish's picture, and what kind of fish it is. */
export type FishPart = Part & { kind: Species };

/**
 * How each kind carries itself: its size against a koi's, how fast it swims, how quickly it
 * turns, how often it picks somewhere new to go, and whether it ever leaps.
 */
const TRAITS: Record<Species, { size: number; pace: number; turn: number; restless: number; leaps: number }> = {
  koi: { size: 1, pace: 1, turn: 1, restless: 1, leaps: 1 },
  // Small and quick, and the keenest to jump; the long tail makes it look longer than it is.
  goldfish: { size: 0.78, pace: 1.4, turn: 1.4, restless: 0.6, leaps: 2 },
  // Slow and lazy, given to stopping and turning round. It never jumps.
  bluegill: { size: 0.75, pace: 0.55, turn: 0.8, restless: 1.3, leaps: 0 },
};

/**
 * The fish out in the open water, and which open spot each lives in (beyond the bow, beyond
 * the stern, near the front): the two goldfish share the nearest, as a pair.
 */
const ROAMERS: [Species, number][] = [
  ['koi', 0],
  ['bluegill', 1],
  ['goldfish', 2],
  ['goldfish', 2],
];

/** Draw order: under the surface, and out of it beyond or in front of the boat. */
const ORDER_UNDER = -0.8;
const ORDER_FAR = -0.6;
const ORDER_NEAR = 1.45;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

const underVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// A fish seen through the water: bent by the same ripples as the water itself, softened,
// and tinted with the colour of the water over it, more so the deeper it swims.
const underFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D map;
  uniform sampler2D uPlate;
  uniform sampler2D uSim;
  uniform vec4 uView; // left, bottom, width, height in world units
  uniform float uHorizon;
  uniform vec2 uSimTexel;
  uniform float uTime;
  uniform float uWaterY;
  uniform float uClip;
  uniform float uDepth;
  varying vec2 vUv;
  varying vec2 vWorld;

  void main() {
    vec2 screen = (vWorld - uView.xy) / uView.zw;
    float v = clamp((vWorld.y - uView.y) / (uHorizon - uView.y), 0.0, 1.0);
    vec2 simUv = vec2(screen.x, v);
    float l = texture2D(uSim, simUv - vec2(uSimTexel.x, 0.0)).r;
    float r = texture2D(uSim, simUv + vec2(uSimTexel.x, 0.0)).r;
    float d = texture2D(uSim, simUv - vec2(0.0, uSimTexel.y)).r;
    float u = texture2D(uSim, simUv + vec2(0.0, uSimTexel.y)).r;
    vec2 bend = clamp(vec2(r - l, u - d) * vec2(0.7, 1.0), -0.09, 0.09);
    bend.x += sin(vWorld.y * 0.45 + uTime * 2.2) * 0.006 * (1.0 + uDepth * 2.0);

    vec4 color = texture2D(map, vUv + bend, 0.4 + uDepth * 2.5); // premultiplied
    vec3 water = texture2D(uPlate, vec2(screen.x, uHorizon / ${DESIGN_H.toFixed(1)} * v)).rgb;
    color.rgb = mix(color.rgb, water * color.a, mix(0.14, 0.85, uDepth));

    // While it leaps, only the part still under the surface is drawn this way.
    float surface = uWaterY + sin(vWorld.x * 0.05 + uTime * 1.3) * 1.1 + sin(vWorld.x * 0.13 - uTime * 0.9) * 0.6;
    float below = mix(1.0, 1.0 - smoothstep(surface - 1.5, surface + 1.5, vWorld.y), uClip);
    gl_FragColor = color * below * mix(0.96, 0.1, uDepth);
  }
`;

type WaterUniforms = {
  uPlate: { value: THREE.Texture };
  uSim: { value: THREE.Texture };
  uView: { value: THREE.Vector4 };
  uHorizon: { value: number };
  uSimTexel: { value: THREE.Vector2 };
};

/**
 * A fish's picture as a strip that flexes: one unit long, nose at the left, lying along x.
 * `tilt` is how much of the sideways swish shows: some from a little above, none from the side.
 */
export class FlexStrip {
  readonly geometry = new THREE.BufferGeometry();
  private positions: THREE.BufferAttribute;
  private half: number;

  constructor(part: { w: number; h: number }, private tilt = TILT) {
    this.half = (0.5 * part.h) / part.w;
    const count = (COLS + 1) * 2;
    this.positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(count * 2);
    const index: number[] = [];
    for (let i = 0; i <= COLS; i++) {
      uv.set([i / COLS, 1, i / COLS, 0], i * 4);
      const a = i * 2;
      if (i < COLS) index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setIndex(index);
    this.flex(0, 0);
  }

  /**
   * Bend the body into a wave travelling from nose to tail. A fish swishes sideways, which
   * from the side shows mostly as the tail shortening and lengthening.
   */
  flex(phase: number, amount: number) {
    const array = this.positions.array as Float32Array;
    const side = (s: number) => amount * (0.1 + 0.9 * s * s) * Math.sin(phase - s * 5.2);
    let x = -PIVOT;
    for (let i = 0; i <= COLS; i++) {
      const s = i / COLS;
      const lift = side(s) * this.tilt;
      array.set([x, this.half + lift, 0, x, -this.half + lift, 0], i * 6);
      const slope = (side(s + 1 / COLS) - side(s)) * COLS;
      x += Math.sqrt(Math.max(0.25, 1 - slope * slope)) / COLS;
    }
    this.positions.needsUpdate = true;
  }
}

/**
 * One fish's picture, as a strip that flexes. It is drawn two ways with the same shape:
 * murky for the part under the surface, and crisp, with a reflection, for the part out of it.
 */
class Body {
  readonly group = new THREE.Group();
  readonly under: THREE.ShaderMaterial;
  readonly above: THREE.ShaderMaterial;
  readonly air: THREE.Mesh;
  private strip: FlexStrip;

  constructor(part: Part, shared: SpriteShared, water: WaterUniforms) {
    this.strip = new FlexStrip(part);
    const { geometry } = this.strip;

    this.under = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: part.texture },
        ...water,
        uTime: shared.uTime,
        uWaterY: { value: 0 },
        uClip: { value: 0 },
        uDepth: { value: 0.3 },
      },
      vertexShader: underVertexShader,
      fragmentShader: underFragmentShader,
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.above = createSpriteMaterial(part.texture, shared, { waterY: 0 });

    const swimming = new THREE.Mesh(geometry, this.under);
    swimming.renderOrder = ORDER_UNDER;
    this.air = new THREE.Mesh(geometry, this.above);
    this.air.layers.enable(REFLECT_LAYER);
    this.air.visible = false;
    swimming.frustumCulled = this.air.frustumCulled = false;
    this.group.add(swimming, this.air);
  }

  flex(phase: number, amount: number) {
    this.strip.flex(phase, amount);
  }
}

type Mode = 'swim' | 'gather' | 'leap' | 'tug';

type Koi = {
  body: Body;
  kind: Species;
  /** The project tag it lives under, or null for one that roams the open water. */
  tag: number | null;
  active: boolean;
  placed: boolean;
  length: number;
  pace: number;
  seed: number;
  /** Which side of the float it comes to: -1 left, 1 right. */
  side: number;
  // Where it lives and where it is, measured across the water: x, and q = y / FLAT.
  homeX: number;
  homeQ: number;
  reachX: number;
  reachQ: number;
  x: number;
  q: number;
  vx: number;
  vq: number;
  goalX: number;
  goalQ: number;
  nextGoal: number;
  /** 1 facing left, as drawn; -1 facing right. `flip` follows it, turning through edge-on. */
  facing: number;
  flip: number;
  angle: number;
  beat: number;
  flexing: number;
  /** 0 at the surface, 1 too deep to see. */
  depth: number;
  depthGoal: number;
  nextDepth: number;
  rising: boolean;
  ringDue: boolean;
  spookedUntil: number;
  mode: Mode;
  clock: number;
  // The leap: direction, the surface it leaves, height and speed on the page, and progress.
  dir: number;
  line: number;
  y: number;
  vy: number;
  size: number;
  stand: number;
  out: boolean;
  back: boolean;
};

export type SchoolHooks = {
  ripple: (x: number, y: number, radius: number, strength: number) => void;
  sound: (name: SoundName, amount?: number) => void;
};

/**
 * The fish he is actually after. A couple circle under each project's tag and a few roam
 * the open water; they shy from the pointer, come to look at the float, and leap.
 */
export class School {
  readonly group = new THREE.Group();
  private fish: Koi[] = [];
  private uniforms: WaterUniforms;
  private view: View | null = null;
  private horizon = worldY(HORIZON_Y);
  private time = 0;
  private nextLeap = 2.5;
  /** The float they have come to look at, and how hard it is being tugged down. */
  private bait: { tag: number; x: number; y: number; dip: number } | null = null;
  private biter: Koi | null = null;
  private escape: { fish: Koi; at: number } | null = null;
  private watchAt = new THREE.Vector2();
  private watchUntil = -1;

  /** `calm` is for visitors who ask for less motion: the fish only drift about. */
  constructor(
    parts: FishPart[],
    shared: SpriteShared,
    water: { plate: THREE.Texture; sim: THREE.Texture; simSize: THREE.Vector2 },
    private boat: Boat,
    private droplets: Droplets,
    private hooks: SchoolHooks,
    tags: number,
    private calm: boolean,
  ) {
    this.uniforms = {
      uPlate: { value: water.plate },
      uSim: { value: water.sim },
      uView: { value: new THREE.Vector4(0, 0, 1, 1) },
      uHorizon: { value: this.horizon },
      uSimTexel: { value: new THREE.Vector2(1 / water.simSize.x, 1 / water.simSize.y) },
    };
    const koi = parts.filter((part) => part.kind === 'koi');
    const total = tags * FISH_PER_TAG + ROAMERS.length;
    for (let n = 0; n < total; n++) {
      const tag = n < tags * FISH_PER_TAG ? Math.floor(n / FISH_PER_TAG) : null;
      // Koi under the tags; in the open water, the roamers in their order.
      const kind = tag === null ? ROAMERS[n - tags * FISH_PER_TAG][0] : 'koi';
      const part = kind === 'koi' ? koi[n % koi.length] : (parts.find((p) => p.kind === kind) ?? koi[0]);
      const traits = TRAITS[part.kind];
      const body = new Body(part, shared, this.uniforms);
      this.group.add(body.group);
      this.fish.push({
        body,
        kind: part.kind,
        tag,
        active: true,
        placed: false,
        length: (tag === null ? 104 + Math.random() * 10 : 92 + Math.random() * 14) * traits.size,
        pace: (34 + Math.random() * 16) * traits.pace,
        seed: n * 2.4,
        side: n % 2 ? 1 : -1,
        homeX: 0, homeQ: 0, reachX: 80, reachQ: 50,
        x: 0, q: 0, vx: 0, vq: 0,
        goalX: 0, goalQ: 0, nextGoal: 0,
        facing: n % 2 ? 1 : -1,
        flip: n % 2 ? 1 : -1,
        angle: 0,
        beat: n,
        flexing: 0.06,
        depth: 0.3,
        depthGoal: 0.08 + Math.random() * 0.3,
        nextDepth: 2 + Math.random() * 7,
        rising: false,
        ringDue: false,
        spookedUntil: 0,
        mode: 'swim',
        clock: 0,
        dir: 1, line: 0, y: 0, vy: 0, size: 1, stand: 0, out: false, back: false,
      });
    }
  }

  /** Things look smaller the farther up the water they are. */
  private sizeAt(y: number) {
    return 1 - 0.42 * clamp(y / this.horizon, 0, 1);
  }

  /** Whether a fish could come out of the water at this point: on the page, clear of the hull. */
  private open(x: number, line: number) {
    const view = this.view!;
    const [bow, stern] = this.boat.hullEnds;
    if (x < view.left + 30 || x > view.right - 30) return false;
    // Beyond the boat, the bow and stern overhang the water well past where the hull meets it.
    return !(line > this.boat.waterY - 6 && x > bow - 170 && x < stern + 60);
  }

  /** Fit the fish to the visible water: under each tag, and in the open stretches. */
  setView(view: View, spots: { x: number; y: number }[]) {
    this.view = view;
    this.uniforms.uView.value.set(view.left, view.bottom, view.width, view.height);
    const narrow = view.width / view.height < 1.1;
    const [bow, stern] = this.boat.hullEnds;
    const below = this.boat.waterY - view.bottom;
    // Beyond the bow and beyond the stern when there is water there; otherwise below the boat.
    const open = [
      bow - view.left > 240
        ? [view.left + (bow - view.left) * 0.5, worldY(590)]
        : [view.left + view.width * 0.26, view.bottom + below * 0.14],
      view.right - stern > 240
        ? [(stern + view.right) / 2, worldY(590)]
        : [view.left + view.width * 0.72, view.bottom + below * 0.3],
      [clamp(1300, view.left + view.width * 0.5, view.right - view.width * 0.16), worldY(880)],
    ];
    let roamer = 0;
    this.fish.forEach((f, n) => {
      let x: number, y: number;
      if (f.tag !== null) {
        const spot = spots[f.tag];
        const size = this.sizeAt(spot.y);
        x = spot.x;
        y = spot.y - 24 * size;
        f.reachX = 115 * size;
        f.reachQ = 60 * size;
        f.active = !narrow || n % FISH_PER_TAG === 0;
      } else {
        [x, y] = open[ROAMERS[roamer++][1]];
        const size = this.sizeAt(y);
        f.reachX = 110 * size;
        f.reachQ = 70 * size;
      }
      f.homeX = x;
      f.homeQ = y / FLAT;
      f.body.group.visible = f.active;
      if (!f.placed || Math.hypot(f.x - f.homeX, f.q - f.homeQ) > 500) {
        f.placed = true;
        f.x = f.homeX + (Math.random() - 0.5) * 2 * f.reachX;
        f.q = f.homeQ + (Math.random() - 0.5) * 2 * f.reachQ;
        f.vx = f.vq = 0;
        this.settle(f);
        this.wander(f, this.time);
      }
    });
  }

  setSim(texture: THREE.Texture) {
    this.uniforms.uSim.value = texture;
  }

  /** Pick somewhere new to drift to, near home. */
  private wander(f: Koi, time: number) {
    if (f.kind === 'bluegill' && Math.random() < 0.4) {
      // It stops where it is for a while, and turns round to look the other way.
      f.goalX = f.x;
      f.goalQ = f.q;
      f.facing = -f.facing;
      f.nextGoal = time + 2 + Math.random() * 2.5;
      return;
    }
    const angle = Math.random() * Math.PI * 2;
    const reach = Math.sqrt(Math.random());
    f.goalX = f.homeX + Math.cos(angle) * reach * f.reachX;
    f.goalQ = f.homeQ + Math.sin(angle) * reach * f.reachQ;
    f.nextGoal = time + (1.6 + Math.random() * 2.6) * TRAITS[f.kind].restless;
  }

  /** Back to plain swimming, wholly under the surface. */
  private settle(f: Koi) {
    f.mode = 'swim';
    f.body.air.visible = false;
    f.body.under.uniforms.uClip.value = 0;
    f.out = f.back = false;
  }

  /** Something hit the water: every fish near it bolts. */
  scare(x: number, y: number, radius: number, power = 1) {
    if (this.calm) return;
    for (const f of this.fish) {
      if (!f.active || f.mode !== 'swim') continue;
      const dx = f.x - x, dq = f.q - y / FLAT;
      const distance = Math.hypot(dx, dq) || 1;
      if (distance > radius) continue;
      const kick = (1 - distance / radius) * 330 * power * this.sizeAt(f.q * FLAT);
      f.vx += (dx / distance) * kick;
      f.vq += (dq / distance) * kick;
      f.spookedUntil = this.time + 0.6;
      f.nextGoal = this.time + 0.7;
    }
  }

  /** The float has landed by a tag: its fish scatter, then come back to look. */
  lure(tag: number, x: number, y: number) {
    if (this.calm) return;
    this.scare(x, y, 180, 0.9);
    this.bait = { tag, x, y, dip: 0 };
    this.biter = null;
  }

  /** Keep the fish on the float as it drifts, and tell them how hard it is being pulled under. */
  follow(x: number, y: number, dip: number) {
    if (!this.bait) return;
    this.bait.x = x;
    this.bait.y = y;
    this.bait.dip = dip;
  }

  /** One of them takes the float in its mouth and tugs. */
  bite() {
    const bait = this.bait;
    if (!bait) return;
    let best: Koi | null = null;
    for (const f of this.fish) {
      if (!f.active || f.tag !== bait.tag || f.mode !== 'swim') continue;
      if (!best || Math.abs(f.x - bait.x) < Math.abs(best.x - bait.x)) best = f;
    }
    if (!best) return;
    best.mode = 'tug';
    best.facing = bait.x < best.x ? 1 : -1;
    this.biter = best;
  }

  /** The line is hauled in: they all bolt, and the one that had it jumps clear. */
  flee() {
    const bait = this.bait;
    this.bait = null;
    if (this.biter) {
      this.settle(this.biter);
      this.escape = { fish: this.biter, at: this.time + 0.5 };
      this.biter = null;
    }
    if (bait) this.scare(bait.x, bait.y, 220, 1.1);
  }

  /** The line has gone: lose interest. */
  release() {
    this.bait = null;
    if (this.biter) this.settle(this.biter);
    this.biter = null;
  }

  /** Where to look, if a fish is out of the water or has only just gone back in. */
  watch(out: THREE.Vector2) {
    if (this.time > this.watchUntil) return false;
    out.copy(this.watchAt);
    return true;
  }

  /** Start a leap, heading `dir` (-1 left, 1 right) if it can, else the other way. */
  private leap(f: Koi, dir: number) {
    const y = f.q * FLAT;
    const size = this.sizeAt(y);
    const line = y + 11 * size;
    const lands = (d: number) => this.open(f.x + d * 20 * size, line) && this.open(f.x + d * 125 * size, line);
    if (!lands(dir)) dir = -dir;
    if (!lands(dir)) return false;
    f.mode = 'gather';
    f.clock = 0;
    f.dir = dir;
    return true;
  }

  private splash(f: Koi, power: number) {
    const loud = 0.25 + 0.35 * f.size;
    this.hooks.ripple(f.x, f.line, 0.05, -0.6 * power);
    this.droplets.burst(f.x, f.line, Math.round(8 * power), 260 * f.size * power, 12 * f.size);
    this.hooks.sound('plop', loud * power);
  }

  /** `pointer` is where the cursor is, in world units, only while it is moving. */
  update(dt: number, time: number, pointer: { x: number; y: number } | null) {
    if (!this.view) return;
    this.time = time;

    if (this.escape && time >= this.escape.at) {
      const { fish } = this.escape;
      this.escape = null;
      if (fish.mode === 'swim') this.leap(fish, fish.x < this.boat.group.position.x ? -1 : 1);
    }
    if (!this.calm && time > this.nextLeap) {
      // Mostly the ones in open water; now and then one from under a tag.
      const able = this.fish.filter(
        (f) =>
          f.active &&
          f.mode === 'swim' &&
          TRAITS[f.kind].leaps > 0 &&
          time > f.spookedUntil &&
          (f.tag === null || f.tag !== this.bait?.tag),
      );
      // The goldfish are the keenest: each counts as many times as it is keen.
      const loose = able.filter((f) => f.tag === null).flatMap((f) => Array<Koi>(TRAITS[f.kind].leaps).fill(f));
      const pick = loose.length && Math.random() < 0.7 ? loose : able;
      const f = pick[Math.floor(Math.random() * pick.length)];
      this.nextLeap = f && this.leap(f, f.facing === 1 ? -1 : 1) ? time + 6 + Math.random() * 7 : time + 1;
    }

    for (const f of this.fish) {
      if (!f.active) continue;
      if (f.mode === 'leap') this.fly(f, dt);
      else if (f.mode === 'tug' && this.bait) this.tug(f, dt);
      else {
        if (f.mode === 'tug') this.settle(f);
        this.swim(f, dt, time, pointer);
      }

      const size = f.mode === 'leap' ? f.size : this.sizeAt(f.q * FLAT);
      const length = f.length * size;
      f.flip += (f.facing - f.flip) * Math.min(1, dt * 9);
      f.stand += ((f.mode === 'leap' ? 1 : 0) - f.stand) * Math.min(1, dt * 10);
      f.body.flex(f.beat, f.flexing);
      f.body.group.position.set(f.x, f.mode === 'leap' ? f.y : f.q * FLAT, 0);
      f.body.group.rotation.z = f.angle;
      f.body.group.scale.set(length * f.flip, length * (0.82 + 0.18 * f.stand), 1);
      f.body.under.uniforms.uDepth.value = f.depth;
    }
  }

  private swim(f: Koi, dt: number, time: number, pointer: { x: number; y: number } | null) {
    const y = f.q * FLAT;
    const size = this.sizeAt(y);
    const view = this.view!;
    const spooked = time < f.spookedUntil;
    const gathering = f.mode === 'gather';
    const bait = this.bait && f.tag === this.bait.tag && !spooked && !gathering ? this.bait : null;

    if (time > f.nextGoal) this.wander(f, time);
    let goalX = f.goalX, goalQ = f.goalQ;
    let pace = f.pace * size * (this.calm ? 0.7 : 1);
    if (bait) {
      // Hang about the float, drifting in for a closer look and back out again.
      // Once one of them has it, the others watch from the far side.
      const side = this.biter ? -this.biter.facing : f.side;
      goalX = bait.x + side * ((this.biter ? 62 : 24) + 12 * Math.sin(time * 1.7 + f.seed)) * size;
      goalQ = (bait.y - 9 * size) / FLAT + Math.sin(f.seed) * 14 * size;
      pace *= 1.5;
    }
    const dx = goalX - f.x, dq = goalQ - f.q;
    const far = Math.hypot(dx, dq) || 1;
    const ease = Math.min(1, far / (45 * size));
    let wantX = (dx / far) * pace * ease, wantQ = (dq / far) * pace * ease;
    if (!bait && far < 14 * size) f.nextGoal = Math.min(f.nextGoal, time + 0.4);

    if (gathering) {
      // A run along the surface before the jump.
      f.clock += dt;
      f.facing = -f.dir;
      wantX = f.dir * 130 * size;
      wantQ = 0;
    } else if (pointer && !this.calm) {
      const px = f.x - pointer.x, pq = f.q - pointer.y / FLAT;
      const near = Math.hypot(px, pq) || 1;
      const reach = 125 * size;
      if (near < reach) {
        const push = (1 - near / reach) * 2600 * size * dt;
        f.vx += (px / near) * push;
        f.vq += (pq / near) * push;
        if (!spooked) this.hooks.ripple(f.x, y + 6 * size, 0.03, -0.25);
        f.spookedUntil = time + 0.5;
      }
    }

    // They keep out of each other's way.
    for (const other of this.fish) {
      if (other === f || !other.active || other.mode === 'leap') continue;
      const ox = f.x - other.x, oq = f.q - other.q;
      const apart = Math.hypot(ox, oq) || 1;
      const room = 0.75 * f.length * size;
      if (apart < room) {
        wantX += (ox / apart) * (1 - apart / room) * pace * 1.6;
        wantQ += (oq / apart) * (1 - apart / room) * pace * 1.6;
      }
    }

    const turn = Math.min(1, (gathering ? 9 : (spooked ? 1.4 : 2.4) * TRAITS[f.kind].turn) * dt);
    f.vx += (wantX - f.vx) * turn;
    f.vq += (wantQ - f.vq) * turn;
    const speed = Math.hypot(f.vx, f.vq);
    const limit = 320 * size;
    if (speed > limit) {
      f.vx *= limit / speed;
      f.vq *= limit / speed;
    }
    f.x = clamp(f.x + f.vx * dt, view.left - 60, view.right + 60);
    f.q = clamp(f.q + f.vq * dt, (view.bottom - 30) / FLAT, (this.horizon - 55) / FLAT);

    // A lazy bluegill drifting to a stop keeps facing whichever way it last turned.
    const idle = f.kind === 'bluegill' && Math.abs(f.vx) < 14 * size;
    if (bait && far < 30 * size && speed < 30 * size) f.facing = bait.x < f.x ? 1 : -1;
    else if (!gathering && !idle && Math.abs(f.vx) > 7 * size) f.facing = f.vx < 0 ? 1 : -1;
    const tilt = clamp(Math.atan2(f.vq * FLAT, Math.max(Math.abs(f.vx), 25 * size)), -0.5, 0.5);
    f.angle += (-f.facing * tilt - f.angle) * Math.min(1, dt * 7);

    // The tail beats faster and wider the faster it goes.
    const pacing = speed / size;
    f.beat += dt * (5 + pacing * 0.09);
    f.flexing += (0.05 + Math.min(0.1, pacing * 0.0006) - f.flexing) * Math.min(1, dt * 6);

    // It drifts deeper and shallower, and every so often comes up to touch the surface.
    if (time > f.nextDepth) {
      f.rising = !f.rising;
      f.ringDue = f.rising;
      f.depthGoal = f.rising ? 0.02 : 0.08 + Math.random() * 0.34;
      f.nextDepth = time + (f.rising ? 1.3 : 4 + Math.random() * 6);
    }
    const depthGoal = gathering ? 0.02 : bait ? 0.08 : f.depthGoal;
    const sink = dt * (gathering ? 3 : 0.9);
    f.depth += clamp(depthGoal - f.depth, -sink, sink);
    if (f.ringDue && f.depth < 0.06) {
      f.ringDue = false;
      this.hooks.ripple(f.x - f.facing * f.length * size * 0.4, y + 8 * size, 0.026, 0.2);
    }

    if (gathering && f.clock > 0.3) {
      f.mode = 'leap';
      f.clock = 0;
      f.size = size;
      f.line = y + 11 * size;
      f.y = y;
      f.vx = f.dir * (95 + Math.random() * 55) * size;
      f.vy = (400 + Math.random() * 100) * size;
      f.out = f.back = false;
      f.body.air.visible = true;
      f.body.air.renderOrder = f.line > this.boat.waterY - 2 ? ORDER_FAR : ORDER_NEAR;
      f.body.under.uniforms.uClip.value = 1;
      f.body.under.uniforms.uWaterY.value = f.line;
      f.body.above.uniforms.uWaterY.value = f.line;
    }
  }

  /** Out of the water, over, and back in. */
  private fly(f: Koi, dt: number) {
    if (f.y > f.line - 5 * f.size) f.vy += GRAVITY * f.size * dt;
    if (f.back) {
      // The water takes the speed out of it, and it sinks from sight for a moment.
      f.clock += dt;
      f.vy *= Math.exp(-dt * 11);
      f.vx *= Math.exp(-dt * 3);
      f.depth = Math.min(0.5, f.depth + dt * 1.4);
    }
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (!f.out && !f.back && f.y > f.line) {
      f.out = true;
      this.splash(f, 0.8);
    } else if (f.out && f.vy < 0 && f.y < f.line) {
      f.out = false;
      f.back = true;
      f.clock = 0;
      this.splash(f, 1.2);
    }
    if (f.out) {
      this.watchAt.set(f.x, f.y);
      this.watchUntil = this.time + 0.7;
    }
    f.facing = -f.dir;
    f.flip = f.facing;
    f.angle = f.dir < 0 ? Math.atan2(-f.vy, -f.vx) : Math.atan2(f.vy, f.vx);
    f.beat += dt * 26;
    f.flexing += (0.13 - f.flexing) * Math.min(1, dt * 10);

    if (f.back && f.clock > 0.38) {
      f.q = f.y / FLAT;
      f.vq = (f.vy / FLAT) * 0.3;
      this.settle(f);
      f.nextGoal = this.time;
    }
  }

  /** Holding the float in its mouth, pulling it down in jerks. */
  private tug(f: Koi, dt: number) {
    const bait = this.bait!;
    const size = this.sizeAt(bait.y);
    const length = f.length * size;
    const y = f.q * FLAT;
    // Nose up at the float from one side, so the body hangs below and behind it.
    const toX = bait.x + f.facing * 0.36 * length;
    const toY = bait.y - 0.24 * length - bait.dip * 0.55;
    const pull = Math.min(1, dt * 12);
    f.x += (toX - f.x) * pull;
    f.q = (y + (toY - y) * pull) / FLAT;
    f.vx = f.vq = 0;
    f.angle += (-f.facing * 0.55 - f.angle) * Math.min(1, dt * 10);
    f.depth += clamp(0.04 - f.depth, -dt * 3, dt * 3);
    f.beat += dt * (14 + bait.dip * 0.6);
    f.flexing += (0.09 + Math.min(0.06, bait.dip * 0.004) - f.flexing) * Math.min(1, dt * 8);
  }
}
