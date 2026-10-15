import type { Project } from '../types';

// Draft copy, written from the live page. Edit freely.
export const senk8: Project = {
  slug: 'senk8',
  title: 'senk8',
  kind: 'Landing page',
  catch: 'bottle',
  summary: 'A holding page for a portfolio: a name, one line, and a promise that more is on the way.',
  facts: [
    { label: 'Type', value: 'Landing page' },
    { label: 'Live at', value: 'senk8.vercel.app' },
  ],
  lead: { type: 'site', url: 'https://senk8.vercel.app/', title: 'The senk8 landing page' },
  sections: [
    {
      heading: 'What it says',
      body: ['“I build content, campaigns & digital things from scratch.” And, beside it: “Portfolio launching soon.”'],
    },
    {
      heading: 'The look',
      body: [
        'Almost nothing is on the page. A very large grotesque name runs along the bottom in black and blue on near-white, and the one line of copy sits small above it.',
      ],
    },
  ],
  link: { label: 'Visit site', href: 'https://senk8.vercel.app/' },
  library: ['/library/senk8.webp'],
};
