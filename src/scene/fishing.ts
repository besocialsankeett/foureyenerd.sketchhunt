import * as THREE from 'three';
import type { Boat } from './boat';
import type { Catch, CatchKind } from './catch';
import type { Droplets } from './droplets';
import { BENCH, POSES, RIM_Y } from './layout';
import type { Puppet } from './puppet';
import { Ribbon } from './rod';
import { REFLECT_LAYER, createSpriteMaterial, type SpriteShared } from './sprite';

export type Phase =
  | 'idle'
  | 'windup'
  | 'whip'
  | 'flight'
  | 'waiting'
  | 'bite'
  | 'hooked'
  | 'pulling'
  | 'landing'
  | 'recover'
  | 'tossing'
  | 'reeling';

const SEGMENTS = 24;
const GRAVITY = -1400;
/** Line let out when nothing is cast: the float dangles this far below the rod tip. */
const REST_LENGTH = 105;
const WINDUP_TIME = 0.4;
const RELEASE_TIME = 0.14; // into the whip, the moment the line lets go
const FLIGHT_TIME = 0.78;
const BITE_TIME = 0.95;
const STRAIN_TIME = 0.4;
/** The float is much heavier than the line, so the line follows it and not the reverse. */
const FLOAT_SHARE = 0.2;

/** One hump from 0 up to 1 and back, over t in 0..1; zero outside. */
const bump = (t: number) => (t > 0 && t < 1 ? Math.sin(Math.PI * t) : 0);

function solidTexture(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  return texture;
}

/** A classic bobber: red over white, with a short stem. */
function floatTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 56;
  canvas.height = 88;
  const ctx = canvas.getContext('2d')!;
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#4a1512';
  ctx.beginPath();
  ctx.moveTo(28, 6);
  ctx.lineTo(28, 32);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(28, 54, 22, 0, Math.PI * 2);
  ctx.fillStyle = '#f7f1e6';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#d8402f';
  ctx.fillRect(0, 0, 56, 54);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(20, 44, 6, 9, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(28, 54, 22, 0, Math.PI * 2);
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  return texture;
}

type Cast = { x: number; y: number; kind: CatchKind };

/** The sounds the scene can ask for. `amount` scales how big each one is, around 1. */
export type SoundName = 'cast' | 'plop' | 'splash' | 'bite' | 'creak' | 'thud' | 'paper' | 'pop' | 'drip';

export type FishingHooks = {
  ripple: (x: number, y: number, radius: number, strength: number) => void;
  sound: (name: SoundName, amount?: number) => void;
  /** The catch has been set down in the boat. */
  onLand: () => void;
};

/**
 * The line, the float and everything that happens on them: casting, the bite, hauling the
 * catch up and setting it in the boat. The line is a simulated string pinned to the rod
 * tip, with a weight on its end. This also directs the puppet, telling it which pose to
 * chase and which face to wear at each moment.
 */
export class Fishing {
  readonly line: Ribbon;
  readonly float: THREE.Mesh;
  /** The tug of the line on the rod tip, as an acceleration, for the rod to bend under. */
  readonly pull = new THREE.Vector2();
  phase: Phase = 'idle';

  /** How far whatever has bitten is dragging the float under, right now. */
  get tug() {
    return this.dip;
  }

  private lineMaterial: THREE.ShaderMaterial;
  private floatMaterial: THREE.ShaderMaterial;
  private now: Float32Array; // x, y per point, from the rod tip (0) to the end of the line (last)
  private before: Float32Array;
  private length = REST_LENGTH;
  private clock = 0;
  private primed = false;

  private restWaterY: number;
  private target = new THREE.Vector2();
  private kind: CatchKind = 'box';
  private queued: Cast | null = null;
  private launch = new THREE.Vector2();
  private nextBob = 0;
  private biteAt = 0;
  private dip = 0;
  private endShare = FLOAT_SHARE;
  private broke = false;
  private cleared = false;
  private straining = false;
  private cheerUntil = 0;
  private tip = new THREE.Vector3();
  private bench = new THREE.Vector3();
  private benchLocal: THREE.Vector2;
  private rimLocalY: number;

