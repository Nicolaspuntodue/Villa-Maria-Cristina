import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { T, pickLang, fill } from './i18n.js';
import { animate, inView, press } from 'motion';
import { animate as anime, splitText, stagger } from 'animejs';
import { readWind, peak } from './wind.js';
import { initChart } from './chart.js';

gsap.registerPlugin(ScrollTrigger);
// mobile URL bar show/hide must not re-layout pins mid-scroll
ScrollTrigger.config({ ignoreMobileResize: true });

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const webgl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
// the scroll scenes (pool, night sky) need WebGL and a visitor who has not asked for less motion; everyone else gets the static page
const scene = webgl && !reduced;
root.classList.toggle('has-scene', scene);
root.classList.toggle('has-motion', !reduced);

// always start at the top: the pinned scenes assume it
history.scrollRestoration = 'manual';
scrollTo(0, 0);

/* ---------- language: ?lang= > last choice > device languages > English ---------- */
const saved = { get() { try { return localStorage.getItem('vmc-lang'); } catch { return null; } }, set(v) { try { localStorage.setItem('vmc-lang', v); } catch { /* private mode */ } } };
let lang = pickLang([new URLSearchParams(location.search).get('lang'), saved.get(), ...(navigator.languages || [navigator.language])].filter(Boolean));
let wind = null; // null = still reading, 'offline' = no reading, else { name, sector, kn, beach, deg, hours }
let chartUnit;   // set once the 24-hour chart is on the page

function renderWind() {
  const t = T[lang], el = $('#wind');
  $('[data-beach="capo"]').classList.toggle('is-today', !!wind?.beach);
  if (!wind) el.textContent = t['sea.loading'];
  else if (wind === 'offline') el.textContent = t['sea.offline'];
  else if (!wind.beach) el.textContent = fill(t['sea.calm'], wind);
  else el.textContent = `${fill(t['sea.now'], { wind: wind.name, dir: t['sea.dirs'][wind.sector], kn: wind.kn })} ${fill(t['sea.pick'], wind)}`;
  if (!wind?.hours) return;
  if (!chartUnit) { chartUnit = initChart($('#chart'), wind, !reduced); ScrollTrigger.refresh(); } // the chart adds height above the night scene
  chartUnit(t['chart.unit']);
  $('#chart-foot').textContent = fill(t['chart.peak'], peak(wind.hours));
}
function setLang(l) {
  lang = l;
  const t = T[l];
  root.lang = l;
  document.title = t['meta.title'];
  $('meta[name="description"]').content = t['meta.desc'];
  $$('[data-i18n]').forEach((el) => { el.textContent = t[el.dataset.i18n]; });
  $('#lang').value = l;
  renderWind();
  ScrollTrigger.refresh(); // line counts change with the language
}
$('#lang').addEventListener('change', async (e) => {
  const l = e.target.value;
  saved.set(l);
  if (reduced) return setLang(l);
  await animate('main', { opacity: 0 }, { duration: 0.18 }); // the words change while the page is out
  setLang(l);
  animate('main', { opacity: 1 }, { duration: 0.4 });
});
setLang(lang);
readWind().then((w) => { wind = w; }, () => { wind = 'offline'; }).finally(renderWind);

/* ---------- smooth scroll ---------- */
let lenis;
if (!reduced) {
  lenis = new Lenis({ lerp: 0.09 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
  $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
    const target = $(a.getAttribute('href'));
    if (target) { e.preventDefault(); lenis.scrollTo(target, { offset: a.getAttribute('href') === '#top' ? 0 : -60 }); }
  }));
}

/* ---------- navigation: light over the water, solid once the gravel shows ---------- */
const nav = $('.nav');
const solidAfter = () => (scene ? innerHeight * 0.5 : innerHeight - 80);
const onScroll = () => nav.classList.toggle('is-solid', scrollY > solidAfter());
addEventListener('scroll', onScroll, { passive: true });
onScroll();
// over the dark fields (pool, night, footer) the solid bar turns dark too
const dark = new Set();
const band = new IntersectionObserver((entries) => {
  entries.forEach((en) => dark[en.isIntersecting ? 'add' : 'delete'](en.target));
  nav.classList.toggle('is-dark', dark.size > 0);
}, { rootMargin: '0px 0px -96% 0px' });
$$('.pool, .night, .foot, .sea__wide').forEach((el) => band.observe(el));

