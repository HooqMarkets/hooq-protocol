import { spring, setNumber, isReduced } from './motion.js';
import { initReveal, initProgress, initParallax, initSpotlight, initTilt } from './fx.js';
import { loadMarket, createPoller, deriveStats, TOP_N } from './market.js';

window.__hooq = true;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reg = JSON.parse($('#register').textContent);
const rec = (id) => reg.records.find((r) => r.id === id);
const market = rec('market');
const chain = rec('chain');

/* ---------- formatting ---------- */
const DASH = '–';
const fmtUsd = (n) => {
  if (n == null || !Number.isFinite(n)) return DASH;
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
};
const fmtPrice = (p) => {
  if (p == null || !Number.isFinite(p)) return DASH;
  if (p >= 1000) return '$' + Math.round(p).toLocaleString('en-US');
  if (p >= 1) return '$' + p.toFixed(2);
  if (p >= 0.01) return '$' + p.toFixed(4);
  if (p === 0) return '$0';
  const s = p.toPrecision(3);
  return '$' + (/e/.test(s) ? p.toFixed(10).replace(/0+$/, '') : s);
};
const fmtPct = (c) => (c == null || !Number.isFinite(c) ? DASH : (c >= 0 ? '▲ ' : '▼ ') + Math.abs(c).toFixed(1) + '%');
const fmtPlain = (c) => (c == null || !Number.isFinite(c) ? DASH : (c >= 0 ? '+' : '−') + Math.abs(c).toFixed(1) + '%');
const fmtRatio = (n) => n.toFixed(2) + '×';
const fmtShare = (n) => (n * 100).toFixed(0) + '%';
const fmtInt = (n) => String(Math.round(n));
const short = (a) => (a && a.length > 10 ? a.slice(0, 4) + '…' + a.slice(-4) : a || DASH);
const pad2 = (n) => String(n).padStart(2, '0');

/* ---------- store ---------- */
const state = { status: 'loading', rows: [], counts: null, sortKey: 'volume' };
const subs = [];
const set = (patch) => {
  Object.assign(state, patch);
  subs.forEach((f) => f(state));
};
const sorted = () => {
  const k = state.sortKey;
  return [...state.rows].sort((a, b) => (b[k] == null ? -Infinity : b[k]) - (a[k] == null ? -Infinity : a[k]));
};

/* ---------- status ---------- */
const STATUS_TEXT = { loading: 'Syncing', live: 'Live', retry: 'Retrying', down: 'Offline', pending: 'Pending' };
subs.push((s) => {
  document.documentElement.dataset.mstatus = s.status;
  $$('[data-status-text]').forEach((el) => (el.textContent = STATUS_TEXT[s.status]));
});

/* ---------- copy ---------- */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
}
document.addEventListener('click', async (e) => {
  const el = e.target instanceof Element ? e.target.closest('[data-copy]') : null;
  if (!el || !el.dataset.copy) return;
  const ok = await copyText(el.dataset.copy);
  const fb = el.matches('[data-fb]') ? el : $('[data-fb]', el) || el;
  const idle = fb.dataset.idle || el.dataset.idle || fb.textContent;
  fb.dataset.idle = idle;
  fb.textContent = ok ? 'Copied' : 'Copy failed';
  el.classList.toggle('copied', ok);
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    fb.textContent = idle;
    el.classList.remove('copied');
  }, 1600);
});

/* ---------- nav ---------- */
const burger = $('[data-burger]');
const mnav = $('#mnav');
burger.addEventListener('click', () => {
  const open = burger.getAttribute('aria-expanded') !== 'true';
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  mnav.hidden = !open;
});
mnav.addEventListener('click', (e) => {
  if (e.target.closest('a')) {
    mnav.hidden = true;
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-label', 'Open menu');
  }
});
{
  const links = $$('.nav-links a');
  const secs = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
        }
      },
      { rootMargin: '-40% 0px -55% 0px' }
    );
    secs.forEach((s) => io.observe(s));
  }
}

