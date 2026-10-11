// Register rendering. Pure functions, shared by the build and the gates.

export const STATES = ['stated', 'absent', 'unconfirmed'];
export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const INERT_FORBIDDEN = ['value', 'url', 'pairsUrl', 'rpc', 'handle', 'href'];
const DATA_ONLY = ['checked'];

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const find = (reg, id) => reg.records.find((r) => r.id === id);

export function validateRegister(reg) {
  const errors = [];
  const ids = new Set();
  for (const r of reg.records) {
    if (ids.has(r.id)) errors.push(`duplicate record ${r.id}`);
    ids.add(r.id);
    if (!STATES.includes(r.state)) errors.push(`${r.id}: bad state ${r.state}`);
    if (!r.label) errors.push(`${r.id}: missing label`);
    if (r.state !== 'stated') {
      for (const k of INERT_FORBIDDEN) if (k in r) errors.push(`${r.id}: inert record carries ${k}`);
    } else {
      if (r.id === 'ca' && !BASE58.test(r.value || '')) errors.push('ca: stated value is not a Solana address');
      if (r.id === 'x' && !handleOf(r.url, ['x.com', 'twitter.com'])) errors.push('x: stated url has no handle');
      if (r.id === 'github' && !handleOf(r.url, ['github.com'])) errors.push('github: stated url has no handle');
      if (r.id === 'market' && !(r.url && r.pairsUrl && r.pairsUrl.includes('{addresses}')))
        errors.push('market: stated record needs url and pairsUrl');
      if (!['x', 'github', 'market'].includes(r.id) && !r.value) errors.push(`${r.id}: stated record has no value`);
    }
  }
  return errors;
}

// Store the URL, derive the handle.
export function handleOf(url, hosts) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (!hosts.includes(u.hostname.replace(/^www\./, ''))) return null;
    const h = u.pathname.split('/').filter(Boolean)[0];
    return h && /^[A-Za-z0-9_.-]{1,39}$/.test(h) ? h : null;
  } catch {
    return null;
  }
}

// Runtime copy of the register: dates removed, inert records reduced to id/label/state.
export function sanitizeRegister(reg) {
  return {
    records: reg.records.map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) {
        if (DATA_ONLY.includes(k) || k === 'source' || k === 'scope') continue;
        out[k] = v;
      }
      if (r.state !== 'stated') for (const k of INERT_FORBIDDEN) delete out[k];
      return out;
    }),
  };
}

const X_MARK =
  '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>';
const GH_MARK =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.292-.124-.317-.66-1.293-1.127-1.554-.385-.207-.936-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.448-.275-5.005-1.224-5.005-5.432 0-1.196.426-2.186 1.128-2.956-.111-.275-.496-1.402.11-2.915 0 0 .921-.288 3.024 1.128a10.193 10.193 0 0 1 2.75-.371c.936 0 1.871.123 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.513.221 2.64.111 2.915.701.77 1.127 1.747 1.127 2.956 0 4.222-2.571 5.157-5.019 5.432.399.344.743 1.004.743 2.035 0 1.471-.014 2.654-.014 3.025 0 .289.206.632.756.522C19.851 20.979 23 16.854 23 12c0-6.077-4.922-11-11-11Z"/></svg>';

export function renderCa(reg) {
  const r = find(reg, 'ca');
  if (r && r.state === 'stated') {
    const v = esc(r.value);
    return `<div class="ca" data-ca data-state="stated"><span class="ca-label">CA</span><button class="ca-copy" type="button" data-copy="${v}" aria-label="Copy contract address"><span class="ca-addr">${v}</span><span class="ca-fb" data-fb data-idle="Copy" aria-live="polite">Copy</span></button></div>`;
  }
  return `<div class="ca" data-ca data-state="${r ? esc(r.state) : 'absent'}"><span class="ca-label">CA</span><span class="ca-pending" aria-label="Contract address, pending">pending</span></div>`;
}

function social(reg, id, name, hosts, mark, prefix) {
  const r = find(reg, id);
  const handle = r && r.state === 'stated' ? handleOf(r.url, hosts) : null;
  if (handle) {
    return `<a class="soc" data-social="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${name}, ${prefix}${esc(handle)}">${mark}</a>`;
  }
  return `<span class="soc is-inert" data-social="${id}" data-state="${r ? esc(r.state) : 'absent'}" role="img" aria-disabled="true" aria-label="${name}, pending">${mark}</span>`;
}

export function renderSocial(reg) {
  return (
    social(reg, 'x', 'X', ['x.com', 'twitter.com'], X_MARK, '@') +
    social(reg, 'github', 'GitHub', ['github.com'], GH_MARK, '')
  );
}

export function renderPending(reg, ids) {
  return ids
    .map((id) => {
      const r = find(reg, id);
      if (!r) return '';
      const val = r.state === 'stated' ? esc(r.value) : 'pending';
      return `<li class="rec" data-record="${esc(id)}" data-state="${esc(r.state)}"><span class="mono-label">${esc(r.label)}</span><b>${val}</b></li>`;
    })
    .join('');
}

export function renderSlots(reg) {
  const chain = find(reg, 'chain');
  const market = find(reg, 'market');
  return {
    ca: renderCa(reg),
    social: renderSocial(reg),
    pending: renderPending(reg, ['supply', 'fees', 'lock', 'audit']),
    chain: chain && chain.state === 'stated' ? esc(chain.value) : 'pending',
    marketState: market && market.state === 'stated' ? 'stated' : 'inert',
    marketName: market && market.state === 'stated' ? esc(market.value) : 'pending',
    registerJson: JSON.stringify(sanitizeRegister(reg)).replace(/</g, '\\u003c'),
  };
}
