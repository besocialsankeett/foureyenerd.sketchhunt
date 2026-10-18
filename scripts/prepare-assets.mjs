// Turns the generated source art in reference/parts into the textures the scene loads:
// strips the faint background haze, trims, splits sprite sheets, and writes a manifest.
import sharp from 'sharp';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'reference', 'parts');
const OUT = path.join(root, 'public', 'scene');
const MANIFEST = path.join(root, 'src', 'scene', 'manifest.json');

const HAZE = 28; // alpha at or below this is generator haze, not artwork
const CELL = 4; // coarse grid used to tell sprites apart

async function loadRaw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function stripHaze(img) {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= HAZE) data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
  }
  return img;
}

/**
 * Removes the pale halo left where art was cut from a white background: soft edge pixels
 * take the colour of the solid art beside them, and the faintest outer rim is dropped.
 */
function defringe(img) {
  const { data, width, height } = img;
  const source = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const alpha = source[i + 3];
      if (alpha === 0 || alpha >= 250) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = (ny * width + nx) * 4;
          if (source[j + 3] < 250) continue;
          r += source[j];
          g += source[j + 1];
          b += source[j + 2];
          n++;
        }
      }
      if (n) {
        data[i] = Math.round(r / n);
        data[i + 1] = Math.round(g / n);
        data[i + 2] = Math.round(b / n);
      }
      data[i + 3] = Math.round(Math.min(1, Math.max(0, (alpha - 70) / 150)) * 255);
    }
  }
  return img;
}

/**
 * Cuts art out of a plain white background: the near-white that reaches the edges of the sheet
 * is cleared, and the pixels along the art's edge are made partly see-through by how pale they
 * are, for defringe to finish. Sheets that are already transparent pass through unchanged.
 */
function clearWhite(img) {
  const { data, width, height } = img;
  const pale = (i) => data[i + 3] < 30 || (Math.min(data[i], data[i + 1], data[i + 2]) > 228 && Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) < 20);
  const gone = new Uint8Array(width * height);
  const stack = [];
  for (let x = 0; x < width; x++) stack.push([x, 0], [x, height - 1]);
  for (let y = 0; y < height; y++) stack.push([0, y], [width - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const n = y * width + x;
    if (gone[n] || !pale(n * 4)) continue;
    gone[n] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  for (let n = 0; n < gone.length; n++) if (gone[n]) data[n * 4 + 3] = 0;
  // The soft edge: within two pixels of the cleared white, paler means more see-through.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = y * width + x;
      if (gone[n]) continue;
      let near = false;
      for (let dy = -2; dy <= 2 && !near; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && gone[ny * width + nx]) {
            near = true;
            break;
          }
        }
      }
      if (!near) continue;
      const i = n * 4;
      const low = Math.min(data[i], data[i + 1], data[i + 2]);
      data[i + 3] = Math.min(data[i + 3], Math.round(Math.min(1, (255 - low) / 120) * 255));
    }
  }
  return img;
}

function blank(width, height) {
  return { data: Buffer.alloc(width * height * 4), width, height };
}

function bounds(img) {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function crop(img, box) {
  const out = blank(box.w, box.h);
  for (let y = 0; y < box.h; y++) {
    const from = ((box.y + y) * img.width + box.x) * 4;
    img.data.copy(out.data, y * box.w * 4, from, from + box.w * 4);
  }
  return out;
}

function encode(img) {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } });
}

async function save(img, file) {
  await encode(defringe(img)).webp({ quality: 92, alphaQuality: 100 }).toFile(path.join(OUT, file));
  return { file: `/scene/${file}`, w: img.width, h: img.height };
}

/**
 * Splits a sheet into its separate sprites. Works on a coarse, slightly dilated mask so the
 * thin loose strokes of one sprite stay together, and returns each sprite on its own, with
 * anything belonging to a neighbour removed, plus where it sat on the sheet.
 */
