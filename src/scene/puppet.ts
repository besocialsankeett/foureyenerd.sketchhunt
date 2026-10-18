import * as THREE from 'three';
import type { Boat } from './boat';
import { createFaceMaterial, type Eyes } from './face';
import { POSES, RIG, type Pose } from './layout';
import { Rod } from './rod';
import { REFLECT_LAYER, createSpriteMaterial, type SpriteShared } from './sprite';

export const EXPRESSIONS = ['happy', 'blink', 'worried', 'surprised', 'straining', 'delighted'] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export type Part = { texture: THREE.Texture; w: number; h: number };
export type PuppetTextures = {
  heads: Record<Expression, Part>;
  /** The eye openings of each expression, or null where the eyes are drawn shut. */
  eyes: Record<Expression, Eyes | null>;
  torso: Part;
  neck: Part;
  armFar: Part;
  armNear: Part;
};

type Point = readonly [number, number];
type ArmSpec = { scale: number; shoulder: Point; elbow: Point; hand: Point; fist?: readonly [number, number, number, number] };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** A damped spring: the workhorse behind every part that follows something with a lag. */
class Spring {
  value = 0;
  speed = 0;

  step(target: number, stiffness: number, damping: number, dt: number) {
    this.speed += ((target - this.value) * stiffness - this.speed * damping) * dt;
    this.value += this.speed * dt;
    return this.value;
  }
}

/** A plane for a part, subdivided, with the given image pixel at its origin and y up. */
function partGeometry(part: Part, pivot: Point, scale: number, segments = 1) {
  const geometry = new THREE.PlaneGeometry(part.w * scale, part.h * scale, segments, segments);
  geometry.translate((part.w / 2 - pivot[0]) * scale, -(part.h / 2 - pivot[1]) * scale, 0);
  return geometry;
}

function distanceToSegment(px: number, py: number, a: THREE.Vector2, b: THREE.Vector2, lo: number, hi: number) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const u = clamp(((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy), lo, hi);
  return Math.hypot(px - (a.x + dx * u), py - (a.y + dy * u));
}

/**
 * One arm drawn from a single image and bent at the elbow. Each vertex follows the upper
 * arm, the forearm, or a blend of both near the elbow, so the bend stays smooth.
 */
class Arm {
  readonly mesh: THREE.Mesh;
  private rest: Float32Array;
  private forearm: Float32Array; // how much each vertex belongs to the forearm
  private positions: THREE.BufferAttribute;
  private elbow0 = new THREE.Vector2();
  private upper: number;
  private lower: number;
  private upperAngle: number;
  private lowerAngle: number;

