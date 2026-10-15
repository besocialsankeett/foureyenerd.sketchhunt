import * as THREE from 'three';
import { BOAT, worldY } from './layout';
import { REFLECT_LAYER, createSpriteMaterial, type SpriteShared } from './sprite';

/** Draw order of the near side of the hull; anything inside the boat sits below this. */
export const BOAT_FRONT_ORDER = 0.9;

/**
 * The boat as a floating body: it heaves and pitches on springs around a gentle swell.
 * It is drawn twice, whole and then just its near side, so passengers sit between the two.
 */
export class Boat {
  readonly group = new THREE.Group();
  readonly waterY = worldY(BOAT.waterY);
  /** World x of the two points where the hull meets the water. */
  readonly hullEnds: [number, number];

  private rest = new THREE.Vector2();
  private heave = 0;
  private heaveSpeed = 0;
  private pitch = 0;
  private pitchSpeed = 0;

  constructor(texture: THREE.Texture, front: THREE.Texture, size: { w: number; h: number }, shared: SpriteShared) {
    const width = size.w * BOAT.scale;
    const height = size.h * BOAT.scale;
    const geometry = new THREE.PlaneGeometry(width, height);
    const back = new THREE.Mesh(geometry, createSpriteMaterial(texture, shared, { waterY: this.waterY }));
    const near = new THREE.Mesh(geometry, createSpriteMaterial(front, shared, { waterY: this.waterY }));
    near.renderOrder = BOAT_FRONT_ORDER;
    for (const mesh of [back, near]) {
      mesh.layers.enable(REFLECT_LAYER);
      this.group.add(mesh);
    }

    // Place the image so that its water row sits on the water surface.
    this.rest.set(BOAT.left + width / 2, this.waterY + (BOAT.waterRow - size.h / 2) * BOAT.scale);
    this.group.position.set(this.rest.x, this.rest.y, 0);
    this.hullEnds = [BOAT.left + BOAT.hullColumns[0] * BOAT.scale, BOAT.left + BOAT.hullColumns[1] * BOAT.scale];
  }

  /** Vertical speed in world units per second; drives the rings the hull sheds. */
  get verticalSpeed() {
    return this.heaveSpeed;
  }

  get pitchAngle() {
    return this.pitch;
  }

  /** A design-space position expressed in the boat's own frame, for things riding in it. */
  toLocal(designX: number, designY: number) {
    return new THREE.Vector2(designX - this.rest.x, worldY(designY) - this.rest.y);
  }

  /** Knock the boat: a downward shove and a twist, e.g. when something lands in it. */
  push(down: number, twist = 0) {
    this.heaveSpeed -= down;
    this.pitchSpeed += twist;
  }

  update(dt: number, time: number) {
    const swell = Math.sin(time * 0.9) * 2.2 + Math.sin(time * 1.7 + 1.0) * 1.1;
    const lean = Math.sin(time * 0.7 + 2.0) * 0.006;

    this.heaveSpeed += ((swell - this.heave) * 26 - this.heaveSpeed * 3.2) * dt;
    this.heave += this.heaveSpeed * dt;
    this.pitchSpeed += ((lean - this.pitch) * 22 - this.pitchSpeed * 2.6) * dt;
    this.pitch += this.pitchSpeed * dt;

    this.group.position.y = this.rest.y + this.heave;
    this.group.rotation.z = this.pitch;
  }
}
