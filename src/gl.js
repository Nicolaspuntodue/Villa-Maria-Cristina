import {
  WebGLRenderer, Scene, Camera, Mesh, PlaneGeometry, ShaderMaterial, WebGLRenderTarget,
  HalfFloatType, LinearFilter, TextureLoader, CanvasTexture, Vector2, Vector4,
} from 'three';

// Hero: you look straight down into the villa's saltwater pool. The name lies on the pool floor and is read through real
// water: a ripple simulation (height field, ping-pong render targets) that the pointer disturbs, plus caustics and glints.
// Scrolling is the drone going up: the camera pulls back until the water is just the pool in the villa's own aerial photo.

// aerial photo (public/media/aerial.webp) and where the water is in it, in photo pixels
export const PHOTO = { w: 1915, h: 1080 };
export const POOL = { x0: 186, y0: 196, x1: 570, y1: 960 };
const POOL_M = [6, 12]; // metres, only used to scale the waves

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// views(aspect) -> the two camera framings in photo pixels [cx, cy, w, h]: inside the pool, and the whole estate (cover fit)
export function views(a) {
  const pw = POOL.x1 - POOL.x0, ph = POOL.y1 - POOL.y0;
  const pcx = (POOL.x0 + POOL.x1) / 2, pcy = (POOL.y0 + POOL.y1) / 2;
  const sw = Math.min(0.9 * pw, 0.9 * ph * a);
  const wide = a > PHOTO.w / PHOTO.h;
  const ew = wide ? PHOTO.w : PHOTO.h * a, eh = ew / a;
  // phones keep the pool in the middle; wider screens show the photo from its left edge so the pool sits on the left
  const ecx = clamp(a < 1 ? pcx : ew / 2, ew / 2, PHOTO.w - ew / 2);
  return { start: [pcx, pcy, sw, sw / a], end: [ecx, clamp(PHOTO.h / 2, eh / 2, PHOTO.h - eh / 2), ew, eh] };
}

// each line of the name is scaled to the same width, like letters cut for a pool floor
function titleTexture(lines) {
  const W = 2048, fam = '-apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `700 100px ${fam}`;
  const rows = lines.map((l) => {
    const m = probe.measureText(l);
    const fs = (100 * W) / m.width;
    return { l, fs, cap: ((m.actualBoundingBoxAscent || 70) * fs) / 100 };
  });
  const gap = 0.22 * Math.min(...rows.map((r) => r.cap));
  const H = Math.ceil(rows.reduce((s, r) => s + r.cap, 0) + gap * (rows.length - 1)) + 8;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  let y = 4;
  for (const r of rows) { ctx.font = `700 ${r.fs}px ${fam}`; y += r.cap; ctx.fillText(r.l, 0, y, W); y += gap; }
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter; tex.generateMipmaps = false;
  return { tex, aspect: W / H };
}

const vert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// height field: R = height now, G = height one step ago
const simFrag = /* glsl */`
  precision highp float;
  uniform sampler2D uState;
  uniform vec2 uPx;
  uniform vec3 uDrop; // xy = where (pool uv), z = strength
  uniform float uRadius;
  varying vec2 vUv;
  void main() {
    vec4 s = texture2D(uState, vUv);
    float sum = texture2D(uState, vUv - vec2(uPx.x, 0.0)).r + texture2D(uState, vUv + vec2(uPx.x, 0.0)).r
              + texture2D(uState, vUv - vec2(0.0, uPx.y)).r + texture2D(uState, vUv + vec2(0.0, uPx.y)).r;
    float h = (sum * 0.5 - s.g) * 0.985;
    vec2 d = (vUv - uDrop.xy) * vec2(1.0, 2.0);
    h += uDrop.z * exp(-dot(d, d) / (uRadius * uRadius));
    gl_FragColor = vec4(h, s.r, 0.0, 1.0);
  }
`;

