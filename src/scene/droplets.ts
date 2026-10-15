import * as THREE from 'three';

const COUNT = 220;
const GRAVITY = -1500;
const HIDDEN = 1e6;

function dropTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(16, 16, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#e4f5ff';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#5aa9dc';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(12, 12, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

/** Flying water: splashes thrown up from the surface and drips falling off wet things. */
export class Droplets {
  readonly points: THREE.Points;
  private positions: THREE.BufferAttribute;
  private velocity = new Float32Array(COUNT * 2);
  /** The height at which each drop ends: the water it falls back into, or a deck. */
  private floor = new Float32Array(COUNT);
  private rings = new Uint8Array(COUNT);
  private alive = new Uint8Array(COUNT);
  private next = 0;

  constructor(private ripple: (x: number, y: number, radius: number, strength: number) => void) {
    const geometry = new THREE.BufferGeometry();
    const array = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) array[i * 3 + 1] = HIDDEN;
    this.positions = new THREE.BufferAttribute(array, 3);
    this.positions.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.positions);
    const material = new THREE.PointsMaterial({
      map: dropTexture(),
      size: 7,
      sizeAttenuation: false,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** Scale the drops with the canvas, so they stay the same size relative to the scene. */
  setScale(pixelsPerUnit: number) {
    (this.points.material as THREE.PointsMaterial).size = Math.max(3, 6.5 * pixelsPerUnit);
  }

  private spawn(x: number, y: number, vx: number, vy: number, floor: number, ring: boolean) {
    const i = this.next;
    this.next = (this.next + 1) % COUNT;
    const array = this.positions.array as Float32Array;
    array[i * 3] = x;
    array[i * 3 + 1] = y;
    this.velocity[i * 2] = vx;
    this.velocity[i * 2 + 1] = vy;
    this.floor[i] = floor;
    this.rings[i] = ring ? 1 : 0;
    this.alive[i] = 1;
  }

  /** A splash: drops thrown up and outward from a point on the water. */
  burst(x: number, waterY: number, count: number, power: number, width = 14) {
    for (let n = 0; n < count; n++) {
      const angle = Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const speed = power * (0.45 + Math.random() * 0.75);
      this.spawn(
        x + (Math.random() - 0.5) * width,
        waterY + 2,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        waterY - Math.random() * 10,
        n % 3 === 0,
      );
    }
  }

  /** A single drip falling from something wet, down to the water or onto a deck. */
  drip(x: number, y: number, floor: number, intoWater: boolean) {
    this.spawn(x, y, (Math.random() - 0.5) * 20, -20 - Math.random() * 40, floor, intoWater);
  }

  update(dt: number) {
    const array = this.positions.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      if (!this.alive[i]) continue;
      this.velocity[i * 2 + 1] += GRAVITY * dt;
      array[i * 3] += this.velocity[i * 2] * dt;
      array[i * 3 + 1] += this.velocity[i * 2 + 1] * dt;
      if (array[i * 3 + 1] < this.floor[i] && this.velocity[i * 2 + 1] < 0) {
        if (this.rings[i]) this.ripple(array[i * 3], this.floor[i], 0.018, 0.12);
        this.alive[i] = 0;
        array[i * 3 + 1] = HIDDEN;
      }
    }
    this.positions.needsUpdate = true;
  }
}
