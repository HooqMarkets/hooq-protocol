import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSlots, validateRegister } from './src/lib/render.mjs';
import { parseBaseTokens, renderFavicon, renderMark, stripPng } from './src/lib/brand.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

// build({ register, out }) is also what the gates call with mutated registers.
export function build({ register, out = path.join(root, 'dist'), src = path.join(root, 'src') } = {}) {
  const reg = register || JSON.parse(fs.readFileSync(path.join(src, 'register.json'), 'utf8'));
  const errors = validateRegister(reg);
  if (errors.length) throw new Error('register invalid:\n  ' + errors.join('\n  '));

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'js'), { recursive: true });
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

  const grid = JSON.parse(fs.readFileSync(path.join(src, 'favicon.grid.json'), 'utf8'));
  const baseTokens = parseBaseTokens(fs.readFileSync(path.join(src, 'tokens.css'), 'utf8'));
  const slots = renderSlots(reg);
  let html = fs.readFileSync(path.join(src, 'index.template.html'), 'utf8');
  const map = {
    ca: slots.ca,
    social: slots.social,
    pending: slots.pending,
    chain: slots.chain,
    market_state: slots.marketState,
    market_name: slots.marketName,
    register_json: slots.registerJson,
    brand_mark: renderMark(grid),
  };
  html = html.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in map)) throw new Error('unknown slot ' + k);
    return map[k];
  });

  fs.writeFileSync(path.join(out, 'index.html'), html);
  for (const f of ['tokens.css', 'styles.css']) fs.copyFileSync(path.join(src, f), path.join(out, f));
  fs.writeFileSync(path.join(out, 'favicon.svg'), renderFavicon(grid, baseTokens));
  for (const f of fs.readdirSync(path.join(src, 'js'))) fs.copyFileSync(path.join(src, 'js', f), path.join(out, 'js', f));
  // The transparent logo from brand/ is the hero emblem.
  fs.writeFileSync(path.join(out, 'assets', 'hooq-mark.png'), stripPng(fs.readFileSync(path.join(root, 'brand', 'LOGO HOOQ PNG...png'))));
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = build();
  const n = fs.readdirSync(out, { recursive: true }).filter((f) => fs.statSync(path.join(out, f)).isFile()).length;
  console.log(`built ${n} files -> ${path.relative(root, out)}/`);
}
