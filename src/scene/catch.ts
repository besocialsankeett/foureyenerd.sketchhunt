import * as THREE from 'three';
import type { Boat } from './boat';
import type { Droplets } from './droplets';
import type { Part } from './puppet';
import { REFLECT_LAYER, createSpriteMaterial, type SpriteShared } from './sprite';
import { GLOBE, INDIA_SPIN, globeMaterial, standPart } from './globe';

export type CatchKind = 'mirror' | 'box' | 'bottle' | 'globe' | 'guitar';
export type CatchTextures = Record<'mirror' | 'box' | 'drawer' | 'bottle' | 'cork' | 'note' | 'globe' | 'guitar', Part>;

/** How tall each catch stands in the scene, and how heavy it feels on the line. */
const SPEC: Record<CatchKind, { height: number; weight: number }> = {
  mirror: { height: 225, weight: 1.5 },
  box: { height: 84, weight: 1 },
  bottle: { height: 100, weight: 0.7 },
  globe: { height: GLOBE.height, weight: 1.2 },
  guitar: { height: 230, weight: 1.4 },
};

/** Draw order while it is out over the water, and once it is inside the boat. */
const ORDER_OUTSIDE = 1.55;
const ORDER_INSIDE = 0.7;
const TOSS_TIME = 0.8;

type Mode = 'hidden' | 'line' | 'boat' | 'air';

/**
 * The thing a project comes up as. Its origin is the point the line is tied to, at the top;
 * the object hangs below. It can ride the line, sit in the boat, or be thrown back.
 */
export class Catch {
  readonly group = new THREE.Group();
  kind: CatchKind = 'box';
  height = 0;
  weight = 1;
  mode: Mode = 'hidden';

  private bodies: Record<CatchKind, THREE.Group>;
  private meshes: THREE.Mesh[] = [];
  private materials: THREE.ShaderMaterial[] = [];
  private width: Record<CatchKind, number>;

  private drawer: THREE.Mesh;
  private cork: THREE.Mesh;
  private note: THREE.Mesh;
  private corkMaterial: THREE.ShaderMaterial;
  private corkAbove: number;

  /** The globe's ball: how far it has turned, how fast, and where a spin should stop. */
  private globeMaterial: THREE.ShaderMaterial;
  private spin = INDIA_SPIN;
  private spinSpeed = 0;
  private spinTarget: number | null = null;

  private wobble = 0;
  private wobbleSpeed = 0;
  /** How far open it is, 0 to 1, and where that is heading. */
  private open = 0;
  private openSpeed = 0;
  private openTarget = 0;
  private wet = 0;
  private nextDrip = 0;
  private landedAt = 0;
  private seat = new THREE.Vector2();
  private from = new THREE.Vector2();
  private to = new THREE.Vector2();
  private clock = 0;
  private level = 0;
  private scratch = new THREE.Vector3();

  constructor(
    textures: CatchTextures,
    private shared: SpriteShared,
    private droplets: Droplets,
    private onSplash: (x: number, y: number, weight: number) => void,
  ) {
    const sprite = (part: Part, scale: number, dx: number, top: number, order = 0) => {
      const material = createSpriteMaterial(part.texture, this.shared, { waterY: 0 });
      const geometry = new THREE.PlaneGeometry(part.w * scale, part.h * scale);
      geometry.translate(dx, top - (part.h * scale) / 2, 0);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.layers.enable(REFLECT_LAYER);
      mesh.userData.order = order;
      this.meshes.push(mesh);
      this.materials.push(material);
      return mesh;
    };

    const mirrorScale = SPEC.mirror.height / textures.mirror.h;
    const boxScale = SPEC.box.height / textures.box.h;
    const corkScale = 15 / textures.cork.w;
    const corkAbove = 8; // how much of the cork stands clear of the bottle's mouth
    const bottleScale = (SPEC.bottle.height - corkAbove) / textures.bottle.h;

    const mirror = new THREE.Group().add(sprite(textures.mirror, mirrorScale, 0, 0));
    const guitarScale = SPEC.guitar.height / textures.guitar.h;
    const guitar = new THREE.Group().add(sprite(textures.guitar, guitarScale, 0, 0));
    // The box image includes its ribbon tab on the right; hang it from the middle of the box.
    // Its drawer sits behind it and slides out sideways when it opens.
    this.drawer = sprite(textures.drawer, boxScale, 3.2, 0, -0.002);
    const box = new THREE.Group().add(this.drawer, sprite(textures.box, boxScale, 3.2, 0));
    // The bottle's cork pops and its note comes up out of the neck.
    this.cork = sprite(textures.cork, corkScale, 0, 0, -0.001);
    this.corkMaterial = this.cork.material as THREE.ShaderMaterial;
    this.corkAbove = corkAbove;
    this.note = sprite(textures.note, 46 / textures.note.h, 0, 46, 0.001);
    const bottle = new THREE.Group().add(this.cork, sprite(textures.bottle, bottleScale, 0, -corkAbove), this.note);
    this.drawer.visible = this.note.visible = false;
    // The desk globe: a drawn stand, and in it a ball that is a sphere with the map round it.
    this.globeMaterial = globeMaterial(textures.globe.texture, this.shared);
    const ball = new THREE.Mesh(new THREE.PlaneGeometry(GLOBE.ball, GLOBE.ball).translate(0, GLOBE.ballY, 0), this.globeMaterial);
    ball.frustumCulled = false;
    ball.layers.enable(REFLECT_LAYER);
    ball.userData.order = 0.001;
    this.meshes.push(ball);
    this.materials.push(this.globeMaterial);
    const globe = new THREE.Group().add(sprite(standPart(), 0.5, 0, 0), ball);
    this.bodies = { mirror, box, bottle, globe, guitar };
    this.width = {
      mirror: textures.mirror.w * mirrorScale,
      box: textures.box.w * boxScale,
      bottle: textures.bottle.w * bottleScale,
      globe: GLOBE.width * 0.75,
      guitar: textures.guitar.w * guitarScale,
    };
    for (const body of Object.values(this.bodies)) {
      body.visible = false;
      this.group.add(body);
    }
    this.setOrder(ORDER_OUTSIDE);
  }

