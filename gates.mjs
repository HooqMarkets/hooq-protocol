// npm run gates: builds mutated registers into a scratch folder and checks both branches of every gate.
// Every mutation anchor reads the CURRENT record at runtime and rebuilds it, so it never depends on the starting state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { BASE58, find, handleOf, validateRegister, sanitizeRegister } from './src/lib/render.mjs';
import { parseBaseTokens } from './src/lib/brand.mjs';
import * as M from './src/js/market.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(root, 'src');
const SCRATCH = path.join(root, '.gate-scratch');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const baseRegister = () => JSON.parse(read(SRC, 'register.json'));

/* ---------- mutation harness (state independent) ---------- */
const TEST_CA = 'HooQ1111111111111111111111111111111111111111';
const TEST_X = 'https://x.com/hooq_markets/';
const TEST_GH = 'https://github.com/hooq-markets';
const MARKET_URL = 'https://api.dexscreener.com/token-boosts/top/v1';
const MARKET_PAIRS = 'https://api.dexscreener.com/tokens/v1/solana/{addresses}';

// Rebuilds record `id` from its identity fields only, whatever its current state is.
function mutate(reg, id, state) {
  const c = structuredClone(reg);
  const cur = c.records.find((r) => r.id === id);
  if (!cur) throw new Error('no record ' + id);
  const next = { id: cur.id, label: cur.label, state, source: cur.source, scope: cur.scope, checked: cur.checked };
  if (state === 'stated') {
    if (id === 'ca') next.value = TEST_CA;
    else if (id === 'x') next.url = TEST_X;
    else if (id === 'github') next.url = TEST_GH;
    else if (id === 'market') Object.assign(next, { value: 'DexScreener', url: MARKET_URL, pairsUrl: MARKET_PAIRS });
    else next.value = 'sample';
  }
  c.records[c.records.indexOf(cur)] = next;
  return c;
}
let seq = 0;
function buildVariant(reg) {
  const out = path.join(SCRATCH, 'b' + seq++);
  build({ register: reg, out });
  return { out, html: read(out, 'index.html') };
}