  constructor(
    shared: SpriteShared,
    boat: Boat,
    private caught: Catch,
    private droplets: Droplets,
    private hooks: FishingHooks,
  ) {
    this.restWaterY = boat.waterY;
    this.benchLocal = boat.toLocal(BENCH[0], BENCH[1]);
    this.rimLocalY = boat.toLocal(BENCH[0], RIM_Y).y;

    this.lineMaterial = createSpriteMaterial(solidTexture('rgba(58, 38, 30, 0.85)'), shared, { waterY: boat.waterY });
    this.lineMaterial.uniforms.uClip.value = 0;
    this.line = new Ribbon(SEGMENTS, this.lineMaterial, 1.3, 1.3);

    this.floatMaterial = createSpriteMaterial(floatTexture(), shared, { waterY: boat.waterY });
    this.floatMaterial.uniforms.uClip.value = 0;
    // 14 x 22 units, with the middle of the ball at the origin.
    const geometry = new THREE.PlaneGeometry(14, 22);
    geometry.translate(0, 2.5, 0);
    this.float = new THREE.Mesh(geometry, this.floatMaterial);
    this.float.frustumCulled = false;
    this.float.layers.enable(REFLECT_LAYER);

    this.now = new Float32Array((SEGMENTS + 1) * 2);
    this.before = new Float32Array((SEGMENTS + 1) * 2);
  }

  /** Cast to a point on the water. If the line is already out, it is reeled in first. */
  cast(x: number, y: number, kind: CatchKind) {
    if (this.phase === 'idle') {
      this.begin({ x, y, kind });
    } else if (this.phase === 'waiting') {
      this.queued = { x, y, kind };
      this.enter('reeling');
    } else if (this.phase === 'tossing') {
      this.queued = { x, y, kind };
    }
  }

  reelIn() {
    if (this.phase === 'waiting') this.enter('reeling');
  }

  /** The visitor pulls: haul up whatever has bitten. */
  haul() {
    if (this.phase !== 'hooked' && this.phase !== 'bite') return;
    const last = SEGMENTS * 2;
    this.caught.hook(this.kind, this.target.y);
    this.endShare = 0.035 / this.caught.weight;
    this.broke = this.cleared = false;
    this.hooks.ripple(this.now[last], this.target.y, 0.08, 0.5);
    this.hooks.sound('creak');
    this.enter('pulling');
  }

  /**
   * Put a catch straight onto the bench, with no fishing: for arriving on a project's own
   * address, or stepping from one case study to the next. Only when nothing is happening.
   */
  place(kind: CatchKind, boat: Boat, time: number) {
    if (this.phase !== 'idle') return false;
    this.caught.hook(kind, this.restWaterY);
    this.caught.bringInside(boat);
    this.caught.land(this.benchLocal, 0, time - 5);
    this.caught.dry();
    return true;
  }

  /** Throw the catch in the boat back to a point on the water. */
  tossBack(x: number, y: number) {
    if (this.phase !== 'idle' || this.caught.mode !== 'boat') return;
    this.caught.toss(x, y);
    this.hooks.sound('cast', 0.8);
    this.enter('tossing');
  }

  private begin(cast: Cast) {
    this.target.set(cast.x, cast.y);
    this.kind = cast.kind;
    this.enter('windup');
  }

  private enter(phase: Phase) {
    this.phase = phase;
    this.clock = 0;
  }

  private setWaterLevel(y: number, clipFloat: boolean) {
    this.lineMaterial.uniforms.uWaterY.value = y;
    this.floatMaterial.uniforms.uWaterY.value = y;
    this.floatMaterial.uniforms.uClip.value = clipFloat ? 1 : 0;
  }