/* ---------- small physics (motion.dev): buttons give under the finger, the four numbers count up ---------- */
if (!reduced) press('.btn', (el) => {
  animate(el, { scale: 0.96 }, { type: 'spring', stiffness: 600, damping: 30 });
  return () => animate(el, { scale: 1 }, { type: 'spring', stiffness: 400, damping: 12 });
});
let counted = false;
function countFacts() {
  if (counted) return;
  counted = true;
  $$('.facts dt').forEach((dt, i) => {
    const [, int, dec = '', rest] = dt.textContent.match(/^(\d+)(?:,(\d+))?(.*)$/); // "9,2" or "2,3 km"
    animate(0, Number(`${int}.${dec || 0}`), {
      duration: 1.6, delay: i * 0.12, ease: [0.2, 0.7, 0.1, 1],
      onUpdate: (v) => { dt.textContent = v.toFixed(dec.length).replace('.', ',') + rest; },
    });
  });
}
if (!reduced && !scene) inView('.facts', countFacts);

/* ---------- rooms: on wide screens the vertical scroll drives the row sideways.
   Created before the night scene below it: ScrollTrigger measures in creation order, and this pin adds height ---------- */
if (!reduced && innerWidth >= 900) {
  const track = $('.rooms__track');
  const dist = () => Math.max(track.scrollWidth - innerWidth, 0);
  gsap.to(track, {
    x: () => -dist(), ease: 'none',
    scrollTrigger: { trigger: '.rooms__pin', start: 'top top', end: () => `+=${dist()}`, pin: true, scrub: 0.5, invalidateOnRefresh: true, anticipatePin: 1 },
  });
}