/* ---------- letter tile / logo ---------- */
function logoInto(el, row) {
  el.textContent = '';
  el.dataset.tone = String(row.symbol.charCodeAt(0) % 5);
  const letter = (row.symbol.trim()[0] || '?').toUpperCase();
  if (!row.imageUrl) {
    el.textContent = letter;
    return;
  }
  const img = new Image();
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.onerror = () => {
    img.remove();
    el.textContent = letter;
  };
  img.src = row.imageUrl;
  el.appendChild(img);
}

/* ---------- board ---------- */
const tbody = $('[data-rows]');
const note = $('[data-note]');
const cell = (cls, label) => {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  if (label) td.dataset.l = label;
  return td;
};
function skeletonRow() {
  const tr = document.createElement('tr');
  tr.dataset.spot = '';
  const mk = (cls, label, inner) => {
    const td = cell(cls, label);
    td.innerHTML = inner;
    tr.appendChild(td);
  };
  mk('rk num', '', '<span class="skel w3"></span>');
  mk('tk', '', '<div class="pair"><span class="skel circle"></span><span class="skel w1"></span></div>');
  ['Price', '24h', 'Volume', 'Depth'].forEach((l) => mk('r num', l, '<span class="skel w2"></span>'));
  mk('r ad', '', '<span class="skel w2"></span>');
  return tr;
}
for (let i = 0; i < TOP_N; i++) tbody.appendChild(skeletonRow());

function fillRow(tr, row, i) {
  tr.textContent = '';
  tr.dataset.addr = row.address;
  const rk = cell('rk num');
  rk.textContent = pad2(i + 1);
  const tk = cell('tk');
  const pair = document.createElement('div');
  pair.className = 'pair';
  const ic = document.createElement('span');
  ic.className = 'ticon';
  logoInto(ic, row);
  const nm = document.createElement('div');
  nm.innerHTML = '<div class="pair-name"></div><div class="pair-sub"></div>';
  nm.firstChild.textContent = row.symbol;
  nm.lastChild.textContent = row.name;
  pair.append(ic, nm);
  tk.appendChild(pair);
  const price = cell('r num', 'Price');
  const chg = cell('r num', '24h');
  const vol = cell('r num', 'Volume');
  const liq = cell('r num', 'Depth');
  price.innerHTML = '<span data-c="price">–</span>';
  chg.innerHTML = '<span data-c="change" class="chg">–</span>';
  vol.innerHTML = '<span data-c="volume">–</span>';
  liq.innerHTML = '<span data-c="liquidity">–</span>';
  const ad = cell('r ad');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.dataset.copy = row.address;
  b.dataset.fb = '';
  b.dataset.idle = 'Copy';
  b.textContent = 'Copy';
  b.setAttribute('aria-label', 'Copy address of ' + row.symbol);
  ad.appendChild(b);
  tr.append(rk, tk, price, chg, vol, liq, ad);
}
function updateRow(tr, row) {
  const put = (k, v, f) => setNumber($(`[data-c="${k}"]`, tr), v, f);
  put('price', row.price, fmtPrice);
  const c = $('[data-c="change"]', tr);
  c.classList.toggle('dn', row.change != null && row.change < 0);
  setNumber(c, row.change, fmtPct);
  put('volume', row.volume, fmtUsd);
  put('liquidity', row.liquidity, fmtUsd);
}
function dashRow(tr) {
  tr.textContent = '';
  delete tr.dataset.addr;
  const rk = cell('rk num');
  rk.textContent = DASH;
  const tk = cell('tk');
  tk.textContent = DASH;
  tr.append(rk, tk);
  ['Price', '24h', 'Volume', 'Depth'].forEach((l) => {
    const td = cell('r num', l);
    td.textContent = DASH;
    tr.appendChild(td);
  });
  const ad = cell('r ad');
  ad.textContent = DASH;
  tr.appendChild(ad);
}
function renderBoard(s) {
  const trs = $$('tr', tbody);
  if (!s.rows.length) {
    if (s.status === 'down' || s.status === 'pending') trs.forEach(dashRow);
    return;
  }
  const view = sorted();
  trs.forEach((tr, i) => {
    const row = view[i];
    if (!row) {
      dashRow(tr);
      return;
    }
    if (tr.dataset.addr !== row.address) {
      const fresh = !tr.dataset.addr;
      fillRow(tr, row, i);
      if (!isReduced()) {
        tr.classList.add('enter');
        tr.style.transitionDelay = i * 55 + 'ms';
        requestAnimationFrame(() => requestAnimationFrame(() => tr.classList.remove('enter')));
        setTimeout(() => (tr.style.transitionDelay = ''), 900 + i * 55);
      }
      void fresh;
    } else {
      const rk = $('.rk', tr);
      if (rk) rk.textContent = pad2(i + 1);
    }
    updateRow(tr, row);
  });
}
subs.push(renderBoard);
subs.push((s) => {
  let msg = '';
  if (s.status === 'down') msg = 'The market source is not answering. Trying again with longer pauses.';
  else if (s.status === 'retry') msg = 'Showing the last good rows while the source recovers.';
  else if (s.status === 'pending') msg = 'Market source pending.';
  else if (s.status === 'live' && s.counts) msg = s.counts.boosted + ' boosts in, ' + s.counts.solana + ' on ' + chain.value + ', ' + s.counts.pairs + ' pairs found, ' + s.rows.length + ' shown.';
  note.textContent = msg;
  note.classList.toggle('err', s.status === 'down');
});
$('[data-sort]').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-key]');
  if (!b) return;
  $$('[data-sort] button').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-pressed', String(x === b));
  });
  set({ sortKey: b.dataset.key });
});

