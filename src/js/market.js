// Market engine. Pure logic with injected IO so the gates can drive it without a browser.
export const TOP_N = 10;
export const CHUNK = 30;
export const POLL_MS = 60000;
export const BACKOFF_BASE_MS = 2000;
export const BACKOFF_MAX_MS = 60000;
export const REQUEST_TIMEOUT_MS = 20000;

export const isSolanaBoost = (b) =>
  !!b && String(b.chainId).toLowerCase() === 'solana' && typeof b.tokenAddress === 'string' && b.tokenAddress.length > 0;

export function pickBoosts(json) {
  const seen = new Set();
  const out = [];
  for (const b of Array.isArray(json) ? json : []) {
    if (isSolanaBoost(b) && !seen.has(b.tokenAddress)) {
      seen.add(b.tokenAddress);
      out.push(b);
    }
  }
  return out;
}

export const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const num = (v) => {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

// One row per boosted token: volume and depth summed over pairs, price and move from the deepest pair.
export function buildRows(boosts, pairs, topN = TOP_N) {
  const wanted = new Set(boosts.map((b) => b.tokenAddress));
  const by = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!p || String(p.chainId).toLowerCase() !== 'solana') continue;
    const addr = p.baseToken && p.baseToken.address;
    if (!addr || !wanted.has(addr)) continue;
    let g = by.get(addr);
    if (!g) {
      g = { address: addr, pairs: 0, volume: 0, liquidity: 0, best: null, bestLiq: -1 };
      by.set(addr, g);
    }
    g.pairs += 1;
    g.volume += num(p.volume && p.volume.h24) || 0;
    const liq = num(p.liquidity && p.liquidity.usd) || 0;
    g.liquidity += liq;
    if (liq > g.bestLiq) {
      g.bestLiq = liq;
      g.best = p;
    }
  }
  const rows = [];
  for (const g of by.values()) {
    const p = g.best;
    rows.push({
      address: g.address,
      symbol: String(p.baseToken.symbol || '?'),
      name: String(p.baseToken.name || p.baseToken.symbol || ''),
      imageUrl: p.info && typeof p.info.imageUrl === 'string' && /^https:\/{2}/.test(p.info.imageUrl) ? p.info.imageUrl : null,
      price: num(p.priceUsd),
      change: num(p.priceChange && p.priceChange.h24),
      volume: g.volume,
      liquidity: g.liquidity,
      pairs: g.pairs,
    });
  }
  rows.sort((a, b) => b.volume - a.volume);
  return rows.slice(0, topN);
}

export function backoffDelay(failures, base = BACKOFF_BASE_MS, max = BACKOFF_MAX_MS) {
  return Math.min(max, base * 2 ** Math.max(0, failures - 1));
}

async function getJson(fetchImpl, url, timeoutMs) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, ctl ? { signal: ctl.signal, headers: { accept: 'application/json' } } : undefined);
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally {
    if (t) clearTimeout(t);
  }
}

// rec is the market register record. Returns { rows, counts } or throws.
export async function loadMarket(rec, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!rec || rec.state !== 'stated') throw new Error('market source not stated');
  const raw = await getJson(fetchImpl, rec.url, timeoutMs);
  const boosts = pickBoosts(raw);
  if (!boosts.length) throw new Error('no solana entries');
  const groups = chunk(
    boosts.map((b) => b.tokenAddress),
    CHUNK
  );
  const lists = await Promise.all(groups.map((g) => getJson(fetchImpl, rec.pairsUrl.replace('{addresses}', g.join(',')), timeoutMs)));
  const pairs = lists.flat();
  const rows = buildRows(boosts, pairs);
  if (!rows.length) throw new Error('no priced rows');
  return { rows, counts: { boosted: Array.isArray(raw) ? raw.length : 0, solana: boosts.length, pairs: pairs.length } };
}

// Poller: poll every interval, back off exponentially on failure, pause while hidden,
// fetch at once when visible again. Environment is injected.
export function createPoller({ run, onOk, onFail, isHidden, setTimer = setTimeout, clearTimer = clearTimeout, interval = POLL_MS, rand = () => 1 }) {
  let timer = null;
  let busy = false;
  let failures = 0;
  let stopped = true;

  const schedule = (ms) => {
    clearTimer(timer);
    timer = null;
    if (stopped || isHidden()) return;
    timer = setTimer(tick, ms);
  };
  async function tick() {
    timer = null;
    if (busy || stopped || isHidden()) return;
    busy = true;
    try {
      const out = await run();
      failures = 0;
      onOk(out);
      busy = false;
      schedule(interval);
    } catch (err) {
      failures += 1;
      busy = false;
      const wait = Math.round(backoffDelay(failures) * (0.85 + 0.3 * rand()));
      onFail(err, failures, wait);
      schedule(Math.min(wait, interval));
    }
  }
  return {
    start() {
      stopped = false;
      tick();
    },
    stop() {
      stopped = true;
      clearTimer(timer);
      timer = null;
    },
    // Call from the visibilitychange handler.
    visibilityChanged() {
      if (stopped) return;
      if (isHidden()) {
        clearTimer(timer);
        timer = null;
      } else {
        clearTimer(timer);
        timer = null;
        tick();
      }
    },
    get failures() {
      return failures;
    },
    get pending() {
      return timer !== null;
    },
  };
}

export function deriveStats(rows) {
  if (!rows || !rows.length) return null;
  const volume = rows.reduce((s, r) => s + r.volume, 0);
  const liquidity = rows.reduce((s, r) => s + r.liquidity, 0);
  const moves = rows.map((r) => r.change).filter((c) => c != null).sort((a, b) => a - b);
  const mid = moves.length ? (moves.length % 2 ? moves[(moves.length - 1) / 2] : (moves[moves.length / 2 - 1] + moves[moves.length / 2]) / 2) : null;
  const adv = rows.filter((r) => r.change != null && r.change > 0).length;
  return {
    count: rows.length,
    volume,
    liquidity,
    adv,
    breadth: rows.length ? adv / rows.length : null,
    turnover: liquidity > 0 ? volume / liquidity : null,
    lead: volume > 0 ? rows[0].volume / volume : null,
    median: mid,
  };
}
