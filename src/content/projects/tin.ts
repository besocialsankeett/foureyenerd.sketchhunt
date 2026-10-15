import type { Project } from '../types';

// Written from the owner's own description of the work and the internship certificate. Edit freely.
export const tin: Project = {
  slug: 'the-indian-netizens',
  title: 'The Indian Netizens',
  kind: 'Website · Internship',
  catch: 'globe',
  summary: 'Three months inside a think-tank, making the website say what the people do.',
  facts: [
    { label: 'Role', value: 'Wix Studio developer intern (web developer and UI/UX designer)' },
    { label: 'When', value: 'June to August 2025' },
    { label: 'Built with', value: 'Wix Studio' },
    { label: 'Live at', value: 'theindiannetizens.in' },
  ],
  lead: { type: 'site', url: 'https://www.theindiannetizens.in/', title: 'The Indian Netizens home page' },
  sections: [
    {
      heading: 'The organisation',
      body: [
        'The Indian Netizens is a youth-led think-tank. A young editorial team publishes articles, reports and a magazine on public policy, diplomacy and the issues that shape India.',
      ],
    },
    {
      heading: 'What I did',
      body: [
        'I joined as a Wix Studio developer intern, designing the website’s layouts and UI structure in Wix Studio, and turning creative concepts into pages that work and read well.',
      ],
    },
    {
      heading: 'Beyond the website',
      body: ['Alongside the site, I wrote blog content and edited UGC-style videos as part of the team’s regular output.'],
    },
    {
      heading: 'The certificate',
      media: [
        {
          type: 'image',
          src: '/projects/tin/certificate.webp',
          alt: 'Internship certificate from The Indian Netizens, issued 5 August 2025, for an internship from 13 June to 5 August 2025 as Web Developer and UI/UX Designer for the official website, signed by the Founder and CEO.',
          width: 800,
          height: 1131,
          caption: 'Internship certificate, August 2025',
        },
      ],
    },
  ],
  link: { label: 'Visit site', href: 'https://www.theindiannetizens.in/' },
  library: ['/library/tin.webp'],
};
