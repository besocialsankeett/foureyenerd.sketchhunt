'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Sfx } from '@/audio/sound';
import { site } from '@/content/site';
import manifest from '@/scene/manifest.json';

/** Stickers a visitor can stamp on their note. */
const STICKERS = [
  { mark: '🐟', name: 'fish' },
  { mark: '⭐', name: 'star' },
  { mark: '🌙', name: 'moon' },
];
/** Remembers, on this device, that a note was left, so the pearl stays. */
const LEFT = 'sketchbook:note-left';

const sound = (name: Sfx, amount = 1) => window.dispatchEvent(new CustomEvent('sketchbook:sound', { detail: { name, amount } }));
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Stage = 'closed' | 'open' | 'sending' | 'sent';

/**
 * The shell on the pond floor. Tapped, it opens and a note rises out of it; sent, the note
 * rolls up into a bubble and floats away, and the pearl it hid is left glowing as a thank-you.
 */
export default function NoteShell({ shown, onOpenChange }: { shown: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('closed');
  /** On the way back up to the pond with the pearl, after a note was sent. */
  const [rising, setRising] = useState(false);
  const [sticker, setSticker] = useState<string | null>(null);
  const [error, setError] = useState('');
  /** The shell is springing open over its pearl, just now, for a note that was sent. */
  const [opening, setOpening] = useState(false);
  const card = useRef<HTMLFormElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const shell = useRef<HTMLButtonElement>(null);
  const { pearl } = manifest.shell;

  useEffect(() => {
    try {
      if (localStorage.getItem(LEFT)) setStage('sent');
    } catch {}
  }, []);

  const writing = stage === 'open' || stage === 'sending';
  useEffect(() => {
    onOpenChange(writing);
    if (writing) text.current?.focus({ preventScroll: true });
  }, [writing, onOpenChange]);

  const open = () => {
    if (writing) return;
    setError('');
    setOpening(false);
    setStage('open');
    sound('whoosh', 0.5);
  };

  /** The note sinks back into the shell, and the shell closes over it. */
  const putAway = () => {
    if (stage !== 'open') return;
    const done = () => {
      setStage(() => {
        try {
          return localStorage.getItem(LEFT) ? 'sent' : 'closed';
        } catch {
          return 'closed';
        }
      });
      shell.current?.focus({ preventScroll: true });
    };
    if (!card.current || reduced()) return done();
    card.current
      .animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(30%) scale(0.3)', opacity: 0 }], {
        duration: 320,
        easing: 'cubic-bezier(0.5, 0, 0.75, 0)',
        fill: 'forwards',
      })
      .finished.then(done, done);
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const message = String(form.get('message') ?? '').trim();
    if (!message) return setError('The shell can’t carry an empty note.');
    if (!site.notesForm) return setError('The shell isn’t connected yet. Try again soon.');
    setStage('sending');
    setError('');
    try {
      const response = await fetch(`https://formspree.io/f/${site.notesForm}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sticker: sticker ?? 'none', _gotcha: form.get('_gotcha') }),
      });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      setStage('open');
      return setError('The current took it the wrong way. Please try again.');
    }
    try {
      localStorage.setItem(LEFT, '1');
    } catch {}
    sound('bubble', 1);
    // The thank-you: the note rolls up into a bubble, the view follows it back up to the pond,
    // and the projects and the shell fall away below.
    const handOff = (detail: { x: number; y: number; size: number } | null) => {
      setStage('sent');
      setOpening(true);
      setSticker(null);
      setRising(true);
      window.dispatchEvent(new CustomEvent('sketchbook:thanks', { detail }));
      window.dispatchEvent(new CustomEvent('library:depth', { detail: 0 }));
      setTimeout(() => router.push('/', { scroll: false }), 600);
    };
    const note = card.current;
    if (!note || reduced()) return handOff(null);
    const rolled = note.animate(
      [
        { transform: 'none', borderRadius: '14px', opacity: 1 },
        { transform: 'scale(0.14)', borderRadius: '50%', opacity: 0.35 },
      ],
      { duration: 550, easing: 'cubic-bezier(0.5, 0, 0.3, 1)', fill: 'forwards' },
    );
    rolled.finished.then(() => {
      const box = note.getBoundingClientRect();
      handOff({ x: box.left + box.width / 2, y: box.top + box.height / 2, size: Math.max(28, Math.min(box.width, box.height)) });
    }, () => handOff(null));
  };

  return (
    <div className="note" data-shown={shown} data-stage={stage} data-opening={opening} data-rising={rising}>
      <p className="note__tap" aria-hidden="true">
        {stage === 'sent' ? 'Thank you! Tap to leave another' : 'Tap to open'}
      </p>
      <button
        ref={shell}
        type="button"
        className="note__shell"
        onClick={open}
        tabIndex={shown && !writing ? 0 : -1}
        aria-label={stage === 'sent' ? 'Open the shell to leave another note' : 'Open the shell to leave a note'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="note__closed" src={manifest.shell.closed.file} alt="" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="note__open" src={manifest.shell.open.file} alt="" draggable={false} />
        <span className="note__puff" aria-hidden="true" />
        <span
          className="note__scroll"
          aria-hidden="true"
          style={{ left: `${pearl.x * 100}%`, top: `${pearl.y * 100}%`, width: `${pearl.r * 340}%` }}
        />
        <span
          className="note__pearl"
          aria-hidden="true"
          style={{ left: `${pearl.x * 100}%`, top: `${pearl.y * 100}%`, width: `${pearl.r * 200}%` }}
        />
      </button>
      <p className="visually-hidden" role="status">
        {stage === 'sent' ? 'Note sent. Thank you!' : ''}
      </p>

      {writing && (
        <form
          ref={card}
          className="note__card"
          role="dialog"
          aria-label="Leave a note"
          onSubmit={send}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              putAway();
            }
          }}
        >
          <button type="button" className="note__close" onClick={putAway} aria-label="Close the note">
            <span aria-hidden="true">×</span>
          </button>
          {sticker && (
            <span className="note__stamp" aria-hidden="true">
              {sticker}
            </span>
          )}
          <label className="note__head" htmlFor="note-message">
            A note for foureyenerd
          </label>
          <textarea
            ref={text}
            id="note-message"
            name="message"
            maxLength={1000}
            rows={5}
            placeholder="Say hi, say what you liked, say anything…"
            disabled={stage === 'sending'}
          />
          <input className="note__trap" type="text" name="_gotcha" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <div className="note__stickers" role="group" aria-label="Stamp a sticker">
            {STICKERS.map((s) => (
              <button
                key={s.name}
                type="button"
                aria-label={s.name}
                aria-pressed={sticker === s.mark}
                onClick={() => setSticker(sticker === s.mark ? null : s.mark)}
              >
                {s.mark}
              </button>
            ))}
          </div>
          {error && (
            <p className="note__error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="note__send" disabled={stage === 'sending'}>
            {stage === 'sending' ? 'Sending…' : 'Send it up'} <span aria-hidden="true">↑</span>
          </button>
        </form>
      )}
    </div>
  );
}