function sprites(sheet, grow = 2) {
  const gw = Math.ceil(sheet.width / CELL), gh = Math.ceil(sheet.height / CELL);
  const solid = new Uint8Array(gw * gh);
  for (let y = 0; y < sheet.height; y++) {
    for (let x = 0; x < sheet.width; x++) {
      if (sheet.data[(y * sheet.width + x) * 4 + 3] > 60) solid[((y / CELL) | 0) * gw + ((x / CELL) | 0)] = 1;
    }
  }
  const mask = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!solid[y * gw + x]) continue;
      for (let dy = -grow; dy <= grow; dy++) {
        for (let dx = -grow; dx <= grow; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) mask[ny * gw + nx] = 1;
        }
      }
    }
  }
  const label = new Int32Array(gw * gh);
  const found = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    const id = found.length + 1;
    let count = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % gw, y = (i / gw) | 0;
      count++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const n = ny * gw + nx;
        if (mask[n] && !label[n]) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    found.push({ id, count });
  }
  return found
    .filter((f) => f.count >= 40)
    .map(({ id }) => {
      const own = blank(sheet.width, sheet.height);
      for (let y = 0; y < sheet.height; y++) {
        for (let x = 0; x < sheet.width; x++) {
          if (label[((y / CELL) | 0) * gw + ((x / CELL) | 0)] !== id) continue;
          const i = (y * sheet.width + x) * 4;
          sheet.data.copy(own.data, i, i, i + 4);
        }
      }
      const box = bounds(own);
      return { box, image: crop(own, box) };
    });
}

function meanLuma(img) {
  let sum = 0, n = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 200) continue;
    sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
    n++;
  }
  return n ? sum / n : 255;
}

/**
 * The two colours a part's skin is painted in: the lit tone and the shaded one. Each is the
 * commonest skin colour in its range of brightness.
 */
function skinTones(img) {
  const commonest = (low, high) => {
    const bins = new Map();
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      if (img.data[i + 3] < 250 || r < low || r > high || !(r > g && g > b) || r - b < 50 || r - b > 130) continue;
      const key = (r >> 2) * 4096 + (g >> 2) * 64 + (b >> 2);
      const bin = bins.get(key) ?? [0, 0, 0, 0];
      bin[0]++;
      bin[1] += r;
      bin[2] += g;
      bin[3] += b;
      bins.set(key, bin);
    }
    const [n, r, g, b] = [...bins.values()].sort((a, b) => b[0] - a[0])[0];
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };
  return { light: commonest(222, 255), shade: commonest(180, 221) };
}

/**
 * Repaints a part so its skin matches another's. Each channel is bent so the part's own lit
 * and shaded tones land on the wanted ones, with black and white left where they are.
 */
function matchSkin(img, want) {
  const have = skinTones(img);
  // Only skin is repainted: anything else, like a coloured sleeve, keeps its own colours.
  const isSkin = (i) => {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    return r > 140 && r > g && g > b && r - b > 40 && r - b < 150 && g > 90;
  };
  const curves = [0, 1, 2].map((c) => {
    const stops = [[0, 0], [have.shade[c], want.shade[c]], [have.light[c], want.light[c]], [255, 255]];
    return Uint8Array.from({ length: 256 }, (_, v) => {
      const i = stops.findIndex(([x]) => v <= x) || 1;
      const [x0, y0] = stops[i - 1], [x1, y1] = stops[i];
      return Math.round(y0 + ((v - x0) / (x1 - x0)) * (y1 - y0));
    });
  });
  for (let i = 0; i < img.data.length; i += 4) {
    if (!isSkin(i)) continue;
    for (let c = 0; c < 3; c++) img.data[i + c] = curves[c][img.data[i + c]];
  }
  return img;
}

const pixel = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

await mkdir(OUT, { recursive: true });
await mkdir(path.dirname(MANIFEST), { recursive: true });
const manifest = {};

