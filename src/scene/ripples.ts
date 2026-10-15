import * as THREE from 'three';

const MAX_DROPS = 8;

/** How much smaller and slower ripples get at the horizon compared with the near edge. */
export const FAR_SCALE = 0.16;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// A damped wave equation on a height field. The field lives in screen space, so the wave
// speed shrinks toward the horizon (v = 1) and is slower vertically than horizontally:
// rings spread as flattened ellipses, the way circles on a receding water plane look.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uPrev; // r = height now, g = height one step ago
  uniform vec2 uTexel;
  uniform float uAspect; // width / height of the simulated region
  uniform vec4 uDrops[${MAX_DROPS}]; // xy = position, z = radius (in region heights), w = strength
  varying vec2 vUv;

  void main() {
    vec4 here = texture2D(uPrev, vUv);
    float h = here.r;
    float l = texture2D(uPrev, vUv - vec2(uTexel.x, 0.0)).r;
    float r = texture2D(uPrev, vUv + vec2(uTexel.x, 0.0)).r;
    float d = texture2D(uPrev, vUv - vec2(0.0, uTexel.y)).r;
    float u = texture2D(uPrev, vUv + vec2(0.0, uTexel.y)).r;

    float s = mix(1.0, ${FAR_SCALE.toFixed(2)}, vUv.y);
    float cx2 = 0.30 * s * s;
    float cy2 = 0.11 * s * s * s * s;
    float next = 2.0 * h - here.g + cx2 * (l + r - 2.0 * h) + cy2 * (u + d - 2.0 * h);
    next *= 0.988;

    for (int i = 0; i < ${MAX_DROPS}; i++) {
      vec4 drop = uDrops[i];
      float ds = mix(1.0, ${FAR_SCALE.toFixed(2)}, drop.y);
      vec2 radius = vec2(drop.z * ds, drop.z * ds * ds * 0.4);
      vec2 q = (vUv - drop.xy) * vec2(uAspect, 1.0) / radius;
      next += drop.w * exp(-dot(q, q));
    }

    // Soak up waves at the borders so they do not bounce back into view.
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    next *= mix(0.9, 1.0, smoothstep(0.0, 0.04, edge));

    gl_FragColor = vec4(next, h, 0.0, 1.0);
  }
`;

export class RippleSim {
  readonly width = 512;
  readonly height = 256;
  readonly supported: boolean;

  private read: THREE.WebGLRenderTarget;
  private write: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private queue: THREE.Vector4[] = [];

  constructor(private renderer: THREE.WebGLRenderer) {
    this.supported =
      renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const options: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.read = new THREE.WebGLRenderTarget(this.width, this.height, options);
    this.write = new THREE.WebGLRenderTarget(this.width, this.height, options);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null },
        uTexel: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
        uAspect: { value: 3 },
        uDrops: { value: Array.from({ length: MAX_DROPS }, () => new THREE.Vector4()) },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.clear();
  }

  get texture() {
    return this.read.texture;
  }

  setAspect(aspect: number) {
    this.material.uniforms.uAspect.value = aspect;
  }

  /** Queue a disturbance. u, v are in the simulated region (v = 0 near, 1 at the horizon). */
  drop(u: number, v: number, radius: number, strength: number) {
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    if (this.queue.length < MAX_DROPS) this.queue.push(new THREE.Vector4(u, v, radius, strength));
  }

  step() {
    if (!this.supported) return;
    const drops = this.material.uniforms.uDrops.value as THREE.Vector4[];
    for (let i = 0; i < MAX_DROPS; i++) {
      const drop = this.queue[i];
      if (drop) drops[i].copy(drop);
      else drops[i].set(0, 0, 1, 0);
    }
    this.queue.length = 0;
    this.material.uniforms.uPrev.value = this.read.texture;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.write);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    [this.read, this.write] = [this.write, this.read];
  }

  clear() {
    const previous = this.renderer.getRenderTarget();
    const color = this.renderer.getClearColor(new THREE.Color());
    const alpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 1);
    for (const target of [this.read, this.write]) {
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
    }
    this.renderer.setClearColor(color, alpha);
    this.renderer.setRenderTarget(previous);
  }

  dispose() {
    this.read.dispose();
    this.write.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
