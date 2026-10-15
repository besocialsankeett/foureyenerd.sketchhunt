import * as THREE from 'three';
import { REFLECT_LAYER, createSpriteMaterial, type SpriteShared } from './sprite';

const SEGMENTS = 24;
const STIFFNESS = 260;
const DAMPING = 9;
/** Downward pull on the rod's own weight, giving it a slight sag at rest. */
const WEIGHT = 2400;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Paints a strip of bamboo: outlined, lit along the top, with a dark ring at each joint. */
function bambooTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a1512';
  ctx.fillRect(0, 0, 512, 16);
  const body = ctx.createLinearGradient(0, 3, 0, 13);
  body.addColorStop(0, '#d9a85a');
  body.addColorStop(0.5, '#c08a3e');
  body.addColorStop(1, '#8f5e28');
  ctx.fillStyle = body;
  ctx.fillRect(0, 3, 512, 10);
  ctx.fillStyle = '#6b3d1c';
  for (const at of [0.08, 0.2, 0.33, 0.47, 0.61, 0.75, 0.88]) ctx.fillRect(Math.round(at * 512), 2, 4, 12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  return texture;
}

/**
 * A ribbon laid along a line of points: the shared drawing for the rod and the line.
 * Width tapers from `thick` at the first point to `thin` at the last.
 */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  readonly points: THREE.Vector2[];
  private positions: THREE.BufferAttribute;

  constructor(segments: number, material: THREE.Material, private thick: number, private thin: number) {
    this.points = Array.from({ length: segments + 1 }, () => new THREE.Vector2());
    const geometry = new THREE.BufferGeometry();
    const count = (segments + 1) * 2;
    this.positions = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(count * 2);
    const index: number[] = [];
    for (let i = 0; i <= segments; i++) {
      uv.set([i / segments, 0, i / segments, 1], i * 4);
      if (i < segments) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    geometry.setAttribute('position', this.positions);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.enable(REFLECT_LAYER);
  }

  /** Rebuild the ribbon after the points have moved. */
  rebuild() {
    const last = this.points.length - 1;
    const array = this.positions.array as Float32Array;
    for (let i = 0; i <= last; i++) {
      const before = this.points[Math.max(0, i - 1)];
      const after = this.points[Math.min(last, i + 1)];
      let nx = -(after.y - before.y);
      let ny = after.x - before.x;
      const length = Math.hypot(nx, ny) || 1;
      const half = (this.thick + (this.thin - this.thick) * (i / last)) / 2;
      nx = (nx / length) * half;
      ny = (ny / length) * half;
      const p = this.points[i];
      array.set([p.x + nx, p.y + ny, 0, p.x - nx, p.y - ny, 0], i * 6);
    }
    this.positions.needsUpdate = true;
  }
}

/**
 * The fishing rod. It is held at the butt and springs sideways along its length, so it
 * lags and whips when swung and bows under the pull of the line.
 */
export class Rod {
  readonly ribbon: Ribbon;
  private bend = 0;
  private bendSpeed = 0;
  private restTip = new THREE.Vector2();
  private restTipSpeed = new THREE.Vector2();
  private primed = false;

  constructor(shared: SpriteShared, waterY: number) {
    this.ribbon = new Ribbon(SEGMENTS, createSpriteMaterial(bambooTexture(), shared, { waterY }), 5.8, 1.6);
  }

  get mesh() {
    return this.ribbon.mesh;
  }

  get tip() {
    return this.ribbon.points[SEGMENTS];
  }

  /**
   * Hold the rod at `butt` pointing along `direction` and advance its bend. `pull` is the
   * tug of the line on the tip, as an acceleration.
   */
  update(butt: THREE.Vector2, direction: THREE.Vector2, length: number, dt: number, pull: THREE.Vector2) {
    const nx = -direction.y, ny = direction.x;
    const tipX = butt.x + direction.x * length, tipY = butt.y + direction.y * length;

    // The tip has mass: when the hands swing the rod, it is left behind, then catches up.
    let ax = 0, ay = 0;
    if (this.primed && dt > 0) {
      const vx = (tipX - this.restTip.x) / dt, vy = (tipY - this.restTip.y) / dt;
      ax = clamp((vx - this.restTipSpeed.x) / dt, -20000, 20000);
      ay = clamp((vy - this.restTipSpeed.y) / dt, -20000, 20000);
      this.restTipSpeed.set(vx, vy);
    }
    this.restTip.set(tipX, tipY);
    this.primed = true;

    const drive = -(ax * nx + ay * ny) * 0.9 + pull.x * nx + pull.y * ny - WEIGHT * ny;
    this.bendSpeed += (drive - this.bend * STIFFNESS - this.bendSpeed * DAMPING) * dt;
    this.bend = clamp(this.bend + this.bendSpeed * dt, -length * 0.32, length * 0.32);

    const points = this.ribbon.points;
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const sideways = this.bend * Math.pow(t, 2.2);
      const along = length * t - ((this.bend * this.bend * 0.55) / length) * t;
      points[i].set(butt.x + direction.x * along + nx * sideways, butt.y + direction.y * along + ny * sideways);
    }
    this.ribbon.rebuild();
  }
}
