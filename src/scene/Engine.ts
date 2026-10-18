import * as THREE from 'three';
import manifest from './manifest.json';
import { Boat } from './boat';
import { Catch, type CatchKind, type CatchTextures } from './catch';
import { Droplets } from './droplets';
import type { Eyes } from './face';
import { School, type Species } from './fish';
import { Fishing, type Phase, type SoundName } from './fishing';
import { BOAT, HORIZON_Y, computeView, tagSpots, worldY, type View } from './layout';
import { Markers } from './markers';
import { Plants, type PlantTextures } from './plants';
import { EXPRESSIONS, Puppet, type Expression, type Part } from './puppet';
import { RippleSim } from './ripples';
import { REFLECT_LAYER, loadTexture, type SpriteShared } from './sprite';
import { Underwater } from './underwater';
import { lightAt, loopHour, moodOf, type Light } from './daylight';
import { Fireflies } from './fireflies';
import { Water } from './water';

const CATCH_PARTS = ['mirror', 'box', 'drawer', 'bottle', 'cork', 'note', 'globe', 'guitar'] as const;
const SIM_STEP = 1 / 60;
const MAX_PIXEL_RATIO = 2;
/**
 * A phone or small tablet: a touch screen no wider than a small tablet on its short side. It
 * draws at a little less than full sharpness and without the extra edge smoothing, which on a
 * small screen look the same and cost much less.
 */
const SMALL_TOUCH =
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches &&
  Math.min(window.screen.width, window.screen.height) < 820;
/** Seconds to go from the surface to fully under, or back. */
const DIVE_TIME = 1.6;

/** Every sound the scene makes: the fishing's own, and the night's. */
export type SceneSound = SoundName | 'twinkle' | 'meteor';

/** Where a project's tag should be drawn on the page, in CSS pixels, and how far it leans. */
export type TagPlacement = { x: number; y: number; tilt: number };

/** What the page is told every frame. */
export type SceneFrame = {
  phase: Phase;
  /** The project the line is cast at, if any. */
  selected: number | null;
  /** The project whose catch is sitting in the boat, if any. */
  caught: number | null;
  tags: TagPlacement[];
  /** Where the float is on the page, in CSS pixels. */
  float: { x: number; y: number };
  /** The top of the catch in the boat, in CSS pixels. */
  catch: { x: number; y: number };
  /** Whether a click on the water would now throw the catch in. */
  tossable: boolean;
  /** The light of the moment, in a word, for the page's own colours to follow. */
  mood: string;
  /** How far under the surface the view has gone: 0 at the surface, 1 fully under. */
  dive: number;
  /** How deep into the night it is: 0 by day, 1 at full night. */
  night: number;
};

/**
 * Owns the WebGL scene: the water, everything floating in it, and the frame loop.
 * The page drives it through methods; nothing in here touches the DOM beyond the canvas.
 */
