import type { Project } from '../types';

// Draft copy, written from the live site. Edit freely.
export const moro: Project = {
  slug: 'moro',
  title: 'MORO',
  kind: 'Website',
  catch: 'mirror',
  summary:
    'A booking site for salons and barbers in Mumbai. It finds you a good place nearby and holds an exact time: real prices, live availability, no phone calls.',
  facts: [
    { label: 'Type', value: 'Website' },
    { label: 'City', value: 'Mumbai' },
    { label: 'Live at', value: 'morosaloons.vercel.app' },
  ],
  lead: { type: 'site', url: 'https://morosaloons.vercel.app/', title: 'The MORO home page' },
  sections: [
    {
      heading: 'The idea',
      body: [
        'Booking a haircut usually means a phone call and a guess at the price. MORO puts the menu, the price and the next free slot on the page before you commit to anything.',
      ],
    },
    {
      heading: 'What is on the page',
      points: [
        'A search by neighbourhood, service and day.',
        'The nearest open chairs, each with its distance, starting price and next free slot.',
        'Six kinds of service, from haircuts to skin and beauty.',
        'A featured salon with its full menu and prices.',
        'Three steps: find your place, pick an exact time, just turn up.',
        'A way in for salon owners.',
      ],
    },
    {
      heading: 'The look',
      body: [
        'Editorial serif headlines on a warm off-white, with black kept for anything you can press. The hero is a single dark arched mirror under the line “Look forward to the mirror.”',
      ],
    },
  ],
  link: { label: 'Visit site', href: 'https://morosaloons.vercel.app/' },
  library: ['/library/moro.webp'],
};
