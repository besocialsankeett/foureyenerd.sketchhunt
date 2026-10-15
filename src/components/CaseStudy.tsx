'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { projectPath, type Project } from '@/content/projects';
import type { Media } from '@/content/types';
import SitePreview from './SitePreview';

type Picture = Extract<Media, { type: 'image' }>;

/** A picture taped into the book. Pressing it shows it full size. */
function Figure({ media, onEnlarge }: { media: Media; onEnlarge: (picture: Picture) => void }) {
  if (media.type === 'site') return <SitePreview url={media.url} title={media.title} />;
  return (
    <figure className="taped">
      <button type="button" className="taped__open" onClick={() => onEnlarge(media)} aria-label={`Show full size: ${media.alt}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={media.src} alt={media.alt} width={media.width} height={media.height} loading="lazy" />
      </button>
      {media.caption && <figcaption>{media.caption}</figcaption>}
    </figure>
  );
}

/** One picture over everything, as large as the screen allows. Escape or a click closes it. */
function Enlarged({ picture, onClose }: { picture: Picture; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    close.current?.focus();
    // Caught before the book's own Escape handler, which would close the whole case study.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      returnTo?.focus({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="enlarged" role="dialog" aria-modal="true" aria-label={picture.caption ?? 'Picture'} onClick={onClose}>
      <button ref={close} type="button" className="enlarged__close" onClick={onClose}>
        Close <span aria-hidden="true">×</span>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={picture.src} alt={picture.alt} width={picture.width} height={picture.height} onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

/** `from` is where closing the book returns to: the boat, or the project library underwater. */
type Props = { project: Project; previous: Project; next: Project; from?: 'boat' | 'library' };

/**
 * A project written up as an open sketchbook, laid over the middle of the scene. The left
 * page is the title page and stays put; the right page holds the work and scrolls. It is
 * ordinary page content: real headings, text and links, readable without the scene.
 */
export default function CaseStudy({ project, previous, next, from = 'boat' }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [enlarged, setEnlarged] = useState<Picture | null>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [project.slug]);

  return (
    <article className="book" aria-labelledby="book-title">
      <div className="book__title-page">
        <Link href={from === 'library' ? '/library' : '/'} scroll={false} className="book__close">
          <span aria-hidden="true">←</span> Back to the {from}
        </Link>

        <header>
          <p className="book__kind">{project.kind}</p>
          <h1 id="book-title" ref={heading} tabIndex={-1}>
            {project.title}
          </h1>
          <p className="book__summary">{project.summary}</p>
        </header>

        <dl className="book__facts">
          {project.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>

        <a className="button" href={project.link.href} target="_blank" rel="noopener noreferrer">
          {project.link.label} <span aria-hidden="true">↗</span>
        </a>

        <nav className="book__more" aria-label="Other projects">
          <Link href={projectPath(previous)} scroll={false}>
            <span aria-hidden="true">←</span> {previous.title}
          </Link>
          <Link href={projectPath(next)} scroll={false}>
            {next.title} <span aria-hidden="true">→</span>
          </Link>
        </nav>
      </div>

      <div className="book__work">
        <Figure media={project.lead} onEnlarge={setEnlarged} />

        {project.sections.map((section) => (
          <section key={section.heading} className="book__section">
            <h2>{section.heading}</h2>
            {section.body?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.points && (
              <ul>
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
            {section.swatches && (
              <ul className="swatches">
                {section.swatches.map((swatch) => (
                  <li key={swatch.hex}>
                    <span style={{ background: swatch.hex }} />
                    {swatch.name}
                    <small>{swatch.hex}</small>
                  </li>
                ))}
              </ul>
            )}
            {section.media?.map((media) => (
              <Figure key={media.type === 'image' ? media.src : media.url} media={media} onEnlarge={setEnlarged} />
            ))}
          </section>
        ))}

        {project.gallery?.map((media) => (
          <Figure key={media.type === 'image' ? media.src : media.url} media={media} onEnlarge={setEnlarged} />
        ))}
      </div>
      {/* Outside the book, which clips and transforms what is inside it. */}
      {enlarged && createPortal(<Enlarged picture={enlarged} onClose={() => setEnlarged(null)} />, document.body)}
    </article>
  );
}
