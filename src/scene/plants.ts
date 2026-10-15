import * as THREE from 'three';
import { PLANTS, worldY, type PlantSpec, type View } from './layout';
import { REFLECT_LAYER, createSpriteMaterial, type SpriteShared } from './sprite';

type Sized = { texture: THREE.Texture; w: number; h: number };
export type PlantTextures = Record<PlantSpec['kind'], Sized[]>;

type Placed = { spec: PlantSpec; mesh: THREE.Mesh; width: number; height: number; phase: number };

/** Reeds, lily pads and stones: pinned to the edges of the view and moving with the water. */
export class Plants {
  readonly group = new THREE.Group();
  private placed: Placed[] = [];

  constructor(textures: PlantTextures, shared: SpriteShared, boatWaterY: number) {
    PLANTS.forEach((spec, i) => {
      const source = textures[spec.kind][spec.index];
      const width = source.w * spec.scale;
      const height = source.h * spec.scale * (spec.flatten ?? 1);
      const phase = i * 1.9;
      const waterY = worldY(spec.waterY);
      const upright = spec.kind !== 'pads';
      const material = createSpriteMaterial(source.texture, shared, {
        waterY: upright ? waterY : undefined,
        sway: spec.kind === 'reeds' ? height * 0.045 : 0,
        phase,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, spec.kind === 'reeds' ? 12 : 1), material);
      if (spec.flip) mesh.scale.x = -1;
      if (upright) mesh.layers.enable(REFLECT_LAYER);
      // Things lower on screen are nearer, so they draw later; the boat sits at order 0.
      mesh.renderOrder = waterY < boatWaterY ? 2 + i * 0.01 : -0.5 + i * 0.01;
      this.group.add(mesh);
      this.placed.push({ spec, mesh, width, height, phase });
    });
  }

  setView(view: View) {
    for (const { spec, mesh } of this.placed) {
      mesh.position.x = spec.anchor === 'left' ? view.left + spec.inset : view.right - spec.inset;
    }
  }

  update(time: number) {
    for (const { spec, mesh, height, phase } of this.placed) {
      const waterY = worldY(spec.waterY);
      if (spec.kind === 'pads') {
        mesh.position.y = waterY + Math.sin(time * 1.1 + phase) * 1.2;
        mesh.rotation.z = Math.sin(time * 0.8 + phase) * 0.012;
      } else {
        // Stems and stones start a little under the surface so no cut edge shows.
        const sunk = spec.kind === 'reeds' ? 0.05 : 0.3;
        mesh.position.y = waterY + height * (0.5 - sunk);
      }
    }
  }
}