// Water: an opaque plate; its transparent top is the white of the page.
{
  const info = await sharp(path.join(SRC, 'water.webp'))
    .flatten({ background: '#ffffff' })
    .webp({ quality: 90 })
    .toFile(path.join(OUT, 'water.webp'));
  manifest.water = { file: '/scene/water.webp', w: info.width, h: info.height };
}

// Boat, plus a copy holding only the near side of the hull, which is drawn in front of
// whoever sits inside. The line follows the top edge of the near rim in the trimmed image.
{
  const sheet = stripHaze(await loadRaw(path.join(SRC, 'boat.webp')));
  const boat = crop(sheet, bounds(sheet));
  manifest.boat = await save(boat, 'boat.webp');

  const rim = [
    [0, 36], [60, 52], [100, 66], [200, 105], [300, 131], [400, 153], [500, 171], [600, 186], [700, 200], [800, 213],
    [900, 220], [1000, 223], [1100, 223], [1200, 221], [1300, 211], [1400, 200], [1500, 186], [1600, 168], [1680, 148],
    [boat.width, 138],
  ];
  const rimY = (x) => {
    for (let i = 1; i < rim.length; i++) {
      if (x <= rim[i][0]) {
        const [x0, y0] = rim[i - 1], [x1, y1] = rim[i];
        return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return rim[rim.length - 1][1];
  };
  const front = blank(boat.width, boat.height);
  for (let x = 0; x < boat.width; x++) {
    const edge = rimY(x);
    for (let y = Math.max(0, Math.floor(edge - 1)); y < boat.height; y++) {
      const i = (y * boat.width + x) * 4;
      const keep = Math.min(1, Math.max(0, y - edge + 1));
      front.data[i] = boat.data[i];
      front.data[i + 1] = boat.data[i + 1];
      front.data[i + 2] = boat.data[i + 2];
      front.data[i + 3] = Math.round(boat.data[i + 3] * keep);
    }
  }
  manifest.boatFront = await save(front, 'boat-front.webp');
}

{
  const sheet = stripHaze(await loadRaw(path.join(SRC, 'plants.webp')));
  const all = sprites(sheet);
  const reeds = all.filter((s) => s.box.h > 250).sort((a, b) => b.box.h - a.box.h);
  const low = all.filter((s) => s.box.h <= 250).sort((a, b) => a.box.x - b.box.x);
  const stones = low.filter((s) => meanLuma(s.image) < 95);
  const pads = low.filter((s) => !stones.includes(s));
  manifest.reeds = await Promise.all(reeds.map((s, i) => save(s.image, `reed-${i}.webp`)));
  manifest.pads = await Promise.all(pads.map((s, i) => save(s.image, `pad-${i}.webp`)));
  manifest.stones = await Promise.all(stones.map((s, i) => save(s.image, `stone-${i}.webp`)));
}

/**
 * Finds the whites of the eyes in a head whose irises have been left blank. Returns a soft
 * mask of the two eye openings and a box around each, or null when the eyes are closed.
 * The irises are drawn live in the scene and clipped to this mask.
 */
function eyeWhites(img) {
  const { width, height, data } = img;
  const white = new Uint8Array(width * height);
  // Only the band of the face where eyes can be, so teeth and sweat drops are not picked up.
  for (let y = 185; y < 300; y++) {
    for (let x = 85; x < 345; x++) {
      const i = (y * width + x) * 4;
      const lo = Math.min(data[i], data[i + 1], data[i + 2]), hi = Math.max(data[i], data[i + 1], data[i + 2]);
      if (data[i + 3] > 250 && lo > 226 && hi - lo < 22) white[y * width + x] = 1;
    }
  }
  const label = new Int32Array(width * height);
  const eyes = [];
  for (let start = 0; start < white.length; start++) {
    if (!white[start] || label[start]) continue;
    const id = eyes.length + 1;
    let minX = width, minY = height, maxX = 0, maxY = 0, area = 0;
    const stack = [start];
    label[start] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % width, y = (i / width) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const n of [i + 1, i - 1, i + width, i - width]) {
        if (white[n] && !label[n]) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    eyes.push({ id, area, box: [(minX + maxX) / 2, (minY + maxY) / 2, (maxX - minX + 1) / 2, (maxY - minY + 1) / 2] });
  }
  const pair = eyes.filter((e) => e.area > 350).sort((a, b) => a.box[0] - b.box[0]);
  if (pair.length !== 2) return null;
  const hard = new Uint8Array(width * height);
  for (let i = 0; i < hard.length; i++) if (label[i] === pair[0].id || label[i] === pair[1].id) hard[i] = 255;
  const mask = Buffer.alloc(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += hard[(y + dy) * width + x + dx];
      mask[y * width + x] = Math.round(sum / 9);
    }
  }
  return { mask, left: pair[0].box, right: pair[1].box };
}

// Heads. Every expression is rebuilt as the first head with only its face swapped in, so
// the hair cannot shift between expressions.
const EXPRESSIONS = ['happy', 'blink', 'worried', 'surprised', 'straining', 'delighted'];

async function rebuildHeads(file) {
  const sheet = stripHaze(await loadRaw(path.join(SRC, file)));
  const heads = sprites(sheet).sort((a, b) =>
    Math.abs(a.box.y - b.box.y) > 100 ? a.box.y - b.box.y : a.box.x - b.box.x,
  );
  if (heads.length !== EXPRESSIONS.length) throw new Error(`expected ${EXPRESSIONS.length} heads, found ${heads.length}`);
  const base = heads[0].image;

  const luma = (img, x, y) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 255;
    const i = (y * img.width + x) * 4;
    const a = img.data[i + 3] / 255;
    return (0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]) * a + 255 * (1 - a);
  };
  // Line a head up with the base by sliding it until the hair overlaps best.
  const align = (head) => {
    let best = { dx: 0, dy: 0, cost: Infinity };
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        let cost = 0;
        for (let y = 6; y < base.height * 0.42; y += 3) {
          for (let x = 6; x < base.width - 6; x += 3) cost += Math.abs(luma(base, x, y) - luma(head, x + dx, y + dy));
        }
        if (cost < best.cost) best = { dx, dy, cost };
      }
    }
    return best;
  };
  // The part of the head that changes with expression: eyes, brows, cheeks, mouth and chin.
  const face = (x, y) => {
    const r = Math.hypot((x - 228) / 128, (y - 320) / 125);
    return Math.min(1, Math.max(0, (1 - r) / 0.1));
  };

  return heads.map((entry, n) => {
    const out = blank(base.width, base.height);
    base.data.copy(out.data);
    if (n > 0) {
      const head = entry.image;
      const { dx, dy } = align(head);
      for (let y = 0; y < base.height; y++) {
        for (let x = 0; x < base.width; x++) {
          const m = face(x, y);
          const sx = x + dx, sy = y + dy;
          if (m <= 0 || sx < 0 || sy < 0 || sx >= head.width || sy >= head.height) continue;
          const i = (y * base.width + x) * 4, j = (sy * head.width + sx) * 4;
          for (let c = 0; c < 4; c++) out.data[i + c] = Math.round(base.data[i + c] * (1 - m) + head.data[j + c] * m);
        }
      }
      console.log(`${file} ${EXPRESSIONS[n]} aligned by`, dx, dy);
    }
    return out;
  });
}

