import * as THREE from 'three';
import { spriteVertexShader, type SpriteShared } from './sprite';

/** One eye opening in the head image: centre x, centre y, half width, half height, in pixels. */
export type EyeBox = readonly [number, number, number, number];
export type Eyes = { mask: THREE.Texture; left: EyeBox; right: EyeBox };

// The head, with the irises painted in live. Each iris is a small drawn disc that slides
// within its eye and is clipped to the eye's white, so the lids cover it as they should.
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D uEyeMask;
  uniform float uEyesOn;
  uniform vec4 uEyeL;
  uniform vec4 uEyeR;
  uniform vec2 uLook; // where he looks: x left(-1) to right(1), y up(-1) to down(1)
  uniform float uIris;
  uniform vec2 uSize;
  uniform float uWaterY;
  uniform float uClip;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vWorldY;

  vec4 iris(vec2 p, vec4 eye) {
    vec2 reach = vec2(max(2.0, eye.z - uIris * 0.75), max(1.5, eye.w - uIris + 3.0));
    vec2 d = p - (eye.xy + uLook * reach);
    float r = length(d);
    vec3 color = mix(vec3(0.25, 0.27, 0.31), vec3(0.45, 0.48, 0.52), smoothstep(-uIris, uIris * 0.7, d.y));
    color = mix(color, vec3(0.13, 0.12, 0.13), 1.0 - smoothstep(uIris * 0.52, uIris * 0.6, r));
    color = mix(color, vec3(0.16, 0.14, 0.15), smoothstep(uIris - 2.8, uIris - 1.4, r));
    float glint = 1.0 - smoothstep(uIris * 0.11, uIris * 0.19, length(d - vec2(-0.36, -0.36) * uIris));
    color = mix(color, vec3(1.0), glint);
    return vec4(color, 1.0 - smoothstep(uIris - 1.0, uIris, r));
  }

  void main() {
    vec4 color = texture2D(map, vUv); // premultiplied; fully opaque wherever an eye is
    if (uEyesOn > 0.5) {
      vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
      float white = texture2D(uEyeMask, vUv).r;
      vec4 eye = p.x < (uEyeL.x + uEyeR.x) * 0.5 ? uEyeL : uEyeR;
      // The upper lid shades the top of the eye.
      float lid = 1.0 - smoothstep(0.0, 8.0, p.y - (eye.y - eye.w));
      color.rgb *= 1.0 - 0.16 * lid * white;
      vec4 disc = iris(p, eye);
      color.rgb = mix(color.rgb, disc.rgb * (1.0 - 0.25 * lid), disc.a * white);
    }
    float above = mix(1.0, smoothstep(uWaterY - 1.5, uWaterY + 1.5, vWorldY), uClip);
    gl_FragColor = color * above * uOpacity;
  }
`;

export function createFaceMaterial(map: THREE.Texture, size: { w: number; h: number }, shared: SpriteShared, waterY: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uMirror: shared.uMirror,
      uTime: shared.uTime,
      uWaterY: { value: waterY },
      uClip: { value: 1 },
      uSway: { value: new THREE.Vector2() },
      uOpacity: { value: 1 },
      uEyeMask: { value: null as THREE.Texture | null },
      uEyesOn: { value: 0 },
      uEyeL: { value: new THREE.Vector4() },
      uEyeR: { value: new THREE.Vector4() },
      uLook: { value: new THREE.Vector2() },
      uIris: { value: 16 },
      uSize: { value: new THREE.Vector2(size.w, size.h) },
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
