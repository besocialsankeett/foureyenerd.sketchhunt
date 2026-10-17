import type { Project } from '../types';

// Draft copy, written from the live site and the owner's note that they designed the whole
// thing and built it by vibe coding. Edit freely.
export const tuningwave: Project = {
  slug: 'the-tuning-wave',
  title: 'The Tuning Wave',
  kind: 'Concept website · Design',
  catch: 'bottle',
  summary: 'An instrument shop where you play before you pay: drums, a guitar and a grand piano you can hear before you buy.',
  facts: [
    { label: 'Role', value: 'Designed the whole website, built with vibe coding' },
    { label: 'Type', value: 'Concept e-commerce site' },
    { label: 'Live at', value: 'thetuningwave-xpwy.vercel.app' },
  ],
  lead: { type: 'site', url: 'https://thetuningwave-xpwy.vercel.app/', title: 'The Tuning Wave home page' },
  sections: [
    {
      heading: 'The idea',
      body: [
        'Spec sheets don’t make music. The Tuning Wave is a made-up instrument house in Mumbai that turns shopping around: every instrument is playable on the page, so you hear it first and buy it second.',
      ],
    },
    {
      heading: 'Three instruments, one stage',
      points: [
        'Undertow Five, a five-piece drum kit tuned low and wide',
        'Lowlight Six, a solid-body electric guitar',
        'Halcyon 186, a baby grand piano',
      ],
    },
    {
      heading: 'The look and feel',
      body: [
        'A dark stage with a single instrument lit in the middle, an elegant serif for the big lines, and water running through everything: the products are named Pulse, Current and Tide, the page opens on a wave that tunes itself, and you scroll to dive.',
        'Sound is off until you ask for it, with a lighter mode for slower devices.',
      ],
    },
    {
      heading: 'A concept',
      body: ['Nothing is for sale: no payment is taken, the bag is for show, and the products, prices and address are fictional.'],
    },
  ],
  link: { label: 'Visit site', href: 'https://thetuningwave-xpwy.vercel.app/' },
  library: ['/library/tuningwave.webp'],
};
