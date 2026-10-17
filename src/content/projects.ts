import { kika } from './projects/kika';
import { moro } from './projects/moro';
import { senk8 } from './projects/senk8';
import { tin } from './projects/tin';
import { tuningwave } from './projects/tuningwave';
import type { Project } from './types';

export type { Project } from './types';

/**
 * Every project in the sketchbook, in the order its marker appears on the water and in the
 * library. To add one: write its file in ./projects, then list it here.
 */
export const projects: Project[] = [moro, kika, senk8, tin, tuningwave];

/** The projects fished out of the pond: those with an object to come up as. */
export const pondProjects = projects.filter((project) => project.catch) as (Project & { catch: NonNullable<Project['catch']> })[];

export const projectPath = (project: Project) => `/work/${project.slug}`;