/**
 * The top of his neck is painted on the head, under the chin, and ends in a ragged cut. Each
 * column's colour a little above that cut (smoothed across its neighbours so no stray pixel
 * streaks) is what the neck below carries on with; the two ends of the run are its outline.
 * In head-image pixels.
 */
function neckStub(img) {
  const at = (x, y) => pixel(img, x, y);
  // Hair is dark and grey, the outline dark and red, skin warm and light.
  const kind = ([r, g, b]) => (r > 120 && r > g && g > b ? 'skin' : r > 30 && r > g * 2 ? 'line' : 'hair');
  const bottom = new Map();
  for (let x = 140; x < 340; x++) {
    for (let y = 440; y >= 380; y--) {
      const p = at(x, y);
      if (p[3] >= 245) {
        if (kind(p) !== 'hair') bottom.set(x, y);
        break;
      }
    }
  }
  let left = 240, right = 240;
  while (bottom.has(left - 1)) left--;
  while (bottom.has(right + 1)) right++;
  const colour = new Map();
  for (let x = left; x <= right; x++) {
    if (x - left < 3 || right - x < 3) {
      colour.set(x, [61, 3, 3]);
      continue;
    }
    const samples = [];
    for (let d = -2; d <= 2; d++) {
      const sx = Math.min(right - 3, Math.max(left + 3, x + d));
      samples.push(at(sx, bottom.get(sx) - 6));
    }
    colour.set(x, [0, 1, 2].map((c) => samples.map((p) => p[c]).sort((a, b) => a - b)[2]));
  }
  return { left, right, bottom, colour };
}

