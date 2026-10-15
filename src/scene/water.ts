import * as THREE from 'three';
import type { Light } from './daylight';
import { DESIGN_H, HORIZON_Y, worldY, type View } from './layout';

const vertexShader = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Paints the water: the plate bent by the ripple field, the mirrored scene laid over it in
// broken horizontal streaks, and a little light on the crests.
const fragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D uPlate;
  uniform sampler2D uSim;
  uniform sampler2D uReflection;
  uniform vec4 uView; // left, bottom, width, height in world units
  uniform vec4 uLens; // the same, for where the camera is now, which sinks while diving
  uniform float uHorizon;
  uniform float uTime;
  uniform vec2 uSimTexel;
  // The time of day: the sky's colours and how far they replace the painted haze, stars and
  // moon, and a low sun with its colour and place across the view.
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform float uSky;
  uniform float uStars;
  uniform float uSun;
  uniform float uSunX;
  uniform vec3 uSunColor;
  // A shooting star: where its head is, which way it flies, how long its tail is, how bright
  // it is now, and what undoes the night's tint so it still comes out white.
  uniform vec2 uMeteorHead;
  uniform vec2 uMeteorDir;
  uniform float uMeteorTail;
  uniform float uMeteor;
  uniform vec3 uLift;
  varying vec2 vWorld;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // A bright head with a tail that thins and fades behind it.
  float meteorAt(vec2 p) {
    vec2 rel = p - uMeteorHead;
    float behind = -dot(rel, uMeteorDir);
    float across = abs(rel.x * uMeteorDir.y - rel.y * uMeteorDir.x);
    float tailT = clamp(behind / max(uMeteorTail, 1.0), 0.0, 1.0);
    float inTail = smoothstep(-2.0, 0.0, behind) * (1.0 - tailT);
    float width = 0.9 + 1.8 * (1.0 - tailT);
    float line = exp(-across * across / (width * width)) * inTail * inTail * 1.3;
    float glow = (exp(-across * across / 40.0) * 0.35 + exp(-across * across / 300.0) * 0.12) * inTail;
    float d = dot(rel, rel);
    float head = exp(-d / 12.0) * 2.0 + exp(-d / 260.0) * 0.5;
    return (line + glow + head) * uMeteor;
  }

  void main() {
    // How much shooting star is on this spot; it is handed on to the night's grade, which adds
    // it as light after the darkening, so it can shine brighter than the dark picture allows.
    float meteor = 0.0;
    vec2 screen = (vWorld - uView.xy) / uView.zw;
    float v = (vWorld.y - uView.y) / (uHorizon - uView.y); // 0 at the near edge, 1 at the horizon
    float inWater = 1.0 - smoothstep(0.94, 1.0, v);
    float near = clamp(1.0 - v, 0.0, 1.0);
    vec2 simUv = vec2(screen.x, v);

    float l = texture2D(uSim, simUv - vec2(uSimTexel.x, 0.0)).r;
    float r = texture2D(uSim, simUv + vec2(uSimTexel.x, 0.0)).r;
    float d = texture2D(uSim, simUv - vec2(0.0, uSimTexel.y)).r;
    float u = texture2D(uSim, simUv + vec2(0.0, uSimTexel.y)).r;
    vec2 slope = vec2(r - l, u - d) * inWater;

    // A slow drift so the painted strokes breathe even when nothing disturbs the water.
    float drift = noise(vec2(vWorld.x * 0.004 + uTime * 0.05, vWorld.y * 0.03 - uTime * 0.12)) - 0.5;
    vec2 bend = slope * vec2(0.06, 0.09) + vec2(drift * 0.004 * near, 0.0);

    // Above the horizon the plate maps one to one; below it, the painted water stretches to
    // reach the bottom of taller views instead of running out.
    float horizonV = uHorizon / ${DESIGN_H.toFixed(1)};
    float plateV = vWorld.y > uHorizon ? min(vWorld.y / ${DESIGN_H.toFixed(1)}, 1.0) : horizonV * clamp(v, 0.0, 1.0);
    vec2 plateUv = vec2(screen.x, plateV) + bend;
    vec3 color = texture2D(uPlate, plateUv).rgb;

    // The sky of the hour takes the place of the painting's pale haze above the water, with
    // stars and a moon at night and a low sun in the evening.
    float above = smoothstep(uHorizon - 6.0, uHorizon + 30.0, vWorld.y);
    float skyT = clamp((vWorld.y - uHorizon) / (uView.y + uView.w - uHorizon), 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(skyT, 0.7));
    float haze = smoothstep(0.55, 0.95, dot(color, vec3(0.299, 0.587, 0.114)));
    color = mix(color, sky, uSky * above * haze);
    vec2 cell = vWorld * 0.06;
    vec2 id = floor(cell);
    float chance = hash(id);
    vec2 spot = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
    float star = step(0.93, chance) * smoothstep(0.09, 0.0, length(fract(cell) - 0.5 - spot * 0.6));
    star *= 0.6 + 0.4 * sin(uTime * 2.0 + chance * 40.0);
    color += star * uStars * above * smoothstep(0.05, 0.4, skyT) * 1.6;
    if (uMeteor > 0.0) {
      meteor = meteorAt(vWorld) * above;
      color += vec3(0.9, 0.93, 1.0) * uLift * meteor * 0.5;
    }
    vec2 moonAt = vec2(uView.x + uView.z * 0.8, uView.y + uView.w * 0.86);
    float moonFar = length(vWorld - moonAt);
    color = mix(color, vec3(1.0, 0.98, 0.9) * 1.5, uStars * above * smoothstep(34.0, 30.0, moonFar));
    color += vec3(0.6, 0.72, 1.0) * uStars * above * 0.5 * exp(-moonFar * moonFar / 25600.0);
    vec2 sunAt = vec2(uView.x + uView.z * uSunX, uHorizon + 70.0);
    float sunFar = length(vWorld - sunAt);
    color += uSunColor * uSun * above * (smoothstep(46.0, 40.0, sunFar) * 0.6 + exp(-sunFar * sunFar / 67600.0) * 0.45);

    // The mirror image slides sideways row by row and thins out in bands, like a
    // reflection broken up by small ripples.
    float rowA = noise(vec2(vWorld.y * 0.21, uTime * 0.7 + vWorld.x * 0.002)) - 0.5;
    float rowB = noise(vec2(vWorld.y * 0.47 + 40.0, uTime * 1.1)) - 0.5;
    float streak = rowA * 0.011 + rowB * 0.003;
    // The reflection was drawn from where the camera is now, so it is read the same way.
    vec2 lens = (vWorld - uLens.xy) / uLens.zw;
    vec4 mirror = texture2D(uReflection, lens + bend * 1.4 + vec2(streak, 0.0)) * inWater;
    float bands = 0.8 + 0.2 * noise(vec2(vWorld.x * 0.006 + uTime * 0.08, vWorld.y * 0.16 - uTime * 0.25));
    float strength = 0.7 * bands;
    color = color * (1.0 - mirror.a * strength) + mirror.rgb * vec3(0.74, 0.85, 1.0) * strength;

    float height = texture2D(uSim, simUv).r * inWater;
    float crest = smoothstep(0.02, 0.22, slope.y);
    float trough = smoothstep(0.02, 0.22, -slope.y);
    color += height * 0.05 + crest * 0.2;
    color *= 1.0 - trough * 0.1;

    // The water takes on the sky's colour, and a path of glitter runs across it below the low
    // sun, or the moon.
    float below = (1.0 - above) * inWater;
    color = mix(color, color * (uSkyHorizon * 1.1 + 0.15), uSky * below * 0.55 * (0.5 + 0.5 * clamp(v, 0.0, 1.0)));
    float sparkle = smoothstep(0.55, 0.9, noise(vec2(vWorld.x * 0.05 + uTime * 0.6, vWorld.y * 0.35 - uTime * 1.4)));
    float width = 40.0 + (1.0 - clamp(v, 0.0, 1.0)) * 220.0;
    float sunPath = (vWorld.x - sunAt.x) / width;
    float moonPath = (vWorld.x - moonAt.x) / width;
    color += uSunColor * sparkle * exp(-sunPath * sunPath) * below * uSun * 0.9;
    color += vec3(0.85, 0.9, 1.0) * sparkle * exp(-moonPath * moonPath) * below * uStars * 0.7;
    // The shooting star again in the water, foreshortened and broken up by the ripples.
    if (uMeteor > 0.0) {
      vec2 sky = vec2(vWorld.x + streak * uView.z * 2.0, 2.0 * uHorizon - vWorld.y);
      float mirrored = meteorAt(sky) * below * bands * 0.4;
      color += vec3(0.9, 0.93, 1.0) * uLift * mirrored * 0.5;
      meteor += mirrored;
    }

    // Carried in the alpha, which anything drawn over the water afterwards (the boat, him, the
    // reeds) sets back to solid, so the star stays hidden behind them.
    // Dithered, so its faint edge fades out smoothly instead of in steps.
    float marked = clamp(meteor, 0.0, 3.0) * 0.25;
    if (marked > 0.0) marked = max(0.0, marked + (hash(gl_FragCoord.xy) - 0.5) * 2.0 / 255.0);
    gl_FragColor = vec4(color, 1.0 - marked);
  }
