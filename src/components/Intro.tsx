'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Sfx } from '@/audio/sound';
import { intro } from '@/content/site';
import manifest from '@/scene/manifest.json';

/** Timings in milliseconds: a flip's two halves, how long a face rests, and the parting. */
const TURN_AWAY = 170;
const TURN_BACK = 230;
const REST = 400;
const SPLIT = 900;
const LAST = intro.length - 1;
/** Each cutout is set down at a slightly different angle, in degrees, like stickers on a page. */
const TILT = [-3, 2.5, -1.5, 3, -2.5, 0];
/** The sound that goes with a face as it lands, beyond the flip itself, and how big it is. */
const ACCENT: Partial<Record<(typeof intro)[number]['face'], [Sfx, number]>> = {
  worried: ['womp', 1],
  surprised: ['ding', 1],
  straining: ['creak', 0.8],
  delighted: ['pop', 0.8],
};

const flat = (tilt: number) => `rotateZ(${tilt}deg)`;
/** Lifted off the page and turned about its upright axis; 90 is edge-on. */
const lifted = (turn: number, tilt: number) => `translateY(-4%) scale(1.06) rotateY(${turn}deg) rotateZ(${tilt}deg)`;

type Props = {
  /** The scene behind is loaded and drawing. */
  ready: boolean;
  /** No start screen and no run of faces: for arriving straight on a project's own address. */
  brief: boolean;
  /** Whose sketchbook it is, shown on the start screen, and the greeting arched above it. */
  name: string;
  hello: string;
  /** The visitor chose how to come in: with sound, or without. */
  onEnter: (withSound: boolean) => void;
  play: (name: Sfx, amount?: number) => void;
  /** The page has begun to part. */
  onLeave: () => void;
};

/**
 * The opening. It waits for the visitor to say whether they want sound, which is also what
 * lets a browser play any. Then a cutout of his head flips over like a card, each time a
 * different face with a different word under it, while a line grows across the middle of
 * the page; and the page parts along that line to show the scene. A click or a key skips
 * to the end; it never parts before the scene is ready.
 */
