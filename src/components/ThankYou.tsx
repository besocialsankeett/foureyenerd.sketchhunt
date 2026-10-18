'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Engine } from '@/scene/Engine';

/** Where the pearl was in the shell, and how to paint it from the shell's picture. */
export type ThanksDetail = {
  x: number;
  y: number;
  size: number;
  image: string;
  backgroundSize: string;
  backgroundPosition: string;
} | null;

/** The pearl stays in the pond's sky for the rest of the visit. */
const STAR = 'sketchbook:pearl-star';
const LINE = 'note received, thank you!';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * After a note is sent: the pearl lifts out of the shell and rises, glowing, with the view back
 * up to the pond. It comes up just past the boat's bow, where a bubble pops, he is delighted,
 * and a line of thanks shows; then the pearl floats up into the sky and stays there as a star.
 */
export default function ThankYou({ engine, pond }: { engine: RefObject<Engine | null>; pond: boolean }) {
  const lantern = useRef<HTMLDivElement>(null);
  const [pearl, setPearl] = useState<ThanksDetail>(null);
  const [line, setLine] = useState(false);
  const [star, setStar] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(STAR)) setStar(true);
    } catch {}
    const onThanks = (event: Event) => {
      setStar(false);
      setPearl((event as CustomEvent<ThanksDetail>).detail ?? { x: 0, y: 0, size: 0, image: '', backgroundSize: '', backgroundPosition: '' });
    };
    window.addEventListener('sketchbook:thanks', onThanks);
    return () => window.removeEventListener('sketchbook:thanks', onThanks);
  }, []);

  useEffect(() => {
    if (!pearl) return;
    let gone = false;
    const run = async () => {
      const element = lantern.current;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const w = window.innerWidth, h = window.innerHeight;
      const at = (x: number, y: number, scale = 1) => `translate(${x - pearl.size / 2}px, ${y - pearl.size / 2}px) scale(${scale})`;
      if (element && pearl.size && !still) {
        // Up through the water with the view, swaying as it goes.
        await element.animate(
          [
            { transform: at(pearl.x, pearl.y), offset: 0 },
            { transform: at(pearl.x - 30, pearl.y - h * 0.25, 1.15), offset: 0.3 },
            { transform: at(pearl.x + 26, h * 0.42, 1.25), offset: 0.65 },
            { transform: at(w * 0.5, h * 0.5, 1.2), offset: 1 },
          ],
          { duration: 2300, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
        ).finished;
        if (gone) return;
        // Over to the surface past the bow, where the bubble pops.
        const found = engine.current?.thanksPoint() ?? { x: w * 0.6, y: h * 0.55 };
        const point = { x: Math.min(w - 40, Math.max(40, found.x)), y: found.y };
        await element.animate([{ transform: at(w * 0.5, h * 0.5, 1.2) }, { transform: at(point.x, point.y, 1) }], {
          duration: 500,
          easing: 'cubic-bezier(0.3, 0, 0.3, 1)',
          fill: 'forwards',
        }).finished;
        if (gone) return;
        engine.current?.thank();
        window.dispatchEvent(new CustomEvent('sketchbook:sound', { detail: { name: 'bubble', amount: 1 } }));
        setLine(true);
        // Then up into the sky, smaller and smaller, to stay as a star.
        await element.animate([{ transform: at(point.x, point.y, 1) }, { transform: at(w * 0.86, h * 0.22, 0.22) }], {
          duration: 1800,
          delay: 400,
          easing: 'cubic-bezier(0.5, 0, 0.3, 1)',
          fill: 'forwards',
        }).finished;
      } else {
        await wait(1800);
        engine.current?.thank();
        setLine(true);
      }
      if (gone) return;
      try {
        sessionStorage.setItem(STAR, '1');
      } catch {}
      setStar(true);
      setPearl(null);
      await wait(2600);
      if (!gone) setLine(false);
    };
    void run();
    return () => {
      gone = true;
    };
  }, [pearl, engine]);

  return (
    <>
      {pearl && pearl.size > 0 && (
        <div
          ref={lantern}
          className="thanks__pearl"
          aria-hidden="true"
          style={{
            width: pearl.size,
            height: pearl.size,
            backgroundImage: `url(${pearl.image})`,
            backgroundSize: pearl.backgroundSize,
            backgroundPosition: pearl.backgroundPosition,
            transform: `translate(${pearl.x - pearl.size / 2}px, ${pearl.y - pearl.size / 2}px)`,
          }}
        />
      )}
      <p className="thanks__line" data-visible={line} role="status">
        {line &&
          Array.from(LINE).map((letter, i) => (
            <span key={i} style={{ '--delay': `${i * 0.03}s` } as CSSProperties}>
              {letter === ' ' ? ' ' : letter}
            </span>
          ))}
      </p>
      <span className="thanks__star" data-visible={star && pond} aria-hidden="true" />
    </>
  );
}
