'use client';

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Engine } from '@/scene/Engine';

/** Where on the screen the note's bubble was when the view began to rise, and its size. */
export type ThanksDetail = { x: number; y: number; size: number } | null;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * After a note is sent: the bubble the note rolled into floats up, and the view follows it
 * back up to the pond. It comes up just past the boat's bow and pops there; he is delighted,
 * pumps his fists and says thank you in a speech bubble, with a soft ding.
 */
export default function ThankYou({ engine }: { engine: RefObject<Engine | null> }) {
  const bubble = useRef<HTMLDivElement>(null);
  const [from, setFrom] = useState<ThanksDetail>(null);
  /** Said to screen readers, since the thanks itself is only his face and his cheer. */
  const [said, setSaid] = useState(false);
  /** Where his speech bubble points: the top of his head, on the screen. */
  const [say, setSay] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onThanks = (event: Event) => setFrom((event as CustomEvent<ThanksDetail>).detail ?? { x: 0, y: 0, size: 0 });
    window.addEventListener('sketchbook:thanks', onThanks);
    return () => window.removeEventListener('sketchbook:thanks', onThanks);
  }, []);

  useEffect(() => {
    if (!from) return;
    let gone = false;
    // The rest of the pond waits until his cheer is over.
    document.documentElement.dataset.thanks = 'true';
    // However it ends, never for longer than the whole thank-you takes.
    const giveBack = setTimeout(() => delete document.documentElement.dataset.thanks, 9000);
    const run = async () => {
      const element = bubble.current;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const w = window.innerWidth, h = window.innerHeight;
      const at = (x: number, y: number, scale = 1) => `translate(${x - from.size / 2}px, ${y - from.size / 2}px) scale(${scale})`;
      if (element && from.size && !still) {
        // Up through the water, wobbling, while the view rises after it.
        await element.animate(
          [
            { transform: at(from.x, from.y), offset: 0 },
            { transform: at(from.x - 24, from.y - h * 0.22, 1.05), offset: 0.3 },
            { transform: at(from.x + 20, h * 0.42, 1.1), offset: 0.65 },
            { transform: at(w * 0.5, h * 0.5, 1.1), offset: 1 },
          ],
          { duration: 2300, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
        ).finished;
        if (gone) return;
        // Over to the surface just past the bow, where it pops.
        const found = engine.current?.thanksPoint() ?? { x: w * 0.6, y: h * 0.55 };
        const point = { x: Math.min(w - 40, Math.max(40, found.x)), y: found.y };
        await element.animate([{ transform: at(w * 0.5, h * 0.5, 1.1) }, { transform: at(point.x, point.y, 1) }], {
          duration: 500,
          easing: 'cubic-bezier(0.3, 0, 0.3, 1)',
          fill: 'forwards',
        }).finished;
        if (gone) return;
        await element.animate(
          [
            { transform: at(point.x, point.y, 1), opacity: 1 },
            { transform: at(point.x, point.y, 1.7), opacity: 0 },
          ],
          { duration: 220, easing: 'ease-out', fill: 'forwards' },
        ).finished;
      } else {
        await wait(1800);
      }
      if (gone) return;
      engine.current?.thank();
      window.dispatchEvent(new CustomEvent('sketchbook:sound', { detail: { name: 'drip', amount: 0.8 } }));
      // A soft ding a beat after the pop.
      setTimeout(() => window.dispatchEvent(new CustomEvent('sketchbook:sound', { detail: { name: 'ding', amount: 0.35 } })), 350);
      setTimeout(() => setSaid(false), 4000);
      setSay(engine.current?.speechPoint() ?? { x: window.innerWidth / 2, y: window.innerHeight * 0.35 });
      setTimeout(() => setSay(null), 3400);
      setSaid(true);
      clearTimeout(giveBack);
      setTimeout(() => delete document.documentElement.dataset.thanks, 3200);
      setFrom(null);
    };
    void run();
    return () => {
      gone = true;
    };
  }, [from, engine]);

  return (
    <>
      {from && from.size > 0 && (
        <div
          ref={bubble}
          className="thanks__bubble"
          aria-hidden="true"
          style={{ width: from.size, height: from.size, transform: `translate(${from.x - from.size / 2}px, ${from.y - from.size / 2}px)` }}
        />
      )}
      {say && (
        // Kept on the screen, its tail still pointing down at his head.
        <div
          className="thanks__say"
          aria-hidden="true"
          style={
            {
              left: Math.min(window.innerWidth - 130, Math.max(130, say.x)),
              top: say.y,
              '--tail': `${say.x - Math.min(window.innerWidth - 130, Math.max(130, say.x))}px`,
            } as CSSProperties
          }
        >
          <p>Thank you for the note!</p>
        </div>
      )}
      <p className="visually-hidden" role="status">
        {said ? 'Note received, thank you!' : ''}
      </p>
    </>
  );
}
