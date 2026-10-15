import * as THREE from 'three';
import type { Part } from './puppet';
import { spriteVertexShader, type SpriteShared } from './sprite';

/** Where India sits across the painted map (0 to 1), so the globe can stop with it in front. */
const INDIA = 0.685;
/** The spin that puts India facing the viewer. */
export const INDIA_SPIN = (INDIA - 0.5) * Math.PI * 2;

// The ball of the desk globe: a flat quad drawn as a sphere, the painted map wrapped round it,
// tilted on its axis, lit from the upper left with a glossy highlight and an inked outline.
// Like every sprite, it is cut off at the water while it is being hauled out, and mirrored for
// the reflection.
const fragment = /* glsl */ `
  uniform sampler2D map;
  uniform float uSpin;
  uniform float uWaterY;
  uniform float uClip;
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  varying float vWorldY;
  varying float vWorldX;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float inside = 1.0 - smoothstep(0.985, 1.0, r);
    if (inside <= 0.0) discard;
    vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
    // The axis leans over, and the top tips a little towards us.
    float ct = cos(0.41), st = sin(0.41);
    vec3 q = vec3(ct * n.x + st * n.y, -st * n.x + ct * n.y, n.z);
    float ca = cos(0.32), sa = sin(0.32);
    q = vec3(q.x, ca * q.y - sa * q.z, sa * q.y + ca * q.z);
    float lon = atan(q.x, q.z) + uSpin;
    float lat = asin(clamp(q.y, -1.0, 1.0));
    vec2 uv = vec2(fract(lon / 6.28318 + 0.5), lat / 3.14159 + 0.5);
    vec3 color = texture2D(map, uv).rgb;

    vec3 light = normalize(vec3(-0.5, 0.6, 0.65));
    color *= 0.5 + 0.6 * max(dot(n, light), 0.0);
    color *= mix(0.78, 1.0, n.z);
    color += pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0), 28.0) * 0.4;
    color = mix(color, vec3(0.29, 0.08, 0.07), smoothstep(0.955, 0.975, r));

    float surface = uWaterY + sin(vWorldX * 0.05 + uTime * 1.3) * 1.1 + sin(vWorldX * 0.13 - uTime * 0.9) * 0.6;
    float above = mix(1.0, smoothstep(surface - 1.5, surface + 1.5, vWorldY), uClip);
    float wet = uClip * (1.0 - smoothstep(surface + 1.0, surface + 5.5, vWorldY));
    color = mix(color, vec3(0.86, 0.94, 1.0), wet * 0.5);
    float a = inside * above * uOpacity;
    gl_FragColor = vec4(color * a, a);
  }
`;

export function globeMaterial(map: THREE.Texture, shared: SpriteShared) {
  // The map wraps round, and is sampled without mipmaps so no seam shows where it meets itself.
  map.wrapS = THREE.RepeatWrapping;
  map.generateMipmaps = false;
  map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: map },
      uSpin: { value: INDIA_SPIN },
      uMirror: shared.uMirror,
      uTime: shared.uTime,
      uWaterY: { value: 0 },
      uClip: { value: 1 },
      uSway: { value: new THREE.Vector2(0, 0) },
      uOpacity: { value: 1 },
    },
    vertexShader: spriteVertexShader,
    fragmentShader: fragment,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** The globe's size and layout, in scene units, from the point the line is tied to. */
export const GLOBE = { height: 112, width: 120, ball: 70, ballY: -43 };

/**
 * The stand, drawn until a painted one arrives: a brass half-ring round the ball with pins top
 * and bottom, a turned wooden stem and a round base.
 */
export function standPart(): Part {
  const scale = 2;
  const w = GLOBE.width * scale, h = GLOBE.height * scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const at = (x: number, y: number): [number, number] => [w / 2 + x * scale, -y * scale + 2];
  const ink = '#4a1512';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Base and stem.
  const [bx, by] = at(0, -104);
  ctx.beginPath();
  ctx.ellipse(bx, by, 30 * scale, 6 * scale, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#8a5a36';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = '#a06c42';
  ctx.beginPath();
  ctx.ellipse(bx, by - 3 * scale, 26 * scale, 4.5 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const [sx, sy] = at(0, -82);
  ctx.beginPath();
  ctx.moveTo(sx - 4 * scale, sy);
  ctx.quadraticCurveTo(sx - 7 * scale, sy + 10 * scale, sx - 5 * scale, by - 6 * scale);
  ctx.lineTo(sx + 5 * scale, by - 6 * scale);
  ctx.quadraticCurveTo(sx + 7 * scale, sy + 10 * scale, sx + 4 * scale, sy);
  ctx.closePath();
  ctx.fillStyle = '#8a5a36';
  ctx.fill();
  ctx.stroke();
  // The brass half-ring, tilted with the globe's axis.
  const [cx, cy] = at(0, GLOBE.ballY);
  const tilt = -0.41;
  for (const [width, colour] of [[7, ink], [4, '#c99a45']] as const) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, 40 * scale, 40 * scale, tilt, Math.PI * 0.5, Math.PI * 1.5, false);
    ctx.lineWidth = width * scale * 0.55;
    ctx.strokeStyle = colour;
    ctx.stroke();
  }
  // Pins top and bottom, along the tilted axis, and a highlight on the brass.
  for (const s of [-1, 1]) {
    const px = cx + Math.sin(-tilt) * 38 * scale * s * -1;
    const py = cy - Math.cos(-tilt) * 38 * scale * s;
    ctx.beginPath();
    ctx.arc(px, py, 3.2 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#c99a45';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, 40 * scale, 40 * scale, tilt, Math.PI * 0.75, Math.PI * 0.95, false);
  ctx.lineWidth = 1.5 * scale;
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.8)';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  return { texture, w, h };
}
