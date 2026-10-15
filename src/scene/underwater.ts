import * as THREE from 'three';
import { FlexStrip, type FishPart, type Species } from './fish';
import { Motes, NearReeds } from './depths';
import { Glow } from './glow';
import type { Part } from './puppet';

/**
 * Who swims past underwater: mostly koi, a pair of goldfish (the second follows the first),
 * and a bluegill.
 */
const SWIMMERS: Species[] = ['koi', 'goldfish', 'goldfish', 'koi', 'bluegill', 'koi', 'koi'];
/** Each kind's length against a koi's. */
const LENGTH: Record<Species, number> = { koi: 1, goldfish: 0.78, bluegill: 0.75 };
const BUBBLES = 180;
const HIDDEN = 1e6;
/** The colour the water lends to whatever is farther away in it. */
const WATER = [0.16, 0.45, 0.68] as const;

// Everything underwater is drawn in screen units: x from 0 to the screen's aspect ratio,
// y from 0 at the bottom to 1 at the top. The surface is a wavy line across the screen at
// height uLine, which is wherever the pond's water level is on screen; only what is below
// it is drawn. uReveal fades the underwater view in as the camera dips under.
const WATERLINE = /* glsl */ `
  uniform float uLine;
  uniform float uTime;
  uniform float uReveal;
  float waterline(float x) {
    return uLine + 0.004 * sin(x * 9.0 + uTime * 2.1) + 0.002 * sin(x * 23.0 - uTime * 3.3);
  }
`;

