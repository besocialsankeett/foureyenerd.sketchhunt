// The scene is laid out in "design" coordinates: the 1536 x 1024 frame of the approved
// concept image, measured from its top-left corner. World space uses the same units with
// y pointing up, so design (x, y) maps to world (x, DESIGN_H - y).

export const DESIGN_W = 1536;
export const DESIGN_H = 1024;

/** Design y where the white of the page has faded into water. */
export const HORIZON_Y = 455;

export const worldY = (designY: number) => DESIGN_H - designY;

export const BOAT = {
  /** Size of one source pixel of the boat image, in design units. */
  scale: 0.716,
  /** Design x of the image's left edge. */
  left: 245,
  /** Design y of the water surface at the hull. */
  waterY: 690,
  /** Row of the boat image that sits at the water surface. */
  waterRow: 360,
  /** Columns of the boat image where the hull meets the water. */
  hullColumns: [170, 1640] as const,
};

type Point = readonly [number, number];

/**
 * How the character's parts fit together. Points are pixels in each part's own image
 * (from its top-left); scales convert those pixels to design units.
 */
export const RIG = {
  /** Design position of the bottom centre of the shirt: where he sits. */
  seat: [1052, 602] as Point,
  torso: {
    scale: 0.357,
    pivot: [290, 640] as Point,
    collar: [228, 70] as Point,
    shoulderFar: [50, 142] as Point,
    shoulderNear: [455, 142] as Point,
    /** Where the lower hand holds the rod: in his lap, at the front edge of the shirt. */
    grip: [-24, 486] as Point,
  },
  head: { scale: 0.4, pivot: [240, 415] as Point, face: [228, 300] as Point },
  /** Iris radius in head-image pixels, by how wide the eyes are open. */
  iris: { normal: 18.5, wide: 14 },
  /** Built from the neck painted under his chin, in the head's own pixels and scale. */
  neck: { scale: 0.4, pivot: [100, 35] as Point },
  armFar: {
    scale: 0.33,
    shoulder: [535, 75] as Point,
    elbow: [455, 450] as Point,
    hand: [75, 440] as Point,
    /** The fist's share of the image, as [min u, min v, max u, max v]. */
    fist: [0, 0, 0.27, 0.37] as const,
  },
  armNear: { scale: 0.33, shoulder: [524, 64] as Point, elbow: [454, 469] as Point, hand: [69, 549] as Point },
  rod: {
    length: 440,
    /** Distance between the two hands, and how far the butt extends below the lower one. */
    handSpacing: 40,
    butt: 22,
  },
};

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Where his hands and body go at each moment of fishing. The puppet chases these on
 * springs, so each one is a target, not a keyframe. Angles are anticlockwise from
 * pointing right; grip offsets are design units from the resting grip (y up).
 */
export const POSES = {
  rest: { rodAngle: rad(125), grip: [0, 0] as Point, lean: 0, snap: 1 },
  windup: { rodAngle: rad(64), grip: [24, 34] as Point, lean: -0.07, snap: 3.2 },
  whip: { rodAngle: rad(147), grip: [-30, 8] as Point, lean: 0.08, snap: 7 },
  wait: { rodAngle: rad(137), grip: [-6, -2] as Point, lean: 0.015, snap: 1.4 },
  brace: { rodAngle: rad(131), grip: [-4, 0] as Point, lean: -0.02, snap: 2.2 },
  haul: { rodAngle: rad(98), grip: [16, 26] as Point, lean: -0.13, snap: 2.4 },
  lower: { rodAngle: rad(121), grip: [0, 8] as Point, lean: -0.03, snap: 2 },
  flick: { rodAngle: rad(150), grip: [-16, 4] as Point, lean: 0.05, snap: 6 },
};

/** Where a catch is set down: the front bench. Design x of its middle and y of its base. */
export const BENCH = [739, 572] as Point;
/** Design y of the top of the hull's near side beside the bench, which a catch must clear. */
export const RIM_Y = 575;
export type Pose = (typeof POSES)[keyof typeof POSES];

/** Design positions of the project markers on the water, for wide views. */
export const TAG_SPOTS = {
  wide: [[330, 775], [565, 900], [775, 945], [1290, 905], [1040, 990]] as Point[],
};

