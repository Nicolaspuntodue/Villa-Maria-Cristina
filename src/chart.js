import { animate as anime, svg, stagger, createSpring } from 'animejs';
import { animate, inView } from 'motion';

// The next 24 hours of wind as an area chart, in the conventions of shadcn/ui charts (horizontal grid only, no axis lines,
// a natural curve, a dot in the tooltip). ponytail: hand-drawn SVG, since shadcn charts are React + Recharts and this page is not;
// move to the real components if the site ever becomes a React app.
const PAD = { l: 32, r: 8, t: 8, b: 28 };

// Catmull-Rom through the points as cubic béziers; control points never dip under the baseline
const curve = (p, base) => p.slice(1).reduce((d, b, i) => {
  const a = p[i], a0 = p[i - 1] || a, b1 = p[i + 2] || b;
  const c1 = Math.min(a.y + (b.y - a0.y) / 6, base), c2 = Math.min(b.y - (b1.y - a.y) / 6, base);
  return `${d}C${a.x + (b.x - a0.x) / 6} ${c1} ${b.x - (b1.x - a.x) / 6} ${c2} ${b.x} ${b.y}`;
}, `M${p[0].x} ${p[0].y}`);

// initChart(figure, { hours: [{ h: '14:00', kn: 12 }, …], deg: 290 }, moving) -> setUnit('nodi')
export function initChart(fig, { hours, deg }, moving) {
  const plot = fig.querySelector('.chart__plot'), el = fig.querySelector('.chart__svg'), tip = fig.querySelector('.chart__tip');
  const needle = fig.querySelector('.compass__needle');
  const last = hours.length - 1;
  let pts, W = 0, unit = '';
  fig.hidden = false;

  const render = () => {
    if (plot.clientWidth === W) return;
    W = plot.clientWidth;
    const H = plot.clientHeight;
    const top = Math.max(10, Math.ceil(Math.max(...hours.map((h) => h.kn)) / 10) * 10);
    const x = (i) => PAD.l + (i * (W - PAD.l - PAD.r)) / last;
    const y = (kn) => PAD.t + (1 - kn / top) * (H - PAD.t - PAD.b);
    pts = hours.map((h, i) => ({ x: x(i), y: y(h.kn) }));
    const line = curve(pts, y(0)), every = W < 520 ? 6 : 3;
    el.setAttribute('viewBox', `0 0 ${W} ${H}`);
    el.innerHTML = [0, 0.5, 1].map((f) => `<line class="chart__grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(top * f)}" y2="${y(top * f)}"/><text x="${PAD.l - 8}" y="${y(top * f) + 4}" text-anchor="end">${top * f}</text>`).join('')
      + hours.map((h, i) => (i % every ? '' : `<text x="${x(i)}" y="${H - 6}" text-anchor="${i ? 'middle' : 'start'}">${h.h}</text>`)).join('')
      + `<path class="chart__area" d="${line}L${x(last)} ${y(0)}L${x(0)} ${y(0)}Z"/><path class="chart__line" d="${line}"/><circle class="chart__dot" r="5" visibility="hidden"/>`;
  };
  render();
  new ResizeObserver(render).observe(plot);

  // tooltip: the nearest hour under the pointer or the finger
  const show = (e) => {
    const r = plot.getBoundingClientRect();
    const i = Math.max(0, Math.min(last, Math.round(((e.clientX - r.left - PAD.l) / (r.width - PAD.l - PAD.r)) * last)));
    const p = pts[i], dot = el.querySelector('.chart__dot');
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y); dot.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.lastElementChild.textContent = `${hours[i].h} · ${hours[i].kn} ${unit}`;
    const tx = Math.min(p.x + 12, r.width - tip.offsetWidth), ty = Math.max(p.y - tip.offsetHeight - 12, 0);
    if (moving) animate(tip, { x: tx, y: ty }, { type: 'spring', stiffness: 500, damping: 40 });
    else tip.style.transform = `translate(${tx}px, ${ty}px)`;
  };
  plot.addEventListener('pointermove', show);
  plot.addEventListener('pointerdown', show);
  plot.addEventListener('pointerleave', () => { tip.hidden = true; el.querySelector('.chart__dot').setAttribute('visibility', 'hidden'); });

  // entrance: the line draws itself, the compass is drawn and the needle swings to where the wind comes from
  if (moving) {
    inView(fig, () => {
      anime(svg.createDrawable(el.querySelector('.chart__line')), { draw: ['0 0', '0 1'], duration: 1800, ease: 'inOutQuart' });
      anime(el.querySelector('.chart__area'), { opacity: [0, 1], duration: 900, delay: 900, ease: 'outQuad' });
      anime(svg.createDrawable(fig.querySelectorAll('.compass__ring, .compass__ticks path')), { draw: ['0 0', '0 1'], duration: 900, delay: stagger(90), ease: 'outQuart' });
      anime(needle, { rotate: [0, deg], delay: 300, ease: createSpring({ stiffness: 40, damping: 5 }) });
    }, { amount: 0.4 });
  } else needle.style.transform = `rotate(${deg}deg)`;

  return (u) => { unit = u; };
}