  private setOrder(order: number) {
    for (const mesh of this.meshes) mesh.renderOrder = order + mesh.userData.order;
  }

  private setWater(y: number) {
    for (const material of this.materials) material.uniforms.uWaterY.value = y;
  }

  /** Bring a catch into being under the water at `level`, ready to be hauled up on the line. */
  hook(kind: CatchKind, level: number) {
    for (const [name, body] of Object.entries(this.bodies)) body.visible = name === kind;
    this.kind = kind;
    this.height = SPEC[kind].height;
    this.weight = SPEC[kind].weight;
    this.mode = 'line';
    this.level = level;
    this.wet = 1;
    this.group.scale.setScalar(1);
    this.setWater(level);
    this.setOrder(ORDER_OUTSIDE);
    this.shut();
  }

  /** Open it up, or close it again. It only opens while it is sitting in the boat. */
  setOpen(open: boolean) {
    // Opened, the globe is given a spin, and comes to rest with India in front.
    if (open && this.openTarget === 0 && this.kind === 'globe') {
      const turns = Math.ceil((this.spin + Math.PI * 4 - INDIA_SPIN) / (Math.PI * 2));
      this.spinTarget = INDIA_SPIN + turns * Math.PI * 2;
    }
    this.openTarget = open ? 1 : 0;
  }

  /** Put every moving part back where it starts. */
  private shut() {
    this.open = this.openSpeed = this.openTarget = 0;
    this.pose();
  }

  /** Arrange the moving parts for how far open it is. */
  private pose() {
    const t = this.open;
    const shown = t > 0.02;
    this.drawer.visible = shown;
    this.drawer.position.x = t * this.width.box * 0.6;
    this.cork.position.set(t * 16, t * 34, 0);
    this.cork.rotation.z = -t * 1.1;
    this.corkMaterial.uniforms.uOpacity.value = Math.max(0, 1 - t * 1.3);
    this.note.visible = shown;
    this.note.position.y = -this.corkAbove - 34 + t * 44;
    this.note.scale.setScalar(0.3 + 0.7 * t);
    // The mirror has no moving parts: it swells a little as it opens.
    this.bodies.mirror.scale.setScalar(1 + 0.05 * t + 0.25 * t * (1 - t));
    // The guitar rocks once, as if strummed, and swells a little.
    this.bodies.guitar.scale.setScalar(1 + 0.04 * t + 0.2 * t * (1 - t));
    this.bodies.guitar.rotation.z = Math.sin(t * Math.PI * 2) * 0.08 * (1 - t);
  }

  /** No more dripping: it has been sitting in the boat a while. */
  dry() {
    this.wet = 0;
  }

  /** Whether a point in the world is on the object. */
  contains(x: number, y: number) {
    const { position } = this.group;
    return (
      this.mode === 'boat' &&
      Math.abs(x - position.x) < this.width[this.kind] / 2 + 10 &&
      y < position.y + 10 &&
      y > position.y - this.height - 10
    );
  }

  /** Hang from the line: follow the hook point and swing with the line's angle. */
  hang(x: number, y: number, angle: number, dt: number) {
    this.wobbleSpeed += ((angle - this.wobble) * 60 - this.wobbleSpeed * 5) * dt;
    this.wobble += this.wobbleSpeed * dt;
    this.group.position.set(x, y, 0);
    this.group.rotation.z = this.wobble;
  }

