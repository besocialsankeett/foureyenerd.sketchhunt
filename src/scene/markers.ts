import * as THREE from 'three';
import { worldY } from './layout';
import { REFLECT_LAYER, createSpriteMaterial, type SpriteShared } from './sprite';

const WIDTH = 13;
const HEIGHT = 44;
/** Height of the top of the mast above the water, where a project's tag hangs. */
const MAST = 36;

/** A cork with a thin mast: the little buoy each project's tag is tied to. */
function buoyTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 52;
  canvas.height = 176;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = '#4a1512';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(26, 6);
  ctx.lineTo(26, 130);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(26, 146, 20, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#c98f55';
  ctx.fill();
  ctx.fillStyle = '#9a6a3a';
  for (const [x, y] of [[18, 138], [32, 150], [22, 156], [34, 136], [14, 148]]) ctx.fillRect(x, y, 4, 3);
  ctx.lineWidth = 5;
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  return texture;
}

type Marker = { mesh: THREE.Mesh; material: THREE.ShaderMaterial; x: number; waterY: number; phase: number };

/** One small buoy per project, rocking on the water. The page hangs a tag on each mast. */
export class Markers {
  readonly group = new THREE.Group();
  private items: Marker[] = [];

  constructor(count: number, shared: SpriteShared) {
    const texture = buoyTexture();
    // The middle of the cork sits at the origin, on the waterline.
    const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT);
    geometry.translate(0, HEIGHT / 2 - 7.5, 0);
    for (let i = 0; i < count; i++) {
      const material = createSpriteMaterial(texture, shared, { waterY: 0 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 1.4;
      mesh.layers.enable(REFLECT_LAYER);
      this.group.add(mesh);
      this.items.push({ mesh, material, x: 0, waterY: 0, phase: i * 2.3 });
    }
  }

  /** Move the buoys to their design positions. */
  place(spots: readonly (readonly [number, number])[]) {
    this.items.forEach((item, i) => {
      item.x = spots[i][0];
      item.waterY = worldY(spots[i][1]);
      item.material.uniforms.uWaterY.value = item.waterY;
    });
  }

  /** Where a buoy meets the water. */
  spot(index: number) {
    const item = this.items[index];
    return { x: item.x, y: item.waterY };
  }

  update(time: number) {
    for (const item of this.items) {
      item.mesh.position.set(item.x, item.waterY + Math.sin(time * 1.3 + item.phase) * 1.1, 0);
      item.mesh.rotation.z = Math.sin(time * 0.9 + item.phase) * 0.09;
    }
  }

  /** The top of a buoy's mast and its lean, for hanging the tag. */
  mastTop(index: number, out: THREE.Vector2) {
    const { mesh } = this.items[index];
    const angle = mesh.rotation.z;
    out.set(mesh.position.x - Math.sin(angle) * MAST, mesh.position.y + Math.cos(angle) * MAST);
    return angle;
  }
}