export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  private shared: SpriteShared = { uMirror: { value: 0 }, uTime: { value: 0 } };
  private reflection: THREE.WebGLRenderTarget;
  private ripples: RippleSim;
  private view: View = computeView(1.5);

  private water?: Water;
  private boat?: Boat;
  private plants?: Plants;
  private puppet?: Puppet;
  private fishing?: Fishing;
  private markers?: Markers;
  private droplets?: Droplets;
  private haul?: Catch;
  private school?: School;
  private underwater?: Underwater;
  /** Where the dive is headed (0 or 1), and how far along it is, before easing. */
  private diveTo = 0;
  private diveAt = 0;
  /** How far the camera has sunk below its place at the surface, in world units. */
  private sink = 0;
  private toScreen = new THREE.Matrix4();
  private shiftMatrix = new THREE.Matrix4();
  private lastPhase: Phase = 'idle';
  private caught: number | null = null;
  private landedAt = -10;
  private opened = false;
  /** Whether the catch in the boat has had its case study opened. Only then can a stray
   * click on the water throw it away. */
  private read = false;
  /** Called whenever something in the scene makes a noise; `pan` is from -1 (left) to 1 (right). */
  onSound: ((name: SceneSound, amount?: number, pan?: number) => void) | null = null;
  /** Called when the visitor clicks the catch sitting in the boat. */
  onCatchClick: (() => void) | null = null;
  /** The time of day, and the passes that apply it: a grade over the whole picture, with the
   * lantern's glow, and then the fireflies on top, which make their own light. */
  private light: Light = lightAt(12);
  /** Whether the pond runs through its own day, or holds one fixed hour. */
  private cycling = true;
  private frameTarget: THREE.WebGLRenderTarget;
  private grade: THREE.Mesh;
  private gradeScene = new THREE.Scene();
  private flatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private glowScene = new THREE.Scene();
  private fireflies?: Fireflies;
  private lanternAt = new THREE.Vector3();
  /** The shooting star crossing the sky, if any, and when the next may come. */
  private meteor: { x: number; y: number; dx: number; dy: number; travel: number; length: number; clock: number } | null = null;
  private nextMeteor = 8;
  private nextTwinkle = 0;
  private calm = false;
  private selected: number | null = null;
  private hovered: number | null = null;
  private pointerAt = -10;
  private listeners = new Set<(frame: SceneFrame) => void>();
  private report: SceneFrame;
  private mast = new THREE.Vector2();

  private frame = 0;
  private last = 0;
  private time = 0;
  private simDebt = 0;
  private nextHullRing = 1;
  private nextStrayRing = 3;
  private pointer: { x: number; y: number } | null = null;
  private disposed = false;
  private observer: ResizeObserver;

  /** `catches` lists, in project order, the object each project comes up as. */
  constructor(
    private canvas: HTMLCanvasElement,
    private catches: CatchKind[],
  ) {
    THREE.ColorManagement.enabled = false;
    this.report = {
      phase: 'idle',
      selected: null,
      caught: null,
      tags: catches.map(() => ({ x: 0, y: 0, tilt: 0 })),
      float: { x: 0, y: 0 },
      catch: { x: 0, y: 0 },
      tossable: false,
      mood: 'day',
      dive: 0,
      night: 0,
    };
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.reflection = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false });
    this.frameTarget = new THREE.WebGLRenderTarget(2, 2, { depthBuffer: false, stencilBuffer: false, samples: SMALL_TOUCH ? 0 : 4 });
    this.grade = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: {
          map: { value: this.frameTarget.texture },
          uTint: { value: new THREE.Vector3(1, 1, 1) },
          uSaturation: { value: 1 },
          uLantern: { value: new THREE.Vector2(0.8, 0.5) },
          uGlow: { value: 0 },
          uAspect: { value: 1.5 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = vec4(position.xy, 0.0, 1.0);
          }
        `,
        // The light of the hour over everything, and the lantern's warm glow around it.
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform vec3 uTint;
          uniform float uSaturation;
          uniform vec2 uLantern;
          uniform float uGlow;
          uniform float uAspect;
          varying vec2 vUv;
          void main() {
            vec4 frame = texture2D(map, vUv);
            vec3 color = frame.rgb;
            float grey = dot(color, vec3(0.299, 0.587, 0.114));
            color = mix(vec3(grey), color, uSaturation) * uTint;
            // A shooting star, if the water marked one here: light of its own, added untinted.
            // Nothing ever leaves the frame emptier than a quarter, so emptier still means unmarked.
            color += vec3(1.0, 0.96, 0.88) * (1.0 - frame.a) * 4.0 * step(0.125, frame.a);
            vec2 d = (vUv - uLantern) * vec2(uAspect, 1.0);
            float r = dot(d, d);
            color += vec3(1.0, 0.72, 0.38) * uGlow * (exp(-r / 0.0012) * 0.55 + exp(-r / 0.02) * 0.22);
            gl_FragColor = vec4(color, 1.0);
          }
        `,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.grade.frustumCulled = false;
    this.gradeScene.add(this.grade);
    this.ripples = new RippleSim(this.renderer);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();

    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.load().then(() => {
      if (this.disposed) return;
      this.resize();
      this.start();
    });
  }

  private async load() {
    const loader = new THREE.TextureLoader();
    const sized = async (entry: { file: string; w: number; h: number }) => ({
      texture: await loadTexture(loader, entry.file),
      w: entry.w,
      h: entry.h,
    });
    const [plate, boat, boatFront, reeds, pads, stones, torso, neck, armFar, armNear, heads, caught, fish, depths] = await Promise.all([
      loadTexture(loader, manifest.water.file, true),
      sized(manifest.boat),
      sized(manifest.boatFront),
      Promise.all(manifest.reeds.map(sized)),
      Promise.all(manifest.pads.map(sized)),
      Promise.all(manifest.stones.map(sized)),
      sized(manifest.torso),
      sized(manifest.neck),
      sized(manifest.armFar),
      sized(manifest.armNear),
      Promise.all(EXPRESSIONS.map((name) => sized(manifest.heads[name]))),
      Promise.all(CATCH_PARTS.map((name) => sized(manifest.catches[name]))),
      Promise.all(manifest.fish.map(async (entry) => ({ ...(await sized(entry)), kind: entry.kind as Species }))),
      loadTexture(loader, manifest.underwater.file, true),
    ]);
    const eyes = {} as Record<Expression, Eyes | null>;
    await Promise.all(
      EXPRESSIONS.map(async (name) => {
        const entry = (manifest.eyes as Record<string, { file: string; left: number[]; right: number[] } | null>)[name];
        eyes[name] = entry && {
          mask: await loadTexture(loader, entry.file, true),
          left: entry.left as unknown as Eyes['left'],
          right: entry.right as unknown as Eyes['right'],
        };
      }),
    );
    if (this.disposed) return;

    this.water = new Water(
      plate,
      this.ripples.texture,
      new THREE.Vector2(this.ripples.width, this.ripples.height),
      this.reflection.texture,
      this.shared.uTime,
    );
    this.boat = new Boat(boat.texture, boatFront.texture, boat, this.shared);
    const expressions = Object.fromEntries(EXPRESSIONS.map((name, i) => [name, heads[i]])) as Record<Expression, Part>;
    this.puppet = new Puppet({ heads: expressions, eyes, torso, neck, armFar, armNear }, this.shared, this.boat);
    const textures: PlantTextures = { reeds, pads, stones };
    this.plants = new Plants(textures, this.shared, this.boat.waterY);
    this.markers = new Markers(this.catches.length, this.shared);

    const ripple = (x: number, y: number, radius: number, strength: number) => this.ripple(x, y, radius, strength);
    const sound = (name: SoundName, amount?: number) => this.onSound?.(name, amount);
    this.droplets = new Droplets((x, y, radius, strength) => {
      ripple(x, y, radius, strength);
      sound('drip');
    });
    const catchTextures = Object.fromEntries(CATCH_PARTS.map((name, i) => [name, caught[i]])) as CatchTextures;
    this.haul = new Catch(catchTextures, this.shared, this.droplets, (x, y, weight) => {
      // Something heavy going back into the water.
      this.school?.scare(x, y, 260, 1.2);
      this.ripple(x, y, 0.08, -0.9);
      this.droplets!.burst(x, y, Math.round(20 * weight), 440, 36);
      sound('splash', weight);
    });
    this.fishing = new Fishing(this.shared, this.boat, this.haul, this.droplets, {
      ripple,
      sound,
      onLand: () => {
        this.read = false;
        this.caught = this.selected;
        this.selected = null;
        this.landedAt = this.time;
        for (const end of this.boat!.hullEnds) this.ripple(end, this.boat!.waterY - 4, 0.07, 0.45);
      },
    });
    this.school = new School(
      fish,
      this.shared,
      { plate, sim: this.ripples.texture, simSize: new THREE.Vector2(this.ripples.width, this.ripples.height) },
      this.boat,
      this.droplets,
      { ripple, sound },
      this.catches.length,
      (this.calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    );
    this.underwater = new Underwater(
      depths,
      manifest.underwater,
      fish,
      { texture: boat.texture, width: boat.w * BOAT.scale, height: boat.h * BOAT.scale },
      reeds,
      this.shared.uTime,
    );
    // The hour may have been set before the water was ready.
    this.water.setLight(this.light);
    this.fireflies = new Fireflies(this.shared.uTime);
    this.glowScene.add(this.fireflies.points);
    this.fishing.line.mesh.renderOrder = 1.5;
    this.fishing.float.renderOrder = 1.6;
    this.scene.add(
      this.water.mesh,
      this.plants.group,
      this.boat.group,
      this.markers.group,
      this.school.group,
      this.haul.group,
      this.fishing.line.mesh,
      this.fishing.float,
      this.droplets.points,
    );
  }

  /** Be told about every frame; returns a function that stops the updates. */
  subscribe(listener: (frame: SceneFrame) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Tell the scene which project's tag the visitor is pointing at, so he can look at it. */
  look(index: number | null) {
    this.hovered = index;
  }

  /**
   * The visitor picked a project's tag. Cast at it; or, if its catch is already in the
   * boat or the line is already there, put things back. A catch in the boat is always
   * thrown back before the next cast.
   */
  cast(index: number) {
    if (!this.fishing || !this.markers) return;
    const { phase } = this.fishing;
    if (phase !== 'idle' && phase !== 'waiting') return;
    if (phase === 'waiting' && index === this.selected) {
      this.fishing.reelIn();
      this.selected = null;
      return;
    }
    const held = this.caught;
    if (held !== null) {
      const home = this.markers.spot(held);
      this.fishing.tossBack(home.x + 26, home.y - 5);
      this.caught = null;
      if (held === index) return;
    }
    // Land a little to the side of the buoy, so the float and the cork do not overlap.
    const spot = this.markers.spot(index);
    this.fishing.cast(spot.x + 26, spot.y - 5, this.catches[index]);
    this.selected = index;
  }

  /**
   * Put a project's catch straight into the boat, without fishing for it. Returns whether
   * it is there now; it cannot be done while the line is in use.
   */
  place(index: number) {
    if (!this.fishing || !this.boat) return false;
    if (this.caught === index) return true;
    if (!this.fishing.place(this.catches[index], this.boat, this.time)) return false;
    this.read = false;
    this.caught = index;
    this.selected = null;
    return true;
  }

  /** Open the catch in the boat to show its project, or close it again. */
  setOpen(open: boolean) {
    if (open !== this.opened && this.haul) {
      this.onSound?.('paper', open ? 1 : 0.6);
      if (open && this.haul.kind === 'bottle') this.onSound?.('pop');
    }
    this.opened = open;
    this.haul?.setOpen(open);
    if (open) this.read = true;
  }

  /** Whether a point in the world is open water, as opposed to sky or the boat. */
  private isWater(x: number, y: number) {
    const boat = this.boat!;
    const onBoat = x > boat.hullEnds[0] - 30 && x < boat.hullEnds[1] + 30 && y > boat.waterY;
    return y < worldY(HORIZON_Y) - 14 && !onBoat;
  }

  /**
   * The project library page is open (or closed again). It is laid over open water: the view
   * dives under the surface while it is open, and comes back up when it closes.
   */
  browse(on: boolean) {
    this.diveTo = on ? 1 : 0;
    if (!on) this.descentTo = 0;
  }

  /**
   * How deep the library has taken the view: 0 just under the surface, 1 down by the floor.
   * The camera sinks there smoothly, and the light dims on the way.
   */
  private descent = 0;
  private descentTo = 0;
  setLibraryDepth(share: number) {
    this.descentTo = Math.min(1, Math.max(0, share));
  }

  /** Hold the pond at one hour of the day, instead of letting its day run. */
  fixHour(hour: number) {
    this.cycling = false;
    this.setLight(lightAt(hour));
  }

  /** Light the pond for an hour of the day. */
  setLight(light: Light) {
    this.light = light;
    this.water?.setLight(light);
    const u = (this.grade.material as THREE.ShaderMaterial).uniforms;
    (u.uTint.value as THREE.Vector3).fromArray(light.tint);
    u.uSaturation.value = light.saturation;
  }

  /** The visitor pulls on a bite. */
  pull() {
    this.fishing?.haul();
  }

  private resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, SMALL_TOUCH ? 1.5 : MAX_PIXEL_RATIO);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.reflection.setSize(Math.ceil((width * ratio) / 2), Math.ceil((height * ratio) / 2));
    this.frameTarget.setSize(Math.ceil(width * ratio), Math.ceil(height * ratio));
    ((this.grade.material as THREE.ShaderMaterial).uniforms.uAspect as { value: number }).value = width / height;
    this.fireflies?.setScale(height * ratio);

    this.view = computeView(width / height);
    const { left, right, top, bottom } = this.view;
    this.camera.left = left;
    this.camera.right = right;
    this.camera.top = top;
    this.camera.bottom = bottom;
    this.camera.updateProjectionMatrix();

    this.ripples.setAspect(this.view.width / (worldY(HORIZON_Y) - bottom));
    this.ripples.clear();
    this.water?.setView(this.view);
    this.plants?.setView(this.view);
    this.markers?.place(tagSpots(this.view, height));
    if (this.markers) this.school?.setView(this.view, this.catches.map((_, i) => this.markers!.spot(i)));
    this.droplets?.setScale((height * ratio) / this.view.height);
    this.underwater?.setSize(width / height, height * ratio);
  }

  /** Convert a world position to the ripple field's coordinates and disturb the water there. */
  private ripple(x: number, y: number, radius: number, strength: number) {
    const horizon = worldY(HORIZON_Y);
    const u = (x - this.view.left) / this.view.width;
    const v = (y - this.view.bottom) / (horizon - this.view.bottom);
    this.ripples.drop(u, v, radius, strength);
  }

  private toWorld(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.view.left + ((event.clientX - rect.left) / rect.width) * this.view.width,
      y: this.view.top - ((event.clientY - rect.top) / rect.height) * this.view.height,
    };
  }

  private onPointerMove = (event: PointerEvent) => {
    if (this.underwater && this.underwater.progress > 0.02) {
      const rect = this.canvas.getBoundingClientRect();
      this.underwater.setPointer((event.clientX - rect.left) / rect.height, 1 - (event.clientY - rect.top) / rect.height);
      return;
    }
    const point = this.toWorld(event);
    if (this.pointer) {
      const travelled = Math.hypot(point.x - this.pointer.x, point.y - this.pointer.y);
      if (travelled > 0.5) this.ripple(point.x, point.y, 0.055, -Math.min(travelled / 22, 1) * 0.45);
    } else {
      this.ripple(point.x, point.y, 0.055, -0.45);
    }
    this.pointer = point;
    this.pointerAt = this.time;
  };

  /** A catch that has been read can be thrown back with a click on the water. */
  private get tossable() {
    return this.caught !== null && this.read && !this.opened && this.fishing?.phase === 'idle';
  }

  /** A click or tap on the water also pulls, when something is on the line. */
  private onPointerDown = (event: PointerEvent) => {
    // Below the surface, the boat and the water above are out of reach.
    if (this.underwater && this.underwater.progress > 0.02) return;
    this.onPointerMove(event);
    if (this.pointer) this.school?.scare(this.pointer.x, this.pointer.y, 150, 0.8);
    if (this.fishing?.phase === 'hooked') this.pull();
    else if (this.pointer && this.fishing?.phase === 'idle' && this.haul?.contains(this.pointer.x, this.pointer.y)) {
      this.onCatchClick?.();
    } else if (this.pointer && this.tossable && this.isWater(this.pointer.x, this.pointer.y)) {
      // Done with it: throw it in where the visitor points.
      this.fishing!.tossBack(this.pointer.x, this.pointer.y);
      this.caught = null;
      this.read = false;
    }
  };

  private onPointerLeave = () => {
    this.underwater?.setPointer(null);
    this.pointer = null;
  };

  private onVisibility = () => {
    if (document.hidden) this.stop();
    else if (!this.paused) this.start();
  };

  /**
   * A note was left in the shell: a bubble pops at the surface beside the boat, and he is
   * delighted for a moment and pumps his fists.
   */
  thank() {
    const boat = this.boat;
    if (!boat || !this.fishing) return;
    const x = boat.hullEnds[1] + 70, y = boat.waterY - 6;
    this.ripple(x, y, 0.06, 0.7);
    this.droplets?.burst(x, y, 10, 260, 20);
    this.fishing.cheer(this.time, 3);
  }

  /** Where on the screen, at the surface, the thank-you bubble pops: just past the boat's bow. */
  thanksPoint() {
    const boat = this.boat;
    if (!boat) return null;
    const x = boat.hullEnds[1] + 70, y = boat.waterY - 6;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((x - this.view.left) / this.view.width) * rect.width,
      y: rect.top + (1 - (y - this.view.bottom) / this.view.height) * rect.height,
    };
  }

  /** While a page covers the whole pond, there is no need to draw it. */
  private paused = false;
  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.stop();
    else this.start();
  }

  private start() {
    if (this.frame || this.disposed || !this.water) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.time += dt;
    this.shared.uTime.value = this.time;
    this.update(dt);
    this.render();
    // Paused, it still draws this one frame, so the page knows the scene is ready behind it.
    if (this.paused) this.stop();
  };

  private update(dt: number) {
    const boat = this.boat!;
    boat.update(dt, this.time);
    const fishing = this.fishing!;
    this.aimGaze(boat, fishing);
    this.puppet!.update(dt, this.time, boat, fishing.pull);
    fishing.update(dt, this.time, this.puppet!, boat);
    this.haul!.update(dt, this.time, boat);
    this.directFish(fishing);
    this.school!.update(dt, this.time, this.pointer && this.time - this.pointerAt < 0.35 ? this.pointer : null);
    this.droplets!.update(dt);
    this.markers!.update(this.time);
    this.plants!.update(this.time);

    // The hull sheds a soft ring from one end, then the other, as it rides the swell.
    if (this.time > this.nextHullRing) {
      const end = boat.hullEnds[Math.floor(this.time) % 2];
      this.ripple(end, boat.waterY - 4, 0.05, 0.1 + Math.abs(boat.verticalSpeed) * 0.02);
      this.nextHullRing = this.time + 1.3 + Math.random() * 0.8;
    }
    // Now and then something small touches the surface somewhere.
    if (this.time > this.nextStrayRing) {
      const x = this.view.left + Math.random() * this.view.width;
      const y = this.view.bottom + Math.random() * (worldY(HORIZON_Y) - this.view.bottom) * 0.7;
      this.ripple(x, y, 0.025, -0.22);
      this.nextStrayRing = this.time + 2.5 + Math.random() * 3;
    }

    this.simDebt = Math.min(this.simDebt + dt, SIM_STEP * 3);
    while (this.simDebt >= SIM_STEP) {
      this.ripples.step();
      this.simDebt -= SIM_STEP;
    }
    this.water!.setSim(this.ripples.texture);
    this.school!.setSim(this.ripples.texture);

    const step = dt / DIVE_TIME;
    const heading = this.diveTo > this.diveAt;
    this.diveAt += Math.max(-step, Math.min(step, this.diveTo - this.diveAt));
    this.placeDive(heading, dt);
    if (this.cycling) this.setLight(lightAt(loopHour(this.time)));
    this.placeLantern(dt);
    this.notify();
  }

  /** Tell the fish what the line is doing, so they can take an interest in it. */
  private directFish(fishing: Fishing) {
    const school = this.school!;
    const { phase } = fishing;
    const float = fishing.float.position;
    if (phase !== this.lastPhase) {
      if (phase === 'waiting' && this.selected !== null) school.lure(this.selected, float.x, float.y);
      else if (phase === 'bite') school.bite();
      else if (phase === 'pulling') school.flee();
      else if (phase === 'reeling' || phase === 'idle') school.release();
      this.lastPhase = phase;
    }
    if (phase === 'waiting' || phase === 'bite' || phase === 'hooked') school.follow(float.x, float.y, fishing.tug);
  }

  /**
   * Decide what he watches: whatever is on the line, then a catch just landed or thrown,
   * then a leaping fish, then a hovered tag, then the cursor, and otherwise the water.
   */
  private aimGaze(boat: Boat, fishing: Fishing) {
    const gaze = this.puppet!.gaze;
    const haul = this.haul!;
    if (this.opened) {
      // The case study is open over the middle of the page: he reads along.
      gaze.set(this.view.left + this.view.width * 0.5, this.view.bottom + this.view.height * 0.5);
    } else if (fishing.phase === 'tossing' || (haul.mode === 'boat' && this.time - this.landedAt < 3)) {
      haul.centre(gaze);
    } else if (fishing.phase !== 'idle') {
      gaze.set(fishing.float.position.x, fishing.float.position.y);
    } else if (this.school!.watch(gaze)) {
      // A fish is out of the water: that is what he came for.
    } else if (this.hovered !== null) {
      this.markers!.mastTop(this.hovered, gaze);
    } else if (this.pointer && this.time - this.pointerAt < 2.5) {
      gaze.set(this.pointer.x, this.pointer.y);
    } else {
      gaze.set(boat.group.position.x - 480 + Math.sin(this.time * 0.31) * 140, boat.waterY - 10);
    }
  }

  /**
   * Diving is one camera move through one world. The underwater painting hangs from the
   * pond's water level, at the boat's waterline, as wide as the view; the camera sinks until
   * it is looking at the painting alone. Above the water level the scene is drawn as ever,
   * below it the water, so both move together and the surface stays where the boat floats.
   */
  private placeDive(heading: boolean, dt: number) {
    const under = this.underwater!;
    const view = this.view;
    const level = this.boat!.waterY;
    under.setProgress(this.diveAt);
    // The painting is taller than the screen: the camera sinks to just under the surface, where
    // the light still comes down through the water, and on down as the library goes deeper.
    this.descent = this.calm ? this.descentTo : this.descent + (this.descentTo - this.descent) * Math.min(1, dt * 1.6);
    under.setDescent(this.descent);
    const depth = Math.max(view.height * 1.75, view.width / under.plateAspect);
    const lineEnd = 1.06 + (depth / view.height - 1.06) * this.descent;
    const bottom = view.bottom - (this.sink = (view.bottom - (level - lineEnd * view.height)) * under.progress);
    this.toScreen.makeScale(1 / view.height, 1 / view.height, 1).multiply(this.shiftMatrix.makeTranslation(-view.left, -bottom, 0));
    this.boat!.group.updateMatrixWorld();
    under.place({
      line: (level - bottom) / view.height,
      plateHeight: depth / view.height,
      lineEnd,
      toScreen: this.toScreen,
      boat: this.boat!.group.matrixWorld,
    });
    under.update(dt, this.time, heading);
  }

  /** Where the boat's lantern is on screen, for its glow above water and its beam below. */
  private placeLantern(dt: number) {
    const boat = this.boat!;
    // The lantern on the stern bench, in the boat's own frame.
    this.lanternAt.set(464, 81, 0).applyMatrix4(boat.group.matrixWorld);
    const bottom = this.view.bottom - this.sink;
    const u = (this.grade.material as THREE.ShaderMaterial).uniforms;
    (u.uLantern.value as THREE.Vector2).set(
      (this.lanternAt.x - this.view.left) / this.view.width,
      (this.lanternAt.y - bottom) / this.view.height,
    );
    // A flame: it flickers.
    const flicker = 0.9 + 0.06 * Math.sin(this.time * 13) + 0.04 * Math.sin(this.time * 31);
    u.uGlow.value = this.light.lantern * flicker;
    this.underwater!.setLantern(this.light.lantern * flicker, (this.lanternAt.x - this.view.left) / this.view.height);
    this.underwater!.setNight(Math.max(0, (this.light.stars - 0.2) / 0.8));
    const flared = this.fireflies!.update(dt, this.light.lantern, this.view);
    // Now and then one of them, lighting up, makes a tiny chime from where it is.
    if (flared !== null && this.time > this.nextTwinkle && this.diveAt < 0.1) {
      this.onSound?.('twinkle', this.fireflies!.brightness, (flared * 2 - 1) * 0.8);
      this.nextTwinkle = this.time + 2 + Math.random() * 2.2;
    }
    this.flyMeteor(dt);
  }

  /**
   * Once or twice a night, a shooting star streaks down across the sky and burns out. The
   * first comes a few seconds after full dark; never for anyone who asked for less motion.
   */
  private flyMeteor(dt: number) {
    const night = this.light.stars;
    const view = this.view;
    if (!this.meteor) {
      if (night < 0.75) this.nextMeteor = this.time + 4 + Math.random() * 6;
      else if (this.time > this.nextMeteor && !this.calm && this.diveAt < 0.02) {
        const horizon = worldY(HORIZON_Y);
        const share = 0.15 + Math.random() * 0.6;
        // Away from the side it starts on, falling at a shallow angle.
        const way = share > 0.5 ? -1 : 1;
        const angle = (20 + Math.random() * 15) * (Math.PI / 180);
        const travel = view.width * (0.18 + Math.random() * 0.12);
        this.meteor = {
          x: view.left + share * view.width,
          y: horizon + (view.top - horizon) * (0.74 + Math.random() * 0.18),
          dx: Math.cos(angle) * way,
          dy: -Math.sin(angle),
          travel,
          length: 0.9 + Math.random() * 0.4,
          clock: 0,
        };
        this.onSound?.('meteor', 1, (share + way * 0.1) * 2 - 1);
        this.nextMeteor = this.time + 10 + Math.random() * 8;
      }
      return;
    }
    const m = this.meteor;
    m.clock += dt;
    const t = m.clock / m.length;
    if (t >= 1 || this.diveAt > 0.05) {
      this.meteor = null;
      this.water!.setMeteor(0, 0, 1, 0, 0, 0);
      return;
    }
    // It speeds up a little as it falls, flares in, and fades out over its last stretch.
    const along = m.travel * (0.8 * t + 0.2 * t * t);
    const brightness = Math.min(1, t / 0.08) * (1 - Math.max(0, (t - 0.6) / 0.4) ** 1.5) * Math.min(1, night * 1.2);
    this.water!.setMeteor(m.x + m.dx * along, m.y + m.dy * along, m.dx, m.dy, Math.min(along, m.travel * 0.45), brightness);
  }

  /** Tell the page where each tag hangs this frame, and what the fishing is doing. */
  private notify() {
    if (!this.listeners.size) return;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    this.report.tags.forEach((tag, i) => {
      tag.tilt = this.markers!.mastTop(i, this.mast);
      tag.x = ((this.mast.x - this.view.left) / this.view.width) * width;
      tag.y = ((this.view.top - this.mast.y) / this.view.height) * height;
    });
    const float = this.fishing!.float.position;
    this.report.float.x = ((float.x - this.view.left) / this.view.width) * width;
    this.report.float.y = ((this.view.top - float.y) / this.view.height) * height;
    const top = this.haul!.group.position;
    this.report.catch.x = ((top.x - this.view.left) / this.view.width) * width;
    this.report.catch.y = ((this.view.top - top.y) / this.view.height) * height;
    this.report.phase = this.fishing!.phase;
    this.report.selected = this.selected;
    this.report.caught = this.caught;
    this.report.tossable = this.tossable;
    this.report.mood = moodOf(this.light);
    this.report.dive = this.diveAt;
    this.report.night = this.light.stars;
    for (const listener of this.listeners) listener(this.report);
  }

  private render() {
    const under = this.underwater!;
    // By plain day the picture is drawn as it is; at any other hour it is drawn first into a
    // frame of its own, then laid on the screen through the light of the hour.
    const light = this.light;
    const graded =
      light.lantern > 0.01 || light.saturation !== 1 || light.tint.some((v) => Math.abs(v - 1) > 0.005);
    const target = graded ? this.frameTarget : null;
    if (under.covering) {
      // Nothing above the surface can be seen: draw only what is below it.
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(under.scene, under.camera);
      this.finish(graded, false);
      return;
    }
    this.camera.top = this.view.top - this.sink;
    this.camera.bottom = this.view.bottom - this.sink;
    this.camera.updateProjectionMatrix();
    this.water!.setLens(this.view.left, this.camera.bottom, this.view.width, this.view.height);

    // First the scene mirrored about each object's own waterline, for the water to sample.
    this.shared.uMirror.value = 1;
    this.camera.layers.set(REFLECT_LAYER);
    this.renderer.setRenderTarget(this.reflection);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    this.shared.uMirror.value = 0;
    this.camera.layers.set(0);
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);

    if (under.scene.visible) {
      this.renderer.autoClear = false;
      this.renderer.render(under.scene, under.camera);
      this.renderer.autoClear = true;
    }
    this.finish(graded, true);
  }

  /** Lay the graded picture on the screen, then anything that gives off its own light. */
  private finish(graded: boolean, surface: boolean) {
    if (graded) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.gradeScene, this.flatCamera);
    }
    const under = this.underwater!;
    if (under.scene.visible && under.glowing) {
      this.renderer.autoClear = false;
      this.renderer.render(under.glowScene, under.camera);
      this.renderer.autoClear = true;
    }
    if (surface && this.light.lantern > 0.05) {
      this.renderer.autoClear = false;
      this.renderer.render(this.glowScene, this.camera);
      this.renderer.autoClear = true;
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
    this.observer.disconnect();
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material as THREE.ShaderMaterial;
        for (const uniform of Object.values(material.uniforms ?? {})) {
          if (uniform.value instanceof THREE.Texture) uniform.value.dispose();
        }
        material.dispose();
      }
    });
    this.reflection.dispose();
    this.frameTarget.dispose();
    this.ripples.dispose();
    this.renderer.dispose();
  }
}