export default function Intro({ ready, brief, name, hello, onEnter, play, onLeave }: Props) {
  const [entered, setEntered] = useState(brief);
  const [face, setFace] = useState(brief ? LAST : 0);
  /** The cutout is turning away, so the word under it is on its way out. */
  const [turning, setTurning] = useState(false);
  /** Every face has had its turn, or the visitor skipped ahead. */
  const [played, setPlayed] = useState(brief);
  // Told only once in the browser that this is a project's own page: skip to the end.
  useEffect(() => {
    if (!brief) return;
    shown.current = LAST;
    setFace(LAST);
    setEntered(true);
    setPlayed(true);
  }, [brief]);
  /** The pictures are in, so the flips can begin. */
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<'playing' | 'leaving' | 'gone'>('playing');
  const cardRef = useRef<HTMLDivElement>(null);
  const shown = useRef(face);
  const still = useRef(false);
  const readyAt = useRef(0);
  const spin = useRef<Animation | null>(null);
  const halfway = useRef(0);
  const landing = useRef(0);
  const hooks = useRef({ play, onLeave });
  hooks.current = { play, onLeave };

  /** Flip the cutout over to another face. The face and its word change while it is edge-on. */
  const turnTo = (next: number) => {
    const card = cardRef.current;
    const from = shown.current;
    if (next === from) return;
    shown.current = next;
    clearTimeout(halfway.current);
    clearTimeout(landing.current);
    // Each flip sounds a step higher than the one before.
    hooks.current.play('flip', 2 ** (next / 6));
    landing.current = window.setTimeout(() => {
      const accent = ACCENT[intro[next].face];
      if (accent) hooks.current.play(...accent);
    }, TURN_AWAY + 140);
    if (still.current || !card) {
      setFace(next);
      return;
    }
    const way = next % 2 ? 1 : -1;
    setTurning(true);
    spin.current?.cancel();
    spin.current = card.animate([{ transform: flat(TILT[from]) }, { transform: lifted(90 * way, TILT[from]) }], {
      duration: TURN_AWAY,
      easing: 'cubic-bezier(0.5, 0, 1, 0.7)',
      fill: 'forwards',
    });
    halfway.current = window.setTimeout(() => {
      setFace(next);
      setTurning(false);
      card.style.transform = flat(TILT[next]);
      spin.current?.cancel();
      spin.current = card.animate([{ transform: lifted(-90 * way, TILT[next]) }, { transform: flat(TILT[next]) }], {
        duration: TURN_BACK,
        easing: 'cubic-bezier(0.15, 0.8, 0.3, 1.35)',
      });
    }, TURN_AWAY);
  };

  /** The visitor comes in. The cutout turns right over once, and the words begin. */
  const enter = (withSound: boolean) => {
    if (entered) return;
    onEnter(withSound);
    setEntered(true);
    hooks.current.play('flip', 1);
    if (still.current) return;
    const edge = TURN_AWAY / (TURN_AWAY + TURN_BACK);
    spin.current = cardRef.current?.animate(
      [
        { transform: flat(TILT[0]), easing: 'cubic-bezier(0.5, 0, 1, 0.7)' },
        { transform: lifted(90, TILT[0]), offset: edge },
        { transform: lifted(-90, TILT[0]), offset: edge, easing: 'cubic-bezier(0.15, 0.8, 0.3, 1.35)' },
        { transform: flat(TILT[0]) },
      ],
      { duration: TURN_AWAY + TURN_BACK },
    ) ?? null;
  };

  useEffect(() => {
    still.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cancelled = false;
    const images = Array.from(cardRef.current?.querySelectorAll('img') ?? []);
    const arrived = Promise.all(
      images.map(
        (image) =>
          image.complete ||
          new Promise((done) => {
            image.addEventListener('load', done, { once: true });
            image.addEventListener('error', done, { once: true });
          }),
      ),
    );
    const patience = new Promise((done) => setTimeout(done, 1500));
    Promise.race([arrived, patience]).then(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(halfway.current);
      clearTimeout(landing.current);
    };
  }, []);

  // One face after another. If the scene is slow, they go round again until it is ready.
  useEffect(() => {
    if (state !== 'playing' || brief || !entered || !loaded || (played && ready)) return;
    const timer = setTimeout(
      () => {
        if (face === LAST) setPlayed(true);
        if (face < LAST || !ready) turnTo((face + 1) % intro.length);
      },
      // The first face has only just finished turning over when its rest begins.
      REST + (face === 0 && !played ? 320 : 0),
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, state, brief, entered, loaded, played, ready]);

  // Once in, a click or a key skips to the last face.
  useEffect(() => {
    if (state !== 'playing' || brief || !entered) return;
    const skip = () => {
      turnTo(LAST);
      setPlayed(true);
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, brief, entered]);

  useEffect(() => {
    if (ready) readyAt.current = performance.now();
  }, [ready]);

  // Done and ready: let the line reach both edges and the scene finish fading in, then part.
  useEffect(() => {
    if (state !== 'playing' || !played || !ready || face !== shown.current) return;
    const wait = Math.max(450, 950 - (performance.now() - readyAt.current));
    const timer = setTimeout(() => setState('leaving'), wait);
    return () => clearTimeout(timer);
  }, [state, played, ready, face]);

  useEffect(() => {
    if (state !== 'leaving') return;
    hooks.current.onLeave();
    hooks.current.play('whoosh');
    const timer = setTimeout(() => setState('gone'), SPLIT + 200);
    return () => clearTimeout(timer);
  }, [state]);

  if (state === 'gone') return null;

  const progress = !entered ? 0 : played && ready ? 1 : played ? 0.9 : ((face + 1) / intro.length) * 0.9;

  return (
    <div className="intro" data-state={state} style={{ '--progress': progress } as CSSProperties}>
      {/* Without scripts nothing would ever take this away, so it must not be there. */}
      <noscript>
        <style>{'.intro{display:none}'}</style>
      </noscript>
      <div className="intro__half intro__half--top" aria-hidden="true" />
      <div className="intro__half intro__half--bottom" aria-hidden="true" />
      <div className="intro__line" aria-hidden="true" />
      <div className="intro__stage">
        <div className="intro__column">
          <div className="intro__head" aria-hidden="true">
            {!brief && (
              // A greeting arched over his head, in the picture's own units so it scales with it.
              <svg className="intro__hello" data-gone={entered} viewBox={`0 0 ${manifest.intro.w} ${manifest.intro.h}`}>
                <path id="intro-arch" d="M -44 262 A 300 300 0 0 1 556 262" fill="none" />
                <text>
                  <textPath href="#intro-arch" startOffset="50%" textAnchor="middle">
                    {hello}
                  </textPath>
                </text>
              </svg>
            )}
            <div ref={cardRef} className="intro__card" style={{ transform: flat(TILT[face]) }}>
              {intro.map((entry, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={entry.face}
                  src={`/intro/face-${entry.face}.webp`}
                  alt=""
                  width={manifest.intro.w}
                  height={manifest.intro.h}
                  decoding="async"
                  data-show={i === face}
                />
              ))}
            </div>
          </div>
          <p key={entered ? face : 'name'} className="intro__word" data-leaving={turning} aria-hidden="true">
            {entered ? intro[face].word : name}
          </p>
          {!entered && (
            <div className="intro__actions">
              <button type="button" className="button" onClick={() => enter(true)}>
                Enter with sound
              </button>
              <button type="button" className="button button--quiet" onClick={() => enter(false)}>
                Enter quietly
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
