import * as THREE from 'three';

// Glowing plankton for the night underwater, in the underwater pass's screen units. Anything
// that stirs the water at night lights it up for a moment: the pointer, the koi's tails, the
// hook, the cards as they swirl. The sparks give off their own light, so they are drawn after
// the night has darkened everything else, and added on top.

const COUNT = 700;
const HIDDEN = 1e6;

type Water = { uLine: { value: number }; uTime: { value: number } };

const vertex = /* glsl */ `
  attribute float aLife; // 1 when lit, falling to 0 as it fades
  attribute float aSize;
  attribute float aSeed;
  uniform float uScale;
  uniform float uTime;
  varying float vGlow;
  varying vec2 vScreen;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vScreen = world.xy;
    float flicker = 0.75 + 0.25 * sin(uTime * 17.0 + aSeed * 40.0);
    vGlow = pow(aLife, 1.6) * flicker;
    gl_PointSize = uScale * aSize * (0.6 + 0.4 * aLife);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragment = /* glsl */ `
  uniform float uLine;
  uniform float uTime;
  uniform float uNight;
  varying float vGlow;
  varying vec2 vScreen;
  void main() {
    if (vScreen.y > uLine + 0.004 * sin(vScreen.x * 9.0 + uTime * 2.1)) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float core = exp(-d * d * 14.0);
    float halo = exp(-d * d * 2.6) * 0.45;
    float a = (core + halo) * vGlow * uNight;
    // A white-hot middle in a cold blue-green light.
    vec3 color = mix(vec3(0.25, 0.85, 1.0), vec3(0.9, 1.0, 1.0), core);
    gl_FragColor = vec4(color * a, a);
  }
`;

export class Glow {
  readonly points: THREE.Points;
  private velocity = new Float32Array(COUNT * 2);
  private age = new Float32Array(COUNT);
  private span = new Float32Array(COUNT);
  private next = 0;
  private scale = { value: 800 };
  private night = { value: 0 };

  constructor(water: Water) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(COUNT * 3);
    const seeds = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 1] = HIDDEN;
      seeds[i] = Math.random();
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(new Float32Array(COUNT), 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(COUNT), 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uScale: this.scale, uNight: this.night, uLine: water.uLine, uTime: water.uTime },
        vertexShader: vertex,
        fragmentShader: fragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  /** How dark it is: the plankton only show at night. */
  get strength() {
    return this.night.value;
  }

  setNight(strength: number) {
    this.night.value = strength;
  }

  setScale(pixelHeight: number) {
    this.scale.value = pixelHeight;
  }

  /** Light up `count` specks around a point, thrown outwards at up to `speed`. */
  spark(x: number, y: number, count: number, spread: number, speed: number) {
    if (this.night.value <= 0.01) return;
    const position = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const size = this.points.geometry.attributes.aSize as THREE.BufferAttribute;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % COUNT;
      const angle = Math.random() * Math.PI * 2;
      const push = Math.random() * speed;
      position.setXYZ(i, x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread, 0);
      this.velocity[i * 2] = Math.cos(angle) * push;
      this.velocity[i * 2 + 1] = Math.sin(angle) * push;
      this.age[i] = 0;
      this.span[i] = 0.9 + Math.random() * 1.4;
      size.setX(i, 0.008 + Math.random() * 0.016);
    }
    size.needsUpdate = true;
  }

  update(dt: number) {
    const position = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const life = this.points.geometry.attributes.aLife as THREE.BufferAttribute;
    const drag = Math.exp(-dt * 2.5);
    for (let i = 0; i < COUNT; i++) {
      if (position.getY(i) >= HIDDEN) continue;
      this.age[i] += dt;
      const left = 1 - this.age[i] / this.span[i];
      if (left <= 0) {
        position.setY(i, HIDDEN);
        life.setX(i, 0);
        continue;
      }
      this.velocity[i * 2] *= drag;
      this.velocity[i * 2 + 1] = this.velocity[i * 2 + 1] * drag + 0.004 * dt;
      position.setXY(i, position.getX(i) + this.velocity[i * 2] * dt, position.getY(i) + this.velocity[i * 2 + 1] * dt);
      // Lit at once, then fading.
      life.setX(i, Math.min(1, this.age[i] * 12) * left);
    }
    position.needsUpdate = true;
    life.needsUpdate = true;
  }
}