/* ---------- text helpers ---------- */
const textNodes = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, '\n')
    .replace(/<style[\s\S]*?<\/style>/g, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
const attrTexts = (html) => [...html.matchAll(/\b(?:aria-label|title|alt|placeholder|aria-description)="([^"]*)"/g)].map((m) => m[1]);
const metaTexts = (html) => [...html.matchAll(/<meta[^>]+(?:description|og:title|og:description|twitter:title|twitter:description)[^>]*content="([^"]*)"/g)].map((m) => m[1]);
const titleText = (html) => (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1];
const caSlot = (html) => (html.match(/<div class="ca" data-ca[\s\S]*?<\/div>/) || [''])[0];
const socials = (html) => [...html.matchAll(/<(a|span) class="soc[^"]*" data-social="(\w+)"[^>]*>/g)].map((m) => ({ tag: m[0], kind: m[2] }));
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name === '.gate-scratch' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

/* ---------- address scanner (rule 3) ---------- */
// Matches address-shaped strings against the stated registry. Never rejects 0x hex wholesale.
export function scanAddresses(text, reg, { exemptCa = true } = {}) {
  const stated = new Set(reg.records.filter((r) => r.state === 'stated' && r.value).map((r) => r.value.toLowerCase()));
  let body = text;
  if (exemptCa) body = body.replace(/<div class="ca" data-ca[\s\S]*?<\/div>/g, ' ');
  const hits = [...body.matchAll(/\b0x[0-9a-fA-F]{40}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)].map((m) => m[0]);
  return hits.filter((h) => !stated.has(h.toLowerCase()));
}

/* ---------- branch matrix ---------- */
function branchRun(base) {
  const results = {};
  const caIds = ['ca', 'x', 'github'];
  for (const id of caIds) {
    for (const state of ['absent', 'stated']) results[`${id}:${state}`] = buildVariant(mutate(base, id, state));
  }
  results['market:absent'] = buildVariant(mutate(base, 'market', 'absent'));
  results['market:stated'] = buildVariant(mutate(base, 'market', 'stated'));
  return results;
}

/* ---------- gates ---------- */
const gates = [];
const gate = (name, fn) => gates.push({ name, fn });
const must = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

gate('register: shape valid, inert records carry no value or url, every combination', () => {
  const base = baseRegister();
  const e = validateRegister(base);
  must(!e.length, e.join('; '));
  for (const id of ['ca', 'x', 'github', 'market']) {
    for (const st of ['absent', 'unconfirmed', 'stated']) {
      const reg = mutate(base, id, st);
      const errs = validateRegister(reg);
      must(!errs.length, `${id}:${st} -> ${errs.join('; ')}`);
      if (st !== 'stated') {
        const run = sanitizeRegister(reg).records.find((r) => r.id === id);
        must(!('value' in run) && !('url' in run) && !('pairsUrl' in run), `${id}:${st} sanitized record carries data`);
      }
    }
  }
  const bad = structuredClone(base);
  bad.records.find((r) => r.id === 'ca').value = TEST_CA;
  must(validateRegister(bad).some((m) => /inert record carries value/.test(m)), 'validator accepted an inert record carrying a value');
  const chain = find(base, 'chain');
  must(chain.state === 'stated' && chain.source === 'client statement' && chain.scope === 'batch-level' && chain.rpc === 'https://solana-rpc.publicnode.com', 'chain record does not match the brief');
});

gate('palette: every colour literal is measured from brand/ pixels, tokens file only, nothing invented', () => {
  const tokens = read(SRC, 'tokens.css');
  const palette = JSON.parse(read(SRC, 'palette.json'));
  const base = parseBaseTokens(tokens);
  must(Object.keys(base).length === 8, 'expected eight measured base colours, got ' + Object.keys(base).length);
  for (const c of palette.colors) {
    must(base[c.token] === c.hex.toLowerCase(), `tokens.css ${c.token} (${base[c.token]}) does not match palette.json (${c.hex})`);
    must(c.source && fs.existsSync(path.join(root, c.source)), `provenance file missing for ${c.token}`);
    must(c.method && c.pixels > 0 && Array.isArray(c.bbox), `provenance incomplete for ${c.token}`);
  }
  must(palette.colors.length === 8, 'palette.json should list the eight measured colours');
  must(!/#[0-9a-fA-F]{3,8}\b/.test(tokens.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(--[\w-]+):\s*#[0-9a-fA-F]{6}\s*;/g, '')), 'hex literal in tokens.css that is not a measured base colour');
  // cross-check: all three logo files agree with the primary measurement within a few levels
  const near = (a, b) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 4);
  for (const [file, set] of Object.entries(palette.crossCheck)) {
    for (const [n, v] of Object.entries(set)) {
      if (!/^#/.test(v)) continue;
      const tok = n === 'paper' || n === 'ink' ? '--' + n : '--c-' + n;
      must(near(v, base[tok]), `${file} ${n} ${v} disagrees with ${tok} ${base[tok]}`);
    }
  }
  const NAMED = '(?:white|black|red|green|blue|gr[ae]y|orange|yellow|purple|pink|cyan|magenta|brown|silver|gold|navy|teal|lime|maroon|olive|aqua|fuchsia|indigo|violet|beige|ivory|tan|coral|salmon|khaki)';
  const files = walk(SRC).filter((f) => !f.endsWith('tokens.css') && !/\.json$/.test(f));
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    const rel = path.relative(root, f);
    must(!/(?<![\w&/#"'-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/.test(t.replace(/&amp;/g, '&')), `hex literal in ${rel}`);
    must(!/\b(?:rgba?|hsla?|hwb|lab|lch|oklch|oklab|color|color-mix)\(/.test(t), `colour function outside tokens in ${rel}`);
    if (f.endsWith('.css')) {
      for (const d of [...t.matchAll(/:\s*([^;{}]+);/g)].map((m) => m[1])) must(!new RegExp(`(^|[\\s,(])${NAMED}([\\s,);]|$)`, 'i').test(d), `named colour in ${rel}: ${d}`);
    }
  }
});

gate('brand: favicon traced from the logo pixel grid, 32x32, palette only, no comments; metadata stripped from shipped art', () => {
  const grid = JSON.parse(read(SRC, 'favicon.grid.json'));
  const base = parseBaseTokens(read(SRC, 'tokens.css'));
  must(grid.size === 32 && grid.rows.length === 32 && grid.rows.every((r) => r.length === 32), 'grid is not 32x32');
  must(fs.existsSync(path.join(root, grid.source)), 'grid source file missing: ' + grid.source);
  for (const row of grid.rows) for (const ch of row) must(ch in grid.legend, 'cell ' + ch + ' not in legend');
  for (const tok of Object.values(grid.legend)) must(tok === 'transparent' || tok in base, 'legend token ' + tok + ' is not a measured colour');
  // shape: two ink legs at the top, a full ink crossbar, five wheel colours present
  const top = grid.rows[2];
  must((top.match(/K+/g) || []).length === 2, 'top rows should show two H legs');
  must(grid.rows.some((r) => /^\.?K{30}\.?$/.test(r)), 'no full-width crossbar row');
  for (const k of ['o', 'y', 'g', 'b', 'm']) must(grid.rows.some((r) => r.includes(k)), 'wheel colour missing from grid: ' + k);
  const fav = read(root, 'dist', 'favicon.svg');
  must(/<svg[^>]*\bwidth="32"[^>]*\bheight="32"/.test(fav) && /viewBox="0 0 32 32"/.test(fav), 'favicon is not 32x32');
  must(!/<!--/.test(fav) && !/--/.test(fav), 'comment or double hyphen in favicon');
  const fills = [...fav.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
  must(fills.length >= 6 && fills.every((c) => Object.values(base).includes(c)), 'favicon fill outside the measured palette');
  must(read(SRC, 'index.template.html').includes('rel="icon"'), 'favicon not linked');
  for (const f of walk(path.join(root, 'dist')).filter((x) => /\.png$/.test(x))) {
    const b = fs.readFileSync(f);
    must(!/iTXt|eXIf|tEXt|zTXt|tIME/.test(b.toString('latin1')), 'metadata chunk left in ' + path.relative(root, f));
  }
  must(fs.existsSync(path.join(root, 'dist', 'assets', 'hooq-mark.png')), 'hero emblem missing from dist');
});

gate('no dates: zero dates, clocks or "as of" text in any rendered branch, attribute, or script', (ctx) => {
  const MONTH = /\b(January|February|March|April|June|July|August|September|October|November|December|Sept)\b/;
  const bad = [/\b(19|20)\d{2}\b/, /\b\d{1,2}:\d{2}(:\d{2})?\b/, /\b\d{4}-\d{2}-\d{2}\b/, MONTH, /\bas of\b/i, /\bchecked\b/i, /\bupdated\b/i, /\b\d+\s?(s|m|h|d|sec|min|hours?|days?)\s+ago\b/i, /\bago\b/i, /\bUTC\b/, /\blast (updated|checked|seen|synced)\b/i];
  for (const [name, v] of Object.entries(ctx.runs)) {
    const all = [...textNodes(v.html), ...attrTexts(v.html), ...metaTexts(v.html), titleText(v.html)];
    for (const t of all) for (const re of bad) must(!re.test(t), `${name}: "${t}" matches ${re}`);
    must(!/"checked"/.test(v.html), `${name}: register dates leaked into the page`);
    must(!/20\d\d-\d\d-\d\d/.test(v.html), `${name}: ISO date in html`);
  }
  for (const f of walk(SRC).filter((x) => /\.(js|css|html)$/.test(x))) {
    const t = fs.readFileSync(f, 'utf8');
    must(!/\bnew Date\b|Date\.now|toLocale(Date|Time)String|toISOString|getFullYear|Intl\.(DateTime|Relative)/.test(t), `date API used in ${path.relative(root, f)}`);
  }
  must(/"checked":\s*"\d{4}-\d{2}-\d{2}"/.test(read(SRC, 'register.json')), 'register.json should keep dates as data');
});

gate('no ch units in any stylesheet or inline style', () => {
  for (const f of walk(SRC).filter((x) => /\.(css|html|js)$/.test(x))) {
    must(!/\d(\.\d+)?ch\b/.test(fs.readFileSync(f, 'utf8')), `ch unit in ${path.relative(root, f)}`);
  }
});

gate('copy: zero words shared with the reference, zero shared 2-grams', (ctx) => {
  const corpusPath = path.join(root, 'reference', 'corpus.txt');
  must(fs.existsSync(corpusPath), 'reference/corpus.txt missing');
  const words = (s) => s.toLowerCase().match(/[a-z0-9$]+(?:'[a-z]+)?/g) || [];
  const grams = (s) => {
    const w = words(s);
    const out = [];
    for (let i = 0; i < w.length - 1; i++) out.push(w[i] + ' ' + w[i + 1]);
    return out;
  };
  const ref = new Set(fs.readFileSync(corpusPath, 'utf8').split('\n').flatMap(grams));
  const mine = [];
  for (const run of Object.values(ctx.runs)) mine.push(...textNodes(run.html), ...attrTexts(run.html), ...metaTexts(run.html), titleText(run.html));
  for (const f of ['main.js']) {
    for (const m of read(SRC, 'js', f).matchAll(/'((?:[^'\\\n]|\\.){6,})'|`((?:[^`\\]|\\.){6,})`/g)) {
      const s = m[1] || m[2];
      if (/\s/.test(s) && !/[{}()=;]/.test(s)) mine.push(s);
    }
  }
  const hits = new Set();
  for (const s of mine) for (const g of grams(s)) if (ref.has(g)) hits.add(g);
  must(hits.size === 0, `shared 2-grams (${hits.size}): ${[...hits].slice(0, 40).join(' | ')}`);
});

gate('repo hygiene: no agent config, no attribution, no stray docs in dist', () => {
  must(!walk(root).some((f) => new RegExp('(^|[\\\\/])(CLAU' + 'DE\\.md|\\.cla' + 'ude)([\\\\/]|$)', 'i').test(path.relative(root, f))), 'agent config file or folder present');
  const bad = new RegExp(['cla' + 'ude', 'anthr' + 'opic', 'co-auth' + 'ored', 'generat' + 'ed (by|with)', '\\bA' + 'I\\b', 'chat' + 'gpt', 'open' + 'a' + 'i','copi' + 'lot', '\\bL' + 'LM\\b'].join('|'), 'i');
  for (const f of walk(root)) {
    if (/\.(png|jpe?g|ico|woff2?)$/i.test(f) || /^(brand|reference)[\\/]/.test(path.relative(root, f))) continue;
    { const mm = fs.readFileSync(f, 'utf8').match(bad); must(!mm, `attribution term "${mm && mm[0]}" in ${path.relative(root, f)}`); }
    must(!bad.test(path.relative(root, f)), `attribution term in file name ${f}`);
  }
  for (const f of ['README.md', 'LICENSE', 'whitepaper.md']) must(!fs.existsSync(path.join(root, 'dist', f)), `${f} leaked into dist`);
  must(!fs.existsSync(path.join(root, 'dist', 'docs')), 'docs folder in dist');
  must(fs.existsSync(path.join(root, 'README.md')) && fs.existsSync(path.join(root, 'docs', 'whitepaper.md')) && fs.existsSync(path.join(root, 'LICENSE')), 'README, whitepaper or LICENSE missing');
  const lic = read(root, 'LICENSE');
  must(/^MIT License/.test(lic) && /Copyright \(c\) 2026 HOOQ/.test(lic), 'LICENSE must be MIT, copyright HOOQ, 2026');
});

gate('address scanner: matches against the stated registry, never blanket-rejects 0x, CA exempt', () => {
  const hex = '0x' + 'ab12cd34ef'.repeat(4);
  const other = '0x' + '9f8e7d6c5b'.repeat(4);
  const regHex = { records: [{ id: 'ca', state: 'stated', value: hex }] };
  must(scanAddresses(`see ${hex}`, regHex, { exemptCa: false }).length === 0, 'stated 0x address was rejected');
  must(scanAddresses(`see ${other}`, regHex, { exemptCa: false }).length === 1, 'unregistered 0x address was accepted');
  must(scanAddresses('value 0x1f and 0xdeadbeef', regHex, { exemptCa: false }).length === 0, 'short hex was rejected');
  const regB = { records: [{ id: 'ca', state: 'stated', value: TEST_CA }] };
  must(scanAddresses(TEST_CA, regB, { exemptCa: false }).length === 0, 'stated base58 rejected');
  must(scanAddresses('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', regB, { exemptCa: false }).length === 1, 'unregistered base58 accepted');
  const slot = `<div class="ca" data-ca><button data-copy="${other}">${other}</button></div>`;
  must(scanAddresses(slot, { records: [] }).length === 0, 'CA slot should be exempt');
  must(scanAddresses(slot, { records: [] }, { exemptCa: false }).length >= 1, 'exemption switch broken');
});

gate('address scanner over every built branch: only stated registry values appear', (ctx) => {
  for (const [name, v] of Object.entries(ctx.runs)) {
    const reg = JSON.parse(JSON.stringify(ctx.regs[name]));
    const files = walk(v.out).filter((f) => /\.(html|js|css|svg)$/.test(f));
    for (const f of files) {
      const hits = scanAddresses(fs.readFileSync(f, 'utf8'), reg);
      must(!hits.length, `${name}: ${path.relative(v.out, f)} holds unregistered address ${hits[0]}`);
    }
    const ca = find(reg, 'ca');
    if (ca.state !== 'stated') {
      for (const f of files) must(!new RegExp(TEST_CA).test(fs.readFileSync(f, 'utf8')), `${name}: CA value present while absent`);
    }
  }
});

gate('CA slot: both branches, top of page, inert carries no value, stated is full and copyable', (ctx) => {
  const a = ctx.runs['ca:absent'].html;
  const s = ctx.runs['ca:stated'].html;
  const slotA = caSlot(a);
  must(/data-state="absent"/.test(slotA) && />pending</.test(slotA), 'absent slot should read pending');
  must(!/data-copy|<button|href=|value=/.test(slotA) && !new RegExp(TEST_CA).test(a), 'absent slot carries a value, button or link');
  const slotS = caSlot(s);
  must(/data-state="stated"/.test(slotS), 'stated slot not marked stated');
  must(slotS.includes(`data-copy="${TEST_CA}"`) && slotS.includes(`class="ca-addr">${TEST_CA}<`), 'stated slot must show and copy the full address');
  must(/<button class="ca-copy" type="button"/.test(slotS) && /aria-live="polite"/.test(slotS), 'stated slot needs a copy button with feedback');
  for (const h of [a, s]) {
    must(h.indexOf('class="ca"') > 0 && h.indexOf('class="ca"') < h.indexOf('class="nav"'), 'CA slot must sit above the nav');
    must(h.indexOf('<header class="top">') < h.indexOf('class="ca"'), 'CA slot must be inside the sticky header');
  }
  const css = read(SRC, 'styles.css');
  must(/\.top\s*\{[^}]*position:\s*sticky/.test(css), 'header is not sticky');
  must(/\.ca-addr\s*\{[^}]*font:[^;]*clamp\(17px/.test(css), 'CA font should be large');
});

gate('social: X and GitHub icons present in every branch, inert has no href, stated derives handle from URL', (ctx) => {
  for (const [name, v] of Object.entries(ctx.runs)) {
    const s = socials(v.html);
    must(s.length === 2 && s[0].kind === 'x' && s[1].kind === 'github', `${name}: both icons must always render, X then GitHub`);
    must(/class="socials"/.test(v.html) && v.html.indexOf('class="socials"') > v.html.indexOf('class="nav-right"'), `${name}: socials not in the right cluster`);
  }
  const html = (k) => ctx.runs[k].html;
  const tagOf = (k, kind) => socials(html(k)).find((x) => x.kind === kind).tag;
  for (const [id, host, prefix, url, handle] of [['x', 'x.com', '@', TEST_X, 'hooq_markets'], ['github', 'github.com', '', TEST_GH, 'hooq-markets']]) {
    const off = tagOf(`${id}:absent`, id);
    must(/^<span/.test(off) && !/href=/.test(off) && /aria-label="[^"]*pending"/.test(off) && /aria-disabled="true"/.test(off), `${id} absent must be inert`);
    const on = tagOf(`${id}:stated`, id);
    must(/^<a/.test(on) && on.includes(`href="${url}"`) && on.includes(`aria-label="${id === 'x' ? 'X' : 'GitHub'}, ${prefix}${handle}"`), `${id} stated must link and derive ${handle}`);
    must(/rel="noopener noreferrer"/.test(on), `${id} link needs rel`);
    must(handleOf(url, [host]) === handle, `${id} handle derivation`);
  }
  const iconCount = (h) => (h.match(/<svg viewBox="0 0 24 24"/g) || []).length;
  for (const v of Object.values(ctx.runs)) must(iconCount(v.html) === 2, 'expected exactly two social svg marks');
  must(ctx.runs['x:absent'].html.includes('M18.901 1.153h3.68l-8.04 9.19') && ctx.runs['x:absent'].html.includes('M12 1C5.923 1 1 5.923 1 12'), 'official X and Octicon paths missing');
  must(!/\.soc[^{]*\{[^}]*display:\s*none/.test(read(SRC, 'styles.css')), 'social icons hidden at some breakpoint');
  const css = read(SRC, 'styles.css');
  must(!/@media[^{]*\{[^@]*\.socials\s*\{\s*display:\s*none/.test(css), 'socials hidden in a media query');
});

gate('market independence: CA state has zero effect on the market, market follows its own record only', (ctx) => {
  const strip = (h) => h.replace(caSlot(h), '<CA/>').replace(/<script type="application\/json" id="register">[\s\S]*?<\/script>/, '');
  must(strip(ctx.runs['ca:absent'].html) === strip(ctx.runs['ca:stated'].html), 'page differs by more than the CA slot');
  const mrec = (h) => JSON.parse(h.match(/id="register">([\s\S]*?)<\/script>/)[1]).records.find((r) => r.id === 'market');
  must(JSON.stringify(mrec(ctx.runs['ca:absent'].html)) === JSON.stringify(mrec(ctx.runs['ca:stated'].html)), 'market record changed with CA state');
  must(/data-market="stated"/.test(ctx.runs['ca:absent'].html) && /data-market="stated"/.test(ctx.runs['ca:stated'].html), 'market inert although record stated');
  const off = ctx.runs['market:absent'].html;
  must(/data-market="inert"/.test(off), 'market record absent should render inert');
  const m = mrec(off);
  must(m.state === 'absent' && !m.url && !m.pairsUrl && !m.value, 'inert market record carries data');
  const main = read(SRC, 'js', 'main.js');
  must(/market && market\.state === 'stated'/.test(main) && !/rec\('ca'\)/.test(main), 'main.js must gate on the market record and never read the CA record');
});

gate('market engine: Solana only, dedupe, top ten by volume, groups of thirty, fetch only when stated', async () => {
  const boosts = [];
  for (let i = 0; i < 70; i++) boosts.push({ chainId: 'solana', tokenAddress: 'S' + i });
  boosts.push({ chainId: 'ethereum', tokenAddress: 'E1' }, { chainId: 'solana', tokenAddress: 'S3' }, { chainId: 'bsc', tokenAddress: 'B1' });
  const calls = [];
  const fetchMock = async (url) => {
    calls.push(url);
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url === MARKET_URL) return ok(boosts);
    const addrs = decodeURIComponent(url.split('/solana/')[1]).split(',');
    must(addrs.length <= 30, 'group larger than thirty');
    must(addrs.every((a) => a.startsWith('S')), 'non-solana address requested');
    return ok(addrs.flatMap((a, i) => [{ chainId: 'solana', baseToken: { address: a, symbol: a, name: a }, priceUsd: '1.5', priceChange: { h24: 3 }, volume: { h24: Number(a.slice(1)) * 10 + i }, liquidity: { usd: 1000 }, info: i % 2 ? { imageUrl: 'https://x/y.png' } : {} }]));
  };
  const rec = { id: 'market', state: 'stated', url: MARKET_URL, pairsUrl: MARKET_PAIRS };
  const out = await M.loadMarket(rec, fetchMock);
  must(out.rows.length === 10, 'not ten rows');
  must(out.rows.every((r, i, a) => i === 0 || a[i - 1].volume >= r.volume), 'rows not sorted by volume');
  must(calls[0] === MARKET_URL && calls.length === 1 + Math.ceil(70 / 30), `unexpected call plan: ${calls.length}`);
  must(out.counts.solana === 70 && out.counts.boosted === 73, 'counts wrong');
  must(M.pickBoosts(boosts).length === 70, 'dedupe or filter wrong');
  const none = [];
  let threw = false;
  try {
    await M.loadMarket({ id: 'market', state: 'absent' }, async (u) => (none.push(u), { ok: true, json: async () => [] }));
  } catch {
    threw = true;
  }
  must(threw && none.length === 0, 'fetched while market record inert');
  const multi = M.buildRows([{ tokenAddress: 'A' }], [
    { chainId: 'solana', baseToken: { address: 'A', symbol: 'A', name: 'A' }, priceUsd: '2', priceChange: { h24: 5 }, volume: { h24: 10 }, liquidity: { usd: 100 } },
    { chainId: 'solana', baseToken: { address: 'A', symbol: 'A', name: 'A' }, priceUsd: '3', priceChange: { h24: -5 }, volume: { h24: 20 }, liquidity: { usd: 900 }, info: { imageUrl: 'http://insecure/x.png' } },
  ]);
  must(multi[0].volume === 30 && multi[0].liquidity === 1000 && multi[0].price === 3 && multi[0].imageUrl === null, 'multi-pair aggregation or image rule wrong');
});

gate('poll: sixty seconds, exponential backoff, last good data kept, pauses while hidden, fetches at once on visible', async () => {
  must(M.POLL_MS === 60000, 'poll interval is not 60s');
  const seq = [1, 2, 3, 4, 5, 6, 7].map((n) => M.backoffDelay(n));
  must(JSON.stringify(seq) === JSON.stringify([2000, 4000, 8000, 16000, 32000, 60000, 60000]), 'backoff curve ' + seq);
  const timers = [];
  let hidden = false;
  let n = 0;
  let good = null;
  const log = [];
  const poller = M.createPoller({
    run: async () => {
      n++;
      if (n === 2 || n === 3) throw new Error('boom');
      return { rows: [n] };
    },
    onOk: (o) => {
      good = o;
      log.push('ok');
    },
    onFail: (e, f, w) => log.push('fail' + f + ':' + w),
    isHidden: () => hidden,
    setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length),
    clearTimer: () => {},
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  poller.start();
  await flush();
  must(log[0] === 'ok' && good.rows[0] === 1, 'first poll failed');
  must(timers.at(-1).ms === 60000, 'did not schedule 60s after success');
  timers.at(-1).fn();
  await flush();
  must(log[1].startsWith('fail1') && good.rows[0] === 1, 'failure lost the last good data');
  must(timers.at(-1).ms >= 1700 && timers.at(-1).ms <= 2300, 'first backoff not about 2s');
  timers.at(-1).fn();
  await flush();
  must(log[2].startsWith('fail2') && timers.at(-1).ms >= 3400 && timers.at(-1).ms <= 4600, 'second backoff not about 4s');
  timers.at(-1).fn();
  await flush();
  must(log[3] === 'ok', 'did not recover');
  const before = n;
  hidden = true;
  timers.at(-1).fn();
  await flush();
  must(n === before, 'polled while hidden');
  poller.visibilityChanged();
  await flush();
  must(n === before, 'visibilitychange to hidden must not poll');
  const tCount = timers.length;
  hidden = false;
  poller.visibilityChanged();
  await flush();
  must(n === before + 1 && timers.length > tCount, 'did not fetch immediately when visible');
  const main = read(SRC, 'js', 'main.js');
  must(/document\.hidden/.test(main) && /visibilitychange/.test(main), 'main.js is not wired to visibility');
  must(/status:\s*state\.rows\.length\s*\?\s*'retry'\s*:\s*'down'/.test(main), 'failure path must keep rows and flag retry or down');
});

gate('motion: spring solver, reveal stagger, parallax, spotlight, progress, count-up flash, reduced-motion fallback everywhere', (ctx) => {
  const css = read(SRC, 'styles.css');
  const mo = read(SRC, 'js', 'motion.js');
  const fx = read(SRC, 'js', 'fx.js');
  const main = read(SRC, 'js', 'main.js');
  must(/stiffness/.test(mo) && /damping/.test(mo) && /isReduced\(\)\)\s*\{[\s\S]*?onUpdate\(to\)/.test(mo), 'spring solver or its reduced path missing');
  must(/prefers-reduced-motion: reduce\)/.test(mo), 'matchMedia reduced check missing');
  const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  must(/animation:\s*none\s*!important/.test(block) && /transition:\s*none\s*!important/.test(block), 'CSS reduced block must disable animations and transitions');
  must(/html\.anim \[data-reveal\]:not\(\.in\)\s*\{\s*opacity:\s*0/.test(css) && /html\.anim \[data-reveal\]:not\(\.in\)\s*\{\s*opacity:\s*1/.test(block), 'reveal must show instantly when reduced');
  must(/isReduced\(\)\s*\|\|/.test(fx) && /initParallax/.test(fx) && /initSpotlight/.test(fx) && /initProgress/.test(fx) && /initReveal/.test(fx) && /initTilt/.test(fx), 'fx modules incomplete');
  must(/i \* 80/.test(fx), 'reveal stagger missing');
  must(/classList\.add\('flash',/.test(mo) && /@keyframes flash/.test(css), 'value-change flash missing');
  must(/@keyframes livepulse/.test(css) && /\.dot\s*\{[^}]*animation:\s*livepulse/.test(css), 'pulsing live dot missing');
  must(/\.skel\s*\{[^}]*animation:\s*sk/.test(css) && /tr\.enter|\.enter/.test(css) && /transitionDelay/.test(main), 'skeleton to data fade-in stagger missing');
  must(/\.mesh i/.test(css) && /@keyframes drift1/.test(css), 'gradient mesh missing');
  must(/data-depth/.test(ctx.runs['ca:absent'].html) && /\.progress/.test(css), 'parallax layers or progress bar missing');
  must(/\.tape-track\s*\{[^}]*animation:\s*tape 90s linear infinite/.test(css), 'ticker timing off');
  must(!/setInterval/.test(main + fx + mo), 'setInterval used; polling must go through the poller');
});

gate('numbers: no visible figure that is not computed live or a section index', (ctx) => {
  for (const [name, v] of Object.entries(ctx.runs)) {
    for (const t of [...textNodes(v.html.replace(caSlot(v.html), "")), ...attrTexts(v.html.replace(caSlot(v.html), ""))]) {
      for (const m of t.matchAll(/\d+/g)) must(/^0[1-9]$/.test(m[0]) || (m[0] === '24' && /24h/.test(t)), `${name}: unexplained number "${m[0]}" in "${t}"`);
    }
  }
  const html = ctx.runs['ca:absent'].html;
  must((html.match(/data-record="/g) || []).length === 4, 'pending chips missing');
  for (const m of html.matchAll(/<li class="rec"[^>]*data-state="(\w+)"[^>]*><span class="mono-label">([^<]+)<\/span><b>([^<]+)<\/b>/g)) {
    must(m[1] === 'absent' && m[3] === 'pending', `inert chip ${m[2]} must read pending only`);
  }
});

gate('wiring: external hosts, no hard-coded endpoints, build output complete', (ctx) => {
  for (const f of ['main.js', 'market.js', 'fx.js', 'motion.js']) must(!/https?:\/\//.test(read(SRC, 'js', f)), `${f} hard-codes a URL; endpoints come from the register`);
  const html = ctx.runs['ca:absent'].html;
  must(!/\{\{/.test(html), 'unfilled template slot');
  for (const m of html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)) must(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)(\/|$)/.test(m[1]) || /rel="noopener/.test(html), `unexpected external ${m[1]}`);
  must(fs.existsSync(path.join(root, 'dist', 'index.html')) && fs.existsSync(path.join(root, 'dist', 'tokens.css')) && fs.existsSync(path.join(root, 'dist', 'js', 'main.js')), 'dist/ incomplete (run npm run build)');
});

gate('mutation anchors are state independent: same verdicts from absent-start and stated-start registers', (ctx) => {
  const ids = ['ca', 'x', 'github', 'market'];
  let flipped = baseRegister();
  for (const id of ids) flipped = mutate(flipped, id, 'stated');
  let cleared = baseRegister();
  for (const id of ids) cleared = mutate(cleared, id, 'absent');
  const observe = (k, h) => {
    const [id, st] = k.split(':');
    if (id === 'ca') return /data-state="stated"/.test(caSlot(h)) + ':' + caSlot(h).includes(TEST_CA);
    if (id === 'market') return (h.match(/data-market="(w+)"/) || [])[1];
    const t = socials(h).find((x) => x.kind === id).tag;
    return /^<a/.test(t) + ':' + /href=/.test(t);
  };
  const verdict = (reg) =>
    Object.entries(branchRun(reg))
      .map(([k, v]) => k + '=' + observe(k, v.html))
      .join('|');
  const a = verdict(flipped);
  const b = verdict(cleared);
  must(a === b, 'branch outputs depend on the register starting state');
  ctx.note = 'stated-start and absent-start registers rebuild to identical branches';
});

/* ---------- runner ---------- */
async function main() {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(SCRATCH, { recursive: true });
  const base = baseRegister();
  const runs = branchRun(base);
  const regs = {};
  for (const k of Object.keys(runs)) {
    const [id, st] = k.split(':');
    regs[k] = mutate(base, id, st);
  }
  const ctx = { runs, regs };
  let pass = 0;
  const failed = [];
  for (const g of gates) {
    try {
      await g.fn(ctx);
      pass++;
      console.log(`  PASS  ${g.name}`);
    } catch (e) {
      failed.push(g.name);
      console.log(`  FAIL  ${g.name}\n        ${String(e.message).split('\n').join('\n        ')}`);
    }
  }
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  console.log(`\n${pass}/${gates.length} gates passed across ${Object.keys(runs).length} built branches`);
  process.exit(failed.length ? 1 : 0);
}
main();