  update(dt: number, time: number, puppet: Puppet, boat: Boat) {
    this.clock += dt;
    boat.group.updateMatrixWorld();
    this.tip.set(puppet.rod.tip.x, puppet.rod.tip.y, 0).applyMatrix4(boat.group.matrixWorld);
    this.bench.set(this.benchLocal.x, this.benchLocal.y, 0).applyMatrix4(boat.group.matrixWorld);
    const rimY = boat.group.position.y + this.rimLocalY;
    const last = SEGMENTS * 2;
    const level = this.target.y;

    if (!this.primed) {
      for (let i = 0; i <= SEGMENTS; i++) {
        this.now[i * 2] = this.before[i * 2] = this.tip.x;
        this.now[i * 2 + 1] = this.before[i * 2 + 1] = this.tip.y - (this.length * i) / SEGMENTS;
      }
      this.primed = true;
    }

    // The state of the fishing, and the pose and face it asks of him.
    let inWater = false;
    let steerTo: number | null = null;
    let lengthGoal = REST_LENGTH;
    let lengthRate = 600;
    this.dip = 0;
    switch (this.phase) {
      case 'idle':
        puppet.pose = POSES.rest;
        puppet.setExpression(time < this.cheerUntil ? 'delighted' : 'happy');
        this.setWaterLevel(this.restWaterY, false);
        break;
      case 'windup':
        puppet.pose = POSES.windup;
        puppet.setExpression('happy');
        if (this.clock > WINDUP_TIME) this.enter('whip');
        break;
      case 'whip':
        puppet.pose = POSES.whip;
        if (this.clock > RELEASE_TIME) {
          this.launch.set(this.now[last], this.now[last + 1]);
          this.setWaterLevel(level, false);
          this.hooks.sound('cast');
          this.enter('flight');
        }
        break;
      case 'flight': {
        puppet.pose = this.clock < 0.2 ? POSES.whip : POSES.wait;
        const t = Math.min(this.clock / FLIGHT_TIME, 1);
        const u = 1 - Math.pow(1 - t, 1.5);
        const rise = 110 + this.launch.distanceTo(this.target) * 0.12;
        const x = this.launch.x + (this.target.x - this.launch.x) * u;
        const y = this.launch.y + (level - this.launch.y) * u + rise * 4 * u * (1 - u) * (1 - u * 0.5);
        // The float flies a set arc; the line is free and trails behind it.
        this.before[last] = this.now[last] = x;
        this.before[last + 1] = this.now[last + 1] = y;
        this.length = Math.max(this.length, Math.hypot(x - this.tip.x, y - this.tip.y) * 1.1);
        lengthGoal = this.length;
        if (t >= 1) {
          this.before[last + 1] = y + 3.5; // carry some of the fall into the water
          // The line was flung out after the float; most of that speed is spent now.
          for (let i = 2; i < last; i++) this.before[i] += (this.now[i] - this.before[i]) * 0.7;
          this.setWaterLevel(level, true);
          this.hooks.ripple(this.target.x, level, 0.05, -0.7);
          this.droplets.burst(this.target.x, level, 7, 260, 8);
          this.hooks.sound('plop', 0.7);
          this.nextBob = time + 0.25;
          this.biteAt = 1.3 + Math.random() * 1.1;
          this.enter('waiting');
        }
        break;
      }
      case 'waiting':
        puppet.pose = POSES.wait;
        inWater = true;
        // Enough line to reach where the float landed, wherever the rod tip has moved to.
        lengthGoal = Math.hypot(this.target.x - this.tip.x, level - this.tip.y) * 1.05;
        lengthRate = 700;
        if (time > this.nextBob) {
          this.hooks.ripple(this.now[last], level, 0.03, this.clock < 1 ? 0.3 : 0.1);
          this.nextBob = time + (this.clock < 1 ? 0.35 : 1.5 + Math.random());
        }
        if (this.clock > this.biteAt) {
          this.hooks.ripple(this.now[last], level, 0.04, -0.5);
          this.hooks.sound('bite');
          this.enter('bite');
        }
        break;
      case 'bite':
        // Two sharp tugs: something has taken it.
        puppet.pose = POSES.brace;
        puppet.setExpression(this.clock < 0.45 ? 'surprised' : 'worried');
        inWater = true;
        lengthGoal = Math.hypot(this.target.x - this.tip.x, level - this.tip.y) * 1.02;
        this.dip = 16 * bump((this.clock - 0.05) / 0.24) + 22 * bump((this.clock - 0.45) / 0.34);
        if (this.clock > 0.45 && this.clock - dt <= 0.45) {
          this.hooks.ripple(this.now[last], level, 0.045, -0.6);
          this.hooks.sound('bite', 1.2);
        }
        if (this.clock > BITE_TIME) {
          this.nextBob = time;
          this.enter('hooked');
        }
        break;
      case 'hooked': {
        // It stays on, tugging, for as long as the visitor takes to pull.
        puppet.pose = POSES.brace;
        puppet.setExpression('worried');
        inWater = true;
        lengthGoal = Math.hypot(this.target.x - this.tip.x, level - this.tip.y) * 1.02;
        this.dip = 6 + 13 * bump((this.clock % 1.15) / 0.32);
        if (time > this.nextBob) {
          this.hooks.ripple(this.now[last], level, 0.04, -0.4);
          this.hooks.sound('bite', 0.6);
          this.nextBob = time + 1.15;
        }
        break;
      }
      case 'pulling': {
        puppet.pose = POSES.haul;
        puppet.setExpression('straining');
        const height = this.caught.height;
        const hookY = this.now[last + 1];
        // First he only takes the strain: the rod bows and the water heaves. Then it comes.
        this.straining = this.clock < STRAIN_TIME;
        lengthGoal = this.straining ? this.length : Math.max(60, this.tip.y - (rimY + 34 + height));
        lengthRate = 300 / Math.sqrt(this.caught.weight);
        // The water heaves before it breaks, then again as the last of it comes clear.
        if (hookY < level + 12 && time > this.nextBob) {
          this.hooks.ripple(this.now[last], level, 0.07, 0.28);
          this.nextBob = time + 0.1;
        }
        if (!this.broke && hookY > level + 6) {
          this.broke = true;
          this.hooks.ripple(this.now[last], level, 0.06, -0.8);
          this.droplets.burst(this.now[last], level, 14, 380, 24);
          this.hooks.sound('splash', 0.6);
        }
        if (!this.cleared && hookY > level + height) {
          this.cleared = true;
          this.hooks.ripple(this.now[last], level, 0.08, 0.9);
          this.droplets.burst(this.now[last], level, Math.round(22 * this.caught.weight), 460, 40);
          boat.push(-40 * this.caught.weight, -0.015);
          this.hooks.sound('splash', this.caught.weight);
        }
        if (hookY > rimY + 26 + height) {
          this.caught.bringInside(boat);
          this.setWaterLevel(this.restWaterY, false);
          this.enter('landing');
        }
        break;
      }
      case 'landing': {
        // Swing it over the front bench and let it down.
        puppet.pose = POSES.lower;
        puppet.setExpression('straining');
        const height = this.caught.height;
        steerTo = this.bench.x;
        const over = Math.abs(this.now[last] - this.bench.x) < 70;
        lengthGoal = over ? this.tip.y - (this.bench.y + height) + 4 : this.length;
        lengthRate = 330;
        const down = this.now[last + 1] <= this.bench.y + height + 2 && Math.abs(this.now[last] - this.bench.x) < 45;
        if (down || this.clock > 3) {
          const drift = (this.now[last] - this.before[last]) * 6;
          this.caught.land(this.benchLocal, drift, time);
          boat.push(230 * this.caught.weight, 0.02 * this.caught.weight);
          this.hooks.sound('thud', this.caught.weight);
          this.droplets.burst(this.bench.x, this.bench.y, 8, 200, this.caught.height * 0.3);
          this.endShare = FLOAT_SHARE;
          this.cheerUntil = time + 2;
          this.hooks.onLand();
          this.enter('recover');
        }
        break;
      }
      case 'recover':
        puppet.pose = POSES.rest;
        puppet.setExpression('delighted');
        lengthRate = 900;
        if (this.length <= REST_LENGTH + 2) this.enter('idle');
        break;
      case 'tossing':
        // A flick of the rod, and it goes back where it came from.
        puppet.pose = this.clock < 0.28 ? POSES.flick : POSES.rest;
        puppet.setExpression('happy');
        if (this.caught.mode === 'hidden') {
          this.enter('idle');
          if (this.queued) {
            const next = this.queued;
            this.queued = null;
            this.begin(next);
          }
        }
        break;
      case 'reeling':
        puppet.pose = POSES.rest;
        lengthRate = 1100;
        inWater = this.now[last + 1] < level + 6;
        if (inWater && time > this.nextBob) {
          this.hooks.ripple(this.now[last], level, 0.03, -0.25);
          this.nextBob = time + 0.07;
        }
        if (this.length <= REST_LENGTH + 2) {
          this.setWaterLevel(this.restWaterY, false);
          this.enter('idle');
          if (this.queued) {
            const next = this.queued;
            this.queued = null;
            this.begin(next);
          }
        }
        break;
    }
    const step = lengthRate * dt;
    this.length += Math.min(step, Math.max(-step, lengthGoal - this.length));

    this.simulate(dt, time, inWater, steerTo);
    this.measurePull();

    for (let i = 0; i <= SEGMENTS; i++) this.line.points[i].set(this.now[i * 2], this.now[i * 2 + 1]);
    this.line.rebuild();
    this.float.position.set(this.now[last], this.now[last + 1], 0);
    // In the air the float hangs along the line; in the water it stands up.
    const hang = Math.atan2(this.now[last - 2] - this.now[last], this.now[last - 1] - this.now[last + 1]);
    const tilt = inWater ? Math.sin(time * 2.1) * 0.08 : -hang * 0.7;
    this.float.rotation.z += (tilt - this.float.rotation.z) * Math.min(1, dt * 10);

    if (this.phase === 'pulling' || this.phase === 'landing') {
      this.caught.hang(this.now[last], this.now[last + 1], -hang * 0.8, dt);
    }
  }