/* ---------- ticker ---------- */
const tape = $('[data-tape]');
function tapeItem(inner) {
  return `<span class="tape-item">${inner}</span>`;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function renderTape(s) {
  let html;
  if (s.rows.length) {
    const items = sorted().map((r) => tapeItem(`<b>${esc(r.symbol)}</b>${esc(fmtPrice(r.price))}<span class="${r.change != null && r.change < 0 ? 'dn' : 'up'}">${esc(fmtPlain(r.change))}</span>`));
    html = items.join('');
  } else if (s.status === 'down' || s.status === 'pending') {
    html = Array(8).fill(tapeItem(`<b>${DASH}</b>${DASH}`)).join('');
  } else {
    html = Array(10).fill(tapeItem('<span class="skel w1"></span>')).join('');
  }
  const key = html;
  if (tape._key === key) return;
  tape._key = key;
  tape.innerHTML = `<span class="tape-run">${html}</span><span class="tape-run" aria-hidden="true">${html}</span>`;
}
subs.push(renderTape);

/* ---------- stats, gauges ---------- */
subs.push((s) => {
  const st = deriveStats(s.rows);
  setNumber($('[data-stat="count"]'), st && st.count, fmtInt);
  setNumber($('[data-stat="volume"]'), st && st.volume, fmtUsd);
  setNumber($('[data-stat="liquidity"]'), st && st.liquidity, fmtUsd);
  const adv = $('[data-stat="adv"]');
  if (st) {
    setNumber(adv, st.adv, (n) => `${Math.round(n)} of ${st.count}`);
  } else setNumber(adv, null, fmtInt);
  setNumber($('[data-gauge="turn"]'), st && st.turnover, fmtRatio);
  setNumber($('[data-gauge="breadth"]'), st && st.breadth, fmtShare);
  setNumber($('[data-gauge="lead"]'), st && st.lead, fmtShare);
  setNumber($('[data-gauge="median"]'), st && st.median, fmtPlain);
  const w = (k, v) => ($(`[data-meter="${k}"]`).style.width = v == null ? '0%' : Math.max(0, Math.min(1, v)) * 100 + '%');
  w('turn', st && st.turnover != null ? st.turnover / (st.turnover + 1) : null);
  w('breadth', st && st.breadth);
  w('lead', st && st.lead);
  w('median', st && st.median != null ? 0.5 + Math.max(-50, Math.min(50, st.median)) / 100 : null);
});

/* ---------- hero rack + readout ---------- */
const SOCKETS = [
  { label: 'Order check', text: 'Logic that fires first. Approve, reshape or turn away incoming orders while reserves sit untouched.' },
  { label: 'Settlement', text: 'Fires once fills complete. Good for logging fresh prices or routing side payments.' },
  { label: 'Fee', text: 'Sets swapper charges. Rules may shift as conditions change.' },
  { label: 'Deposit', text: 'Logic around deposits: who may join, and within which price range.' },
  { label: 'Withdrawal', text: 'Logic around withdrawals: timing, conditions, limits on leaving.' },
  { label: 'Price feed', text: 'Maintains a rolling price average other programs may query.' },
];
const enabled = new Set([0, 2, 5]);
let activeLens = 0;
const stage = $('[data-stage]');
const tags = $('[data-tags]');
const jackList = $('[data-jack-list]');
const modRow = $('[data-module-row]');
const TAG_POS = [
  [16, 43],
  [84, 43],
  [16, 55],
  [84, 55],
  [16, 67],
  [84, 67],
];
SOCKETS.forEach((l, i) => {
  const t = document.createElement('button');
  t.type = 'button';
  t.className = 'cable-tag';
  t.dataset.jack = i;
  t.style.left = TAG_POS[i][0] + '%';
  t.style.top = TAG_POS[i][1] + '%';
  t.innerHTML = '<i></i><span></span>';
  t.lastChild.textContent = l.label;
  tags.appendChild(t);
  const li = document.createElement('li');
  li.innerHTML = '<button type="button" data-jack="' + i + '"><span class="jack-dot"></span><span></span><span class="jack-val"></span></button>';
  li.querySelector('button span:nth-child(2)').textContent = l.label;
  jackList.appendChild(li);
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'chip';
  c.dataset.jack = i;
  c.innerHTML = '<i></i><span></span>';
  c.lastChild.textContent = l.label;
  modRow.appendChild(c);
});
function paintLens() {
  $$('[data-jack]').forEach((el) => {
    const i = +el.dataset.jack;
    const on = enabled.has(i);
    if (el.matches('.cable, .plug')) el.classList.toggle('on', on);
    else if (el.matches('.jack')) el.classList.toggle('on', on);
    else if (el.matches('.cable-tag, .chip')) {
      el.classList.toggle('off', !on);
      el.classList.toggle('hov', i === activeLens && el.matches('.cable-tag'));
      el.setAttribute('aria-pressed', String(on));
    } else if (el.matches('button')) {
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', String(on));
      $('.jack-val', el).textContent = on ? 'wired' : 'open';
    }
  });
  const ro = $('[data-ro-dot]');
  ro.closest('.readout-title').style.setProperty('--dot', getComputedStyle($(`.jack-list [data-jack="${activeLens}"] .jack-dot`)).getPropertyValue('--dot'));
  $('[data-ro-title]').textContent = SOCKETS[activeLens].label;
  $('[data-ro-text]').textContent = SOCKETS[activeLens].text;
  $('[data-ro-foot]').textContent = enabled.size === 0 ? 'Nothing wired' : enabled.size + ' of ' + SOCKETS.length + ' wired';
}
subs.push(paintLens);
function pickLens(i, toggle) {
  activeLens = i;
  if (toggle) enabled.has(i) ? enabled.delete(i) : enabled.add(i);
  paintLens();
}
document.addEventListener('click', (e) => {
  const el = e.target instanceof Element ? e.target.closest('.cable-tag[data-jack], .chip[data-jack], .jack-list button[data-jack]') : null;
  if (el) pickLens(+el.dataset.jack, true);
});
tags.addEventListener('pointerover', (e) => {
  const el = e.target.closest('.cable-tag');
  if (el) pickLens(+el.dataset.jack, false);
});

/* ---------- trace ---------- */
const NODE_X = [60, 247, 433, 620];
const MODS = [
  { name: 'Bare pool', node: null },
  { name: 'Fee rule', node: 1 },
  { name: 'Opening cap', node: 1 },
  { name: 'Price log', node: 3 },
];
const RECEIPT = [
  [['Order size', 'pending'], ['Pool picked', 'pending']],
  [['Charge level', 'pending'], ['Cap check', 'pending']],
  [['Fill price', 'pending'], ['Band touched', 'pending']],
  [['Price log write', 'pending'], ['Maker share', 'pending']],
];
let stepIdx = 0;
let modIdx = 0;
function paintTrace() {
  $$('[data-trace-tabs] button').forEach((b) => {
    const on = +b.dataset.tab === modIdx;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $$('[data-node]').forEach((n) => n.classList.toggle('on', +n.dataset.node <= stepIdx));
  $$('.trace-step').forEach((el) => el.classList.toggle('on', +el.dataset.step === stepIdx));
  $('[data-trace-line]').setAttribute('d', `M60 95 H${NODE_X[stepIdx]}`);
  const wire = $('[data-wire]');
  const m = MODS[modIdx];
  if (m.node != null) {
    wire.setAttribute('cx', NODE_X[m.node]);
    wire.classList.toggle('on', stepIdx >= m.node);
  } else wire.classList.remove('on');
  const dl = $('[data-receipt]');
  dl.textContent = '';
  for (const [k, val] of [['Module', m.name], ...RECEIPT[stepIdx]]) {
    const d = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = val;
    dd.className = 'num' + (val === 'pending' ? ' pend' : '');
    d.append(dt, dd);
    dl.appendChild(d);
  }
}
$('[data-trace-tabs]').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  modIdx = +b.dataset.tab;
  paintTrace();
});
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          stepIdx = +e.target.dataset.step;
          paintTrace();
        }
      }
    },
    { rootMargin: '-45% 0px -45% 0px' }
  );
  $$('.trace-step').forEach((el) => io.observe(el));
}
subs.push(paintTrace);