  constructor(part: Part, spec: ArmSpec, material: THREE.Material) {
    const geometry = partGeometry(part, spec.shoulder, spec.scale, 14);
    this.positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.rest = Float32Array.from(this.positions.array as Float32Array);

    const local = (p: Point) =>
      new THREE.Vector2((p[0] - spec.shoulder[0]) * spec.scale, -(p[1] - spec.shoulder[1]) * spec.scale);
    const shoulder0 = new THREE.Vector2();
    this.elbow0.copy(local(spec.elbow));
    const hand0 = local(spec.hand);
    this.upper = this.elbow0.length();
    this.lower = hand0.distanceTo(this.elbow0);
    this.upperAngle = Math.atan2(this.elbow0.y, this.elbow0.x);
    this.lowerAngle = Math.atan2(hand0.y - this.elbow0.y, hand0.x - this.elbow0.x);

    const blend = this.upper * 0.16;
    this.forearm = new Float32Array(this.positions.count);
    for (let i = 0; i < this.positions.count; i++) {
      const x = this.rest[i * 3], y = this.rest[i * 3 + 1];
      const toUpper = distanceToSegment(x, y, shoulder0, this.elbow0, -0.8, 1);
      const toLower = distanceToSegment(x, y, this.elbow0, hand0, 0, 1.8);
      this.forearm[i] = smooth((toUpper - toLower) / (2 * blend) + 0.5);
    }

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  /** A second drawing of the same bent arm, for showing part of it at another depth. */
  copy(material: THREE.Material) {
    return new THREE.Mesh(this.mesh.geometry, material);
  }

  /**
   * Bend the arm so it runs from the shoulder to the hand. Of the two ways an elbow can
   * bend, take the one hanging lower, or the one further toward his back (+x).
   */
  pose(shoulder: THREE.Vector2, hand: THREE.Vector2, elbow: 'down' | 'back' = 'down') {
    const dx = hand.x - shoulder.x, dy = hand.y - shoulder.y;
    const reach = clamp(Math.hypot(dx, dy), Math.abs(this.upper - this.lower) + 0.5, this.upper + this.lower - 0.5);
    const toHand = Math.atan2(dy, dx);
    const spread = Math.acos(clamp((this.upper ** 2 + reach ** 2 - this.lower ** 2) / (2 * this.upper * reach), -1, 1));
    const up = toHand + spread, down = toHand - spread;
    const first = elbow === 'down' ? Math.sin(up) < Math.sin(down) : Math.cos(up) > Math.cos(down);
    const elbowAngle = first ? up : down;
    const ex = shoulder.x + Math.cos(elbowAngle) * this.upper;
    const ey = shoulder.y + Math.sin(elbowAngle) * this.upper;

    const a1 = elbowAngle - this.upperAngle;
    const a2 = Math.atan2(hand.y - ey, hand.x - ex) - this.lowerAngle;
    const stretch = Math.hypot(hand.x - ex, hand.y - ey) / this.lower;
    const c1 = Math.cos(a1), s1 = Math.sin(a1);
    const c2 = Math.cos(a2) * stretch, s2 = Math.sin(a2) * stretch;

    const out = this.positions.array as Float32Array;
    for (let i = 0; i < this.positions.count; i++) {
      const x = this.rest[i * 3], y = this.rest[i * 3 + 1];
      const ux = shoulder.x + x * c1 - y * s1;
      const uy = shoulder.y + x * s1 + y * c1;
      const qx = x - this.elbow0.x, qy = y - this.elbow0.y;
      const lx = ex + qx * c2 - qy * s2;
      const ly = ey + qx * s2 + qy * c2;
      const w = this.forearm[i];
      out[i * 3] = ux + (lx - ux) * w;
      out[i * 3 + 1] = uy + (ly - uy) * w;
    }
    this.positions.needsUpdate = true;
  }
}

/**
 * The character: separate drawn parts on a skeleton, sitting in the boat. Nothing is
 * keyframed; every part chases a target on a spring, so motion overshoots and settles.
 */
export class Puppet {
  readonly rod: Rod;

  private torso: THREE.Mesh;
  private neck: THREE.Mesh;
  private head: THREE.Mesh;
  private headMaterial: THREE.ShaderMaterial;
  private headRest: Float32Array;
  private hairWeight: Float32Array;
  private armFar: Arm;
  private armNear: Arm;
  private seat: THREE.Vector2;

  private lean = new Spring();
  private nod = new Spring();
  private rodTurn = new Spring();
  private gripX = new Spring();
  private gripY = new Spring();
  private lookX = new Spring();
  private lookY = new Spring();
  private hairX = new Spring();
  private hairY = new Spring();
  private breath = 1;

  /** What he is doing right now: a target the body chases, set by whoever directs him. */
  pose: Pose = POSES.rest;

  /** The point in the world he is looking at. His eyes follow it; his head a little. */
  readonly gaze = new THREE.Vector2();

  private expression: Expression = 'happy';
  private blinkUntil = 0;
  private nextBlink = 2;
  private glance = 0;
  private nextGlance = 4;
  private headAt = new THREE.Vector2();
  private headSpeed = new THREE.Vector2();
  private hasHeadHistory = false;

  // Scratch vectors, reused every frame.
  private collar = new THREE.Vector2();
  private shoulderFar = new THREE.Vector2();
  private shoulderNear = new THREE.Vector2();
  private gripLow = new THREE.Vector2();
  private gripHigh = new THREE.Vector2();
  private butt = new THREE.Vector2();
  private direction = new THREE.Vector2();

