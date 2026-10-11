import { spring, isReduced } from './motion.js';

// Scroll-reveal with a staggered spring. Elements start hidden through html.anim in the CSS.
export function initReveal() {
  const els = [...document.querySelectorAll('[data-reveal]')];
  const show = (el) => el.classList.add('in');
  if (isReduced() || !('IntersectionObserver' in window)) {
    els.forEach(show);
    return;
  }
  const play = (el, delay) => {
    el.style.opacity = '0';
    el.style.transform = 'translate3d(0,32px,0)';
    show(el);
    setTimeout(() => {
      spring({
        stiffness: 120,
        damping: 17,
        onUpdate: (p) => {
          el.style.opacity = String(Math.min(1, Math.max(0, p * 1.2)));
          el.style.transform = `translate3d(0,${(1 - p) * 32}px,0)`;
        },
        onDone: () => {
          el.style.opacity = '';
          el.style.transform = '';
        },
      });
    }, delay);
  };
  const io = new IntersectionObserver(
    (entries) => {
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => (a.target.compareDocumentPosition(b.target) & 4 ? -1 : 1));
      hit.forEach((e, i) => {
        io.unobserve(e.target);
        play(e.target, i * 80);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  );
  els.forEach((el) => io.observe(el));
}

export function initProgress() {
  const bar = document.querySelector('[data-progress]');
  if (!bar) return;
  let raf = 0;
  const paint = () => {
    raf = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(paint);
  };
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick);
  paint();
}

// Parallax depth layers driven by pointer and scroll, eased every frame.
export function initParallax(stage) {
  const layers = [...stage.querySelectorAll('[data-depth]')];
  if (!layers.length) return;
  let px = 0, py = 0, tx = 0, ty = 0, raf = 0;
  const tick = () => {
    raf = 0;
    if (isReduced()) {
      layers.forEach((l) => (l.style.transform = ''));
      return;
    }
    px += (tx - px) * 0.08;
    py += (ty - py) * 0.08;
    const s = Math.min(scrollY, 900);
    for (const l of layers) {
      const d = parseFloat(l.dataset.depth);
      l.style.transform = `translate3d(${(px * d * 26).toFixed(2)}px,${(py * d * 18 - s * d * 0.16).toFixed(2)}px,0)`;
    }
    if (Math.abs(tx - px) > 0.002 || Math.abs(ty - py) > 0.002) raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };
  const hero = stage.closest('.hero') || stage;
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    ty = ((e.clientY - r.top) / r.height - 0.5) * 2;
    kick();
  });
  hero.addEventListener('pointerleave', () => {
    tx = ty = 0;
    kick();
  });
  addEventListener('scroll', kick, { passive: true });
  kick();
}

// Spotlight: write pointer position into custom properties on any [data-spot] under the pointer.
export function initSpotlight() {
  document.addEventListener(
    'pointermove',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest('[data-spot]') : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', e.clientX - r.left + 'px');
      el.style.setProperty('--my', e.clientY - r.top + 'px');
    },
    { passive: true }
  );
}

export function initTilt(el) {
  if (!el) return;
  el.addEventListener('pointermove', (e) => {
    if (isReduced()) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `rotateY(${(x * 14).toFixed(2)}deg) rotateX(${(-y * 14).toFixed(2)}deg)`;
  });
  el.addEventListener('pointerleave', () => (el.style.transform = ''));
}
