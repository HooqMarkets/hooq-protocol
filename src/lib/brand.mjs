// Brand mark helpers. The 32x32 grid was traced from real logo pixels (see favicon.grid.json and palette.json).

// Reads the base hex colours out of tokens.css (plain hex custom properties only).
export function parseBaseTokens(css) {
  const out = {};
  for (const m of css.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2].toLowerCase();
  return out;
}

// Merges a grid of single-letter cells into few rects: horizontal runs first, then stacked rows.
export function gridRects(grid) {
  const runs = [];
  grid.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const k = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === k) w++;
      if (k !== '.') runs.push({ x, y, w, h: 1, k });
      x += w;
    }
  });
  const merged = [];
  for (const r of runs) {
    const up = merged.find((m) => m.k === r.k && m.x === r.x && m.w === r.w && m.y + m.h === r.y);
    if (up) up.h += 1;
    else merged.push({ ...r });
  }
  return merged;
}

// Standalone favicon. Colours are resolved from tokens.css so the file carries no value of its own.
export function renderFavicon(grid, base) {
  const rects = gridRects(grid)
    .map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${base[grid.legend[r.k]]}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">${rects}</svg>\n`;
}

// Keeps only the chunks needed to draw the image. Embedded metadata (dates, ids, tool tags) never ships.
const KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'sRGB']);
export function stripPng(buf) {
  const sig = buf.subarray(0, 8);
  const parts = [sig];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.subarray(o + 4, o + 8).toString('latin1');
    if (KEEP.has(type)) parts.push(buf.subarray(o, o + 12 + len));
    o += 12 + len;
  }
  return Buffer.concat(parts);
}

// Inline copy for the nav. Colours arrive through CSS classes bound to page tokens.
export function renderMark(grid) {
  const cls = { K: 'ink', o: 'orange', y: 'yellow', g: 'green', b: 'blue', m: 'magenta', w: 'ring' };
  const rects = gridRects(grid)
    .map((r) => `<rect class="bm-${cls[r.k]}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"/>`)
    .join('');
  return `<svg class="brand-mark" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false" shape-rendering="crispEdges">${rects}</svg>`;
}
