import * as THREE from 'three';
import { worldY, type View } from './layout';

const COUNT = 28;

const vertex = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uScale;
  uniform float uStrength;
  varying float vGlow;
  void main() {
    // Each one glows and fades on its own slow rhythm, now and then going dark.
    float pulse = 0.5 + 0.5 * sin(uTime * (0.9 + fract(aPhase * 7.3)) + aPhase * 6.28);
    vGlow = pow(pulse, 2.5) * uStrength;
    gl_PointSize = uScale * (0.016 + 0.01 * pulse);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (exp(-d * d * 12.0) * 1.2 + exp(-d * d * 2.5) * 0.45) * vGlow;
    gl_FragColor = vec4(vec3(1.0, 0.93, 0.55) * a, a);
  }
`;

/**
 * Fireflies over the reeds and the water at night. They give off their own light, so they are
 * drawn after the night has darkened everything else, and added on top.
 */
export class Fireflies {
  readonly points: THREE.Points;
  private base = new Float32Array(COUNT * 3);
  private strength = { value: 0 };
  private scale = { value: 800 };
  private time: { value: number };
  private phases = new Float32Array(COUNT);
  private glows = new Float32Array(COUNT);

  /** How brightly they show, from 0 by day to 1 at night. */
  get brightness() {
    return this.strength.value;
  }

  constructor(time: { value: number }) {
    this.time = time;
    const phases = this.phases;
    for (let i = 0; i < COUNT; i++) {
      // Mostly over the edges, where the reeds are, some out over the open water.
      const edge = i % 3 !== 0;
      const x = edge ? (i % 2 ? Math.random() * 0.22 : 0.78 + Math.random() * 0.22) : 0.2 + Math.random() * 0.6;
      this.base.set([x, 480 + Math.random() * 300, Math.random() * 6.28], i * 3);
      phases[i] = Math.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.points = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uTime: time, uScale: this.scale, uStrength: this.strength },
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

  setScale(pixelHeight: number) {
    this.scale.value = pixelHeight;
  }

  /**
   * `strength` is how dark it is: they only come out at dusk and stay through the night.
   * Returns where across the view (0 to 1) one has just reached its brightest, if one has.
   */
  update(dt: number, strength: number, view: View) {
    this.strength.value = Math.max(0, (strength - 0.3) / 0.7);
    if (this.strength.value <= 0) return null;
    const t = this.time.value;
    let flared: number | null = null;
    const position = this.points.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      const [fx, designY, phase] = [this.base[i * 3], this.base[i * 3 + 1], this.base[i * 3 + 2]];
      // A lazy wandering loop.
      const x = view.left + fx * view.width + Math.sin(t * 0.31 + phase) * 40 + Math.sin(t * 0.77 + phase * 2) * 14;
      const y = worldY(designY) + Math.sin(t * 0.43 + phase * 1.7) * 26 + Math.cos(t * 0.91 + phase) * 9;
      position.setXYZ(i, x, y, 0);
      // The same glow as the shader's, to know when one lights up fully.
      const pulse = 0.5 + 0.5 * Math.sin(t * (0.9 + ((this.phases[i] * 7.3) % 1)) + this.phases[i] * 6.28);
      if (pulse > 0.985 && this.glows[i] <= 0.985) flared = (x - view.left) / view.width;
      this.glows[i] = pulse;
    }
    position.needsUpdate = true;
    return flared;
  }
}
