import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { projectPath, projects } from '@/content/projects';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return projects.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = projects.find((p) => p.slug === slug);
  if (!project) return {};
  return {
    title: `${project.title}: ${project.kind}`,
    description: project.summary,
    alternates: { canonical: projectPath(project) },
    openGraph: { title: project.title, description: project.summary, type: 'article', url: projectPath(project) },
  };
}

// The case study itself is drawn by the layout, which reads the address; this page only
// makes the address exist and carries its title and description.
export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;
  if (!projects.some((p) => p.slug === slug)) notFound();
  return null;
}
