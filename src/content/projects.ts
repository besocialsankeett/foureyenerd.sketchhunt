import { kika } from './projects/kika';
import { moro } from './projects/moro';
import { senk8 } from './projects/senk8';
import { tin } from './projects/tin';
import type { Project } from './types';

export type { Project } from './types';

/**
 * Every project in the sketchbook, in the order its marker appears on the water.
 * To add one: write its file in ./projects, then list it here.
 */
export const projects: Project[] = [moro, kika, senk8, tin];

export const projectPath = (project: Project) => `/work/${project.slug}`;