  /** One frame of the string: move every point, then pull the segments back to length. */
  private simulate(dt: number, time: number, inWater: boolean, steerTo: number | null) {
    const now = this.now, before = this.before;
    const flying = this.phase === 'flight';
    const hauling = this.phase === 'pulling';
    const carrying = hauling || this.phase === 'landing';
    const level = this.target.y;
    const steps = 2;
    const h = Math.min(dt, 0.033) / steps;

    for (let s = 0; s < steps; s++) {
      for (let i = 1; i <= SEGMENTS; i++) {
        const x = i * 2, y = x + 1;
        const end = i === SEGMENTS;
        if (end && flying) continue;
        let vx = (now[x] - before[x]) * 0.992;
        let vy = (now[y] - before[y]) * 0.992;
        let ay = GRAVITY;
        if (inWater) {
          if (end) {
            // Buoyancy: the deeper the float sits, the harder the water pushes back.
            const depth = level + 1.5 - this.dip + Math.sin(time * 1.9) * 0.8 - now[y];
            if (depth > -3 - this.dip) {
              ay += depth * 420 + 1400;
              vx *= 0.9;
              vy *= 0.9;
              // The water holds it roughly where it landed.
              if (this.phase !== 'reeling') vx += (this.target.x - now[x]) * 40 * h * h;
            }
          } else if (i > SEGMENTS - 8 && now[y] < level) {
            vx *= 0.8;
            vy *= 0.8;
          }
        }
        if (end && carrying) {
          // A heavy thing comes up steadily however hard the line is yanked, and slower
          // still while the water has hold of it.
          const under = hauling && now[y] < level + this.caught.height;
          if (under) {
            vx *= 0.9;
            vy *= 0.9;
          }
          const heft = Math.pow(this.caught.weight, 0.35);
          const rise = ((this.straining ? 30 : under ? 150 : 290) / heft) * h;
          const drift = (300 / heft) * h;
          vy = Math.min(vy, rise);
          vx = Math.min(drift, Math.max(-drift, vx));
        }
        if (end && steerTo !== null) {
          // He guides the swing toward the bench and steadies it there.
          vx = vx * 0.95 + (steerTo - now[x]) * 30 * h * h;
        }
        before[x] = now[x];
        before[y] = now[y];
        now[x] += vx;
        now[y] += vy + ay * h * h;
        // The last stretch of line lies on the surface rather than sinking.
        if (inWater && i > SEGMENTS - 8 && !end && now[y] < level) now[y] = level;
      }

      now[0] = this.tip.x;
      now[1] = this.tip.y;
      const rest = this.length / SEGMENTS;
      // Sitting in the water, the float is held by it: a line still settling after the
      // cast should lie down beside the float, not snatch it back out.
      const held = inWater && this.phase !== 'reeling' && now[SEGMENTS * 2 + 1] < level + 8;
      const endShare = held ? 0.015 : this.endShare;
      for (let pass = 0; pass < 14; pass++) {
        for (let i = 0; i < SEGMENTS; i++) {
          const a = i * 2, b = a + 2;
          const dx = now[b] - now[a], dy = now[b + 1] - now[a + 1];
          const distance = Math.hypot(dx, dy);
          if (distance <= rest) continue; // a string can go slack but cannot stretch
          const excess = (distance - rest) / distance;
          const pinnedA = i === 0;
          const endB = i === SEGMENTS - 1;
          const pinnedB = endB && flying;
          let shareA = pinnedA ? 0 : 0.5, shareB = pinnedB ? 0 : 0.5;
          if (pinnedA && !pinnedB) shareB = 1;
          else if (pinnedB && !pinnedA) shareA = 1;
          else if (endB && !pinnedA) {
            shareB = endShare;
            shareA = 1 - endShare;
          }
          now[a] += dx * excess * shareA;
          now[a + 1] += dy * excess * shareA;
          now[b] -= dx * excess * shareB;
          now[b + 1] -= dy * excess * shareB;
        }
      }
    }
  }

  /** How hard the line is tugging the rod tip: the weight on it, plus more when it is taut. */
  private measurePull() {
    const last = SEGMENTS * 2;
    const dx = this.now[last] - this.tip.x, dy = this.now[last + 1] - this.tip.y;
    const span = Math.hypot(dx, dy) || 1;
    const carrying = this.phase === 'pulling' || this.phase === 'landing';
    const load = carrying ? 9000 * this.caught.weight : this.phase === 'waiting' ? 500 : 1500;
    const tug = this.dip * 420;
    const taut = Math.max(0, span - this.length * 0.97) * 220;
    const strength = Math.min(load + tug + taut, 26000);
    this.pull.set((dx / span) * strength, (dy / span) * strength);
  }
}
