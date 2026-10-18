'use client';

import { Anton } from 'next/font/google';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Sfx } from '@/audio/sound';
import { projectPath, projects } from '@/content/projects';
import manifest from '@/scene/manifest.json';
import NoteShell from './NoteShell';

/** A tall, heavy condensed face for the big word, the nearest free match to the reference's. */
const display = Anton({ weight: '400', subsets: ['latin'] });

/** The word shown when no project is chosen. */
const DEFAULT_WORD = 'Library';
/** Between letters starting to move, from the middle outwards, in seconds. */
const STAGGER = 0.05;

type Layer = {
  key: number;
  text: string;
  /** A project's name (in the accent colour), or the library's own word. */
  project: boolean;
  /** Coming in, or on its way out; and which way it moves. */
  state: 'in' | 'out';
  from: 'below' | 'above';
};

/** Each project's square thumbnail, and where that square sits in its full picture. */
type Crop = { left: number; top: number; side: number };
const nameOf = (src: string) => src.replace(/^.*\//, '').replace(/\.webp$/, '');
const thumbOf = (src: string) => src.replace(/\.webp$/, '-thumb.webp');
const cropOf = (src: string): Crop =>
  (manifest.libraryThumbs as Record<string, Crop>)[nameOf(src)] ?? { left: 0, top: 0.1, side: 1 };

/** The library word alone sits just under the surface; each project a little deeper. */
const depthOf = (index: number | null) => (index === null ? 0 : (index + 1) / projects.length);

/** The page asks the scene for depth and sound through window events. */
const tell = (type: string, detail: unknown) => window.dispatchEvent(new CustomEvent(type, { detail }));
const sound = (name: Sfx, amount = 1) => tell('sketchbook:sound', { name, amount });

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The window's place, and its title's and kind's, worked out from the screen. */
type Frame = { left: number; top: number; width: number; height: number; titleTop: number; titleSize: number; kindTop: number };

/**
 * Every project on one page, after the reference: a row of small pictures near the top, and
 * one huge word across the middle. Pointing at a picture grows it, brings a round follower
 * with an arrow under the pointer, and rolls the word over, letter by letter from the middle,
 * into that project's name. Scrolling or swiping goes down through the projects one by one,
 * and deeper into the pond's own water with each. Choosing one opens its picture out of its
 * thumbnail into a large window, its name over it, with a glass button to its case study.
 */
export default function ProjectLibrary() {
  const router = useRouter();
  const [active, setActive] = useState<number | null>(null);
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, text: DEFAULT_WORD, project: false, state: 'in', from: 'below' }]);
  const [size, setSize] = useState<Record<string, number>>({});
  /** The pointer is over the row of pictures, so the follower shows. */
  const [pointing, setPointing] = useState(false);
  /** The project opened out into the large window; whether it is closing; its placement. */
  const [focus, setFocus] = useState<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [frame, setFrame] = useState<Frame | null>(null);
  const shown = useRef<number | null>(null);
  const next = useRef(1);
  const row = useRef<HTMLDivElement>(null);
  const follower = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const thumbs = useRef<(HTMLImageElement | null)[]>([]);
  const windowRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const caseRef = useRef<HTMLAnchorElement>(null);
  /** Whether the chosen project came from the pointer (it lets go when the pointer leaves). */
  const byPointer = useRef(false);
  /** How the window should arrive: grown out of its thumbnail, or slid in from a neighbour. */
  const arrival = useRef<'grow' | number>('grow');
  const activeRef = useRef(active);
  activeRef.current = active;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  /** Below the last project, on the pond floor with the shell; and whether a note is open. */
  const [floor, setFloor] = useState(false);
  const floorRef = useRef(floor);
  floorRef.current = floor;
  const writing = useRef(false);
  const onNoteOpen = useCallback((open: boolean) => {
    writing.current = open;
  }, []);

  const choose = useCallback((index: number | null, fromPointer: boolean) => {
    byPointer.current = fromPointer;
    setActive(index);
  }, []);

  // Roll the word over whenever the chosen project changes, and go to that project's depth.
  useEffect(() => {
    tell('library:depth', floor ? 1 : depthOf(active));
  }, [active, floor]);
  useEffect(() => {
    if (shown.current === active) return;
    shown.current = active;
    sound('bubble', 0.8);
    // Towards a project the old word goes up and the new rises from below; back to the
    // library's own word, the other way round.
    const from: Layer['from'] = active === null ? 'above' : 'below';
    const key = next.current++;
    setLayers((current) => [
      ...current
        .filter((layer) => layer.state === 'in')
        .map((layer) => ({ ...layer, state: 'out' as const, from })),
      {
        key,
        text: active === null ? DEFAULT_WORD : projects[active].title,
        project: active !== null,
        state: 'in',
        from,
      },
    ]);
    // The words on their way out are cleared away once they have gone.
    const timer = setTimeout(() => setLayers((current) => current.filter((layer) => layer.state === 'in' || layer.key > key)), 1400);
    return () => clearTimeout(timer);
  }, [active]);

  // Every word is sized to fill the width, as large as the reference's, but never wider than
  // the screen, nor so tall it crowds the pictures above: a long name comes out smaller. The
  // band it rolls through is made as tall as the largest word, so no letter is cut off, and on
  // a short screen it is moved down clear of the row of pictures.
  useLayoutEffect(() => {
    const measure = () => {
      const box = band.current, strip = row.current;
      if (!box || !strip) return;
      const probe = document.createElement('span');
      probe.className = display.className;
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:100px;text-transform:uppercase;letter-spacing:-0.01em';
      document.body.appendChild(probe);
      const fits: Record<string, number> = {};
      const room = box.clientWidth * 0.92;
      const rowBottom = strip.offsetTop + strip.offsetHeight;
      const below = window.innerHeight - rowBottom - 16;
      const largest = Math.min(window.innerWidth * 0.28, window.innerHeight * 0.55, below / 1.06);
      const bandHeight = Math.ceil(largest * 1.06);
      const shift = Math.max(0, rowBottom + 8 - (window.innerHeight - bandHeight) / 2);
      page.current?.style.setProperty('--band', `${bandHeight}px`);
      page.current?.style.setProperty('--band-shift', `${shift}px`);
      for (const text of [DEFAULT_WORD, ...projects.map((project) => project.title)]) {
        probe.textContent = text;
        fits[text] = Math.min(largest, (room / probe.offsetWidth) * 100);
      }
      probe.remove();
      setSize(fits);
    };
    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // The follower trails the pointer across the row, hanging just below it.
  useEffect(() => {
    const box = row.current, dot = follower.current;
    if (!box || !dot) return;
    const still = reduced();
    let x = 0, y = 0, at = { x: 0, y: 0 }, raf = 0, placed = false;
    const move = (event: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      x = event.clientX - rect.left - 30;
      y = event.clientY - rect.top;
      if (!placed) {
        at = { x, y };
        placed = true;
      }
    };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const ease = still ? 1 : 0.16;
      at = { x: at.x + (x - at.x) * ease, y: at.y + (y - at.y) * ease };
      dot.style.translate = `${at.x}px ${at.y}px`;
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerenter', move);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerenter', move);
    };
  }, []);

  /** Open a project's window, grown out of its thumbnail. */
  const open = useCallback(
    (index: number) => {
      arrival.current = 'grow';
      choose(index, false);
      setFocus(index);
      sound('whoosh', 0.6);
    },
    [choose],
  );

  /** Swap the open window for a neighbour's: -1 the one before, 1 the one after. */
  const sideways = useCallback(
    (way: number) => {
      const current = focusRef.current;
      if (current === null) return;
      const index = (current + way + projects.length) % projects.length;
      arrival.current = way;
      choose(index, false);
      setFocus(index);
    },
    [choose],
  );

  /** Back into its thumbnail, then gone; the keyboard goes back to that thumbnail. */
  const close = useCallback(() => {
    const index = focusRef.current;
    const card = windowRef.current, thumb = index === null ? null : thumbs.current[index];
    if (index === null || !card || !thumb || closing) return;
    setClosing(true);
    const done = () => {
      setFocus(null);
      setClosing(false);
      choose(null, false);
      (thumb.closest('a') as HTMLElement | null)?.focus({ preventScroll: true });
    };
    if (reduced()) return done();
    const crop = cropOf(projects[index].library[0]);
    card
      .animate([{ transform: 'none', clipPath: inset(card, null) }, grown(card, thumb, crop)], {
        duration: 450,
        easing: 'cubic-bezier(0.5, 0, 0.2, 1)',
        fill: 'forwards',
      })
      .finished.then(done, done);
  }, [choose, closing]);

  // Scrolling, swiping and the arrow keys go down through the projects and back up; at the
  // top, one more goes back up to the pond. With a window open, sideways moves to the next
  // project's window, and Escape closes it.
  useEffect(() => {
    let gathered = 0, lastPush = 0, quietUntil = 0;
    let start: { id: number; x: number; y: number } | null = null;
    const step = (way: number) => {
      if (focusRef.current !== null || writing.current) return;
      const current = activeRef.current;
      // Past the last project is the pond floor; up from there, back to the projects.
      if (floorRef.current) {
        if (way < 0) setFloor(false);
        return;
      }
      if (way > 0 && current === projects.length - 1) {
        setFloor(true);
        sound('bubble', 0.6);
        return;
      }
      if (way > 0) {
        const index = current === null ? 0 : Math.min(projects.length - 1, current + 1);
        if (index !== current) choose(index, false);
      } else if (current === null) router.push('/', { scroll: false });
      else choose(current === 0 ? null : current - 1, false);
    };
    const push = (amount: number) => {
      const now = performance.now();
      if (now - lastPush > 250) gathered = 0;
      lastPush = now;
      if (now < quietUntil) return;
      gathered += amount;
      if (Math.abs(gathered) > 60) {
        step(Math.sign(gathered));
        gathered = 0;
        quietUntil = now + 700;
      }
    };
    const onWheel = (event: WheelEvent) => push(event.deltaMode === 1 ? event.deltaY * 30 : event.deltaY);
    // A swipe, however it arrives: a finger, a pen, or a mouse dragged. A tap moves too little
    // to count, so it is left to be a click.
    const onSwipeStart = (event: PointerEvent) => {
      start = event.isPrimary ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
    };
    const onSwipeEnd = (event: PointerEvent) => {
      if (!start || event.pointerId !== start.id) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx)) step(dy < 0 ? 1 : -1);
      else if (Math.abs(dx) > 40) sideways(dx < 0 ? 1 : -1);
    };
    const onKey = (event: KeyboardEvent) => {
      if (writing.current) return;
      const isOpen = focusRef.current !== null;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isOpen) close();
        else router.push('/', { scroll: false });
      } else if (isOpen && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        sideways(event.key === 'ArrowRight' ? 1 : -1);
      } else if (!isOpen && (event.key === 'ArrowDown' || event.key === 'PageDown')) {
        event.preventDefault();
        step(1);
      } else if (!isOpen && (event.key === 'ArrowUp' || event.key === 'PageUp')) {
        event.preventDefault();
        step(-1);
      } else if (isOpen && event.key === 'Tab') {
        // The keyboard stays within the open window: its close button and its case study.
        const stops = [closeRef.current, caseRef.current].filter(Boolean) as HTMLElement[];
        const at = stops.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    const onSwipeCancel = () => {
      start = null;
    };
    window.addEventListener('pointerdown', onSwipeStart, { passive: true });
    window.addEventListener('pointerup', onSwipeEnd, { passive: true });
    window.addEventListener('pointercancel', onSwipeCancel, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerdown', onSwipeStart);
      window.removeEventListener('pointerup', onSwipeEnd);
      window.removeEventListener('pointercancel', onSwipeCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [choose, close, router, sideways]);

  // Where the window goes: its name above it, its kind below, the button at the bottom.
  useLayoutEffect(() => {
    if (focus === null) return;
    const place = () => {
      const w = window.innerWidth, h = window.innerHeight;
      const titleSize = Math.min(w * 0.12, 64, h * 0.1);
      const titleTop = Math.max(64, h * 0.08);
      const top = titleTop + titleSize * 1.05 + 14;
      const bottom = h - (caseRef.current?.offsetHeight ?? 50) - 24 - 44;
      const room = Math.max(80, bottom - top);
      const height = Math.min(room, w * 0.84 * 1.25, 760);
      const width = height / 1.25;
      setFrame({ left: (w - width) / 2, top: top + (room - height) / 2, width, height, titleTop, titleSize, kindTop: top + (room + height) / 2 + 10 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [focus]);

  // The window arrives: grown evenly out of its thumbnail, showing only what the thumbnail
  // showed and widening to the whole picture; or, moving between projects, slid in from the side.
  useLayoutEffect(() => {
    const card = windowRef.current, index = focus;
    if (index === null || !card || !frame) return;
    closeRef.current?.focus({ preventScroll: true });
    const way = arrival.current;
    arrival.current = 'grow';
    if (reduced()) return;
    if (way === 'grow') {
      const thumb = thumbs.current[index];
      if (!thumb) return;
      card.animate([grown(card, thumb, cropOf(projects[index].library[0])), { transform: 'none', clipPath: inset(card, null) }], {
        duration: 700,
        easing: 'cubic-bezier(0.2, 0.85, 0.2, 1)',
      });
    } else {
      card.animate(
        [
          { transform: `translateX(${way * 60}px) scale(0.94)`, opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 450, easing: 'cubic-bezier(0.2, 0.85, 0.2, 1)' },
      );
    }
    // Only when the window opens, changes project or is placed again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, frame?.width]);

  /** The case study: the picture glides forward and fades as the book opens over it. */
  const toCaseStudy = (event: React.MouseEvent<HTMLAnchorElement>) => {
    const card = windowRef.current;
    if (!card || reduced() || focus === null) return;
    event.preventDefault();
    const href = projectPath(projects[focus]);
    sound('whoosh', 0.5);
    card
      .animate(
        [
          { transform: 'none', opacity: 1, filter: 'blur(0px)' },
          { transform: 'translateY(-3%) scale(1.12)', opacity: 0, filter: 'blur(6px)' },
        ],
        { duration: 380, easing: 'cubic-bezier(0.4, 0, 0.6, 1)', fill: 'forwards' },
      )
      .finished.then(() => router.push(href, { scroll: false }));
  };

  const shownProject = focus === null ? null : projects[focus];
  const title = shownProject ? Array.from(shownProject.title.toUpperCase()) : [];

  return (
    <div ref={page} className="plib" data-focus={focus !== null && !closing} data-floor={floor}>
      <Link href="/" scroll={false} className="plib__back">
        <span aria-hidden="true">←</span> Back to the pond
      </Link>
      <h1 className="visually-hidden">Project Library</h1>

      <div
        ref={row}
        className="plib__row"
        data-pointing={pointing && focus === null}
        onPointerEnter={(event) => event.pointerType === 'mouse' && setPointing(true)}
        onPointerLeave={() => {
          setPointing(false);
          if (focus === null && byPointer.current) choose(null, false);
        }}
      >
        {projects.map((project, i) => (
          <Link
            key={project.slug}
            href={projectPath(project)}
            scroll={false}
            className="plib__thumb"
            data-active={active === i}
            data-lifted={focus === i}
            aria-label={`${project.title}, ${project.kind}`}
            onPointerEnter={(event) => {
              if (event.pointerType === 'mouse' && focus === null) choose(i, true);
            }}
            onFocus={() => focus === null && choose(i, false)}
            onClick={(event) => {
              // A project opens out into its window first; its case study is one step on.
              event.preventDefault();
              if (focus === null) open(i);
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={(element) => {
                thumbs.current[i] = element;
              }}
              src={thumbOf(project.library[0])}
              alt=""
              width={240}
              height={240}
              draggable={false}
            />
          </Link>
        ))}
        <div ref={follower} className="plib__follower" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="20" height="20">
            <path d="M6.5 2.75L12.9 9.1L15.25.4Z" fill="currentColor" />
            <path d="M.33 12.33L3.3 15.3L10.34 6.57L9.07 5.3Z" fill="currentColor" />
          </svg>
        </div>
      </div>

      <div ref={band} className={`plib__band ${display.className}`}>
        {layers.map((layer) => {
          const letters = Array.from(layer.text.toUpperCase());
          const middle = (letters.length - 1) / 2;
          return (
            <p
              key={layer.key}
              className="plib__word"
              data-state={layer.state}
              data-from={layer.from}
              data-project={layer.project}
              aria-hidden={layer.state === 'out'}
              style={{ fontSize: size[layer.text] ? `${size[layer.text]}px` : undefined }}
            >
              {letters.map((letter, i) => (
                <span key={i} style={{ '--delay': `${Math.abs(i - middle) * STAGGER}s` } as CSSProperties}>
                  {letter === ' ' ? ' ' : letter}
                </span>
              ))}
            </p>
          );
        })}
      </div>

      <button
        type="button"
        className="plib__down"
        data-visible={!floor && focus === null}
        tabIndex={!floor && focus === null ? 0 : -1}
        onClick={() => {
          setFloor(true);
          sound('bubble', 0.6);
        }}
      >
        Scroll down to leave a note
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <NoteShell shown={floor} onOpenChange={onNoteOpen} />

      {shownProject && focus !== null && (
        <div className="plib__focus" data-closing={closing} role="dialog" aria-modal="true" aria-label={shownProject.title}>
          <button type="button" className="plib__shade" tabIndex={-1} aria-hidden="true" onClick={close} />
          {frame && (
            <>
              <p
                key={`title-${focus}`}
                className={`plib__title ${display.className}`}
                style={{ top: frame.titleTop, fontSize: frame.titleSize }}
                aria-hidden="true"
              >
                {title.map((letter, i) => (
                  <span key={i} style={{ '--delay': `${0.2 + Math.abs(i - (title.length - 1) / 2) * 0.035}s` } as CSSProperties}>
                    {letter === ' ' ? ' ' : letter}
                  </span>
                ))}
              </p>
              <div
                ref={windowRef}
                className="plib__window"
                style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shownProject.library[0]} alt={shownProject.title} width={800} height={1000} draggable={false} />
              </div>
              <button
                ref={closeRef}
                type="button"
                className="plib__close"
                style={{ left: frame.left + frame.width - 26, top: frame.top - 18 }}
                onClick={close}
              >
                <span aria-hidden="true">×</span>
                <span className="visually-hidden">Close {shownProject.title}</span>
              </button>
              <p key={`kind-${focus}`} className="plib__kind" style={{ top: frame.kindTop }}>
                {shownProject.kind}
              </p>
            </>
          )}
          <Link ref={caseRef} href={projectPath(shownProject)} scroll={false} className="plib__case" onClick={toCaseStudy}>
            View Case Study <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/** A clip that shows the whole window, or (given a crop) only that square of its picture. */
function inset(card: HTMLElement, crop: Crop | null, radius = 16) {
  if (!crop) return `inset(0px 0px 0px 0px round ${radius}px)`;
  const w = card.offsetWidth, h = card.offsetHeight;
  const left = crop.left * w, top = crop.top * h, side = crop.side * w;
  return `inset(${top}px ${w - left - side}px ${h - top - side}px ${left}px round ${radius}px)`;
}

/**
 * The window shrunk and moved so that the square its thumbnail shows sits exactly over the
 * thumbnail, at the same size: one scale for both directions, so the picture never squashes.
 */
function grown(card: HTMLElement, thumb: HTMLElement, crop: Crop) {
  const from = thumb.getBoundingClientRect();
  const left = card.offsetLeft, top = card.offsetTop, w = card.offsetWidth, h = card.offsetHeight;
  const scale = from.width / (crop.side * w);
  const x = from.left - (left + crop.left * w * scale);
  const y = from.top - (top + crop.top * h * scale);
  return { transform: `translate(${x}px, ${y}px) scale(${scale})`, clipPath: inset(card, crop, 8 / scale) };
}
