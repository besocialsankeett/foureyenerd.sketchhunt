// The time of day at the pond, from the visitor's own clock. Each moment of the day is a set
// of lighting values; between them the values blend, so the light changes by the minute.

type RGB = [number, number, number];

export type Light = {
  /** Light falling on everything, multiplied in. */
  tint: RGB;
  /** 1 is the painting's own colour; less washes it out, as in poor light. */
  saturation: number;
  /** Sky colours at the top of the screen and down at the horizon, and how far they replace
   * the painting's white haze (0 by day, when the painting's own sky is right). */
  skyTop: RGB;
  skyHorizon: RGB;
  sky: number;
  /** A low sun near the horizon, its place across the screen (0 to 1), and its colour. */
  sun: number;
  sunX: number;
  sunColor: RGB;
  /** Stars and the moon. */
  stars: number;
  /** The boat's lantern, and the fireflies that come out with the dark. */
  lantern: number;
};

const NIGHT: Light = {
  tint: [0.42, 0.48, 0.7],
  saturation: 0.62,
  skyTop: [0.03, 0.05, 0.14],
  skyHorizon: [0.1, 0.14, 0.28],
  sky: 1,
  sun: 0,
  sunX: 0.8,
  sunColor: [1, 0.7, 0.4],
  stars: 1,
  lantern: 1,
};

const DAWN: Light = {
  tint: [0.97, 0.87, 0.88],
  saturation: 0.9,
  skyTop: [0.6, 0.66, 0.84],
  skyHorizon: [1, 0.8, 0.72],
  sky: 0.85,
  sun: 0.55,
  sunX: 0.16,
  sunColor: [1, 0.78, 0.6],
  stars: 0.12,
  lantern: 0.35,
};

const DAY: Light = {
  tint: [1, 1, 1],
  saturation: 1,
  skyTop: [1, 1, 1],
  skyHorizon: [1, 1, 1],
  sky: 0,
  sun: 0,
  sunX: 0.5,
  sunColor: [1, 0.95, 0.85],
  stars: 0,
  lantern: 0,
};

const GOLDEN: Light = {
  tint: [1.06, 0.89, 0.72],
  saturation: 1.06,
  skyTop: [0.98, 0.83, 0.6],
  skyHorizon: [1, 0.64, 0.4],
  sky: 0.9,
  sun: 1,
  sunX: 0.82,
  sunColor: [1, 0.66, 0.32],
  stars: 0,
  lantern: 0.25,
};

const DUSK: Light = {
  tint: [0.72, 0.63, 0.8],
  saturation: 0.82,
  skyTop: [0.22, 0.2, 0.42],
  skyHorizon: [0.86, 0.46, 0.44],
  sky: 1,
  sun: 0.3,
  sunX: 0.86,
  sunColor: [1, 0.52, 0.38],
  stars: 0.35,
  lantern: 0.8,
};

/** The day, hour by hour: night until dawn, a long day, a golden evening, dusk, night. */
const DAYLIGHT: [number, Light][] = [
  [0, NIGHT],
  [5, NIGHT],
  [6.3, DAWN],
  [8.3, DAY],
  [16.5, DAY],
  [18, GOLDEN],
  [19.4, DUSK],
  [20.8, NIGHT],
  [24, NIGHT],
];

const blend = (a: number, b: number, t: number) => a + (b - a) * t;
const blendRGB = (a: RGB, b: RGB, t: number): RGB => [blend(a[0], b[0], t), blend(a[1], b[1], t), blend(a[2], b[2], t)];

/** The light at an hour of the day, 0 to 24, with minutes as fractions. */
export function lightAt(hour: number): Light {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < DAYLIGHT.length - 2 && h >= DAYLIGHT[i + 1][0]) i++;
  const [h0, a] = DAYLIGHT[i];
  const [h1, b] = DAYLIGHT[i + 1];
  const raw = (h - h0) / (h1 - h0);
  const t = raw * raw * (3 - 2 * raw);
  return {
    tint: blendRGB(a.tint, b.tint, t),
    saturation: blend(a.saturation, b.saturation, t),
    skyTop: blendRGB(a.skyTop, b.skyTop, t),
    skyHorizon: blendRGB(a.skyHorizon, b.skyHorizon, t),
    sky: blend(a.sky, b.sky, t),
    sun: blend(a.sun, b.sun, t),
    sunX: blend(a.sunX, b.sunX, t),
    sunColor: blendRGB(a.sunColor, b.sunColor, t),
    stars: blend(a.stars, b.stars, t),
    lantern: blend(a.lantern, b.lantern, t),
  };
}

/**
 * An hour fixed in the address, for previewing one light: `?hour=21`, or with fractions,
 * like `?hour=18.5`. Null when there is none.
 */
export function fixedHour() {
  if (typeof window === 'undefined') return null;
  const fixed = new URLSearchParams(window.location.search).get('hour');
  return fixed !== null && fixed !== '' && !Number.isNaN(Number(fixed)) ? Number(fixed) : null;
}

/** How long the pond's own day lasts, in seconds, before it begins again. */
export const LOOP_SECONDS = 90;

/**
 * The pond's own day: about thirty seconds each of day, evening and night. Time runs on
 * without ever stopping, so every moment of light flows into the next as a real day does:
 * the sun goes down through gold and violet, night falls, and dawn brings the day back.
 * Pairs of seconds into the loop and the hour it has reached.
 */
const LOOP: [number, number][] = [
  // Day, from just after dawn to late afternoon.
  [0, 8.4],
  [24, 16.5],
  // Evening: into the gold quickly, then slowly through sunset towards dusk.
  [32, 17.6],
  [58, 19],
  // Night falls, holds, and gives way to dawn.
  [64, 20.8],
  [87, 29.8],
  [LOOP_SECONDS, 32.4],
];

/** The hour of the pond's own day, so many seconds after it began. */
export function loopHour(seconds: number) {
  const t = ((seconds % LOOP_SECONDS) + LOOP_SECONDS) % LOOP_SECONDS;
  let i = 0;
  while (i < LOOP.length - 2 && t >= LOOP[i + 1][0]) i++;
  const [t0, h0] = LOOP[i];
  const [t1, h1] = LOOP[i + 1];
  return (h0 + ((t - t0) / (t1 - t0)) * (h1 - h0)) % 24;
}

/** A word for the light, for the page's own colours to follow. */
export function moodOf(light: Light) {
  if (light.stars > 0.25) return 'night';
  if (light.sky > 0.5) return 'evening';
  return 'day';
}
