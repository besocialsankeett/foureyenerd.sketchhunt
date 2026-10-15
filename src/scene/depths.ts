import * as THREE from 'three';
import type { Part } from './puppet';

// Things that give the water its depth, drawn in the underwater pass's screen units (y from 0
// at the bottom to 1 at the top). They hang at different distances from the camera, so as it
// sinks they slide past at different speeds: the nearer, the faster.

type Water = { uLine: { value: number }; uTime: { value: number }; uReveal: { value: number } };

const WATERLINE = /* glsl */ `
  uniform float uLine;
  uniform float uTime;
  uniform float uReveal;
  float waterline(float x) {
    return uLine + 0.004 * sin(x * 9.0 + uTime * 2.1) + 0.002 * sin(x * 23.0 - uTime * 3.3);
  }
`;

const moteVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec2 vScreen;
  varying float vAlpha;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vScreen = world.xy;
    vAlpha = aAlpha;
    gl_PointSize = aSize * uScale;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// A speck drifting in the water, softer the nearer it is: the near ones are out of focus.
const moteFragment = /* glsl */ `
  varying vec2 vScreen;
  varying float vAlpha;
  ${WATERLINE}
  void main() {
    if (vScreen.y > waterline(vScreen.x)) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-d * d * 3.5) * smoothstep(1.0, 0.8, d) * vAlpha * uReveal;
    gl_FragColor = vec4(vec3(0.86, 0.96, 1.0) * a, a);
  }
`;

/** One band of distance: how many specks, how big, how clear, how fast they pass. */
type Band = { count: number; size: [number, number]; alpha: number; parallax: number };
const BANDS: Band[] = [
  { count: 90, size: [0.0024, 0.0045], alpha: 0.45, parallax: 0.55 },
  { count: 70, size: [0.005, 0.009], alpha: 0.6, parallax: 1 },
  { count: 16, size: [0.016, 0.028], alpha: 0.22, parallax: 1.7 },
];
/** The specks live in a column this many screens tall, repeating, so they never run out. */
const SPAN = 1.5;

/**
 * Specks suspended in the water at three distances. The farthest two bands are drawn behind
 * the library's cards, the nearest in front. The pointer stirs them like a hand in water.
 */
export class Motes {
  readonly back: THREE.Points;
  readonly front: THREE.Points;
  private sets: { points: THREE.Points; base: Float32Array; push: Float32Array; band: Uint8Array }[] = [];
  private scale = { value: 800 };
  private aspect = 1.5;

