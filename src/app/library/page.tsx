import type { Metadata } from 'next';
import ProjectLibrary from '@/components/ProjectLibrary';
import { site } from '@/content/site';

export const metadata: Metadata = {
  title: 'Project Library',
  description: `Every project by ${site.name} in one place. ${site.line}`,
  alternates: { canonical: '/library' },
};

// The library is its own scrolling page laid over the pond, which keeps running behind it.
export default function LibraryPage() {
  return <ProjectLibrary />;
}