  constructor(private textures: PuppetTextures, shared: SpriteShared, boat: Boat) {
    const material = (part: Part) => createSpriteMaterial(part.texture, shared, { waterY: boat.waterY });
    this.seat = boat.toLocal(RIG.seat[0], RIG.seat[1]);

    this.torso = new THREE.Mesh(partGeometry(textures.torso, RIG.torso.pivot, RIG.torso.scale), material(textures.torso));
    this.neck = new THREE.Mesh(partGeometry(textures.neck, RIG.neck.pivot, RIG.neck.scale), material(textures.neck));

    const headGeometry = partGeometry(textures.heads.happy, RIG.head.pivot, RIG.head.scale, 12);
    this.headMaterial = createFaceMaterial(textures.heads.happy.texture, textures.heads.happy, shared, boat.waterY);
    this.head = new THREE.Mesh(headGeometry, this.headMaterial);
    const headPositions = headGeometry.getAttribute('position') as THREE.BufferAttribute;
    headPositions.setUsage(THREE.DynamicDrawUsage);
    this.headRest = Float32Array.from(headPositions.array as Float32Array);
    // The hair moves, the face does not: weight grows with distance from the middle of the face.
    this.hairWeight = new Float32Array(headPositions.count);
    const faceX = (RIG.head.face[0] - RIG.head.pivot[0]) * RIG.head.scale;
    const faceY = -(RIG.head.face[1] - RIG.head.pivot[1]) * RIG.head.scale;
    for (let i = 0; i < headPositions.count; i++) {
      const d = Math.hypot((this.headRest[i * 3] - faceX) / (150 * RIG.head.scale), (this.headRest[i * 3 + 1] - faceY) / (140 * RIG.head.scale));
      this.hairWeight[i] = smooth((d - 0.75) / 0.75);
    }

    this.rod = new Rod(shared, boat.waterY);
    this.rodTurn.value = POSES.rest.rodAngle;
    this.armFar = new Arm(textures.armFar, RIG.armFar, material(textures.armFar));
    this.armNear = new Arm(textures.armNear, RIG.armNear, material(textures.armNear));

    // The far arm passes behind his body, elbow back, and only its fist comes round the rod.
    const farFist = this.armFar.copy(
      createSpriteMaterial(textures.armFar.texture, shared, { waterY: boat.waterY, crop: RIG.armFar.fist }),
    );

    // Back to front, all between the boat's far side (0) and its near side (0.9).
    const order: [THREE.Mesh, number][] = [
      [this.armFar.mesh, 0.15],
      [this.torso, 0.2],
      [this.neck, 0.25],
      [this.head, 0.3],
      [this.rod.mesh, 0.4],
      [farFist, 0.5],
      [this.armNear.mesh, 0.6],
    ];
    for (const [mesh, renderOrder] of order) {
      mesh.renderOrder = renderOrder;
      mesh.frustumCulled = false;
      mesh.layers.enable(REFLECT_LAYER);
      boat.group.add(mesh);
    }
  }

  setExpression(expression: Expression) {
    this.expression = expression;
  }

  /** A point on the shirt, in the boat's frame, after leaning and breathing. */
  private onTorso(point: Point, out: THREE.Vector2) {
    const x = (point[0] - RIG.torso.pivot[0]) * RIG.torso.scale;
    const y = -(point[1] - RIG.torso.pivot[1]) * RIG.torso.scale * this.breath;
    const c = Math.cos(this.lean.value), s = Math.sin(this.lean.value);
    return out.set(this.seat.x + x * c - y * s, this.seat.y + x * s + y * c);
  }

  /** Advance one frame. `pull` is the tug of the line on the rod tip. */
  /** The top of his head, in the world, for a speech bubble to come from. */
  headTop(boat: Boat) {
    return { x: boat.group.position.x + this.head.position.x, y: boat.group.position.y + this.head.position.y + 150 };
  }

