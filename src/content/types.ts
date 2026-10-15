/** Something shown in a case study: a picture, or a live look at a website. */
export type Media =
  | { type: 'image'; src: string; alt: string; width: number; height: number; caption?: string }
  | { type: 'site'; url: string; title: string };

export type Section = {
  heading: string;
  /** Paragraphs of text. */
  body?: string[];
  /** A short list, shown after the paragraphs. */
  points?: string[];
  /** Colour chips, for projects where the palette is part of the story. */
  swatches?: { name: string; hex: string }[];
  /** Pictures that belong to this part of the story, shown after its text. */
  media?: Media[];
};

export type Project = {
  /** Used in the project's web address: /work/<slug>. */
  slug: string;
  title: string;
  /** What kind of work it is, in a few words. Shown on the tag. */
  kind: string;
  /** The object this project comes out of the water as. */
  catch: 'mirror' | 'box' | 'bottle' | 'globe';
  /** One or two sentences: what it is. Also used when the page is shared. */
  summary: string;
  facts: { label: string; value: string }[];
  /** Shown first, large, under the summary. */
  lead: Media;
  sections: Section[];
  /** Further pictures, shown after the sections. */
  gallery?: Media[];
  /** Where the visitor can see the real thing. */
  link: { label: string; href: string };
  /** The one picture that stands for the project in the underwater library, 4:5. The list
   * holds exactly one: one project, one card, one picture. */
  library: [string];
};