`;

export class Water {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(plate: THREE.Texture, sim: THREE.Texture, simSize: THREE.Vector2, reflection: THREE.Texture, time: { value: number }) {
    plate.wrapS = plate.wrapT = THREE.ClampToEdgeWrapping;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPlate: { value: plate },
        uSim: { value: sim },
        uReflection: { value: reflection },
        uView: { value: new THREE.Vector4(0, 0, 1, 1) },
        uLens: { value: new THREE.Vector4(0, 0, 1, 1) },
        uHorizon: { value: worldY(HORIZON_Y) },
        uTime: time,
        uSimTexel: { value: new THREE.Vector2(1 / simSize.x, 1 / simSize.y) },
        uSkyTop: { value: new THREE.Vector3(1, 1, 1) },
        uSkyHorizon: { value: new THREE.Vector3(1, 1, 1) },
        uSky: { value: 0 },
        uStars: { value: 0 },
        uSun: { value: 0 },
        uSunX: { value: 0.8 },
        uSunColor: { value: new THREE.Vector3(1, 0.7, 0.4) },
        uMeteorHead: { value: new THREE.Vector2() },
        uMeteorDir: { value: new THREE.Vector2(1, 0) },
        uMeteorTail: { value: 0 },
        uMeteor: { value: 0 },
        uLift: { value: new THREE.Vector3(1, 1, 1) },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  setSim(texture: THREE.Texture) {
    this.material.uniforms.uSim.value = texture;
  }

  setView(view: View) {
    // Twice as tall as the view, reaching below it, so the water is still there while the
    // camera starts to sink under the surface.
    this.mesh.position.set((view.left + view.right) / 2, view.top - view.height, 0);
    this.mesh.scale.set(view.width, view.height * 2, 1);
    (this.material.uniforms.uView.value as THREE.Vector4).set(view.left, view.bottom, view.width, view.height);
  }

  /** Where the camera is looking this frame: the view, lowered by however far it has sunk. */
  setLens(left: number, bottom: number, width: number, height: number) {
    (this.material.uniforms.uLens.value as THREE.Vector4).set(left, bottom, width, height);
  }

  /**
   * The time of day. The whole picture is afterwards multiplied by `tint`, so the sky's
   * colours are divided by it here, to come out as given.
   */
  setLight(light: Light) {
    const u = this.material.uniforms;
    const lift = (c: [number, number, number]) => c.map((v, i) => Math.min(1.6, v / Math.max(0.05, light.tint[i]))) as [number, number, number];
    (u.uSkyTop.value as THREE.Vector3).fromArray(lift(light.skyTop));
    (u.uSkyHorizon.value as THREE.Vector3).fromArray(lift(light.skyHorizon));
    (u.uSunColor.value as THREE.Vector3).fromArray(light.sunColor);
    u.uSky.value = light.sky;
    u.uStars.value = light.stars;
    u.uSun.value = light.sun;
    u.uSunX.value = light.sunX;
    (u.uLift.value as THREE.Vector3).fromArray(light.tint.map((v) => Math.min(2.5, 1 / Math.max(0.05, v))));
  }

  /** The shooting star of the moment, if any: `brightness` 0 hides it. */
  setMeteor(x: number, y: number, dirX: number, dirY: number, tail: number, brightness: number) {
    const u = this.material.uniforms;
    (u.uMeteorHead.value as THREE.Vector2).set(x, y);
    (u.uMeteorDir.value as THREE.Vector2).set(dirX, dirY);
    u.uMeteorTail.value = tail;
    u.uMeteor.value = brightness;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
