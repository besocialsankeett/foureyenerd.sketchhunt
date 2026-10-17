'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Sound, type Sfx } from '@/audio/sound';
import { pondProjects, projectPath, projects } from '@/content/projects';
import { site } from '@/content/site';
import { Engine } from '@/scene/Engine';
import { fixedHour } from '@/scene/daylight';
import type { Phase } from '@/scene/fishing';
import CaseStudy from './CaseStudy';
import Cursor from './Cursor';
import Intro from './Intro';

/** What the line of help at the bottom says at each moment. */
function hintFor(phase: Phase, caught: number | null, tossable: boolean) {
  if (phase === 'waiting') return 'Wait for a bite';
  if (phase !== 'idle') return null;
  if (caught === null) return 'Pick a tag to go fishing, or scroll down for the project library';
  return tossable ? 'Click the water to throw it back' : `You caught ${pondProjects[caught].title}. Open it up.`;
}

/**
 * The scene and everything laid over it: a tag per project on its buoy, the Pull button,
 * and the case study of whichever project the address points at.
 */
export default function Sketchbook() {
  const pathname = usePathname();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const tagRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pullRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [selected, setSelected] = useState<number | null>(null);
  const [caught, setCaught] = useState<number | null>(null);
  const [seen, setSeen] = useState<number[]>([]);
  const [tossable, setTossable] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const soundRef = useRef<Sound | null>(null);
  /** What the sound switch says, which is what the visitor asked for. */
  const wantsSound = useRef(false);
  /** The opening has gone, so the scene can be heard. */
  const onShow = useRef(false);
  /** Any part of the way under: the surface's own controls are put away. */
  const [deep, setDeep] = useState(false);

  // The address decides which case study is showing: /work/<slug>, or none.
  const reading = projects.findIndex((project) => projectPath(project) === pathname);
  /** The project library is its own page laid over the pond. */
  const browsing = pathname === '/library';
  // A case study opened from the library is read underwater, and leads back to the library;
  // stepping on to the next project keeps it there. Remembered from the address before.
  const [trail, setTrail] = useState({ path: pathname, fromLibrary: false });
  const fromLibrary =
    trail.path === pathname ? trail.fromLibrary : reading >= 0 && (trail.path === '/library' || trail.fromLibrary);
  if (trail.path !== pathname) setTrail({ path: pathname, fromLibrary });
  // Kept for the tab, so a reload of a case study opened from the library stays underwater.
  useEffect(() => {
    try {
      if (reading >= 0 && fromLibrary) sessionStorage.setItem('fromLibrary', pathname);
      else if (reading < 0) sessionStorage.removeItem('fromLibrary');
    } catch {
      // Storage unavailable: the case study just opens at the boat after a reload.
    }
  }, [reading, fromLibrary, pathname]);
  useEffect(() => {
    try {
      if (reading >= 0 && sessionStorage.getItem('fromLibrary') === pathname) setTrail({ path: pathname, fromLibrary: true });
    } catch {
      // As above.
    }
    // Only on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Below the surface: in the library, or reading a project opened from it. */
  const underwater = browsing || (reading >= 0 && fromLibrary);
  const backTo = fromLibrary ? '/library' : '/';
  // The server cannot tell which page the layout is drawn for, so anything that depends on it
  // waits until the page is running in the browser, to match what the server sent.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const readingRef = useRef(reading);
  readingRef.current = reading;
  const underwaterRef = useRef(underwater);
  underwaterRef.current = underwater;
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(
      canvas,
      pondProjects.map((project) => project.catch),
    );
    engineRef.current = engine;
    // Exposed for debugging in the browser console during development.
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __engine?: Engine }).__engine = engine;

    const sound = new Sound();
    soundRef.current = sound;
    if (process.env.NODE_ENV !== 'production') (window as unknown as { __sound?: Sound }).__sound = sound;
    // The scene is already running behind the opening; it is not heard until it is seen.
    sound.holdAmbience();
    engine.onSound = (name, amount, pan) => {
      if (onShow.current) sound.play(name, amount, pan);
    };
    // The switch starts out showing what the visitor chose last time. A browser will not let
    // a page make noise until it has been clicked or typed at, so the sound itself begins at
    // the first such moment; unless that moment is the switch being used, which decides for
    // itself.
    if (Sound.remembered()) {
      wantsSound.current = true;
      setSoundOn(true);
    }
    const wake = (event: Event) => {
      if (event.target instanceof Element && event.target.closest('.sound, .intro')) return;
      if (wantsSound.current && !sound.enabled) sound.setEnabled(true);
    };
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);

    // Scrolling down from the pond dives into the water, to the project library; scrolling
    // up there comes back to the pond. One step per gesture, however long a trackpad keeps
    // scrolling after the fingers have left it.
    let gathered = 0;
    let lastPush = 0;
    let quietUntil = 0;
    let swipeFrom: { id: number; x: number; y: number } | null = null;
    const step = (direction: number) => {
      const inLibrary = window.location.pathname === '/library';
      if (direction > 0 && !inLibrary) routerRef.current.push('/library', { scroll: false });
      else if (direction < 0 && inLibrary) routerRef.current.push('/', { scroll: false });
    };
    // The library page handles its own scrolling, swiping and keys.
    const blocked = (target: EventTarget | null) =>
      !onShow.current ||
      readingRef.current >= 0 ||
      window.location.pathname === '/library' ||
      (target instanceof Element && target.closest('.book, .enlarged, .intro') !== null);

    // The library asks the scene to go deeper, and to make a sound, through window events.
    const onDepth = (event: Event) => engine.setLibraryDepth((event as CustomEvent<number>).detail);
    const onSound = (event: Event) => {
      const { name, amount } = (event as CustomEvent<{ name: Sfx; amount?: number }>).detail;
      if (onShow.current) sound.play(name, amount);
    };
    window.addEventListener('library:depth', onDepth);
    window.addEventListener('sketchbook:sound', onSound);
    const push = (amount: number) => {
      const now = performance.now();
      if (now - lastPush > 250) gathered = 0;
      lastPush = now;
      if (now < quietUntil) return;
      gathered += amount;
      if (Math.abs(gathered) > 60) {
        step(Math.sign(gathered));
        gathered = 0;
        quietUntil = now + 900;
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!blocked(event.target)) push(event.deltaMode === 1 ? event.deltaY * 30 : event.deltaY);
    };
    // A swipe, however it arrives: a finger, a pen, or a mouse dragged. Up dives, down rises.
    const onSwipeStart = (event: PointerEvent) => {
      swipeFrom = event.isPrimary && !blocked(event.target) ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
    };
    const onSwipeEnd = (event: PointerEvent) => {
      if (!swipeFrom || event.pointerId !== swipeFrom.id) return;
      const dx = event.clientX - swipeFrom.x, dy = event.clientY - swipeFrom.y;
      swipeFrom = null;
      if (Math.abs(dy) > 50 && Math.abs(dy) > Math.abs(dx) * 1.2) step(dy < 0 ? 1 : -1);
    };
    const onKey = (event: KeyboardEvent) => {
      if (blocked(event.target)) return;
      if (event.key === 'ArrowDown' || event.key === 'PageDown') step(1);
      else if (event.key === 'ArrowUp' || event.key === 'PageUp' || event.key === 'Escape') step(-1);
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('pointerdown', onSwipeStart, { passive: true });
    window.addEventListener('pointerup', onSwipeEnd, { passive: true });
    window.addEventListener('keydown', onKey);

    // The pond runs through its own day on a loop, unless the address fixes an hour.
    const hour = fixedHour();
    if (hour !== null) engine.fixHour(hour);

    let shownTossable = false;
    let shownMood = '';
    let shownDeep = false;
    let shownPhase: Phase | null = null;
    let shownSelected: number | null | undefined;
    let shownCaught: number | null | undefined;
    engine.onCatchClick = () => {
      if (typeof shownCaught === 'number') routerRef.current.push(projectPath(pondProjects[shownCaught]), { scroll: false });
    };
    const unsubscribe = engine.subscribe((frame) => {
      // These move every frame, so they are positioned directly rather than through React.
      frame.tags.forEach((tag, i) => {
        const element = tagRefs.current[i];
        if (element) {
          element.style.transform = `translate(${tag.x}px, ${tag.y}px) translate(-50%, -100%) rotate(${-tag.tilt}rad)`;
        }
      });
      // The Pull button sits just above the float, where the visitor is already looking.
      if (frame.phase === 'hooked' && pullRef.current) {
        pullRef.current.style.translate = `${frame.float.x}px ${frame.float.y}px`;
      }
      if (openRef.current) openRef.current.style.translate = `${frame.catch.x}px ${frame.catch.y}px`;

      // A case study read at the surface needs its catch in the boat, and open, however the
      // visitor got here. One read underwater leaves the boat as it was.
      // (Indexes on the pond count only the projects that have a catch.)
      const want = underwaterRef.current || readingRef.current < 0 ? -1 : pondProjects.indexOf(projects[readingRef.current] as (typeof pondProjects)[number]);
      if (want >= 0 && frame.caught !== want) engine.place(want);
      engine.setOpen(want >= 0 && frame.caught === want);

      if (frame.dive > 0.01 !== shownDeep) setDeep((shownDeep = frame.dive > 0.01));
      // The crickets and frogs are above the water: under it they cannot be heard.
      sound.setNight(frame.night * (1 - frame.dive));
      if (frame.mood !== shownMood) document.documentElement.dataset.mood = shownMood = frame.mood;
      if (frame.tossable !== shownTossable) setTossable((shownTossable = frame.tossable));
      if (shownPhase === null) setReady(true);
      if (frame.phase !== shownPhase) setPhase((shownPhase = frame.phase));
      if (frame.selected !== shownSelected) setSelected((shownSelected = frame.selected));
      if (frame.caught !== shownCaught) {
        const landed = (shownCaught = frame.caught);
        setCaught(landed);
        if (landed !== null) setSeen((list) => (list.includes(landed) ? list : [...list, landed]));
      }
    });

    return () => {
      // Silence first, so that nothing below can leave sound running if it goes wrong.
      sound.dispose();
      soundRef.current = null;
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('pointerdown', onSwipeStart);
      window.removeEventListener('pointerup', onSwipeEnd);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('library:depth', onDepth);
      window.removeEventListener('sketchbook:sound', onSound);
      unsubscribe();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const hooked = phase === 'hooked';
  // Keyboard users were on a tag when they cast; bring them to the control that matters now.
  useEffect(() => {
    if (hooked && document.activeElement?.classList.contains('tag')) pullRef.current?.focus();
  }, [hooked]);

  // A case study closes with Escape, or with a click anywhere on the water around the book,
  // back to wherever it was opened from.
  useEffect(() => {
    if (reading < 0) return;
    const close = () => routerRef.current.push(backTo, { scroll: false });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // Caught on the way down, before the scene takes the click as fishing.
    const onClick = (event: MouseEvent) => {
      if (event.target !== canvasRef.current) return;
      event.stopPropagation();
      close();
    };
    document.documentElement.dataset.reading = 'true';
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick, true);
    return () => {
      delete document.documentElement.dataset.reading;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
    };
  }, [reading, backTo]);

  // The library page is laid over open water: the view goes under while it is open, and
  // stays under while a project opened from it is read.
  useEffect(() => {
    engineRef.current?.browse(underwater);
  }, [underwater]);
  useEffect(() => {
    document.documentElement.dataset.page = browsing ? 'library' : 'pond';
  }, [browsing]);

  // Everything that belongs to the surface fades while the view is under it.
  useEffect(() => {
    document.documentElement.dataset.dive = String(deep);
  }, [deep]);

  const busy = phase !== 'idle' && phase !== 'waiting';
  const hint = ready && reading < 0 && !browsing ? hintFor(phase, caught, tossable) : null;
  const canOpen = caught !== null && phase === 'idle' && reading < 0;

  return (
    <>
      <canvas ref={canvasRef} className="scene" data-ready={ready} aria-hidden="true" />
      <Cursor />
      <Intro
        ready={ready}
        brief={mounted && (reading >= 0 || browsing)}
        name={site.name}
        hello={site.hello}
        onEnter={(withSound) => {
          wantsSound.current = withSound;
          soundRef.current?.setEnabled(withSound);
          setSoundOn(withSound);
        }}
        play={(name, amount) => soundRef.current?.play(name, amount)}
        onLeave={() => {
          onShow.current = true;
          soundRef.current?.releaseAmbience();
        }}
      />
      <header className="masthead" data-visible={ready && reading < 0}>
        {/* The page's main heading is the name here, and the project's title on a case study. */}
        {reading < 0 ? <h1>{site.name}</h1> : <p className="masthead__name">{site.name}</p>}
        <p className="masthead__line">{site.line}</p>
      </header>
      <button
        type="button"
        className="sound"
        aria-pressed={soundOn}
        onClick={() => {
          const on = !soundOn;
          wantsSound.current = on;
          soundRef.current?.setEnabled(on);
          setSoundOn(on);
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" />
          {soundOn ? <path d="M16 9a4.5 4.5 0 0 1 0 6M18.8 6.5a8 8 0 0 1 0 11" /> : <path d="M16.5 9.5l5 5M21.5 9.5l-5 5" />}
        </svg>
        <span className="sound__label">Sound is {soundOn ? 'on' : 'off'}</span>
      </button>
      <Link href="/library" scroll={false} className="to-library" data-visible={ready && reading < 0 && !browsing}>
        {/* The sketchbook-tide mark: shown instead of the words on a phone. */}
        <svg className="to-library__icon" viewBox="0 0 64 64" aria-hidden="true">
          <path
            d="M32 18C24 12 14 12 6 15V50C14 47 24 47 32 53C40 47 50 47 58 50V15C50 12 40 12 32 18Z"
            fill="#fff8e6"
            stroke="#4a1512"
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M32 18V53" stroke="#4a1512" strokeWidth="3" />
          <path d="M10 36q5-5 10 0t9 0M35 36q5-5 10 0t9 0" fill="none" stroke="#3f8fc4" strokeWidth="3.5" strokeLinecap="round" />
          <path d="M10 43q5-4 10 0t9 0M35 43q5-4 10 0t9 0" fill="none" stroke="#3f8fc4" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
        </svg>
        <span className="to-library__label">Project Library</span>
      </Link>
      {/* On a phone, in place of the help line: an invitation to swipe down into the water. */}
      <Link
        href="/library"
        scroll={false}
        className="swipe"
        data-visible={ready && reading < 0 && !browsing && !deep}
        tabIndex={ready && reading < 0 && !browsing && !deep ? 0 : -1}
      >
        Swipe to dive in
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5L6 7.5L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <nav className="tags" aria-label="Projects" data-ready={ready}>
        {pondProjects.map((project, i) => (
          <button
            key={project.slug}
            ref={(element) => {
              tagRefs.current[i] = element;
            }}
            type="button"
            className="tag"
            aria-pressed={selected === i || caught === i}
            aria-disabled={busy}
            data-seen={seen.includes(i)}
            onClick={() => {
              if (busy) return;
              // Fishing for something else puts the case study away.
              if (reading >= 0) router.push('/', { scroll: false });
              engineRef.current?.cast(i);
            }}
            onPointerEnter={() => engineRef.current?.look(i)}
            onPointerLeave={() => engineRef.current?.look(null)}
            onFocus={() => engineRef.current?.look(i)}
            onBlur={() => engineRef.current?.look(null)}
          >
            <span className="tag__title">{project.title}</span>
            <span className="tag__kind">{project.kind}</span>
          </button>
        ))}
      </nav>
      <button
        ref={pullRef}
        type="button"
        className="pull"
        data-visible={hooked}
        tabIndex={hooked ? 0 : -1}
        aria-hidden={!hooked}
        onClick={() => engineRef.current?.pull()}
      >
        Pull!
      </button>
      <Link
        ref={openRef}
        href={caught !== null ? projectPath(pondProjects[caught]) : '/'}
        scroll={false}
        className="open"
        data-visible={canOpen}
        tabIndex={canOpen ? 0 : -1}
        aria-hidden={!canOpen}
      >
        Open{caught !== null && <span className="visually-hidden"> the {pondProjects[caught].title} case study</span>}
      </Link>
      <p className="hint" data-visible={hint !== null} aria-live="polite">
        {hint}
      </p>
      {reading >= 0 && (
        <CaseStudy
          key={projects[reading].slug}
          project={projects[reading]}
          previous={projects[(reading + projects.length - 1) % projects.length]}
          next={projects[(reading + 1) % projects.length]}
          from={fromLibrary ? 'library' : 'boat'}
        />
      )}
    </>
  );
}