/* ---------- spotlight card ---------- */
let spIdx = 0;
function paintSpot(s) {
  const view = sorted();
  const r = view[spIdx % Math.max(view.length, 1)];
  const q = (k) => $(`[data-sp-${k}]`);
  if (!r) {
    ['name', 'sub', 'sym', 'price', 'change', 'liq', 'share', 'rank'].forEach((k) => (q(k).textContent = DASH));
    q('logo').textContent = '';
    q('bar').style.width = '0%';
    $('[data-sp-copy]').dataset.copy = '';
    return;
  }
  const total = view.reduce((a, x) => a + x.volume, 0);
  const share = total > 0 ? r.volume / total : 0;
  q('rank').textContent = pad2((spIdx % view.length) + 1) + ' on the board';
  q('name').textContent = r.name;
  q('sub').textContent = short(r.address);
  q('sym').textContent = r.symbol;
  q('price').textContent = fmtPrice(r.price);
  q('change').textContent = fmtPlain(r.change);
  q('liq').textContent = fmtUsd(r.liquidity);
  q('share').textContent = fmtShare(share);
  q('bar').style.width = share * 100 + '%';
  if (q('logo').dataset.addr !== r.address) {
    q('logo').dataset.addr = r.address;
    logoInto(q('logo'), r);
  }
  $('[data-sp-copy]').dataset.copy = r.address;
}
subs.push(paintSpot);
$('[data-sp-prev]').addEventListener('click', () => {
  const n = state.rows.length || 1;
  spIdx = (spIdx + n - 1) % n;
  paintSpot(state);
});
$('[data-sp-next]').addEventListener('click', () => {
  const n = state.rows.length || 1;
  spIdx = (spIdx + 1) % n;
  paintSpot(state);
});

