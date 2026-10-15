import * as THREE from 'three';

/** Uniforms every sprite shares, so one assignment flips the whole scene into its reflection. */
export type SpriteShared = {
  uMirror: { value: number };
  uTime: { value: number };
};

/** Layer holding everything that should appear reflected in the water. */
export const REFLECT_LAYER = 1;

export const spriteVertexShader = /* glsl */ `
  uniform float uMirror;
  uniform float uWaterY;
  uniform float uTime;
  uniform vec2 uSway; // amplitude in world units, phase
  varying vec2 vUv;
  varying float vWorldY;
  varying float vWorldX;

  void main() {
    vUv = uv;
    vec3 p = position;
    float bend = uv.y * uv.y;
    p.x += uSway.x * bend * (sin(uTime * 0.9 + uSway.y) * 0.7 + sin(uTime * 2.3 + uSway.y * 1.7) * 0.3);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorldY = world.y;
    vWorldX = world.x;
    if (uMirror > 0.5) world.y = 2.0 * uWaterY - world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform float uWaterY;
  uniform float uClip;
  uniform float uOpacity;
  uniform vec4 uCrop; // the part of the image to show: min u, min v, max u, max v
  uniform float uTime;
  varying vec2 vUv;
  varying float vWorldY;
  varying float vWorldX;

  void main() {
    vec4 color = texture2D(map, vUv); // premultiplied
    // The surface is never quite still, and a pale line of water clings where it is broken.
    float surface = uWaterY + sin(vWorldX * 0.05 + uTime * 1.3) * 1.1 + sin(vWorldX * 0.13 - uTime * 0.9) * 0.6;
    float above = mix(1.0, smoothstep(surface - 1.5, surface + 1.5, vWorldY), uClip);
    float wet = uClip * (1.0 - smoothstep(surface + 1.0, surface + 5.5, vWorldY));
    color.rgb = mix(color.rgb, vec3(0.86, 0.94, 1.0) * color.a, wet * 0.5);
    vec2 inside = smoothstep(uCrop.xy - 0.012, uCrop.xy, vUv) * (1.0 - smoothstep(uCrop.zw, uCrop.zw + 0.012, vUv));
    gl_FragColor = color * above * inside.x * inside.y * uOpacity;
  }
`;

export type SpriteOptions = {
  /** World y of the water surface; the sprite is hidden below it and mirrored about it. */
  waterY?: number;
  sway?: number;
  phase?: number;
  /** Show only part of the image: [min u, min v, max u, max v]. */
  crop?: readonly [number, number, number, number];
};

export function createSpriteMaterial(map: THREE.Texture, shared: SpriteShared, options: SpriteOptions = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uMirror: shared.uMirror,
      uTime: shared.uTime,
      uWaterY: { value: options.waterY ?? 0 },
      uClip: { value: options.waterY === undefined ? 0 : 1 },
      uSway: { value: new THREE.Vector2(options.sway ?? 0, options.phase ?? 0) },
      uOpacity: { value: 1 },
      uCrop: { value: new THREE.Vector4(...(options.crop ?? [0, 0, 1, 1])) },
    },
    vertexShader: spriteVertexShader,
    fragmentShader,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function loadTexture(loader: THREE.TextureLoader, url: string, opaque = false) {
  return loader.loadAsync(url).then((texture) => {
    // Colours are passed through untouched so the art matches the source files exactly.
    texture.colorSpace = THREE.NoColorSpace;
    texture.premultiplyAlpha = !opaque;
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  });
}
