// Damped spring solver plus the reduced-motion switch. Every animation routes through here.
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
export const isReduced = () => mq.matches;

// Semi-implicit Euler on a unit progress value. Returns a cancel function.
export function spring({ from = 0, to = 1, stiffness = 170, damping = 22, mass = 1, onUpdate, onDone }) {
  if (isReduced()) {
    onUpdate(to);
    if (onDone) onDone();
    return () => {};
  }
  let x = from;
  let v = 0;
  let last = performance.now();
  let raf = 0;
  let dead = false;
  const h = 1 / 240;
  const step = (now) => {
    if (dead) return;
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    while (dt > 0) {
      const s = Math.min(h, dt);
      v += ((-stiffness * (x - to) - damping * v) / mass) * s;
      x += v * s;
      dt -= s;
    }
    if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.005) {
      onUpdate(to);
      if (onDone) onDone();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    dead = true;
    cancelAnimationFrame(raf);
  };
}

// Count a number element toward a new value; flash on every change after the first.
export function setNumber(el, value, fmt) {
  const ok = typeof value === 'number' && Number.isFinite(value);
  if (!ok) {
    if (el._cancel) el._cancel();
    el._v = null;
    el.textContent = '–';
    return;
  }
  if (el._v === value) return;
  const prev = el._v;
  if (el._cancel) el._cancel();
  el._v = value;
  if (isReduced()) {
    el.textContent = fmt(value);
    return;
  }
  const from = prev == null ? 0 : prev;
  if (prev != null) {
    el.classList.remove('flash', 'fl-up', 'fl-dn');
    void el.offsetWidth;
    el.classList.add('flash', value > prev ? 'fl-up' : 'fl-dn');
  }
  el._cancel = spring({
    stiffness: 120,
    damping: 18,
    onUpdate: (p) => {
      el.textContent = fmt(from + (value - from) * Math.min(Math.max(p, 0), 1.02));
    },
    onDone: () => {
      el.textContent = fmt(value);
    },
  });
}