// The scene's heads have blank eye-whites: their irises are drawn live, clipped to a mask.
let skin, shade, stub;
{
  const heads = await rebuildHeads('heads-blank.webp');
  // His face sets the skin tones for every other part of him.
  ({ light: skin, shade } = skinTones(heads[0]));
  // The ragged cut under the painted neck is trimmed off: the neck behind the head takes over
  // there with the same colours, so there is no seam.
  stub = neckStub(heads[0]);
  for (const out of heads) {
    for (let x = stub.left; x <= stub.right; x++) {
      for (let y = stub.bottom.get(x) - 5; y < out.height; y++) out.data[(y * out.width + x) * 4 + 3] = 0;
    }
  }

  manifest.heads = {};
  manifest.eyes = {};
  for (let n = 0; n < heads.length; n++) {
    const out = heads[n];
    const eyes = eyeWhites(out);
    if (eyes) {
      const file = `eyes-${EXPRESSIONS[n]}.webp`;
      await sharp(eyes.mask, { raw: { width: out.width, height: out.height, channels: 1 } })
        .webp({ lossless: true })
        .toFile(path.join(OUT, file));
      manifest.eyes[EXPRESSIONS[n]] = { file: `/scene/${file}`, left: eyes.left, right: eyes.right };
      console.log(`eyes ${EXPRESSIONS[n]}`, eyes.left, eyes.right);
    } else {
      manifest.eyes[EXPRESSIONS[n]] = null;
    }
    manifest.heads[EXPRESSIONS[n]] = await save(out, `head-${EXPRESSIONS[n]}.webp`);
  }
}

// The intro shows the same six heads with their eyes as painted, each as a sticker cut out
// with a white border. The border is the head's own outline grown and smoothed, so it runs
// round the curls instead of following every one.
{
  const INTRO = path.join(root, 'public', 'intro');
  const MARGIN = 36;
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  await mkdir(INTRO, { recursive: true });
  const heads = await rebuildHeads('heads.webp');
  manifest.intro = null;
  for (let n = 0; n < heads.length; n++) {
    const head = await encode(defringe(heads[n]))
      .resize({ width: 440 })
      .extend({ top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, background: clear })
      .png()
      .toBuffer();
    const { data: grown, info } = await sharp(head)
      .extractChannel('alpha')
      .blur(14)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const backing = Buffer.alloc(info.width * info.height * 4, 255);
    // Wherever the blurred outline is more than faintly there, the backing is solid.
    for (let i = 0; i < grown.length; i++) backing[i * 4 + 3] = Math.min(255, Math.max(0, (grown[i] - 20) * 9));
    await sharp(backing, { raw: { width: info.width, height: info.height, channels: 4 } })
      .composite([{ input: head }])
      .webp({ quality: 88, alphaQuality: 100 })
      .toFile(path.join(INTRO, `face-${EXPRESSIONS[n]}.webp`));
    manifest.intro = { w: info.width, h: info.height };
  }
}