  /** From now on it is over the boat rather than in front of it. */
  bringInside(boat: Boat) {
    this.setOrder(ORDER_INSIDE);
    this.setWater(boat.waterY);
  }

  /** Set it down in the boat with its base at `seat` (in the boat's frame). */
  land(seat: THREE.Vector2, kick: number, time: number) {
    this.mode = 'boat';
    this.seat.copy(seat);
    this.wobbleSpeed += kick;
    this.landedAt = time;
  }

  /** Throw it from the boat back to a point on the water. */
  toss(x: number, y: number) {
    this.mode = 'air';
    this.clock = 0;
    this.from.set(this.group.position.x, this.group.position.y);
    this.to.set(x, y);
    this.level = y;
    this.setWater(y);
    this.setOrder(ORDER_OUTSIDE);
    this.group.scale.setScalar(1);
    this.shut();
  }

  /** The globe's ball turns slowly by itself, and when given a spin, whirls and settles. */
  private turnGlobe(dt: number) {
    const step = Math.min(dt, 0.05);
    if (this.spinTarget !== null) {
      // A soft spring onto the stopping point: a fast whirl that slows to a gentle stop.
      const k = 2.2;
      this.spinSpeed += ((this.spinTarget - this.spin) * k * k - this.spinSpeed * 2 * k) * step;
      if (Math.abs(this.spinTarget - this.spin) < 0.002 && Math.abs(this.spinSpeed) < 0.01) {
        this.spin = this.spinTarget % (Math.PI * 2);
        this.spinTarget = null;
        this.spinSpeed = 0;
      }
    } else if (this.openTarget === 0) {
      this.spinSpeed += (0.25 - this.spinSpeed) * step;
    } else {
      this.spinSpeed *= Math.exp(-step * 3);
    }
    this.spin += this.spinSpeed * step;
    this.globeMaterial.uniforms.uSpin.value = this.spin;
  }

  /** The middle of the object, for him to look at. */
  centre(out: THREE.Vector2) {
    return out.set(this.group.position.x, this.group.position.y - this.height / 2);
  }

  update(dt: number, time: number, boat: Boat) {
    if (this.mode === 'hidden') return;
    this.group.visible = true;
    if (this.kind === 'globe') this.turnGlobe(dt);

    if (this.mode === 'boat') {
      // Riding in the boat: it sits on the bench, rocks to rest, and breathes a little
      // to show it can be opened.
      this.scratch.set(this.seat.x, this.seat.y + this.height, 0).applyMatrix4(boat.group.matrixWorld);
      this.wobbleSpeed += (-this.wobble * 90 - this.wobbleSpeed * 6) * dt;
      this.wobble += this.wobbleSpeed * dt;
      this.group.position.set(this.scratch.x, this.scratch.y, 0);
      this.group.rotation.z = boat.pitchAngle + this.wobble * 0.5;
      this.openSpeed += ((this.openTarget - this.open) * 90 - this.openSpeed * 11) * dt;
      this.open = Math.min(1.15, Math.max(0, this.open + this.openSpeed * dt));
      this.pose();
      const settled = Math.min(1, Math.max(0, time - this.landedAt - 1.2)) * (1 - this.openTarget);
      this.group.scale.setScalar(1 + Math.sin(time * 3.2) * 0.012 * settled);
    } else if (this.mode === 'air') {
      this.clock += dt;
      const t = Math.min(this.clock / TOSS_TIME, 1);
      const rise = 150 + Math.abs(this.to.x - this.from.x) * 0.1;
      // Aim so that the whole object, not just its top, ends up under the surface.
      const endY = this.to.y - 6;
      this.group.position.set(
        this.from.x + (this.to.x - this.from.x) * t,
        this.from.y + (endY - this.from.y) * t + rise * 4 * t * (1 - t),
        0,
      );
      this.group.rotation.z = t * 2.4;
      if (t >= 1) {
        this.onSplash(this.to.x, this.to.y, this.weight);
        this.mode = 'hidden';
        this.group.visible = false;
        for (const body of Object.values(this.bodies)) body.visible = false;
        return;
      }
    }

    // Water runs off it for a few seconds after it leaves the water.
    if (this.wet > 0 && this.mode !== 'air' && this.group.position.y > this.level + 10 && time > this.nextDrip) {
      const half = this.width[this.kind] * 0.42;
      const x = this.group.position.x + (Math.random() - 0.5) * 2 * half;
      const bottom = this.group.position.y - this.height;
      if (this.mode === 'boat') this.droplets.drip(x, bottom + this.height * 0.35, bottom, false);
      else if (bottom > this.level) this.droplets.drip(x, bottom, this.level, true);
      this.nextDrip = time + 0.03 + (1 - this.wet) * 0.22;
      this.wet = Math.max(0, this.wet - (this.mode === 'boat' ? 0.012 : 0.004));
    }
  }
}
