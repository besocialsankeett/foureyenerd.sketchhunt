'use client';

import { useEffect, useRef } from 'react';

type Mode = 'arrow' | 'pencil' | 'bubble';

/** Anything that does something when clicked. */
const CLICKABLE = 'a, button, [role="button"], summary, label, select';
/** Where the pencil comes out: the opening's paper. A case study, and a picture opened from one,
 * keep the arrow; the project library is underwater, so it has the bubble. */
const PAPER = '.intro';
/** Where typing happens: the ordinary text cursor is shown there instead. */
const TYPING = 'input, textarea, [contenteditable="true"]';
/** How long the pencil's line takes to fade, and a bubble to rise and burst, in seconds. */
const TRAIL = 0.8;
const BUBBLE_LIFE = 1.3;

type Bubble = { x: number; y: number; r: number; rise: number; sway: number; born: number };

/**
 * The pointer, as one small character that changes with where it is: a chunky cozy-game
 * arrowhead on the pond and on case studies, a pencil on the opening (a pointing hand over its
 * buttons), and a bubble underwater and in the project library.
 * It flips over like the opening's cards when it changes. Only for a mouse or trackpad; touch
 * keeps its own ways, and with less motion asked for it only follows, without the extras.
 */
export default function Cursor() {
  const root = useRef<HTMLDivElement>(null);
  const swing = useRef<HTMLDivElement>(null);
  const flip = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const cursor = root.current, swinger = swing.current, flipper = flip.current, canvas = trail.current;
    if (!fine.matches || !cursor || !swinger || !flipper || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    html.dataset.cursor = 'on';

    let x = -100, y = -100;
    let target: Element | null = null;
    let shown: Mode | null = null;
    let active = false;
    let visible = false;
    let tilt = 0, tiltSpeed = 0, lastX = x, lastY = y, travelled = 0;
    let frame = 0, last = performance.now();
    let flipping = 0;
    const points: { x: number; y: number; t: number }[] = [];
    const bubbles: Bubble[] = [];

    const size = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    size();

    /** Which one it should be, for what is under it now. */
    const modeFor = (element: Element | null): Mode => {
      // The opening's paper covers everything until it parts, even where it lets clicks through.
      if (element?.closest(PAPER) || document.querySelector('.intro[data-state="playing"]')) return 'pencil';
      // A case study is read with the arrow, even when it was opened underwater.
      if (element?.closest('.book, .enlarged')) return 'arrow';
      return html.dataset.dive === 'true' ? 'bubble' : 'arrow';
    };
    /** Whether a click here would do something. Over the scene, the scene says so itself. */
    const activeFor = (element: Element | null) => {
      if (!element) return false;
      const clickable = element.closest(CLICKABLE);
      if (clickable) return !clickable.matches(':disabled, [aria-disabled="true"]');
      if (element instanceof HTMLCanvasElement) return element.style.cursor === 'pointer' || html.dataset.reading === 'true';
      return false;
    };

    const show = (mode: Mode) => {
      if (mode === shown) return;
      const first = shown === null;
      shown = mode;
      if (first || still) {
        cursor.dataset.mode = mode;
        return;
      }
      // Turned over like a card: the new face is put in while it is edge-on.
      clearTimeout(flipping);
      flipper.animate(
        [
          { transform: 'rotateY(0deg)', easing: 'cubic-bezier(0.5, 0, 1, 0.7)' },
          { transform: 'rotateY(90deg)', offset: 0.45 },
          { transform: 'rotateY(-90deg)', offset: 0.45, easing: 'cubic-bezier(0.15, 0.8, 0.3, 1.35)' },
          { transform: 'rotateY(0deg)' },
        ],
        { duration: 260 },
      );
      flipping = window.setTimeout(() => (cursor.dataset.mode = mode), 117);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      x = event.clientX;
      y = event.clientY;
      target = event.target instanceof Element ? event.target : null;
      const typing = !!target?.closest(TYPING);
      if (visible === typing) {
        visible = !typing;
        cursor.dataset.visible = String(visible);
      }
    };
    const onOut = (event: PointerEvent) => {
      // Gone out of the window, or into a framed site, which shows its own cursor.
      if (event.relatedTarget === null) {
        visible = false;
        cursor.dataset.visible = 'false';
      }
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
      if (still) return;
      const press =
        shown === 'arrow'
          ? [{ transform: 'none' }, { transform: 'scale(1.12, 0.78)', offset: 0.3 }, { transform: 'scale(0.94, 1.08)', offset: 0.65 }, { transform: 'none' }]
          : shown === 'bubble'
            ? [{ transform: 'none' }, { transform: 'scale(1.25, 0.8)', offset: 0.35 }, { transform: 'none' }]
            : [{ transform: 'none' }, { transform: 'scale(0.85)', offset: 0.35 }, { transform: 'none' }];
      cursor.querySelector('.cursor__press')?.animate(press, { duration: 260, easing: 'ease-out' });
    };

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      show(modeFor(target));
      const nowActive = activeFor(target);
      if (nowActive !== active) cursor.dataset.active = String((active = nowActive));
      cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;

      // It leans a little into the way it is moved, and springs back upright.
      const vx = dt > 0 ? (x - lastX) / dt : 0;
      travelled += Math.hypot(x - lastX, y - lastY);
      lastX = x;
      lastY = y;
      if (!still) {
        const want = Math.max(-0.25, Math.min(0.25, vx * 0.0004));
        tiltSpeed += ((want - tilt) * 120 - tiltSpeed * 12) * dt;
        tilt += tiltSpeed * dt;
        swinger.style.transform = `rotate(${tilt}rad)`;
      }

      // The pencil's line, and the bubbles, on a sheet over everything.
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (still || !visible) {
        points.length = 0;
        bubbles.length = 0;
        return;
      }
      if (shown === 'pencil') {
        const lastPoint = points[points.length - 1];
        if (!lastPoint || Math.hypot(lastPoint.x - x, lastPoint.y - y) > 1.5) points.push({ x, y, t });
      }
      while (points.length && t - points[0].t > TRAIL) points.shift();
      ctx.lineCap = 'round';
      ctx.lineWidth = 1.4;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        ctx.strokeStyle = `rgba(74, 21, 18, ${(0.32 * (1 - (t - b.t) / TRAIL)).toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      if (shown === 'bubble') {
        // A bubble comes off it every so far it moves.
        if (travelled > 34) {
          travelled = 0;
          bubbles.push({ x: x + (Math.random() - 0.5) * 8, y: y - 6, r: 2 + Math.random() * 3.5, rise: 35 + Math.random() * 35, sway: Math.random() * 6.28, born: t });
        }
      } else travelled = 0;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        const age = t - b.born;
        if (age > BUBBLE_LIFE) {
          bubbles.splice(i, 1);
          continue;
        }
        const bx = b.x + Math.sin(t * 5 + b.sway) * 3;
        const by = b.y - b.rise * age;
        const fade = 1 - age / BUBBLE_LIFE;
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.85 * fade).toFixed(3)})`;
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.12 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(bx, by, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.9 * fade).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(bx - b.r * 0.35, by - b.r * 0.35, b.r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    document.addEventListener('pointerout', onOut);
    window.addEventListener('resize', size);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(flipping);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('resize', size);
      delete html.dataset.cursor;
    };
  }, []);

  return (
    <>
      <canvas ref={trail} className="cursor-trail" aria-hidden="true" />
      <div ref={root} className="cursor" data-visible="false" data-mode="arrow" data-active="false" aria-hidden="true">
        <div ref={swing} className="cursor__swing">
          <div ref={flip} className="cursor__flip">
            <div className="cursor__press">
              {/* A chunky arrowhead with no stem, its tip at the point. */}
              <svg className="cursor__arrow" width="22" height="26" viewBox="-3 -3 22 26">
                <path d="M0 0L1.2 19L6.4 14.2L14.4 13Z" fill="#fff8e6" stroke="#4a1512" strokeWidth="2.6" strokeLinejoin="round" />
                <path d="M2.3 4.6L3 12.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M3.4 16.4L6 14" stroke="#e9d9b8" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              {/* A pencil stub, its lead at the point. */}
              <svg className="cursor__pencil" width="34" height="34" viewBox="0 0 34 34">
                <g transform="translate(2 2) rotate(45)">
                  <path d="M11 -4.5H33V4.5H11Z" fill="#f2c14e" />
                  <path d="M11 -1.5H33" stroke="#d99b2b" strokeWidth="1.2" />
                  <path d="M33 -4.5H37V4.5H33Z" fill="#b9b2a7" />
                  <path d="M37 -4.5H40.5Q42.5 -4.5 42.5 -2.6L42 -0.6L42.6 1.4Q42.5 4.5 40.5 4.5H37Z" fill="#e98a8a" />
                  <path d="M0.4 0L11 -4.5V4.5Z" fill="#f1d3a6" />
                  <path d="M0.4 0L4.2 -1.6V1.6Z" fill="#4a1512" />
                  <path
                    d="M0.4 0L11 -4.5H40.5Q42.5 -4.5 42.5 -2.6L42 -0.6L42.6 1.4Q42.5 4.5 40.5 4.5H11Z M33 -4.5V4.5 M37 -4.5V4.5 M11 -4.5V4.5"
                    fill="none"
                    stroke="#4a1512"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                </g>
              </svg>
              {/* The pointing hand, drawn the same way, its fingertip at the point. */}
              <svg className="cursor__hand" width="26" height="30" viewBox="0 0 28 32">
                <path
                  d="M9 1c1.6 0 2.8 1.2 2.8 2.8V13c0-1.4 1.1-2.4 2.5-2.4s2.5 1 2.5 2.4v1c0-1.4 1.1-2.4 2.5-2.4s2.5 1 2.5 2.4v1.2c0-1.3 1-2.2 2.3-2.2s2.3 1 2.3 2.3V24c0 4.4-3.6 7.6-8 7.6h-3.4c-2.6 0-4.6-1.2-6.1-3.2l-5.7-7.2c-.9-1.3-.6-3 .7-3.8 1.2-.8 2.8-.5 3.6.7l.6.9V3.8C6.2 2.2 7.4 1 9 1Z"
                  fill="#fff8e6"
                  stroke="#4a1512"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path d="M11.8 13v4.5M16.8 14v4M21.8 15.2v3.6" stroke="#4a1512" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              {/* A bubble, its middle at the point. */}
              <svg className="cursor__bubble" width="28" height="28" viewBox="0 0 28 28">
                <circle cx="14" cy="14" r="11.2" fill="none" stroke="rgba(10, 45, 75, 0.35)" strokeWidth="1" />
                <circle cx="14" cy="14" r="10" fill="rgba(255, 255, 255, 0.14)" stroke="rgba(255, 255, 255, 0.92)" strokeWidth="1.6" />
                <path d="M8.2 11.2a6.4 6.4 0 0 1 4-4.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="17.6" cy="18.4" r="1" fill="#fff" fillOpacity="0.7" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
