import type { Media, Project } from '../types';

/** A slide from the KIKA presentation. They are all 1920 by 1080. */
const slide = (file: string, alt: string, caption?: string): Media => ({
  type: 'image',
  src: `/projects/kika/deck/${file}.webp`,
  alt,
  width: 1920,
  height: 1080,
  caption,
});

// The case study is the KIKA presentation itself, slide by slide. The short lines of text
// between the slides are drafted from it. Edit freely.
export const kika: Project = {
  slug: 'kika',
  title: 'KIKA',
  kind: 'Brand identity',
  catch: 'box',
  summary:
    'Coasters that look like food and drinks, for rooms that like to show off. A brand identity, packaging and launch campaign built on one joke: coaster or real?',
  facts: [
    { label: 'Type', value: 'Brand identity, packaging and launch campaign' },
    { label: 'Audience', value: 'Gen Z room decorators, and people buying a gift' },
    { label: 'Typefaces', value: 'Fredoka and DM Sans' },
    { label: 'Price point', value: 'Sets of 4 from ₹999' },
  ],
  lead: slide(
    '01-cover',
    'Cover slide: the KIKA logo in cream on indigo, with flower shapes in orange, yellow, pink and green. “Brand identity, packaging and launch campaign. senk8, 2026.”',
  ),
  sections: [
    {
      heading: 'The brief',
      body: ['Round printed coasters, sold in sets of 4, 16 and 32, for Gen Z room decorators and people buying a gift.'],
      media: [
        slide(
          '02-brief',
          'The brief: “Coasters that look like food and drinks, for rooms that like to show off.” Product: round printed coasters, sold in sets of 4, 16 and 32. Audience: Gen Z room decorators and people buying a gift. Price: from ₹999 for a set of four.',
        ),
      ],
    },
    {
      heading: 'The idea',
      body: ['Every coaster fools you for a second, and the whole brand is built on that second.'],
      media: [
        slide(
          '03-idea',
          'The idea: “Coaster or real?” beside a photograph of a glass of iced matcha next to a coaster printed to look exactly like it. “Every coaster fools you for a second. The whole brand is built on that second: the name of each set, the box, and every post.”',
        ),
      ],
    },
    {
      heading: 'The logo',
      body: ['Hand-drawn rounded letters, with a flower dotting the i. The flower works alone as the icon.'],
      media: [
        slide(
          '04-logo',
          'The logo: KIKA in hand-drawn rounded indigo letters with an orange flower dotting the i, and four colour versions on indigo, yellow, pink and green. “The flower works alone as the icon and takes any colour in the palette.”',
        ),
      ],
    },
    {
      heading: 'Colour and type',
      body: [
        'Kika Indigo is the one colour no coaster has, so the brand never fights the product. Rounded Fredoka headlines match the logo; DM Sans does everything else.',
      ],
      media: [
        slide(
          '05-colours',
          'The palette: Kika Indigo #4B3FF6, Tangerine #FF7A1A, Matcha #B9DC4E, Bubblegum #FF6FAE and Butter #FFE566, with Milk #FFFBF0, Ink #15102E, Lilac #CFC9FF, Peach #FFCFB0, Pistachio #DCEDB5, Blush #FFCCDD and Cream #FFF3B8.',
        ),
        slide(
          '06-type',
          'Typography: display face Fredoka, shown large on yellow, and body face DM Sans, set in a sample: “Put a drink on it. Looks like a snack. Works like a coaster.” with a “Set of 4 · from ₹999” tag.',
        ),
      ],
    },
    {
      heading: 'The flower pattern',
      media: [slide('07-pattern', 'A tiled pattern of the KIKA flower in every colour of the palette, each on a contrasting square.')],
    },
    {
      heading: 'The sets',
      body: ['Each set of four is named like a food order.'],
      media: [
        slide(
          '08-sets',
          'The four sets. Set 01, The Iced Order: iced matcha, iced latte, cola on ice, lemon iced tea. Set 02, The Brunch Order: fried egg, waffle, cinnamon roll, glazed donut. Set 03, The Fruit Plate: orange slice, strawberry, coconut, papaya star. Set 04, The Junk Drawer: soda can top, bottle cap, button, peppermint candy.',
        ),
      ],
    },
    {
      heading: 'Packaging: your order is ready',
      body: [
        'The joke arrives before the box is open. A round window makes the box look as if a drink is inside, and the drawer holds a flower pattern, a receipt and stickers.',
      ],
      media: [
        slide(
          '09-packaging',
          'Packaging in three steps: a stack of KIKA shipping cartons reading “They’re coasters.”; the indigo drawer box with a round window showing an iced matcha coaster; and the open drawer, lined with flowers, revealing a fried egg coaster beside a receipt and a sticker sheet.',
        ),
        slide(
          '10-receipt-stickers',
          'The receipt and sticker sheet. The receipt reads “Your order is ready”, lists four iced drinks, and totals 4 coasters and 0 calories: “Do not eat. Put a drink on it.” The stickers say “Do not eat.”, “Coaster or real?”, “0 calories” and “Pull. Don’t bite.”',
        ),
      ],
    },
    {
      heading: 'The campaign',
      body: ['Made to be posted. The grid keeps asking the same question, then answers it with the box.'],
      media: [
        slide(
          '11-made-to-be-posted',
          'Made to be posted: the open drawer box with matcha, fried egg, orange and soda can coasters on pink; four drink coasters on yellow; and a hand holding the box up against a blue sky.',
        ),
        slide(
          '12-in-the-room',
          'The coasters at home: an iced matcha on a fried egg coaster on a yellow bedside table, and an iced latte on a donut coaster on a tiled café table beside egg and cinnamon roll coasters.',
        ),
        slide(
          '13-campaign-grid',
          'One joke, nine posts: a nine-post Instagram grid mixing “Coaster or real?”, the logo, the cartons, coaster photographs and “Looks like a snack. Works like a coaster.”, beside a story reading “Your order is ready.”',
        ),
        {
          type: 'image',
          src: '/projects/kika/instagram-mockups.webp',
          alt: 'Three phones showing the KIKA Instagram profile and two stories: “Now serving: The Iced Order” and a poll between a fried egg coaster and an orange slice coaster.',
          width: 1400,
          height: 875,
          caption: 'Profile and stories',
        },
      ],
    },
    {
      heading: 'The website',
      media: [
        slide(
          '14-website',
          'The KIKA shop home page: “Put a drink on it.” on indigo with a Shop the sets button, lifestyle photographs, and a card for each of the four sets, from ₹999.',
        ),
      ],
    },
  ],
  gallery: [
    slide(
      '15-closing',
      'Closing slide on yellow: “Looks like a snack. Works like a coaster.” Brand identity, packaging concept and campaign by Sanket Athawale; mockups generated and art-directed by senk8.',
    ),
  ],
  link: { label: 'View on X', href: 'https://x.com/bsenk8/status/2109446693012095440' },
  library: ['/library/kika.webp'],
};
