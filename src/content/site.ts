/** Who the sketchbook belongs to. Shown in the corner of the scene and in the page title. */
export const site = {
  name: 'foureyenerd',
  line: 'Basically, with four eyes, I design and build stuff.',
  title: 'Sketchbook',
  /** Where to find him, shown as icons on the pond. */
  social: [
    { name: 'Instagram', href: 'https://www.instagram.com/social.sankeett/' },
    { name: 'X', href: 'https://x.com/foureyenerdd' },
    { name: 'GitHub', href: 'https://github.com/besocialsankeett' },
    { name: 'Behance', href: 'https://www.behance.net/sanketathawale' },
  ],
  /**
   * The Formspree form that notes left in the shell are sent to: the letters after
   * formspree.io/f/ in the form's endpoint.
   */
  notesForm: 'mnpjrbaa',
  /** Arched over his head on the opening's start screen; it reads on into the name below. */
  hello: 'hello, i am sankeett aka',
};

/**
 * The opening: the faces he pulls while the scene loads, in order, and the word under each.
 * Faces are happy, blink, worried, surprised, straining and delighted.
 */
export const intro = [
  { face: 'happy', word: 'design.' },
  { face: 'blink', word: 'vibe code.' },
  { face: 'worried', word: 'it worked yesterday.' },
  { face: 'surprised', word: 'it works?!' },
  { face: 'straining', word: 'one last fix.' },
  { face: 'delighted', word: 'ship it.' },
] as const;