/* ---------- volume curve ---------- */
const ck = $('[data-ck-slider]');
function paintClock() {
  const view = sorted();
  const area = $('[data-ck-area]'), lv = $('[data-ck-line-v]'), ld = $('[data-ck-line-d]'), cur = $('[data-ck-cur]'), pt = $('[data-ck-pt]');
  if (!view.length) {
    [area, lv, ld].forEach((p) => p.setAttribute('d', ''));
    $('[data-ck-sym]').textContent = DASH;
    setNumber($('[data-ck-vol]'), null, fmtUsd);
    setNumber($('[data-ck-liq]'), null, fmtUsd);
    pt.style.opacity = '0';
    cur.style.opacity = '0';
    return;
  }
  pt.style.opacity = '';
  cur.style.opacity = '';
  const n = view.length;
  ck.max = String(n);
  const maxV = Math.max(...view.map((r) => r.volume)) || 1;
  const maxL = Math.max(...view.map((r) => r.liquidity)) || 1;
  const X = (i) => (n === 1 ? 340 : (i / (n - 1)) * 680);
  const yv = (r) => 178 - (r.volume / maxV) * 150;
  const yl = (r) => 178 - (r.liquidity / maxL) * 150;
  const path = (fn) => view.map((r, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + fn(r).toFixed(1)).join(' ');
  lv.setAttribute('d', path(yv));
  ld.setAttribute('d', path(yl));
  area.setAttribute('d', path(yv) + ' L680 190 L0 190 Z');
  const i = Math.min(Math.max(+ck.value - 1, 0), n - 1);
  const r = view[i];
  cur.setAttribute('x1', X(i));
  cur.setAttribute('x2', X(i));
  pt.style.left = (X(i) / 680) * 100 + '%';
  pt.style.top = yv(r) + 'px';
  $('[data-ck-sym]').textContent = r.symbol;
  setNumber($('[data-ck-vol]'), r.volume, fmtUsd);
  setNumber($('[data-ck-liq]'), r.liquidity, fmtUsd);
}
ck.addEventListener('input', paintClock);
subs.push(paintClock);

/* ---------- depth filter ---------- */
const slider = $('[data-lens-slider]');
function paintLensFilter() {
  const rows = state.rows;
  const max = rows.reduce((m, r) => Math.max(m, r.liquidity), 0);
  const p = +slider.value;
  $('[data-lens-fill]').style.width = p + '%';
  if (!rows.length) {
    $('[data-lens-floor]').textContent = DASH;
    $('[data-lens-count]').textContent = DASH;
    $('[data-lens-verdict]').textContent = 'Waiting for rows.';
    return;
  }
  const floor = (max * p) / 100;
  const n = rows.filter((r) => r.liquidity >= floor).length;
  $('[data-lens-floor]').textContent = fmtUsd(floor);
  $('[data-lens-count]').textContent = `${n} of ${rows.length}`;
  $('[data-lens-verdict]').textContent = n === 0 ? 'Nothing clears this floor.' : n === rows.length ? 'Every token clears it.' : `${n} ${n === 1 ? 'token clears' : 'tokens clear'} the floor.`;
}
slider.addEventListener('input', paintLensFilter);
subs.push(paintLensFilter);

/* ---------- code card ---------- */
const codeBody = $('[data-code-body]');
const k = (s) => `<span class="k">${s}</span>`;
const c = (s) => `<span class="c">${esc(s)}</span>`;
function paintCode(i) {
  const url = market && market.state === 'stated' ? market.url : 'pending';
  const pairs = market && market.state === 'stated' ? market.pairsUrl : 'pending';
  const slug = chain.value.toLowerCase();
  const snippets = [
    `${c('// every boosted token, all chains mixed')}\n${k('const')} boosts = ${k('await')} fetch(\n  "${esc(url)}"\n).then((r) => r.json());`,
    `${c('// keep one chain, ask for pairs in groups')}\n${k('const')} mints = [...${k('new')} Set(boosts\n  .filter((b) => b.chainId === "${esc(slug)}")\n  .map((b) => b.tokenAddress))];\n\n${k('const')} pairs = ${k('await')} fetch(\n  "${esc(pairs)}"\n    .replace("{addresses}", mints.slice(0, 30).join(","))\n).then((r) => r.json());`,
  ];
  codeBody.innerHTML = snippets[i];
  $$('[data-code-tabs] button').forEach((b) => {
    const on = +b.dataset.code === i;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
}
$('[data-code-tabs]').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-code]');
  if (b) paintCode(+b.dataset.code);
});
paintCode(0);

/* ---------- boot ---------- */
initReveal();
initProgress();
initSpotlight();
initParallax(stage);
initTilt($('[data-tilt]'));
subs.forEach((f) => f(state));

if (market && market.state === 'stated') {
  const poller = createPoller({
    run: () => loadMarket(market, (u, o) => fetch(u, o)),
    onOk: ({ rows, counts }) => set({ rows, counts, status: 'live' }),
    onFail: (err) => {
      document.documentElement.dataset.merr = String((err && err.message) || err).slice(0, 60);
      set({ status: state.rows.length ? 'retry' : 'down' });
    },
    isHidden: () => document.hidden,
    rand: Math.random,
  });
  document.addEventListener('visibilitychange', () => poller.visibilityChanged());
  poller.start();
} else {
  set({ status: 'pending' });
}
