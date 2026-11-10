import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, PlaneGeometry, ShaderMaterial, Points, BufferGeometry, BufferAttribute,
  AdditiveBlending, TextureLoader, LinearFilter, Color,
} from 'three';

// Night: the villa's own photo of the lit pool, standing in a 3D scene. Scrolling tilts the camera up from the water to a sky of
// stars that sit at different depths in front of the black sky, so they drift against each other as you look up.

const PHOTO_ASPECT = 1920 / 996;
const SKY = 0.34;   // the top 34% of the photo is open sky
const WATER = 0.72; // the pool starts 72% of the way down
const BG = 0x020304;

const photoVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const photoFrag = /* glsl */`
  precision highp float;
  uniform sampler2D uTex;
  uniform vec3 uBg;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float y = 1.0 - vUv.y; // 0 = top of the photo
    float w = smoothstep(${WATER.toFixed(2)}, ${(WATER + 0.06).toFixed(2)}, y);
    vec2 uv = vUv + w * vec2(sin(y * 140.0 + uTime * 1.6) * 0.0016 + sin(y * 61.0 - uTime * 1.1) * 0.0022, 0.0);
    vec3 col = texture2D(uTex, uv).rgb;
    col += w * vec3(0.02, 0.07, 0.09) * (0.5 + 0.5 * sin(vUv.x * 60.0 + y * 90.0 + uTime * 2.0));
    col = mix(uBg, col, smoothstep(0.0, 0.10, y)); // the photo's sky dissolves into the page's night
    gl_FragColor = vec4(col, 1.0);
  }
`;
const starVert = /* glsl */`
  attribute vec3 aSeed; // size, phase, speed
  uniform float uTime, uScale, uShow;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSeed.x * uScale / -mv.z;
    vA = (0.55 + 0.45 * sin(uTime * aSeed.z + aSeed.y)) * uShow;
  }
`;
const starFrag = /* glsl */`
  precision highp float;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * pow(smoothstep(0.5, 0.0, d), 2.2) * vA, 1.0);
  }
`;

export function initNight(canvas, { src }) {
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  const dpr = Math.min(devicePixelRatio, 1.75);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(BG);
  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  const DIST = 5;

  const photoMat = new ShaderMaterial({
    vertexShader: photoVert, fragmentShader: photoFrag,
    uniforms: { uTex: { value: null }, uBg: { value: new Color(BG) }, uTime: { value: 0 } },
  });
  const photo = new Mesh(new PlaneGeometry(1, 1), photoMat);
  scene.add(photo);

  const N = 1400;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos.set([Math.random() * 2 - 1, Math.random(), Math.random()], i * 3); // unit box, placed on resize
    seed.set([Math.random() ** 4 * 2.2 + 0.5, Math.random() * 6.28, 0.6 + Math.random() * 2.2], i * 3);
  }
  const unit = pos.slice();
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new BufferAttribute(pos, 3));
  starGeo.setAttribute('aSeed', new BufferAttribute(seed, 3));
  const starMat = new ShaderMaterial({
    vertexShader: starVert, fragmentShader: starFrag, blending: AdditiveBlending, depthTest: false, transparent: true,
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uShow: { value: 0.35 } },
  });
  const stars = new Points(starGeo, starMat);
  stars.frustumCulled = false;
  scene.add(stars);

  let vh = 1, vw = 1, progress = 0, mx = 0;
  const resize = () => {
    const W = canvas.clientWidth || innerWidth, H = canvas.clientHeight || innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    vh = 2 * DIST * Math.tan((camera.fov / 2) * Math.PI / 180); vw = vh * camera.aspect;
    // photo: covers the first view, bottom edges together (the pool stays in frame on any screen)
    const pwid = Math.max(vw, vh * PHOTO_ASPECT) * 1.04, phei = pwid / PHOTO_ASPECT;
    photo.scale.set(pwid, phei, 1);
    photo.position.set(0, -vh / 2 + phei / 2 - vh * 0.02, 0);
    const horizon = photo.position.y + phei / 2 - SKY * phei;
    for (let i = 0; i < N; i++) {
      const z = 0.2 + unit[i * 3 + 2] * 3.2, spread = (DIST - z) / DIST; // nearer stars need less room to fill the view
      pos[i * 3] = unit[i * 3] * vw * 0.75 * spread;
      pos[i * 3 + 1] = (horizon + unit[i * 3 + 1] * vh * 1.7) * spread;
      pos[i * 3 + 2] = z;
    }
    starGeo.attributes.position.needsUpdate = true;
    // a phone shows a narrow strip of sky: fewer, finer stars or it reads as snow
    starGeo.setDrawRange(0, W < 700 ? 450 : N);
    starMat.uniforms.uScale.value = H * dpr * (W < 700 ? 0.003 : 0.0042) * DIST;
  };
  resize();
  addEventListener('resize', resize);
  addEventListener('pointermove', (e) => { mx = e.clientX / innerWidth - 0.5; }, { passive: true });

  let visible = false, loaded = false, cx = 0;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(canvas);
  new TextureLoader().load(src, (tex) => {
    tex.minFilter = LinearFilter; tex.generateMipmaps = false;
    photoMat.uniforms.uTex.value = tex; loaded = true;
  });

  return {
    setProgress(p) { progress = p; },
    frame(time) {
      if (!visible || !loaded) return;
      const t = progress * progress * (3 - 2 * progress);
      cx += (mx * 0.25 - cx) * 0.05;
      camera.position.set(cx, t * vh * 0.6, DIST);
      camera.lookAt(cx * 0.6, t * vh * 0.6, 0);
      photoMat.uniforms.uTime.value = time;
      starMat.uniforms.uTime.value = time;
      starMat.uniforms.uShow.value = 0.35 + 0.65 * t;
      renderer.render(scene, camera);
    },
  };
}