  update(dt: number, time: number, boat: Boat, pull: THREE.Vector2) {
    // Urgent poses are chased harder: the same springs, wound tighter.
    const { snap } = this.pose;
    const follow = (spring: Spring, target: number, stiffness: number, ratio = 0.55) => {
      const k = stiffness * snap;
      return spring.step(target, k, 2 * Math.sqrt(k) * ratio, dt);
    };

    // He balances against the boat's tilt and sways a little on his own.
    follow(this.lean, this.pose.lean + Math.sin(time * 0.55) * 0.012 - boat.pitchAngle * 0.9, 40, 0.7);
    this.breath = 1 + (Math.sin(time * 1.7) * 0.5 + 0.5) * 0.014;
    this.torso.position.set(this.seat.x, this.seat.y, 0);
    this.torso.rotation.z = this.lean.value;
    this.torso.scale.y = this.breath;

    if (time > this.nextGlance) {
      this.glance = [-0.035, 0, 0, 0.04][Math.floor(Math.random() * 4)];
      this.nextGlance = time + 3 + Math.random() * 4;
    }
    // His eyes go to what he is watching, quickly; his head tips a little the same way.
    const eyeX = boat.group.position.x + this.head.position.x - 6;
    const eyeY = boat.group.position.y + this.head.position.y + 62;
    this.lookX.step(clamp((this.gaze.x - eyeX) / 240, -1, 1), 150, 20, dt);
    this.lookY.step(clamp((eyeY - this.gaze.y) / 220, -1, 1), 150, 20, dt);
    (this.headMaterial.uniforms.uLook.value as THREE.Vector2).set(this.lookX.value, this.lookY.value);
    const tip = this.lookY.value * 0.035 - this.lookX.value * 0.012;
    this.nod.step(this.glance * 0.5 + tip + Math.sin(time * 0.8 + 1) * 0.018 - this.lean.value * 0.4, 55, 8, dt);
    const headAngle = this.lean.value + this.nod.value;
    this.onTorso(RIG.torso.collar, this.collar);
    this.head.position.set(this.collar.x, this.collar.y, 0);
    this.head.rotation.z = headAngle;
    this.neck.position.set(this.collar.x, this.collar.y, 0);
    this.neck.rotation.z = this.lean.value + this.nod.value * 0.5;

    this.updateHair(dt, boat);
    this.updateFace(time);

    // The rod pivots in the lower hand; the upper hand rides further up it.
    follow(this.rodTurn, this.pose.rodAngle + Math.sin(time * 0.9 + 0.5) * 0.02 - boat.verticalSpeed * 0.0015, 32);
    follow(this.gripX, this.pose.grip[0], 60);
    follow(this.gripY, this.pose.grip[1], 60);
    const angle = this.rodTurn.value + this.lean.value * 0.5;
    this.direction.set(Math.cos(angle), Math.sin(angle));
    this.onTorso(RIG.torso.grip, this.gripLow);
    this.gripLow.x += this.gripX.value;
    this.gripLow.y += this.gripY.value;
    this.gripHigh.copy(this.gripLow).addScaledVector(this.direction, RIG.rod.handSpacing);
    this.butt.copy(this.gripLow).addScaledVector(this.direction, -RIG.rod.butt);
    this.rod.update(this.butt, this.direction, RIG.rod.length, dt, pull);

    this.armFar.pose(this.onTorso(RIG.torso.shoulderFar, this.shoulderFar), this.gripHigh, 'back');
    this.armNear.pose(this.onTorso(RIG.torso.shoulderNear, this.shoulderNear), this.gripLow);
  }

  /** The hair is one soft mass on a spring: it lags behind the head and wobbles to rest. */
  private updateHair(dt: number, boat: Boat) {
    const x = boat.group.position.x + this.head.position.x;
    const y = boat.group.position.y + this.head.position.y;
    if (this.hasHeadHistory && dt > 0) {
      const vx = (x - this.headAt.x) / dt, vy = (y - this.headAt.y) / dt;
      const ax = clamp((vx - this.headSpeed.x) / dt, -3000, 3000);
      const ay = clamp((vy - this.headSpeed.y) / dt, -3000, 3000);
      this.hairX.speed -= ax * dt;
      this.hairY.speed -= ay * dt;
      this.headSpeed.set(vx, vy);
    }
    this.headAt.set(x, y);
    this.hasHeadHistory = true;
    const jx = clamp(this.hairX.step(0, 130, 7, dt), -12, 12);
    const jy = clamp(this.hairY.step(0, 150, 8, dt), -10, 10);

    const positions = this.head.geometry.getAttribute('position') as THREE.BufferAttribute;
    const out = positions.array as Float32Array;
    for (let i = 0; i < positions.count; i++) {
      const w = this.hairWeight[i];
      out[i * 3] = this.headRest[i * 3] + jx * w;
      out[i * 3 + 1] = this.headRest[i * 3 + 1] + jy * w;
    }
    positions.needsUpdate = true;
  }

  private updateFace(time: number) {
    if (time > this.nextBlink) {
      this.blinkUntil = time + 0.12;
      this.nextBlink = time + 2.2 + Math.random() * 3.5;
    }
    // Only the resting smile has a matching closed-eye drawing.
    const shown = this.expression === 'happy' && time < this.blinkUntil ? 'blink' : this.expression;
    const uniforms = this.headMaterial.uniforms;
    uniforms.map.value = this.textures.heads[shown].texture;
    const eyes = this.textures.eyes[shown];
    uniforms.uEyesOn.value = eyes ? 1 : 0;
    if (eyes) {
      uniforms.uEyeMask.value = eyes.mask;
      (uniforms.uEyeL.value as THREE.Vector4).fromArray(eyes.left);
      (uniforms.uEyeR.value as THREE.Vector4).fromArray(eyes.right);
      uniforms.uIris.value = shown === 'surprised' ? RIG.iris.wide : RIG.iris.normal;
    }
  }
}