/* ---------- hero: the pool, then the drone goes up ---------- */
if (scene) {
  const wide = innerWidth >= 900;
  const hero = { trigger: '.hero', start: 'top top', end: 'bottom bottom', scrub: true };
  gsap.timeline({ scrollTrigger: hero, defaults: { ease: 'none' } })
    .to('.hero__copy', { autoAlpha: 0, y: -40, duration: 0.14 }, 0.03)
    .fromTo('.hero__intro', wide ? { xPercent: 100 } : { yPercent: 100 }, { xPercent: 0, yPercent: 0, duration: 0.26, ease: 'power2.out' }, 0.62)
    .from('.hero__intro > *', { autoAlpha: 0, y: 24, stagger: 0.03, duration: 0.1 }, 0.74)
    .call(countFacts, [], 0.78)
    .to({}, { duration: 0.1 }, 0.9); // hold on the estate before the page moves on

  import('./gl.js').then(async ({ initHero }) => {
    // the name is drawn with the system font, or Inter where there is no San Francisco; never wait more than a moment for it
    await Promise.race([document.fonts.load('700 100px Inter').catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    const canvas = $('.hero__gl');
    const gl = initHero(canvas, { src: '/media/aerial.webp', portrait: innerWidth / innerHeight < 0.9 });
    gsap.ticker.add((t) => gl.frame(t));
    gl.ready.then(() => canvas.classList.add('is-ready'));
    ScrollTrigger.create({ ...hero, onUpdate: (s) => gl.setProgress(s.progress) });
  }).catch((err) => {
    console.warn('WebGL hero unavailable, using the static page', err);
    root.classList.remove('has-scene');
    ScrollTrigger.refresh();
  });

  /* night: tilt up from the pool to the stars; loaded when it is a screen away */
  const night = $('.night');
  const near = new IntersectionObserver(([en]) => {
    if (!en.isIntersecting) return;
    near.disconnect();
    import('./night.js').then(({ initNight }) => {
      const canvas = $('.night__gl');
      const sky = initNight(canvas, { src: '/media/notte.webp' });
      gsap.ticker.add((t) => sky.frame(t));
      canvas.classList.add('is-ready');
      ScrollTrigger.create({ trigger: night, start: 'top top', end: 'bottom bottom', scrub: true, onUpdate: (s) => sky.setProgress(s.progress) });
    }).catch((err) => console.warn('Night sky unavailable, using the photo', err));
  }, { rootMargin: '100% 0px' });
  near.observe(night);
  gsap.timeline({ scrollTrigger: { trigger: night, start: 'top top', end: 'bottom bottom', scrub: true }, defaults: { ease: 'none' } })
    .from('.quotes blockquote, .night__src', { autoAlpha: 0, y: 32, stagger: 0.14, duration: 0.2 }, 0.22)
    .to({}, { duration: 0.1 }, 0.9);
}

/* ---------- the house in four details: the photograph holds while the text scrolls, and changes with it ---------- */
{
  const steps = $$('.story__steps li'), photos = $$('.story__ph');
  // the line a step has to cross to be the current one: mid-screen beside the photo; near the foot of the screen when the photo
  // sits above the text, so a step is current for as long as it shows under the photo
  const at = () => (innerWidth >= 900 ? 'center' : '92%');
  steps.forEach((li, i) => ScrollTrigger.create({
    trigger: li, start: () => `top ${at()}`, end: () => `bottom ${at()}`,
    onToggle: (s) => s.isActive && [steps, photos].forEach((set) => set.forEach((el, j) => el.classList.toggle('is-on', i === j))),
  }));
  gsap.to('.story__bar i', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.story__steps', start: () => `top ${at()}`, end: () => `bottom ${at()}`, scrub: true } });
}

/* ---------- entrances and photograph drift ---------- */
const seen = new IntersectionObserver((entries) => entries.forEach((en) => {
  if (en.isIntersecting) { en.target.classList.add('in'); seen.unobserve(en.target); }
}), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
$$('[data-reveal], [data-clip]').forEach((el) => {
  el.style.setProperty('--i', [...el.parentElement.children].filter((c) => c.matches('[data-reveal]')).indexOf(el));
  seen.observe(el);
});
if (!reduced) {
  // headings: word by word (anime.js)
  $$('h2[data-reveal]').forEach((h) => inView(h, () => {
    const { words } = splitText(h, { words: true }); // no clip wrapper: it cuts the descenders at this line height
    h.classList.add('is-split');
    anime(words, { y: ['70%', '0%'], opacity: [0, 1], duration: 1100, delay: stagger(70), ease: 'outExpo' });
  }, { amount: 0.3 }));

  // the pool opens like a window as it comes up the screen; the breakfast door opens from the middle
  const opens = (sel, from, start, end) => gsap.fromTo(`${sel} .frame`, { clipPath: from }, {
    clipPath: 'inset(0% 0% 0% 0%)', ease: 'none', scrollTrigger: { trigger: sel, start, end, scrub: 0.4 },
  });
  opens('.pool__wide', 'inset(24% 30% 24% 30%)', 'top 90%', 'top 12%');
  opens('.bf__door', 'inset(0% 50% 0% 50%)', 'top 92%', 'top 40%');

  // "at sunset the water becomes a mirror": the reflection arrives rippled and settles.
  // Not on touch screens: an SVG displacement filter is redrawn on the CPU every frame, and a phone drops frames while it runs
  if (matchMedia('(hover: hover)').matches) inView('.pool__mirror', (fig) => {
    const img = $('img', fig), map = $('#ripple feDisplacementMap'), o = { s: 70 };
    img.style.filter = 'url(#ripple)';
    anime(o, { s: 0, duration: 3400, ease: 'outQuart', onUpdate: () => map.setAttribute('scale', o.s), onComplete: () => { img.style.filter = ''; } });
  }, { amount: 0.5 });

  if (matchMedia('(hover: hover)').matches) {
    // photographs lean towards the pointer (motion.dev springs)
    $$('.ph .frame').forEach((f) => {
      f.addEventListener('pointermove', (e) => {
        const r = f.getBoundingClientRect();
        animate(f, { transformPerspective: 900, rotateY: ((e.clientX - r.left) / r.width - 0.5) * 7, rotateX: (0.5 - (e.clientY - r.top) / r.height) * 7, scale: 1.02 }, { type: 'spring', stiffness: 180, damping: 20 });
      });
      f.addEventListener('pointerleave', () => animate(f, { rotateX: 0, rotateY: 0, scale: 1 }, { type: 'spring', stiffness: 120, damping: 14 }));
    });
  }

  $$('[data-parallax]').forEach((img) => gsap.fromTo(img, { yPercent: -6, scale: 1.14 }, {
    yPercent: 6, scale: 1.14, ease: 'none',
    scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true },
  }));
}

/* ---------- booking: dates go straight to the villa's Booking.com page ---------- */
// ponytail: hands off to Booking.com; replace with the villa's own booking engine or contact when they have one.
const BOOKING = 'https://www.booking.com/hotel/it/villa-maria-cristina-provincia-di-sassari';
const BOOKING_LANG = { it: 'it', en: 'en-gb', es: 'es', fr: 'fr', de: 'de' };
const form = $('#book');
const today = new Date().toISOString().slice(0, 10);
form.checkin.min = today; form.checkout.min = today;
form.checkin.addEventListener('change', () => { form.checkout.min = form.checkin.value || today; });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const { checkin, checkout, guests } = form;
  const err = $('.book__err');
  const dated = checkin.value && checkout.value;
  err.hidden = !dated || checkout.value > checkin.value;
  if (!err.hidden) return;
  const q = dated ? `?${new URLSearchParams({ checkin: checkin.value, checkout: checkout.value, group_adults: guests.value, no_rooms: 1 })}` : '';
  open(`${BOOKING}.${BOOKING_LANG[lang]}.html${q}`, '_blank', 'noopener');
});

addEventListener('load', () => ScrollTrigger.refresh());
