'use client';

import { useEffect, useRef, useState } from 'react';

/** The size the site is laid out at inside the frame, before it is scaled to fit. */
const WIDTH = 1280;
const HEIGHT = 800;

/**
 * A live look at a website, drawn as a small browser window. The real page is loaded at
 * desktop size and scaled down to fit; clicking anywhere on it opens the site itself.
 */
export default function SitePreview({ url, title }: { url: string; title: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setScale(element.clientWidth / WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <figure className="browser">
      <div className="browser__bar" aria-hidden="true">
        <span />
        <span />
        <span />
        <p>{url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</p>
      </div>
      <div ref={frame} className="browser__view" style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}>
        {scale > 0 && (
          <iframe
            src={url}
            title={title}
            width={WIDTH}
            height={HEIGHT}
            loading="lazy"
            tabIndex={-1}
            style={{ transform: `scale(${scale})` }}
          />
        )}
        <a className="browser__link" href={url} target="_blank" rel="noopener noreferrer">
          <span className="visually-hidden">Open {title} in a new tab</span>
        </a>
      </div>
    </figure>
  );
}