const drawFrag = /* glsl */`
  precision highp float;
  uniform sampler2D uPhoto, uSim, uTitle;
  uniform vec4 uView;      // camera in photo uv (y down): centre, size
  uniform vec4 uPool;      // water rectangle in photo uv (y down): min, max
  uniform vec4 uTitleRect; // the name on the floor, in pool uv: centre, size
  uniform vec2 uSimPx;
  uniform float uTime, uZoom, uScrim;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  // tileable caustic net (after Dave Hoskins' "Tileable Water Caustic")
  float caustic(vec2 uv, float t) {
    const float TAU = 6.28318530718;
    vec2 p = mod(uv * TAU, TAU) - 250.0;
    vec2 i = p;
    float c = 1.0, inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c = 1.17 - pow(c / 4.0, 1.4);
    return pow(abs(c), 8.0);
  }
  // slope of the slow swell the breeze keeps on the surface
  vec2 swell(vec2 m, float t) {
    vec2 g = vec2(1.0, 0.35) * cos(dot(m, vec2(1.0, 0.35)) * 2.1 + t * 1.1);
    g += vec2(-0.5, 0.9) * cos(dot(m, vec2(-0.5, 0.9)) * 3.3 - t * 1.4) * 0.7;
    g += vec2(0.8, -0.7) * cos(dot(m, vec2(0.8, -0.7)) * 5.7 + t * 2.0) * 0.4;
    return g;
  }

  void main() {
    vec2 s = vec2(vUv.x, 1.0 - vUv.y);
    vec2 puv = uView.xy + (s - 0.5) * uView.zw;
    vec3 col = texture2D(uPhoto, vec2(puv.x, 1.0 - puv.y)).rgb;

    vec2 q = (puv - uPool.xy) / (uPool.zw - uPool.xy);
    vec2 fw = fwidth(q) * 1.5 + 1e-5;
    vec2 e = smoothstep(vec2(0.0), fw, q) * smoothstep(vec2(0.0), fw, 1.0 - q);
    float inside = e.x * e.y;

    if (inside > 0.001) {
      vec2 size = vec2(${POOL_M[0]}.0, ${POOL_M[1]}.0);
      vec2 m = q * size;
      float hx = texture2D(uSim, q + vec2(uSimPx.x, 0.0)).r - texture2D(uSim, q - vec2(uSimPx.x, 0.0)).r;
      float hy = texture2D(uSim, q + vec2(0.0, uSimPx.y)).r - texture2D(uSim, q - vec2(0.0, uSimPx.y)).r;
      vec2 n = vec2(hx, hy) * 9.0 + swell(m, uTime) * 0.02;
      vec2 fm = m + n * 0.55; // where the refracted ray meets the floor
      vec2 fq = fm / size;

      vec3 water = mix(vec3(0.016, 0.13, 0.20), vec3(0.03, 0.30, 0.42), 0.35 + 0.4 * noise(fm * 0.8 + uTime * 0.05));
      float edge = min(min(m.x, size.x - m.x), min(m.y, size.y - m.y));
      water *= mix(0.4, 1.0, smoothstep(0.0, 1.1, edge));

      vec2 tq = (fq - uTitleRect.xy) / uTitleRect.zw + 0.5;
      float ta = texture2D(uTitle, vec2(tq.x, 1.0 - tq.y)).r * step(0.0, tq.x) * step(tq.x, 1.0) * step(0.0, tq.y) * step(tq.y, 1.0);
      water = mix(water, vec3(0.90, 0.95, 0.93), ta * 0.94);

      float c = caustic(fm * 0.42 + n * 0.3, uTime * 0.55);
      float c2 = caustic(fm * 0.9 + 3.7, uTime * 0.4);
      water += vec3(0.10, 0.52, 0.62) * c * 0.9 * (1.0 - 0.5 * ta) + vec3(0.5, 0.8, 0.85) * c2 * 0.25 * (1.0 - ta);
      water += vec3(0.6, 0.9, 0.95) * min((hx * hx + hy * hy) * 40.0, 0.35);
      vec3 nn = normalize(vec3(-n * 5.0, 1.0));
      water += 0.6 * pow(max(dot(nn, normalize(vec3(0.35, -0.3, 0.89))), 0.0), 220.0);

      // neutral scrim behind the navigation (top) and the first-screen copy (bottom), gone once the camera leaves
      water *= 1.0 - uScrim * (0.42 * smoothstep(0.5, 1.0, s.y) + 0.3 * smoothstep(0.22, 0.0, s.y));
      col = mix(col, water, inside);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function initHero(canvas, { src, portrait }) {
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  const scene = new Scene(), camera = new Camera();
  const quad = new Mesh(new PlaneGeometry(2, 2));
  scene.add(quad);

  const SIM = [160, 320];
  const rt = () => new WebGLRenderTarget(SIM[0], SIM[1], { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
  let a = rt(), b = rt();

  const simMat = new ShaderMaterial({
    vertexShader: vert, fragmentShader: simFrag,
    uniforms: { uState: { value: null }, uPx: { value: new Vector2(1 / SIM[0], 1 / SIM[1]) }, uDrop: { value: [0, 0, 0] }, uRadius: { value: 0.03 } },
  });
  const title = titleTexture(portrait ? ['VILLA', 'MARIA', 'CRISTINA'] : ['VILLA MARIA', 'CRISTINA']);
  const pw = POOL.x1 - POOL.x0, ph = POOL.y1 - POOL.y0;
  const drawMat = new ShaderMaterial({
    vertexShader: vert, fragmentShader: drawFrag,
    uniforms: {
      uPhoto: { value: null }, uSim: { value: null }, uTitle: { value: title.tex },
      uView: { value: new Vector4() },
      uPool: { value: new Vector4(POOL.x0 / PHOTO.w, POOL.y0 / PHOTO.h, POOL.x1 / PHOTO.w, POOL.y1 / PHOTO.h) },
      uTitleRect: { value: new Vector4() },
      uSimPx: { value: new Vector2(1 / SIM[0], 1 / SIM[1]) },
      uTime: { value: 0 }, uZoom: { value: 0 }, uScrim: { value: 1 },
    },
  });

  let v = views(1), view = [0, 0, 1, 1], progress = 0, W = 1, H = 1;
  const setView = () => {
    // zoom is geometric so the pull-back feels like constant climb; the centre follows the zoom
    const t = clamp((progress - 0.04) / 0.7, 0, 1);
    const z = t * t * (3 - 2 * t);
    const [sx, sy, sw] = v.start, [ex, ey, ew] = v.end;
    const w = sw * (ew / sw) ** z, k = (w - sw) / (ew - sw);
    view = [sx + (ex - sx) * k, sy + (ey - sy) * k, w, w * (H / W)];
    drawMat.uniforms.uView.value.set(view[0] / PHOTO.w, view[1] / PHOTO.h, view[2] / PHOTO.w, view[3] / PHOTO.h);
    drawMat.uniforms.uZoom.value = z;
    drawMat.uniforms.uScrim.value = 1 - clamp(progress / 0.2, 0, 1);
  };
  const resize = () => {
    W = canvas.clientWidth || innerWidth; H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false);
    v = views(W / H);
    // the name: 86% of the first view wide, a little above its centre so the copy below has room
    const tw = (0.86 * v.start[2]) / pw, th = (0.86 * v.start[2]) / title.aspect / ph;
    drawMat.uniforms.uTitleRect.value.set(0.5, 0.5 - (0.06 * v.start[3]) / ph, tw, th);
    setView();
  };
  resize();
  addEventListener('resize', resize);

  // pointer -> pool uv
  const drops = [];
  let last = null;
  const toPool = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    const px = view[0] + ((cx - r.left) / r.width - 0.5) * view[2], py = view[1] + ((cy - r.top) / r.height - 0.5) * view[3];
    return [(px - POOL.x0) / pw, (py - POOL.y0) / ph];
  };
  const onMove = (e) => {
    const [x, y] = toPool(e.clientX, e.clientY);
    if (x < 0 || x > 1 || y < 0 || y > 1) { last = null; return; }
    const moved = last ? Math.hypot(x - last[0], (y - last[1]) * 2) : 1;
    if (moved > 0.012 && drops.length < 4) { drops.push([x, y, Math.min(0.05 + moved * 1.2, 0.16)]); last = [x, y]; }
  };
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', (e) => { last = null; onMove(e); }, { passive: true });

  let visible = true, drawn = false, nextRain = 0;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(canvas);

  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });
  new TextureLoader().load(src, (tex) => {
    tex.minFilter = LinearFilter; tex.generateMipmaps = false;
    drawMat.uniforms.uPhoto.value = tex;
    drawn = true;
  });

  const frame = (time) => {
    if (!visible || !drawn) return;
    if (time > nextRain) { // the pool is never quite still: the jet, a leaf, the breeze
      drops.push([0.15 + Math.random() * 0.7, 0.1 + Math.random() * 0.8, 0.02 + Math.random() * 0.03]);
      nextRain = time + 0.5 + Math.random() * 1.2;
    }
    const d = drops.shift();
    simMat.uniforms.uDrop.value = d || [0, 0, 0];
    simMat.uniforms.uState.value = a.texture;
    quad.material = simMat;
    renderer.setRenderTarget(b); renderer.render(scene, camera);
    [a, b] = [b, a];

    drawMat.uniforms.uSim.value = a.texture;
    drawMat.uniforms.uTime.value = time;
    quad.material = drawMat;
    renderer.setRenderTarget(null); renderer.render(scene, camera);
    resolveReady();
  };

  return { ready, frame, setProgress(p) { progress = p; setView(); } };
}
