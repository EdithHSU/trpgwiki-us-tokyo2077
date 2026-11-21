/* 2077 東京互動勢力地圖（移植自原始成品「2077 東京｜互動勢力地圖」）
   - 嵌在頁面的 #tokyo-map 框裡（不是整個視窗），可切換全螢幕
   - 只保留線稿樣式：網站淺色模式用 C（線稿・淺），深色模式用 B（線稿・深）
   - 資料：data-src（hooks/mapdata.py 產生的 map.json）與 data-geo（行政區界線 GeoJSON）
   - 本站另外加的欄位：page／people 會變成連到 wiki 頁面的連結，mock 會標「模擬」 */
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import './map.css';

const host = document.getElementById('tokyo-map');
if (host) {
  Promise.all([host.dataset.src, host.dataset.geo].map((u) => fetch(u).then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  })))
    .then(([data, geo]) => start(host, data, geo, host.dataset.base || ''))
    .catch((err) => { host.textContent = '地圖資料載入失敗（' + err.message + '）'; });
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function start(host, DATA, GEO, BASE) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  host.innerHTML = `
  <div class="tm" data-theme="c">
    <div class="tm-stage"></div>
    <div class="tm-labels"></div>
    <header class="tm-hud">
      <p class="tm-kicker">TOKYO · 2077 · SESSION LOG</p>
      <h2 class="tm-h1">東京 23 區勢力圖</h2>
      <ul class="tm-legend"></ul>
      <ul class="tm-keys">
        <li><i class="key-lm"></i>地標</li>
        <li><i class="key-ev"></i>事件</li>
        <li><i class="key-ct"></i>爭奪中</li>
      </ul>
    </header>
    <p class="tm-hint"><span class="ho">拖曳平移 · 滾輪縮放 · 點擊行政區檢視詳情 · Esc 重置</span><span class="hz">拖曳旋轉視角 · 滾輪縮放</span></p>
    <div class="tm-toolbar">
      <div class="tm-switch" role="radiogroup" aria-label="閱覽模式">
        <span class="lbl">VIEW</span>
        <button type="button" role="radio" data-m="map">地圖</button>
        <button type="button" role="radio" data-m="tl">事件時間軸</button>
      </div>
      <button type="button" class="tm-full">全螢幕</button>
    </div>
    <aside class="tm-timeline" aria-label="事件時間軸">
      <div class="tl-head">
        <p class="tm-kicker">TOKYO · 2077 · TIMELINE</p>
        <h2 class="tl-title">事件時間軸</h2>
        <p class="tl-meta"></p>
        <ul class="tl-legend"></ul>
      </div>
      <div class="tl-card"><ol class="tl-list"></ol><i class="tl-thumb" aria-hidden="true"></i></div>
      <div class="tl-nav">
        <button type="button" class="tl-prev">↑ 上一則</button>
        <span class="tl-pos">— / —</span>
        <button type="button" class="tl-next">下一則 ↓</button>
      </div>
    </aside>
    <p class="tm-src">區界：國土數值情報 N03（niiyz/JapanCityGeoJson）</p>
    <aside class="tm-panel" aria-label="行政區詳情" aria-hidden="true">
      <div class="p-top"><button type="button" class="back"><span aria-hidden="true">←</span>返回全圖<kbd>Esc</kbd></button></div>
      <div class="p-scroll"></div>
    </aside>
  </div>`;

  const root = host.querySelector('.tm');
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => root.querySelectorAll(s);
  const cls = (c, on) => root.classList.toggle(c, on);
  const has = (c) => root.classList.contains(c);

  /* ---------- 資料索引 ---------- */
  const FAC = Object.fromEntries(DATA.factions.map((f) => [f.id, f]));
  const WARD = Object.fromEntries(DATA.wards.map((w) => [w.code, w]));
  const BY_SLUG = Object.fromEntries(DATA.wards.map((w) => [w.slug, w]));
  const NONE = '#8A929B';
  const facColor = (w) => (FAC[w.faction] || { color: NONE }).color;
  const href = (url) => BASE + url;

  /* ---------- 投影（Mercator → 平面，地圖寬 1000 單位）---------- */
  const D2R = Math.PI / 180;
  const merc = ([lon, lat]) => [lon * D2R, Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2))];
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
  GEO.features.forEach((f) => polysOf(f.geometry).forEach((p) => p[0].forEach((c) => {
    const [x, y] = merc(c); mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y);
  })));
  const SCALE = 1000 / (mxx - mnx), CX = (mnx + mxx) / 2, CY = (mny + mxy) / 2;
  const P = (c) => { const [x, y] = merc(c); return [(x - CX) * SCALE, (y - CY) * SCALE]; };
  const MAP_W = (mxx - mnx) * SCALE, MAP_H = (mxy - mny) * SCALE;

  /* ---------- Three.js ---------- */
  const stage = $('.tm-stage');
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
  catch (e) { host.insertAdjacentHTML('beforeend', '<div class="tm-fail">此瀏覽器無法啟用 WebGL。</div>'); throw e; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);

  /* 線稿樣式：B 深色、C 淺色（跟著網站的深淺色模式） */
  const THEMES = {
    b: { bg: '#1B1C1E', grid: [0x2E3034, 0x27292C], slab: '#D6D7D9', line: '#111214', lineIn: '#74777C', lineSel: '#111214' },
    c: { bg: '#F2F3F5', grid: [0xE1E4E8, 0xE9EBEE], slab: '#FFFFFF', line: '#7C8590', lineIn: '#C4C9D0', lineSel: '#15181C', selLikeA: true },
  };
  const siteTheme = () => (document.body.getAttribute('data-md-color-scheme') === 'slate' ? 'b' : 'c');
  let theme = siteTheme();
  const BG = new THREE.Color(THEMES[theme].bg);
  renderer.setClearColor(BG);

  const labelR = new CSS2DRenderer({ element: $('.tm-labels') });
  const scene = new THREE.Scene();
  const FOV = 30;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);

  let grid = null;
  function makeGrid(t) {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    grid = new THREE.GridHelper(1600, 32, t.grid[0], t.grid[1]);
    grid.position.y = -0.6; scene.add(grid);
  }

  /* 側面斜線貼圖 */
  const hatchSrc = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#000'; g.lineWidth = 5;
    for (let i = -128; i <= 256; i += 16) { g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 128, 0); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  })();
  const HATCH = 19;
  const LINE_MATS = [];
  const LW_OUT = 1.6, LW_IN = 1;

  /* 爭奪中斜紋貼圖 */
  const makeStripe = (col, lw) => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = col; g.lineWidth = lw;
    for (let i = -64; i <= 128; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / 9, 1 / 9); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const stripeLite = makeStripe('#BCC1C8', 4);

  const DEPTH = 6;
  const wards = [];
  const meshes = [];
  const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return a / 2; };
  const ringCentroid = (r) => {
    let a = 0, x = 0, y = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f;
    }
    return [x / (3 * a), y / (3 * a)];
  };

  GEO.features.forEach((f) => {
    const code = f.properties.N03_007, w = WARD[code];
    if (!w) return;
    const shapes = [], outlines = [];
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, big = null, bigA = 0;
    polysOf(f.geometry).forEach((poly, pi) => {
      const rings = poly.map((r) => r.map(P));
      const shape = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)));
      rings.slice(1).forEach((h) => shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y)))));
      shapes.push(shape);
      rings.forEach((r, ri) => outlines.push({ r, ext: (f.properties.ext && f.properties.ext[pi] && f.properties.ext[pi][ri]) || '' }));
      rings[0].forEach(([x, y]) => { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); });
      const a = Math.abs(ringArea(rings[0])); if (a > bigA) { bigA = a; big = rings[0]; }
    });

    const base = new THREE.Color(facColor(w));
    const po = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: true };
    const top = new THREE.MeshBasicMaterial({ color: base.clone(), map: w.contested ? stripeLite : null, ...po });
    const side = new THREE.MeshBasicMaterial({ color: base.clone(), ...po });
    const hatch = hatchSrc.clone(); hatch.repeat.set(1 / HATCH, 1 / HATCH);
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapes, { depth: DEPTH, bevelEnabled: false }), [top, side]);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.code = code;

    /* 上緣、下緣、轉角垂直線；城市外框用粗線，區界用細線 */
    const segOut = [], segIn = [];
    outlines.forEach(({ r, ext }) => {
      const n = r.length - 1;
      for (let i = 0; i < n; i++) {
        const [x0, y0] = r[i], [x1, y1] = r[i + 1];
        const out = ext[i] === '1', prevOut = ext[(i - 1 + n) % n] === '1';
        (out ? segOut : segIn).push(x0, y0, DEPTH + 0.03, x1, y1, DEPTH + 0.03, x0, y0, -0.03, x1, y1, -0.03);
        const [xp, yp] = r[(i - 1 + n) % n];
        const a1 = Math.atan2(y0 - yp, x0 - xp), a2 = Math.atan2(y1 - y0, x1 - x0);
        let d = Math.abs(a2 - a1); if (d > Math.PI) d = 2 * Math.PI - d;
        if (d > 0.62) (out || prevOut ? segOut : segIn).push(x0, y0, -0.03, x0, y0, DEPTH + 0.03);
      }
    });
    const matOut = new LineMaterial({ color: 0x111214, linewidth: LW_OUT, transparent: true });
    const matIn = new LineMaterial({ color: 0x111214, linewidth: LW_IN, transparent: true });
    LINE_MATS.push(matOut, matIn);
    const fat = new THREE.Group();
    [[segOut, matOut], [segIn, matIn]].forEach(([s, m]) => {
      if (!s.length) return;
      const lg = new LineSegmentsGeometry(); lg.setPositions(s);
      fat.add(new LineSegments2(lg, m));
    });
    mesh.add(fat);
    scene.add(mesh); meshes.push(mesh);

    const [lx, ly] = ringCentroid(big);
    const el = document.createElement('div'); el.className = 'wl';
    el.innerHTML = `<span><i class="fd${w.contested ? ' ct' : ''}${w.faction ? '' : ' none'}" style="--c:${facColor(w)}"></i>${esc(w.name)}</span>`;
    const label = new CSS2DObject(el); label.position.set(lx, DEPTH + 2, -ly); scene.add(label);

    wards.push({
      w, code, mesh, top, side, label, el, base, fat, hatch, matOut, matIn, op: 1, tOp: 1, lw: LW_OUT, tLw: LW_OUT,
      tLO: new THREE.Color(), tLI: new THREE.Color(),
      center: [(bx0 + bx1) / 2, -(by0 + by1) / 2], size: [bx1 - bx0, by1 - by0],
      s: 1, ts: 1, tTop: base.clone(), tSide: base.clone(),
    });
  });
  const RW = Object.fromEntries(wards.map((r) => [r.code, r]));

  /* ---------- 地標與事件標記 ---------- */
  const markers = {};
  const addMarker = (item, kind) => {
    if (!RW[item.ward]) return;
    const b = document.createElement('button');
    b.className = `mk ${kind}`; b.type = 'button';
    b.setAttribute('aria-label', `${kind === 'lm' ? '地標' : '事件'}：${item.title || item.name}`);
    b.innerHTML = `<i></i><span>${esc(item.title || item.name)}</span>`;
    b.addEventListener('click', (e) => { e.stopPropagation(); select(item.ward, item.id); });
    b.addEventListener('pointerenter', () => setHL(item.id, true));
    b.addEventListener('pointerleave', () => setHL(item.id, false));
    const o = new CSS2DObject(b);
    const [x, y] = P(item.position);
    o.position.set(x, DEPTH + 1, -y);
    scene.add(o);
    markers[item.id] = { o, el: b, ward: item.ward };
  };
  DATA.landmarks.forEach((l) => addMarker(l, 'lm'));
  DATA.events.forEach((e) => addMarker(e, 'ev'));

  /* ---------- 圖例 ---------- */
  const unset = DATA.wards.filter((w) => !w.faction).length;
  $('.tm-legend').innerHTML = DATA.factions.map((f) => {
    const n = DATA.wards.filter((w) => w.faction === f.id).length;
    return `<li style="--c:${f.color}"><i class="sw"></i>${esc(f.name)}<span class="n">${n} 區</span></li>`;
  }).join('') + (unset ? `<li style="--c:${NONE}"><i class="sw none"></i>未設定<span class="n">${unset} 區</span></li>` : '');

  /* ---------- 狀態 ---------- */
  let selected = null, hovered = null, openId = null;

  function retarget() {
    const T = THEMES[theme];
    const slab = new THREE.Color(T.slab);
    wards.forEach((r) => {
      const isSel = selected === r.code, isHov = hovered === r.code;
      if (!selected) r.ts = 1; else r.ts = isSel ? 6 : 0.55;
      r.tOp = selected && !isSel ? (isHov ? 0.5 : 0.22) : 1;
      r.tLw = isSel ? LW_IN : LW_OUT;
      const sm = isSel ? r.hatch : null;
      if (r.side.map !== sm) { r.side.map = sm; r.side.needsUpdate = true; }
      r.tLO.set(isSel ? T.lineSel : T.line); r.tLI.set(isSel ? T.lineSel : T.lineIn);
      if (isSel && T.selLikeA) { r.tTop.copy(r.base); r.tSide.copy(r.base).multiplyScalar(0.72); }
      else if (isSel) { r.tTop.copy(r.base).lerp(slab, 0.12); r.tSide.copy(r.base).lerp(slab, 0.7); }
      else { r.tTop.copy(slab).lerp(r.base, isHov ? 0.3 : 0); r.tSide.copy(slab).multiplyScalar(0.96); }
      r.el.classList.toggle('hover', isHov);
      r.el.classList.toggle('sel', isSel);
    });
    Object.values(markers).forEach((m) => m.el.classList.toggle('in', m.ward === selected));
  }

  /* ---------- 相機 ---------- */
  const cam = { tx: 0, ty: 0, tz: 0, dist: 1000, pitch: 0, bearing: 0, sx: 0, sy: 0 };
  let tween = null;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const vw = () => root.clientWidth || 1, vh = () => root.clientHeight || 1;
  const isNarrow = () => vw() <= 760;
  const panelBox = () => (isNarrow() ? { w: 0, h: vh() * 0.56 } : { w: Math.min(380, vw()), h: 0 });
  const tlW = () => (has('tl') && !isNarrow() ? 320 : 0);
  function overviewState() {
    const aw = vw() - tlW();
    const need = Math.max(MAP_H * 1.16, MAP_W * 1.16 * vh() / aw);
    return { tx: 0, ty: 0, tz: 0, dist: need / (2 * Math.tan(FOV * D2R / 2)), pitch: 0, bearing: 0, sx: -tlW() / 2, sy: 0 };
  }
  function wardState(r) {
    const pb = panelBox();
    const aw = vw() - pb.w, ah = vh() - pb.h;
    const k = 2.1;
    const hFit = Math.max(r.size[1] * k * vh() / ah, r.size[0] * k * vh() / aw, 150);
    return {
      tx: r.center[0], ty: 16, tz: r.center[1], dist: hFit / (2 * Math.tan(FOV * D2R / 2)),
      pitch: 52 * D2R, bearing: -14 * D2R, sx: (pb.w - tlW()) / 2, sy: pb.h / 2,
    };
  }
  function fly(to, dur = 1500) {
    if (reduce) { Object.assign(cam, to); tween = null; return; }
    const from = { ...cam };
    const arc = Math.max(from.dist, to.dist) * (selected && from.pitch > 0 ? 0.08 : 0);
    tween = { from, to, t0: performance.now(), dur, arc };
  }
  const _t = new THREE.Vector3();
  function applyCam() {
    const { tx, ty, tz, dist, pitch, bearing, sx, sy } = cam;
    const sp = Math.sin(pitch);
    camera.position.set(tx + dist * sp * Math.sin(bearing), ty + dist * Math.cos(pitch), tz + dist * sp * Math.cos(bearing));
    camera.up.set(-Math.sin(bearing), 0, -Math.cos(bearing));
    camera.lookAt(_t.set(tx, ty, tz));
    if (sx || sy) camera.setViewOffset(vw(), vh(), sx, sy, vw(), vh()); else camera.clearViewOffset();
  }

  /* ---------- 側欄 ---------- */
  const facChip = (id) => {
    const f = FAC[id];
    if (!f) return '';
    return f.url
      ? `<a class="chip" style="--c:${f.color}" href="${esc(href(f.url))}">${esc(f.name)}</a>`
      : `<span class="chip" style="--c:${f.color}">${esc(f.name)}</span>`;
  };
  const peopleList = (ps) => (ps && ps.length
    ? `<p class="people">${ps.map((p) => `<a href="${esc(href(p.url))}">${esc(p.emoji)} ${esc(p.name)}</a>`).join('')}</p>` : '');
  const pageLink = (p) => (p ? `<p class="go"><a href="${esc(href(p.url))}">前往「${esc(p.name)}」頁面 →</a></p>` : '');
  const mockTag = (e) => (e.mock ? '<span class="mock">模擬</span>' : '');

  function renderPanel(w) {
    const f = FAC[w.faction];
    const lms = DATA.landmarks.filter((l) => l.ward === w.code);
    const evs = DATA.events.filter((e) => e.ward === w.code).sort((a, b) => a.session - b.session);
    const lmItem = (l) => `
      <li class="item" data-id="${esc(l.id)}">
        <button type="button" class="row" aria-expanded="false"><i class="ic-lm"></i><span class="t">${esc(l.name)}</span><span class="m">LANDMARK</span><i class="cv"></i></button>
        <div class="body"><div><div class="inner"><p>${esc(l.summary)}</p>${l.detail ? `<p>${esc(l.detail)}</p>` : ''}${peopleList(l.people)}${pageLink(l.page)}</div></div></div>
      </li>`;
    const evItem = (e) => `
      <li class="item" data-id="${esc(e.id)}">
        <button type="button" class="row" aria-expanded="false"><i class="ic-ev"></i><span class="t">${esc(e.title)}${mockTag(e)}</span><span class="m">第 ${e.session} 團</span><i class="cv"></i></button>
        <div class="body"><div><div class="inner">
          <p>${esc(e.summary)}</p>
          ${e.excerpt ? `<blockquote>${esc(e.excerpt)}<cite>— 團錄節錄 · SESSION ${String(e.session).padStart(2, '0')}${e.mock ? ' · 模擬資料' : ''}</cite></blockquote>` : ''}
          <div class="chips">${e.factions.map(facChip).join('')}</div>
          ${peopleList(e.people)}${pageLink(e.page)}
        </div></div></div>
      </li>`;
    const pb = $('.p-scroll');
    pb.innerHTML = `
      <p class="p-code">${esc(w.slug.toUpperCase())} · ${esc(w.code)}</p>
      <h3 class="p-name" tabindex="-1">${esc(w.name)}</h3>
      <div class="chips">${w.faction ? facChip(w.faction) : '<span class="chip none">未設定</span>'}${w.contested ? '<span class="chip ct">爭奪中</span>' : ''}</div>
      <p class="p-sum">${esc(w.summary)}</p>
      ${f ? `<p class="p-fac" style="--c:${f.color}">${esc(f.name)}：${esc(f.summary)}</p>` : ''}
      <section class="sec"><h4>地標 <span>${lms.length}</span></h4>
        ${lms.length ? `<ul class="list">${lms.map(lmItem).join('')}</ul>` : '<p class="empty">此區尚無紀錄的地標。</p>'}</section>
      <section class="sec"><h4>事件 <span>${evs.length}</span></h4>
        ${evs.length ? `<ul class="list">${evs.map(evItem).join('')}</ul>` : '<p class="empty">此區尚無團錄事件。</p>'}</section>`;
    pb.scrollTop = 0;
    pb.querySelectorAll('.item').forEach((li) => {
      const id = li.dataset.id;
      li.querySelector('.row').addEventListener('click', () => toggleItem(id));
      li.addEventListener('pointerenter', () => setHL(id, true));
      li.addEventListener('pointerleave', () => setHL(id, false));
    });
  }
  function toggleItem(id, force) {
    const next = force !== undefined ? (force ? id : null) : (openId === id ? null : id);
    openId = next;
    $$('.p-scroll .item').forEach((li) => {
      const on = li.dataset.id === openId;
      li.classList.toggle('open', on);
      li.querySelector('.row').setAttribute('aria-expanded', on);
    });
    Object.entries(markers).forEach(([k, m]) => m.el.classList.toggle('on', k === openId));
    if (openId) {
      const li = [...$$('.p-scroll .item')].find((x) => x.dataset.id === openId);
      if (li) setTimeout(() => li.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }), 120);
    }
    syncTimeline();
  }
  function setHL(id, on) { const m = markers[id]; if (m) m.el.classList.toggle('hl', on); }

  /* ---------- 事件時間軸 ---------- */
  const EVENTS = [...DATA.events].sort((a, b) => a.session - b.session || a.id.localeCompare(b.id));
  const EV_BY_ID = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
  (function buildTimeline() {
    const sessions = [...new Set(EVENTS.map((e) => e.session))];
    const anyMock = EVENTS.some((e) => e.mock);
    $('.tl-meta').textContent = EVENTS.length
      ? `${EVENTS.length} 則事件 · 第 ${sessions[0]}${sessions.length > 1 ? '–' + sessions[sessions.length - 1] : ''} 團${anyMock ? ' · 含模擬資料' : ''}`
      : '還沒有事件';
    $('.tl-legend').innerHTML = DATA.factions.map((f) => `<li style="--c:${f.color}"><i></i>${esc(f.name)}</li>`).join('');
    let html = '', last = null;
    EVENTS.forEach((e) => {
      if (e.session !== last) { html += `<li class="tl-sess">SESSION ${String(e.session).padStart(2, '0')}</li>`; last = e.session; }
      const w = WARD[e.ward];
      html += `<li class="tl-ev" data-id="${esc(e.id)}"><i class="node"></i><button type="button">
        <span class="t">${esc(e.title)}${mockTag(e)}</span>
        <span class="w"><b>${esc(w ? w.name : '')}</b>${e.factions.map((id) => (FAC[id] ? `<i style="--c:${FAC[id].color}" title="${esc(FAC[id].name)}"></i>` : '')).join('')}</span>
      </button></li>`;
    });
    $('.tl-list').innerHTML = html;
    $$('.tl-list .tl-ev').forEach((li) => {
      const id = li.dataset.id;
      li.querySelector('button').addEventListener('click', () => openEvent(id));
      li.addEventListener('pointerenter', () => setHL(id, true));
      li.addEventListener('pointerleave', () => setHL(id, false));
    });
  })();
  function openEvent(id) { const e = EV_BY_ID[id]; if (e) select(e.ward, id); }
  function stepEvent(d) {
    if (!EVENTS.length) return;
    const i = EVENTS.findIndex((e) => e.id === openId);
    const n = i < 0 ? (d > 0 ? 0 : EVENTS.length - 1) : Math.max(0, Math.min(EVENTS.length - 1, i + d));
    openEvent(EVENTS[n].id);
    [...$$('.tl-list .tl-ev')].find((x) => x.dataset.id === EVENTS[n].id)?.querySelector('button').focus({ preventScroll: true });
  }
  function syncTimeline() {
    const i = EVENTS.findIndex((e) => e.id === openId);
    $$('.tl-list .tl-ev').forEach((li) => li.classList.toggle('on', li.dataset.id === openId));
    $('.tl-pos').textContent = i < 0 ? `— / ${EVENTS.length}` : `${i + 1} / ${EVENTS.length}`;
    $('.tl-prev').disabled = i <= 0; $('.tl-next').disabled = i === EVENTS.length - 1 || !EVENTS.length;
    if (i >= 0 && has('tl')) {
      const li = [...$$('.tl-list .tl-ev')].find((x) => x.dataset.id === openId);
      li && li.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
  }
  let tlScrollT = 0;
  function updThumb() {
    const l = $('.tl-list'), th = $('.tl-thumb');
    const ch = l.clientHeight, sh = l.scrollHeight;
    if (sh <= ch + 1) { th.style.height = '0'; return; }
    const track = ch - 24, h = Math.max(28, track * ch / sh);
    th.style.height = h + 'px';
    th.style.transform = `translateY(${(track - h) * l.scrollTop / (sh - ch)}px)`;
  }
  $('.tl-list').addEventListener('scroll', () => {
    updThumb();
    const c = $('.tl-card'); c.classList.add('scrolling');
    clearTimeout(tlScrollT); tlScrollT = setTimeout(() => c.classList.remove('scrolling'), 900);
  }, { passive: true });
  $('.tl-prev').addEventListener('click', () => stepEvent(-1));
  $('.tl-next').addEventListener('click', () => stepEvent(1));

  let mode = 'map';
  function setMode(m, instant) {
    mode = m;
    try { localStorage.setItem('tokyo2077-wiki-map-mode', m); } catch (e) { /* 無痕視窗等情況 */ }
    cls('tl', m === 'tl');
    $('.tm-timeline').setAttribute('aria-hidden', m !== 'tl');
    $$('.tm-switch button').forEach((b) => b.setAttribute('aria-checked', b.dataset.m === m));
    const to = selected ? wardState(RW[selected]) : overviewState();
    if (instant) Object.assign(cam, to); else fly(to, 900);
    syncTimeline();
    updThumb();
  }
  $$('.tm-switch button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));

  /* ---------- 選取 / 返回 ---------- */
  function select(code, itemId = null) {
    const r = RW[code]; if (!r) return;
    const changed = selected !== code;
    selected = code;
    cls('zoom', true);
    $('.tm-panel').setAttribute('aria-hidden', 'false');
    if (changed) { renderPanel(r.w); openId = null; fly(wardState(r)); }
    toggleItem(itemId, !!itemId);
    if (!itemId) toggleItem(null, false);
    retarget();
    const h = itemId && EV_BY_ID[itemId] && mode === 'tl' ? itemId : r.w.slug;
    if (location.hash.slice(1) !== h) history.replaceState(null, '', '#' + h);
    if (changed && mode !== 'tl') setTimeout(() => $('.p-name')?.focus({ preventScroll: true }), reduce ? 0 : 700);
  }
  function overview() {
    if (!selected) return;
    selected = null; openId = null;
    Object.values(markers).forEach((m) => m.el.classList.remove('on'));
    cls('zoom', false);
    $('.tm-panel').setAttribute('aria-hidden', 'true');
    retarget();
    fly(overviewState(), 1300);
    history.replaceState(null, '', location.pathname + location.search);
  }
  $('.back').addEventListener('click', overview);

  /* 鍵盤：只在滑鼠停在地圖上、焦點在地圖裡，或全螢幕時才接手 */
  const active = () => has('full') || root.matches(':hover') || root.contains(document.activeElement);
  addEventListener('keydown', (e) => {
    if (!active()) return;
    if (mode === 'tl' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); stepEvent(e.key === 'ArrowDown' ? 1 : -1); return; }
    if (e.key === 'Escape') {
      if (selected) overview();
      else if (has('full')) setFull(false);
      else fly(overviewState(), 900);
    }
  });
  addEventListener('hashchange', () => {
    const h = location.hash.slice(1), w = BY_SLUG[h];
    if (EV_BY_ID[h]) { if (mode !== 'tl') setMode('tl'); openEvent(h); } else if (w) select(w.code); else overview();
  });

  /* ---------- 全螢幕 ---------- */
  function setFull(on) {
    cls('full', on);
    document.documentElement.classList.toggle('tm-noscroll', on);
    $('.tm-full').textContent = on ? '離開全螢幕' : '全螢幕';
  }
  $('.tm-full').addEventListener('click', () => setFull(!has('full')));
  // 頁面上的「全螢幕開啟」按鈕（data-open-full="tokyo-map"）
  document.querySelectorAll('[data-open-full="tokyo-map"]').forEach((b) => b.addEventListener('click', () => setFull(true)));

  /* ---------- 樣式（跟著網站深淺色）---------- */
  function applyTheme(id, instant) {
    theme = id; const T = THEMES[id];
    root.dataset.theme = id;
    BG.set(T.bg); renderer.setClearColor(BG); makeGrid(T);
    retarget();
    wards.forEach((r) => { r.matOut.color.copy(r.tLO); r.matIn.color.copy(r.tLI); });
    if (instant) wards.forEach((r) => { r.top.color.copy(r.tTop); r.side.color.copy(r.tSide); });
  }
  new MutationObserver(() => { const t = siteTheme(); if (t !== theme) applyTheme(t); })
    .observe(document.body, { attributes: true, attributeFilter: ['data-md-color-scheme'] });

  /* ---------- 指標互動 ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const canvas = renderer.domElement;
  const local = (ev) => { const b = canvas.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
  function pick(ev) {
    const [x, y] = local(ev);
    ndc.set(x / vw() * 2 - 1, -(y / vh()) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.code : null;
  }
  const D = { pitchMin: 18 * D2R, pitchMax: 80 * D2R };
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundAt(x, y) {
    ndc.set(x / vw() * 2 - 1, -(y / vh()) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(ground, new THREE.Vector3());
  }
  function distLimits() {
    if (!selected) { const d = overviewState().dist; return [d * 0.16, d * 1.5]; }
    const d = wardState(RW[selected]).dist; return [d * 0.45, d * 2.2];
  }
  function clampPan() {
    if (selected) return;
    cam.tx = Math.max(-MAP_W * 0.6, Math.min(MAP_W * 0.6, cam.tx));
    cam.tz = Math.max(-MAP_H * 0.6, Math.min(MAP_H * 0.6, cam.tz));
  }
  function zoomBy(f, x, y) {
    tween = null;
    const [lo, hi] = distLimits();
    const nd = Math.max(lo, Math.min(hi, cam.dist * f));
    if (!selected && x !== undefined) {
      const p = groundAt(x, y);
      if (p) { const s = nd / cam.dist; cam.tx = p.x + (cam.tx - p.x) * s; cam.tz = p.z + (cam.tz - p.z) * s; }
    }
    cam.dist = nd; clampPan();
  }

  const ptrs = new Map();
  let down = null, dragging = false, pinch0 = 0, dist0 = 0;
  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (ptrs.size === 1) { down = [ev.clientX, ev.clientY]; dragging = false; }
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); dist0 = cam.dist; dragging = true;
    }
  });
  canvas.addEventListener('pointermove', (ev) => {
    const prev = ptrs.get(ev.pointerId);
    if (!prev) {
      const c = pick(ev);
      if (c !== hovered) { hovered = c; retarget(); }
      canvas.style.cursor = c && c !== selected ? 'pointer' : 'grab';
      return;
    }
    ptrs.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch0 > 0) { const [lo, hi] = distLimits(); cam.dist = Math.max(lo, Math.min(hi, dist0 * pinch0 / d)); tween = null; }
      return;
    }
    if (!dragging && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5) {
      dragging = true; tween = null; canvas.style.cursor = 'grabbing';
      if (hovered) { hovered = null; retarget(); }
    }
    if (!dragging) return;
    const dx = ev.clientX - prev[0], dy = ev.clientY - prev[1];
    if (!selected) {
      const wpp = 2 * cam.dist * Math.tan(FOV * D2R / 2) / vh();
      const cb = Math.cos(cam.bearing), sb = Math.sin(cam.bearing);
      cam.tx -= (dx * cb + dy * sb) * wpp;
      cam.tz -= (-dx * sb + dy * cb) * wpp;
      clampPan();
    } else {
      cam.bearing -= dx * 0.006;
      cam.pitch = Math.max(D.pitchMin, Math.min(D.pitchMax, cam.pitch - dy * 0.005));
    }
  });
  function endPtr(ev) {
    const wasDrag = dragging;
    ptrs.delete(ev.pointerId);
    if (ptrs.size === 0) {
      canvas.style.cursor = 'grab';
      if (!wasDrag && down && ev.type === 'pointerup') {
        const c = pick(ev);
        if (c) { if (c !== selected) select(c); } else overview();
      }
      down = null; dragging = false; pinch0 = 0;
    }
  }
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('pointerleave', () => { if (!ptrs.size && hovered) { hovered = null; retarget(); } });
  root.addEventListener('wheel', (ev) => {
    if (ev.target.closest && ev.target.closest('.tm-panel, .tm-timeline, .tm-toolbar')) return;
    ev.preventDefault();
    const [x, y] = local(ev);
    zoomBy(Math.exp(ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015)), x, y);
  }, { passive: false });

  /* ---------- 尺寸 ---------- */
  function resize() {
    renderer.setSize(vw(), vh());
    labelR.setSize(vw(), vh());
    camera.aspect = vw() / vh();
    camera.updateProjectionMatrix();
    LINE_MATS.forEach((m) => m.resolution.set(vw(), vh()));
    tween = null;
    Object.assign(cam, selected ? wardState(RW[selected]) : overviewState());
    updThumb();
  }
  new ResizeObserver(resize).observe(root);

  /* ---------- 主迴圈 ---------- */
  function frame(now) {
    if (tween) {
      const { from, to, t0, dur, arc } = tween;
      const t = Math.min(1, (now - t0) / dur), e = ease(t);
      for (const k in to) cam[k] = from[k] + (to[k] - from[k]) * e;
      cam.dist += Math.sin(Math.PI * t) * arc;
      if (t >= 1) tween = null;
    }
    applyCam();
    const near = !selected && overviewState().dist / cam.dist >= 4;
    if (near !== has('near')) cls('near', near);
    const k = reduce ? 1 : 0.09;
    wards.forEach((r) => {
      r.s += (r.ts - r.s) * k; if (Math.abs(r.ts - r.s) < 0.004) r.s = r.ts;
      r.mesh.scale.z = r.s;
      r.hatch.repeat.y = r.s / HATCH;
      r.op += (r.tOp - r.op) * k; if (Math.abs(r.tOp - r.op) < 0.003) r.op = r.tOp;
      r.lw += (r.tLw - r.lw) * k; if (Math.abs(r.tLw - r.lw) < 0.01) r.lw = r.tLw; r.matOut.linewidth = r.lw;
      r.matOut.color.lerp(r.tLO, k); r.matIn.color.lerp(r.tLI, k);
      r.top.opacity = r.side.opacity = r.matOut.opacity = r.matIn.opacity = r.op;
      r.mesh.renderOrder = r.op > 0.99 ? 0 : 1;
      r.top.color.lerp(r.tTop, k);
      r.side.color.lerp(r.tSide, k);
      r.label.position.y = DEPTH * r.s + 2;
    });
    Object.values(markers).forEach((m) => { m.o.position.y = DEPTH * RW[m.ward].s + 1.2; });
    renderer.render(scene, camera);
    labelR.render(scene, camera);
    requestAnimationFrame(frame);
  }

  resize();
  applyTheme(theme, true);
  try { const m = localStorage.getItem('tokyo2077-wiki-map-mode'); if (m === 'tl' || m === 'map') mode = m; } catch (e) { /* 略過 */ }
  const h0 = location.hash.slice(1);
  if (EV_BY_ID[h0]) mode = 'tl';
  setMode(mode, true);
  if (EV_BY_ID[h0]) openEvent(h0);
  else if (BY_SLUG[h0]) select(BY_SLUG[h0].code);
  requestAnimationFrame(frame);
}