  constructor(water: Water) {
    const build = (bands: Band[], indices: number[]) => {
      const count = bands.reduce((sum, b) => sum + b.count, 0);
      const base = new Float32Array(count * 3); // x, y, drift phase
      const band = new Uint8Array(count);
      const sizes = new Float32Array(count);
      const alphas = new Float32Array(count);
      let i = 0;
      bands.forEach((b, n) => {
        for (let k = 0; k < b.count; k++, i++) {
          base.set([Math.random(), Math.random() * SPAN, Math.random() * 6.28], i * 3);
          band[i] = indices[n];
          sizes[i] = b.size[0] + Math.random() * (b.size[1] - b.size[0]);
          alphas[i] = b.alpha * (0.6 + Math.random() * 0.4);
        }
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
      const points = new THREE.Points(
        geometry,
        new THREE.ShaderMaterial({
          uniforms: { uScale: this.scale, ...water },
          vertexShader: moteVertex,
          fragmentShader: moteFragment,
          transparent: true,
          premultipliedAlpha: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      points.frustumCulled = false;
      this.sets.push({ points, base, push: new Float32Array(count * 2), band });
      return points;
    };
    this.back = build(BANDS.slice(0, 2), [0, 1]);
    this.front = build(BANDS.slice(2), [2]);
    this.back.renderOrder = 3;
    this.front.renderOrder = 9;
  }

  setSize(aspect: number, pixelHeight: number) {
    this.aspect = aspect;
    this.scale.value = pixelHeight;
  }

  /** `travel` is how far the camera has sunk, in screens; `pointer` is in screen units. */
  update(dt: number, time: number, travel: number, pointer: THREE.Vector2 | null) {
    for (const { points, base, push, band } of this.sets) {
      const position = points.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < band.length; i++) {
        const b = BANDS[band[i]];
        const phase = base[i * 3 + 2];
        // They rise very slowly on their own, and slide past as the camera sinks.
        let y = (base[i * 3 + 1] + travel * b.parallax + time * 0.006 * (1 + b.parallax)) % SPAN;
        if (y < 0) y += SPAN;
        y -= (SPAN - 1) / 2;
        let x = base[i * 3] * this.aspect + Math.sin(time * 0.21 + phase) * 0.012 * b.parallax;
        if (pointer) {
          const dx = x + push[i * 2] - pointer.x, dy = y + push[i * 2 + 1] - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < 0.14 && d > 1e-4) {
            const shove = (1 - d / 0.14) * 0.5 * dt * b.parallax;
            push[i * 2] += (dx / d) * shove;
            push[i * 2 + 1] += (dy / d) * shove;
          }
        }
        // Stirred specks drift back as the water stills.
        const settle = Math.exp(-dt * 0.9);
        push[i * 2] *= settle;
        push[i * 2 + 1] *= settle;
        x += push[i * 2];
        y += push[i * 2 + 1];
        position.setXYZ(i, x, y, 0);
      }
      position.needsUpdate = true;
    }
  }
}

const reedVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  varying vec2 vUv;
  varying vec2 vScreen;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.x += sin(uTime * 0.7 + uSway) * 0.06 * uv.y * uv.y;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vScreen = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// A reed right in front of the camera: out of focus, in the water's shade, its foot fading
// away rather than ending in a cut.
const reedFragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uFocus; // where the cards hang: the reeds keep clear of it
  varying vec2 vUv;
  varying vec2 vScreen;
  ${WATERLINE}
  void main() {
    if (vScreen.y > waterline(vScreen.x)) discard;
    vec4 color = texture2D(map, vUv, 2.2); // premultiplied
    color.rgb = mix(color.rgb, vec3(0.04, 0.2, 0.26) * color.a, 0.62) * 0.8;
    float a = smoothstep(0.0, 0.3, vUv.y) * 0.92 * uReveal;
    a *= smoothstep(0.2, 0.42, abs(vScreen.x - uFocus));
    gl_FragColor = color * a;
  }
`;

type Reed = { mesh: THREE.Mesh; side: number; inset: number; base: number; height: number; flip: boolean };

/**
 * A few reeds very close to the camera at the edges of the screen, blurred and dark, that
 * slide past faster than anything else as the camera sinks: the strongest cue of depth.
 */
export class NearReeds {
  readonly group = new THREE.Group();
  private reeds: Reed[] = [];
  private aspect = 1.5;
  private focus = { value: 0.75 };

  constructor(parts: Part[], water: Water) {
    const plan: [number, number, number, number, boolean][] = [
      // part, side (-1 left, 1 right), its middle's distance in from that edge, in screen
      // heights, where in the repeat, flipped
      [0, -1, 0.06, 0, false],
      [1, 1, 0.05, 0.9, true],
      [2, -1, 0.2, 1.6, false],
    ];
    for (const [index, side, inset, base, flip] of plan) {
      const part = parts[index % parts.length];
      const material = new THREE.ShaderMaterial({
        uniforms: { map: { value: part.texture }, uSway: { value: base * 3 }, uFocus: this.focus, ...water },
        vertexShader: reedVertex,
        fragmentShader: reedFragment,
        transparent: true,
        premultipliedAlpha: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const height = 1.15;
      const geometry = new THREE.PlaneGeometry((part.w / part.h) * height, height, 1, 16);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      if (flip) mesh.scale.x = -1;
      this.group.add(mesh);
      this.reeds.push({ mesh, side, inset, base, height, flip });
    }
  }

  /** `focus` is how far across the screen the cards hang. */
  setSize(aspect: number, focus: number) {
    this.aspect = aspect;
    this.focus.value = focus;
  }

  /** `travel` is how far the camera has sunk, in screens. */
  update(travel: number) {
    const repeat = 2.4;
    for (const reed of this.reeds) {
      const { mesh, side, inset, base, height } = reed;
      let y = (base + travel * 1.8) % repeat;
      if (y < 0) y += repeat;
      mesh.position.set(side < 0 ? inset : this.aspect - inset, y - height / 2 - 0.2, 0);
    }
  }
}