// Torso. The generated shirt came back with an empty collar: the opening shows the inside of
// the shirt, in the shirt's own shade, and the neck is built from the one painted on the head.
// (A burgundy hoodie version of the body and arms is kept as body-hoodie.webp and
// arms-hoodie.webp; it needs RIG torso points 32px lower, arms 2-4px, collar [227, 68].)
{
  const sheet = clearWhite(stripHaze(await loadRaw(path.join(SRC, 'body.webp'))));
  const [torso] = sprites(sheet).sort((a, b) => a.box.y - b.box.y);
  const img = torso.image;
  // The collar point, as RIG.torso.collar in src/scene/layout.ts.
  const seed = [228, 70];
  const target = pixel(img, ...seed);
  // A pale, empty opening can be matched loosely; a dark painted lining only closely, as the
  // fabric round it is a near shade of the same colour.
  const pale = 0.299 * target[0] + 0.587 * target[1] + 0.114 * target[2] > 150;
  const close = (x, y) => {
    const p = pixel(img, x, y);
    return p[3] > 200 && Math.abs(p[0] - target[0]) + Math.abs(p[1] - target[1]) + Math.abs(p[2] - target[2]) < (pale ? 70 : 35);
  };
  const seen = new Uint8Array(img.width * img.height);
  const stack = [seed];
  const opening = [];
  seen[seed[1] * img.width + seed[0]] = 1;
  while (stack.length) {
    const [x, y] = stack.pop();
    opening.push([x, y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      // The collar opening only: stay inside its part of the image.
      if (nx < 100 || ny < 0 || nx > 380 || ny > 170) continue;
      if (seen[ny * img.width + nx] || !close(nx, ny)) continue;
      seen[ny * img.width + nx] = 1;
      stack.push([nx, ny]);
    }
  }
  // An empty, pale opening (the T-shirt's) shows the shirt's inside in its own shade; a
  // painted one (the hoodie's dark hood lining) is left as it is.
  const CLOTH = [216, 180, 174];
  if (pale) {
    for (const [x, y] of opening) img.data.set(CLOTH, (y * img.width + x) * 4);
  }
  manifest.torso = await save(img, 'torso.webp');

  // The neck, in head-image pixels: each column of the painted neck carried straight down
  // through the collar opening, and up behind the head where it was trimmed. The head and the
  // neck hang from the collar point; these match RIG in src/scene/layout.ts.
  const HEAD = { scale: 0.4, pivot: [240, 415] };
  const TORSO = { scale: 0.357, collar: seed };
  const X0 = 140, Y0 = 380, W = 200, H = 130;
  const inOpening = (hx, hy) => {
    const tx = Math.round(TORSO.collar[0] + ((hx - HEAD.pivot[0]) * HEAD.scale) / TORSO.scale);
    const ty = Math.round(TORSO.collar[1] + ((hy - HEAD.pivot[1]) * HEAD.scale) / TORSO.scale);
    return tx >= 0 && ty >= 0 && tx < img.width && ty < img.height && seen[ty * img.width + tx] === 1;
  };
  const neck = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hx = X0 + x, hy = Y0 + y;
      if (hx < stub.left || hx > stub.right) continue;
      if (hy > stub.bottom.get(hx) && !inOpening(hx, hy)) continue;
      neck.set([...stub.colour.get(hx), 255], (y * W + x) * 4);
    }
  }
  const info = await sharp(neck, { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(path.join(OUT, 'neck.webp'));
  manifest.neck = { file: '/scene/neck.webp', w: info.width, h: info.height };
}

// Arms: on the sheet the far arm (upper hand on the rod) is on the left.
{
  const sheet = clearWhite(stripHaze(await loadRaw(path.join(SRC, 'arms.webp'))));
  const [far, near] = sprites(sheet).sort((a, b) => a.box.x - b.box.x);
  // The arms were painted a little paler and pinker than his face.
  manifest.armFar = await save(matchSkin(far.image, { light: skin, shade }), 'arm-far.webp');
  manifest.armNear = await save(matchSkin(near.image, { light: skin, shade }), 'arm-near.webp');
}

// Catches: the object each project comes up as, with the loose parts it opens into.
{
  const byX = (a, b) => a.box.x - b.box.x;
  const mirror = stripHaze(await loadRaw(path.join(SRC, 'catch-mirror.webp')));
  // The Tuning Wave's electric guitar, dripping, with pond weed round its neck.
  const guitar = clearWhite(stripHaze(await loadRaw(path.join(SRC, 'catch-guitar.webp'))));
  const [box, drawer] = sprites(stripHaze(await loadRaw(path.join(SRC, 'catch-kika.webp')))).sort(byX);
  const [bottle, cork, note] = sprites(stripHaze(await loadRaw(path.join(SRC, 'catch-bottle.webp')))).sort(byX);
  manifest.catches = {
    mirror: await save(crop(mirror, bounds(mirror)), 'catch-mirror.webp'),
    guitar: await save(crop(guitar, bounds(guitar)), 'catch-guitar.webp'),
    box: await save(box.image, 'catch-box.webp'),
    drawer: await save(drawer.image, 'catch-drawer.webp'),
    bottle: await save(bottle.image, 'catch-bottle.webp'),
    cork: await save(cork.image, 'catch-cork.webp'),
    note: await save(note.image, 'catch-note.webp'),
  };
  // The Indian Netizens' desk globe: its world map, wrapped round a sphere drawn in the scene.
  const globe = await sharp(path.join(SRC, 'globe-map.webp')).resize(1024, 512).removeAlpha().webp({ quality: 90 }).toFile(path.join(OUT, 'catch-globe.webp'));
  manifest.catches.globe = { file: '/scene/catch-globe.webp', w: globe.width, h: globe.height };
}

// Underwater: the pond seen from below the surface, for diving into. An opaque plate.
{
  const info = await sharp(path.join(SRC, 'underwater.webp'))
    .flatten({ background: '#2a6fa8' })
    .webp({ quality: 88 })
    .toFile(path.join(OUT, 'underwater.webp'));
  manifest.underwater = { file: '/scene/underwater.webp', w: info.width, h: info.height };
}

// Fish: side views facing left, with a clear margin so they can ripple without their edges
// smearing. Two koi, a comet goldfish and a bluegill, each marked with what it is.
{
  const MARGIN = 20;
  manifest.fish = [];
  for (const [name, kind] of [
    ['0', 'koi'],
    ['1', 'koi'],
    ['goldfish', 'goldfish'],
    ['bluegill', 'bluegill'],
  ]) {
    const cut = defringe(stripHaze(await loadRaw(path.join(SRC, `fish-${name}.webp`))));
    const info = await encode(crop(cut, bounds(cut)))
      .resize({ width: 480 })
      .extend({ top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 92, alphaQuality: 100 })
      .toFile(path.join(OUT, `fish-${name}.webp`));
    manifest.fish.push({ file: `/scene/fish-${name}.webp`, w: info.width, h: info.height, kind });
  }
}

// The underwater library: one picture per project, 4:5, taken from the project's own work.
// MORO: the arched mirror from the top of its home page. KIKA: the drawer box photograph
// from the packaging slide. senk8: its whole landing page, set on the page's own grey.
{
  const LIB = path.join(root, 'public', 'library');
  await mkdir(LIB, { recursive: true });
  for (const old of await readdir(LIB)) await unlink(path.join(LIB, old));
  const shots = path.join(root, 'reference', 'library');
  const size = { width: 800, height: 1000 };
  await sharp(path.join(shots, 'moro-full.png'))
    .extract({ left: 420, top: 290, width: 600, height: 750 })
    .resize(size)
    .webp({ quality: 86 })
    .toFile(path.join(LIB, 'moro.webp'));
  await sharp(path.join(root, 'reference', 'kika', 'deck', '09-packaging.webp'))
    .extract({ left: 682, top: 170, width: 556, height: 695 })
    .resize(size)
    .webp({ quality: 86 })
    .toFile(path.join(LIB, 'kika.webp'));
  const page = await sharp(path.join(shots, 'senk8-full.png')).resize({ width: 800 }).toBuffer();
  await sharp({ create: { ...size, channels: 3, background: '#f8f8f8' } })
    .composite([{ input: page, top: Math.round((1000 - 500) / 2), left: 0 }])
    .webp({ quality: 86 })
    .toFile(path.join(LIB, 'senk8.webp'));
  // The Indian Netizens: the "India's Next-Gen Think Tank" section of its home page, which sits
  // on near-black, so the rest of the card is that same black.
  const band = await sharp(path.join(shots, 'tin-full.png'))
    .extract({ left: 0, top: 880, width: 1440, height: 800 })
    .resize({ width: 800 })
    .toBuffer();
  const bandHeight = (await sharp(band).metadata()).height;
  await sharp({ create: { ...size, channels: 3, background: { r: 3, g: 3, b: 3 } } })
    .composite([{ input: band, top: Math.round((1000 - bandHeight) / 2), left: 0 }])
    .webp({ quality: 86 })
    .toFile(path.join(LIB, 'tin.webp'));
  // The Tuning Wave: the glowing guitar from its home page, on its own black.
  await sharp(path.join(shots, 'tuningwave-full.png'))
    .extract({ left: 598, top: 70, width: 664, height: 830 })
    .resize(size)
    .webp({ quality: 86 })
    .toFile(path.join(LIB, 'tuningwave.webp'));
  // Square thumbnails for the library's row, each cut to the part that reads at a glance: the
  // mirror and the box as they are, the first half of senk8's wordmark, and The Indian Netizens' headline
  // with its colour. Where each square sits in its picture is kept, as shares of the picture's
  // width (left, side) and height (top), so a thumbnail can open out into the whole picture.
  const crops = { moro: [0, 100, 800], kika: [0, 100, 800], senk8: [10, 530, 380], tin: [120, 110, 580], tuningwave: [100, 140, 600] };
  manifest.libraryThumbs = {};
  for (const [name, [left, top, side]] of Object.entries(crops)) {
    await sharp(path.join(LIB, `${name}.webp`))
      .extract({ left, top, width: side, height: side })
      .resize(240, 240)
      .webp({ quality: 88 })
      .toFile(path.join(LIB, `${name}-thumb.webp`));
    manifest.libraryThumbs[name] = { left: left / size.width, top: top / size.height, side: side / size.width };
  }
  // Its internship certificate, for the case study.
  await mkdir(path.join(root, 'public', 'projects', 'tin'), { recursive: true });
  await sharp(path.join(shots, 'tin-certificate.jpg'))
    .webp({ quality: 88 })
    .toFile(path.join(root, 'public', 'projects', 'tin', 'certificate.webp'));
}

// The shell on the pond floor that takes notes: closed on the sheet's left, open with its pearl
// on the right. Where the pearl sits is kept, as shares of the open shell's width and height.
{
  const sheet = clearWhite(await loadRaw(path.join(root, 'reference', 'shell.webp')));
  const half = (x, w) => {
    const side = crop(sheet, { x, y: 0, w, h: sheet.height });
    return crop(side, bounds(side));
  };
  const closed = half(0, 760), openSide = crop(sheet, { x: 760, y: 0, w: sheet.width - 760, h: sheet.height });
  const box = bounds(openSide);
  manifest.shell = {
    closed: await save(closed, 'shell-closed.webp'),
    open: await save(crop(openSide, box), 'shell-open.webp'),
    pearl: { x: (1097 - 760 - box.x) / box.w, y: (615 - box.y) / box.h, r: 92 / box.w },
  };
}

await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest));
console.log('skin', hex(skin), 'shade', hex(shade));