const plateVertex = /* glsl */ `
  varying vec2 vScreen;
  void main() {
    // Screen units: the quad is stretched across the screen's full width.
    vScreen = (modelMatrix * vec4(position, 1.0)).xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The painted pond from below, kept moving: the whole picture drifts gently, the surface
// shimmers, the plants at the sides sway, light plays over the floor and through the rays.
const plateFragment = /* glsl */ `
  precision highp float;
  uniform sampler2D map;
  uniform float uAspect;
  uniform float uPlateAspect;
  uniform float uPlateHeight;
  uniform float uDepth; // 0 just under the surface, 1 down by the pond floor
  uniform float uLantern; // the boat's lantern, lit at night
  uniform float uBeamX;
  varying vec2 vScreen;
  ${WATERLINE}

  void main() {
    float t = uTime;
    float line = waterline(vScreen.x);
    float y = vScreen.y;

    // The painting hangs from the water level, as wide as the screen at least.
    float h = uPlateHeight;
    float w = h * uPlateAspect;
    vec2 uv = vec2((vScreen.x - (uAspect - w) * 0.5) / w, 1.0 - (uLine - y) / h);

    uv.x += sin(uv.y * 30.0 + t * 1.4) * 0.0012;
    uv.y += sin(uv.x * 22.0 + t * 1.1) * 0.0008;
    float top = smoothstep(0.84, 1.0, uv.y);
    uv.x += sin(uv.x * 40.0 + t * 3.0) * 0.004 * top;
    float sides = smoothstep(0.26, 0.06, uv.x) + smoothstep(0.74, 0.94, uv.x);
    float grown = clamp((uv.y - 0.04) / 0.7, 0.0, 1.0);
    uv.x += sin(t * 0.9 + uv.y * 4.0 + step(0.5, uv.x) * 2.0) * 0.007 * sides * grown * (1.0 - top);
    // As the camera dips in, the whole view swims; just under the surface it always bends.
    float settling = 1.0 - uReveal;
    uv += vec2(sin(vScreen.y * 34.0 + t * 5.0), sin(vScreen.x * 21.0 - t * 4.0)) * 0.018 * settling;
    float near = smoothstep(0.05, 0.0, line - y);
    uv.y += sin(vScreen.x * 26.0 + t * 4.0) * 0.008 * near;

    vec3 color = texture2D(map, clamp(uv, 0.001, 0.999)).rgb;

    vec2 q = uv * vec2(10.0, 6.0);
    float web = sin(q.x * 1.7 + t * 0.8 + sin(q.y * 2.1 + t * 0.6)) + sin(q.y * 2.3 - t * 0.7 + sin(q.x * 1.3 - t * 0.5));
    web = pow(max(0.0, 1.0 - abs(web * 0.5)), 6.0);
    color += web * 0.2 * smoothstep(0.3, 0.06, uv.y) * vec3(1.0, 0.97, 0.8);

    float angle = atan(uv.x - 0.5, 1.08 - uv.y);
    float rays = max(0.0, sin(angle * 26.0 + t * 0.5) * sin(angle * 15.0 - t * 0.33));
    color += rays * 0.07 * smoothstep(0.3, 0.95, uv.y) * (1.0 - smoothstep(0.0, 0.5, abs(uv.x - 0.5)));

    // Shafts of light from the surface, drifting slowly, that reach less far the deeper
    // the camera goes; the water darkens and cools with depth, and from the edges.
    vec2 from = vec2(uAspect * 0.42, 1.7);
    vec2 toward = vScreen - from;
    float spread = atan(toward.x, -toward.y);
    float shafts = smoothstep(0.45, 1.0, 0.5 + 0.5 * sin(spread * 23.0 + t * 0.22))
      * smoothstep(0.25, 1.0, 0.5 + 0.5 * sin(spread * 9.0 - t * 0.15 + 1.3));
    float reach = smoothstep(-0.3 - 0.6 * (1.0 - uDepth), 1.1, y);
    color += vec3(0.78, 0.93, 1.0) * shafts * reach * 0.16 * (1.0 - uDepth * 0.7) * (1.0 - uLantern * 0.85);
    // At night the only light from above is the lantern's: one warm beam, widening as it sinks.
    float beamWidth = 0.07 + max(0.0, 1.3 - y) * 0.2;
    float beamX = (vScreen.x - uBeamX) / beamWidth;
    color += vec3(1.0, 0.74, 0.42) * exp(-beamX * beamX) * smoothstep(-0.4, 1.0, y) * 1.3 * uLantern * (1.0 - uDepth * 0.5);
    color = mix(color, vec3(0.05, 0.17, 0.33), uDepth * 0.3);
    color *= mix(0.82, 1.04, clamp(y, 0.0, 1.0)) * (1.0 - uDepth * 0.12);
    vec2 centred = (vScreen - vec2(uAspect * 0.5, 0.5)) / vec2(uAspect, 1.0);
    color *= 1.0 - smoothstep(0.25, 0.75, length(centred)) * 0.22;

    // The surface seen edge-on: a bright line of light where the water meets the air.
    float under = 1.0 - smoothstep(line - 0.0015, line + 0.0015, y);
    float rim = smoothstep(0.008, 0.0, line - y) * under;
    color = mix(color, vec3(0.88, 0.97, 1.0), rim * 0.7);
    float alpha = under * uReveal;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

const shapeVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vScreen;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vScreen = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// A picture seen through the water: the farther off, the more it takes on the water's colour.
const shapeFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uHaze;
  varying vec2 vUv;
  varying vec2 vScreen;
  ${WATERLINE}

  void main() {
    if (vScreen.y > waterline(vScreen.x)) discard;
    vec4 color = texture2D(map, vUv); // premultiplied
    color.rgb = mix(color.rgb, vec3(${WATER.join(', ')}) * color.a, uHaze);
    gl_FragColor = color * uReveal;
  }
`;

const bubbleVertex = /* glsl */ `
  attribute float aSize;
  uniform float uScale;
  varying vec2 vScreen;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vScreen = world.xy;
    gl_PointSize = aSize * uScale;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// A bubble: a clear disc with a bright rim and a glint, gone once it reaches the surface.
const bubbleFragment = /* glsl */ `
  varying vec2 vScreen;
  ${WATERLINE}

  void main() {
    if (vScreen.y > waterline(vScreen.x)) discard;
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p);
    float disc = smoothstep(0.5, 0.44, d);
    float rim = disc - smoothstep(0.42, 0.3, d) * 0.75;
    float glint = smoothstep(0.13, 0.04, length(p - vec2(-0.16, -0.16)));
    float alpha = clamp(rim * 0.7 + glint, 0.0, 1.0) * uReveal;
    gl_FragColor = vec4(vec3(0.9, 0.97, 1.0) * alpha, alpha);
  }
`;

type Swimmer = {
  kind: Species;
  /** The one it follows, keeping just behind and above it. */
  lead: Swimmer | null;
  mesh: THREE.Mesh;
  strip: FlexStrip;
  haze: { value: number };
  x: number;
  /** Height in the painting, from its floor (0) to the surface (1). */
  y: number;
  dir: number;
  speed: number;
  depth: number;
  beat: number;
  seed: number;
};

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Where the underwater view sits on screen this frame. */
export type Placement = {
  /** Screen height of the water level. */
  line: number;
  /** Height of the painting, in screen heights. */
  plateHeight: number;
  /** Where the water level will be once fully under, at the current depth. */
  lineEnd: number;
  /** World to screen units, for things that also exist above the water, like the boat. */
  toScreen: THREE.Matrix4;
  /** The boat's place in the world, so its underside can be drawn below the surface. */
  boat: THREE.Matrix4;
};

/**
 * Below the surface. Drawn over the scene in its own pass while diving: the painted pond
 * from underneath, hanging from the water level so that it and the scene above move as one
 * world; koi swimming past at eye level; bubbles; and the boat's hull under the water.
 * `progress` runs from 0, at the surface, to 1, fully under.
 */
export class Underwater {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1.5, 1, 0, -10, 10);
  progress = 0;
  /** How far the camera has gone, before easing. */
  private raw = 0;
  private aspect = 1.5;
  private line = { value: -1 };
  private reveal = { value: 0 };
  private plateHeight = { value: 1 };
  private depth = { value: 0 };
  private lantern = { value: 0 };
  private beamX = { value: 1 };
  private lineEnd = 1;
  private motes: Motes;
  private nearReeds: NearReeds;
  /** The glowing plankton, drawn after the night's darkening, on top of everything below. */
  readonly glowScene = new THREE.Scene();
  private glow: Glow;
  private lastPointer = new THREE.Vector2();
  private hadPointer = false;
  private nextWake = 0;
  private pointer = new THREE.Vector2();
  private pointing = false;
  private time: { value: number };
  readonly plateAspect: number;
  private plate: THREE.Mesh;
  /** Everything that lives in the painting, carried with it: koi and bubbles. */
  private deep = new THREE.Group();
  private hull: THREE.Mesh;
  private swimmers: Swimmer[] = [];
  private bubbles: THREE.Points;
  private bubbleSpeed = new Float32Array(BUBBLES);
  private bubbleSway = new Float32Array(BUBBLES);
  private nextBubble = 0;
  private bubbleSlot = 0;
  private scale = { value: 800 };

  constructor(
    plate: THREE.Texture,
    plateSize: { w: number; h: number },
    fish: FishPart[],
    boat: { texture: THREE.Texture; width: number; height: number },
    reeds: Part[],
    time: { value: number },
  ) {
    this.time = time;
    this.plateAspect = plateSize.w / plateSize.h;
    plate.wrapS = plate.wrapT = THREE.ClampToEdgeWrapping;
    const shared = { uLine: this.line, uTime: this.time, uReveal: this.reveal, uDepth: this.depth };
    const shape = (map: THREE.Texture, haze: { value: number }) =>
      new THREE.ShaderMaterial({
        uniforms: { map: { value: map }, uHaze: haze, ...shared },
        vertexShader: shapeVertex,
        fragmentShader: shapeFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    this.plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0),
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: plate },
          uAspect: { value: this.aspect },
          uPlateAspect: { value: this.plateAspect },
          uPlateHeight: this.plateHeight,
          uLantern: this.lantern,
          uBeamX: this.beamX,
          ...shared,
        },
        vertexShader: plateVertex,
        fragmentShader: plateFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.plate.frustumCulled = false;
    this.scene.add(this.plate);

    // The same picture as the boat above, placed exactly where the boat is: only the part
    // below the surface shows, a little hazed by the water.
    this.hull = new THREE.Mesh(new THREE.PlaneGeometry(boat.width, boat.height), shape(boat.texture, { value: 0.3 }));
    this.hull.matrixAutoUpdate = false;
    this.hull.frustumCulled = false;
    this.hull.renderOrder = 2;
    this.scene.add(this.hull, this.deep);

    const koi = fish.filter((part) => part.kind === 'koi');
    SWIMMERS.forEach((kind, n) => {
      const part = kind === 'koi' ? koi[n % koi.length] : (fish.find((p) => p.kind === kind) ?? koi[0]);
      const strip = new FlexStrip(part, 0.25);
      const haze = { value: 0 };
      const mesh = new THREE.Mesh(strip.geometry, shape(part.texture, haze));
      mesh.frustumCulled = false;
      this.deep.add(mesh);
      // A goldfish straight after another goldfish follows it.
      const before = this.swimmers[n - 1];
      const lead = kind === 'goldfish' && before?.kind === 'goldfish' && !before.lead ? before : null;
      const swimmer: Swimmer = {
        kind: part.kind,
        lead,
        mesh,
        strip,
        haze,
        x: 0,
        y: 0,
        dir: 1,
        speed: 0,
        depth: 0,
        beat: n * 1.7,
        seed: n * 2.3,
      };
      if (!lead) this.respawn(swimmer, true);
      this.swimmers.push(swimmer);
    });

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(BUBBLES * 3);
    for (let i = 0; i < BUBBLES; i++) positions[i * 3 + 1] = HIDDEN;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(BUBBLES), 1));
    this.bubbles = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uScale: this.scale, ...shared },
        vertexShader: bubbleVertex,
        fragmentShader: bubbleFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 10;
    this.deep.add(this.bubbles);

    this.motes = new Motes(shared);
    this.nearReeds = new NearReeds(reeds, shared);
    this.glow = new Glow(shared);
    this.glowScene.add(this.glow.points);
    this.scene.add(this.motes.back, this.motes.front, this.nearReeds.group);
  }

  /** How dark it is, for the plankton: 0 by day, 1 at night. */
  setNight(strength: number) {
    this.glow.setNight(strength);
  }

  /** Whether there is any glowing to draw. */
  get glowing() {
    return this.glow.strength > 0.01;
  }

  /** The boat's lantern: how brightly it is lit, and where across the screen it hangs. */
  setLantern(strength: number, x: number) {
    this.lantern.value = strength;
    this.beamX.value = x;
  }

  /** Where the pointer is, in screen units, or null when it is not over the water. */
  setPointer(x: number | null, y = 0) {
    this.pointing = x !== null;
    if (x !== null) this.pointer.set(x, y);
  }

  /** Fully under, with nothing above the water level on screen. */
  get arrived() {
    return this.progress > 0.999;
  }

  /** Whether the water fills the whole screen, so nothing above it needs drawing. */
  get covering() {
    return this.reveal.value >= 1 && this.line.value > 1.02;
  }

  setSize(aspect: number, pixelHeight: number) {
    this.aspect = aspect;
    this.camera.right = aspect;
    this.camera.updateProjectionMatrix();
    this.plate.scale.set(aspect, 1, 1);
    (this.plate.material as THREE.ShaderMaterial).uniforms.uAspect.value = aspect;
    this.scale.value = pixelHeight;
    this.glow.setScale(pixelHeight);
  }

  /**
   * Send a fish off from one side of the screen, at some depth: koi anywhere in the middle
   * water, goldfish quick and up near the light, the bluegill slow and low by the floor.
   */
  private respawn(f: Swimmer, anywhere = false) {
    f.dir = Math.random() < 0.5 ? -1 : 1;
    if (f.kind === 'goldfish') {
      f.depth = Math.random() * 0.4;
      f.speed = (0.08 + Math.random() * 0.04) * (1 - 0.4 * f.depth);
      f.y = 0.6 + Math.random() * 0.15;
    } else if (f.kind === 'bluegill') {
      f.depth = Math.random() * 0.6;
      f.speed = 0.022 + Math.random() * 0.015;
      f.y = 0.08 + Math.random() * 0.1;
    } else {
      f.depth = Math.random();
      f.speed = (0.05 + Math.random() * 0.05) * (1 - 0.4 * f.depth);
      f.y = 0.22 + Math.random() * 0.5;
    }
    const length = this.lengthOf(f);
    f.x = anywhere ? Math.random() * this.aspect : f.dir > 0 ? -length : this.aspect + length;
    f.haze.value = 0.08 + 0.5 * f.depth;
    // Farther ones are drawn first, so nearer ones pass in front of them.
    f.mesh.renderOrder = f.depth < 0.3 ? 7 + (1 - f.depth) : 1 - f.depth;
  }

  private lengthOf(f: Swimmer) {
    return (0.24 - 0.12 * f.depth) * LENGTH[f.kind];
  }

  /** A bubble at a point given in screen units. */
  private bubble(x: number, y: number, size: number, speed: number) {
    const i = this.bubbleSlot;
    this.bubbleSlot = (this.bubbleSlot + 1) % BUBBLES;
    const position = this.bubbles.geometry.attributes.position as THREE.BufferAttribute;
    const sizes = this.bubbles.geometry.attributes.aSize as THREE.BufferAttribute;
    position.setXYZ(i, x, y - this.deep.position.y, 0);
    sizes.setX(i, size);
    this.bubbleSpeed[i] = speed;
    this.bubbleSway[i] = Math.random() * 6.28;
  }

  /**
   * How far the camera has gone, before easing: 0 at the surface, 1 fully under. The water
   * view fades in over the first stretch, while the camera has barely begun to sink.
   */
  /** How far down the water the view has gone, 0 just under the surface to 1 by the floor:
   * the light dims and the shafts fade the deeper it is. */
  setDescent(share: number) {
    this.depth.value = share;
  }

  setProgress(raw: number) {
    this.raw = raw;
    this.progress = easeInOut(Math.min(1, Math.max(0, (raw - 0.1) / 0.9)));
    this.reveal.value = smooth(raw / 0.35);
  }

  /** Put the water level and everything hanging from it where the scene above now is. */
  place({ line, plateHeight, lineEnd, toScreen, boat }: Placement) {
    this.lineEnd = lineEnd;
    this.line.value = line;
    this.plateHeight.value = plateHeight;
    this.deep.position.y = line - plateHeight;
    this.hull.matrix.multiplyMatrices(toScreen, boat);
  }

  /**
   * At night, whatever moves through the water lights it: a trail behind the pointer, and
   * wakes behind the fish.
   */
  private stirPlankton(dt: number, time: number) {
    const glow = this.glow;
    if (glow.strength > 0.01) {
      if (this.pointing) {
        if (this.hadPointer) {
          const moved = this.pointer.distanceTo(this.lastPointer);
          if (moved > 0.002) glow.spark(this.pointer.x, this.pointer.y, Math.min(10, Math.ceil(moved * 160)), 0.02, 0.06);
        }
        this.lastPointer.copy(this.pointer);
      }
      this.hadPointer = this.pointing;
      if (time > this.nextWake) {
        this.nextWake = time + 0.07;
        for (const f of this.swimmers) {
          const tail = f.x - f.dir * this.lengthOf(f) * 0.45;
          if (tail > -0.1 && tail < this.aspect + 0.1) glow.spark(tail, f.mesh.position.y + this.deep.position.y, 1, 0.02, 0.02);
        }
      }
    }
    glow.update(dt);
  }

  /** `diving` is true while heading down, which churns up bubbles under the surface. */
  update(dt: number, time: number, diving: boolean) {
    this.scene.visible = this.reveal.value > 0.001;
    if (!this.scene.visible) return;
    const plate = this.plateHeight.value;
    // How far the camera has sunk through the water, in screens.
    const travel = this.deep.position.y;
    this.motes.update(dt, time, travel, this.pointing ? this.pointer : null);
    this.nearReeds.update(travel);
    this.stirPlankton(dt, time);


    for (const f of this.swimmers) {
      const lead = f.lead;
      if (lead) {
        // Just behind and a little above the one in front, weaving a little on its own.
        f.dir = lead.dir;
        f.depth = lead.depth;
        f.speed = lead.speed;
        f.haze.value = lead.haze.value;
        f.mesh.renderOrder = lead.mesh.renderOrder - 0.01;
        f.x = lead.x - lead.dir * (this.lengthOf(lead) * 0.95 + Math.sin(time * 0.9 + f.seed) * 0.02);
        f.y = lead.y + 0.03 + Math.sin(time * 1.3 + f.seed) * 0.008;
      }
      const length = this.lengthOf(f);
      // The bluegill dawdles: it swims a little, slows almost to a stop, and goes on.
      const pace = f.kind === 'bluegill' ? 0.1 + 0.9 * THREE.MathUtils.smoothstep(Math.sin(time * 0.35 + f.seed), -0.3, 0.5) : 1;
      if (!lead) {
        f.x += f.dir * f.speed * pace * dt;
        // One with a follower goes round again only once the follower is off the screen too.
        const gone = this.swimmers.some((other) => other.lead === f) ? length * 2.3 : length;
        if ((f.dir > 0 && f.x > this.aspect + gone) || (f.dir < 0 && f.x < -gone)) this.respawn(f);
      }
      f.beat += dt * (6 + f.speed * pace * 40);
      f.strip.flex(f.beat, 0.09);
      f.mesh.position.set(f.x, f.y * plate + Math.sin(time * 0.7 + f.seed) * 0.012, 0);
      f.mesh.rotation.z = Math.cos(time * 0.7 + f.seed) * 0.05 * -f.dir;
      // Drawn facing left; turned round to swim right.
      f.mesh.scale.set(length * -f.dir, length, 1);
    }

    // Bubbles rise from the floor now and then, and a rush of them while going under.
    if (time > this.nextBubble) {
      const rush = diving && this.raw > 0.02 && this.raw < 0.9;
      const count = rush ? 4 : 1;
      const floor = this.deep.position.y;
      for (let n = 0; n < count; n++) {
        const x = Math.random() * this.aspect;
        const y = rush ? Math.min(1, this.line.value) - Math.random() * 0.45 : floor + Math.random() * 0.08;
        this.bubble(x, y, 0.008 + Math.random() * (rush ? 0.022 : 0.014), 0.12 + Math.random() * 0.2);
      }
      this.nextBubble = time + (rush ? 0.03 : 0.35 + Math.random() * 0.4);
    }
    const position = this.bubbles.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < BUBBLES; i++) {
      const y = position.getY(i);
      if (y >= HIDDEN) continue;
      const rise = y + this.bubbleSpeed[i] * dt;
      if (rise > plate + 0.02) {
        position.setY(i, HIDDEN);
        continue;
      }
      position.setXY(i, position.getX(i) + Math.sin(time * 2.4 + this.bubbleSway[i]) * 0.02 * dt, rise);
    }
    position.needsUpdate = true;
    (this.bubbles.geometry.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}