/**
 * Where the project markers float. On a narrow screen they sit in two neat rows of two in the
 * open water below the boat, placed by the share of the screen so none is cut off at an edge.
 */
export const tagSpots = (view: View, pixelHeight = 1000): Point[] => {
  // A short landscape screen, like a phone on its side: the markers would crowd each other at
  // their usual places, so they float in one row across the water below the boat instead.
  if (view.width / view.height >= 1.1 && pixelHeight < 500) {
    const y = DESIGN_H - (view.top - view.height * 0.74);
    return [0.1, 0.3, 0.5, 0.7, 0.9].map((share) => [view.left + view.width * share, y] as Point);
  }
  if (view.width / view.height >= 1.1) return TAG_SPOTS.wide;
  const bottom = DESIGN_H - view.bottom;
  const row = (share: number) => BOAT.waterY + (bottom - BOAT.waterY) * share;
  const column = (share: number) => view.left + view.width * share;
  return [
    [column(0.28), row(0.18)],
    [column(0.72), row(0.18)],
    [column(0.28), row(0.42)],
    [column(0.72), row(0.42)],
    [column(0.5), row(0.64)],
  ];
};

export type View = { left: number; right: number; top: number; bottom: number; width: number; height: number };

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The visible rectangle in world units for a viewport aspect ratio. Wide screens show the
 * whole design frame plus extra water at the sides; narrow screens keep the full height and
 * slide toward the stern, where the character sits. Portrait phone screens widen the view
 * until the whole boat, bow to stern, fits across them, centred on it.
 */
export function computeView(aspect: number): View {
  let height = DESIGN_H;
  let width = DESIGN_H * aspect;
  let centerX = DESIGN_W / 2;
  if (aspect < 1.5) {
    // 0 for anything 1.1 wide or wider (untouched), 1 for a portrait phone of 0.75 or narrower.
    const portrait = clamp01((1.1 - aspect) / 0.35);
    width = Math.max(DESIGN_H * aspect, lerp(900, 1330, portrait));
    height = width / aspect;
    centerX = lerp(lerp(DESIGN_W / 2, 1060, clamp01((1.5 - aspect) / 0.6)), BOAT.left + 620, portrait);
  }
  const top = DESIGN_H + (height - DESIGN_H) * 0.4;
  return { left: centerX - width / 2, right: centerX + width / 2, top, bottom: top - height, width, height };
}

type Anchor = 'left' | 'right';

export type PlantSpec = {
  kind: 'reeds' | 'pads' | 'stones';
  index: number;
  /** Which edge of the view the plant is pinned to, and how far in from it. */
  anchor: Anchor;
  inset: number;
  /** Design y of the water surface under the plant. */
  waterY: number;
  scale: number;
  flip?: boolean;
  /** Vertical squash for things lying flat on the water. */
  flatten?: number;
};

export const PLANTS: PlantSpec[] = [
  { kind: 'reeds', index: 2, anchor: 'left', inset: 165, waterY: 668, scale: 0.3 },
  { kind: 'reeds', index: 0, anchor: 'left', inset: 62, waterY: 752, scale: 0.42 },
  { kind: 'stones', index: 0, anchor: 'left', inset: 48, waterY: 760, scale: 0.42 },
  { kind: 'pads', index: 1, anchor: 'left', inset: 175, waterY: 768, scale: 0.3, flatten: 0.6 },
  { kind: 'pads', index: 0, anchor: 'left', inset: 300, waterY: 944, scale: 0.36, flatten: 0.8 },
  { kind: 'reeds', index: 1, anchor: 'left', inset: 150, waterY: 985, scale: 0.6 },
  { kind: 'reeds', index: 2, anchor: 'right', inset: 82, waterY: 705, scale: 0.36, flip: true },
  { kind: 'pads', index: 2, anchor: 'right', inset: 110, waterY: 772, scale: 0.42, flatten: 0.6 },
  { kind: 'reeds', index: 1, anchor: 'right', inset: 48, waterY: 800, scale: 0.5, flip: true },
  { kind: 'pads', index: 1, anchor: 'right', inset: 70, waterY: 978, scale: 0.5, flatten: 0.85, flip: true },
];
