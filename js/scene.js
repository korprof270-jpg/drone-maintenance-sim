// 드론 정비 시뮬레이터 — 3D 작업대: 부품 끌어다 붙이기, 선 끝을 눌러 연결하기, 카메라
(function () {
  const SIM = window.SIM, T = THREE;
  const sc = (SIM.scene = { xray: false, env: "bench", showExpect: false, dragDrone: false, poseName: "level", lift: 0, tumble: 0, pick: null, drag: null });
  const objs = (sc.objs = {});
  const K = (sc.K = 3.6); // 20L급 농업용 4축(축간 약 1.6m) 크기
  const KS = K / 2.2; // 작업대·시점 배율
  const ARM_R = 0.225, S2 = Math.SQRT1_2, LEG = 0.128, REST_Y = LEG * K;
  // 작업대 위 기체 높이: 스키드가 있으면 스키드로 서고, 없으면 하판(또는 아래 배터리)이 작업대에 닿는다
  const restY = () => (SIM.has("skid") ? REST_Y : SIM.has("under") ? 0.05 * K : 0.018 * K);
  // 부품별 모형 배율 (프레임 대비 잘 보이도록 키움)
  const PS = { bottom: 1, top: 1, arm: 1, skid: 1, motor: 2.0, prop: 1.2, esc: 1.55, fc: 1.75, pm: 1.7, battery: 1.3, gps: 1.6, rx: 1.95, telem: 1.85, buzzer: 2.4, switch: 2.4 };
  let composer, gtao, bloom, hemi, hdri = {}, livePlug = null;
  let renderer, scene, camera, drone, benchGroup, fieldGroup, partsRoot, wires, expectGroup, selBox, sun, snapRing, liveWire, stageEl;
  const air = {}, targets = [];
  const orbit = (sc.orbit = { theta: 0.3, phi: 0.86, dist: 2.75 * KS, target: new T.Vector3(0, 0.2 * KS, 0.16 * KS) });
  const poseQ = new T.Quaternion();
  sc.poseQ = poseQ;

  const mat = (color, o) => new T.MeshStandardMaterial(Object.assign({ color: new T.Color(color), roughness: 0.6, metalness: 0.1 }, o || {}));
  const M = {
    carbon: mat(0x22262a, { roughness: 0.45 }), red: mat(0xc8382e), white: mat(0xe9ecec), steel: mat(0xb9c0c4, { metalness: 0.8, roughness: 0.3 }),
    dark: mat(0x16181a), blue: mat(0x2b62c4), yellow: mat(0xe2b322), copper: mat(0xb86b2c, { metalness: 0.6, roughness: 0.4 }),
    prop: mat(0x2c2f33, { roughness: 0.35 }), green: mat(0x2f8a54), plug: mat(0xece6d2, { roughness: 0.7 }),
  };
  const HIT = new T.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, visible: false }); // 클릭 영역: 그리지 않고 클릭 판정에만 쓴다
  // 카본 직조 무늬 (트윌) + 클리어코트
  const carbonTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const k = (x + y) % 4 < 2; const gr = g.createLinearGradient(x * 8, y * 8, x * 8 + 8, y * 8 + 8); gr.addColorStop(0, k ? "#2c3034" : "#17191c"); gr.addColorStop(1, k ? "#1b1e21" : "#24272b"); g.fillStyle = gr; g.fillRect(x * 8, y * 8, 8, 8); } const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(6, 6); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8; return t; })();
  // 높이(밝기) 그림 → 노멀맵: 카본 직조·나뭇결·금속 결이 빛을 받아 입체적으로 보이게 한다
  function normalFrom(src, strength, repeat) {
    const w = src.width, h = src.height, d = src.getContext("2d").getImageData(0, 0, w, h).data, c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"), out = g.createImageData(w, h), L = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (L(x + 1, y) - L(x - 1, y)) * strength, dy = (L(x, y + 1) - L(x, y - 1)) * strength, n = 1 / Math.hypot(dx, dy, 1), i = (y * w + x) * 4; out.data[i] = (-dx * n * 0.5 + 0.5) * 255; out.data[i + 1] = (dy * n * 0.5 + 0.5) * 255; out.data[i + 2] = n * 255; out.data[i + 3] = 255; }
    g.putImageData(out, 0, 0); const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; if (repeat) t.repeat.copy(repeat); t.anisotropy = 8; return t;
  }
  const weaveH = (() => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"); for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const k = (x + y) % 4 < 2, gr = k ? g.createLinearGradient(x * 8, 0, x * 8 + 8, 0) : g.createLinearGradient(0, y * 8, 0, y * 8 + 8); gr.addColorStop(0, "#202020"); gr.addColorStop(0.5, "#ffffff"); gr.addColorStop(1, "#202020"); g.fillStyle = gr; g.fillRect(x * 8, y * 8, 8, 8); } return c; })();
  M.carbon = new T.MeshPhysicalMaterial({ color: 0xffffff, map: carbonTex, normalMap: normalFrom(weaveH, 2.2, carbonTex.repeat), normalScale: new T.Vector2(0.35, 0.35), roughness: 0.38, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12 });
  const brushed = (() => { const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g = c.getContext("2d"); g.fillStyle = "#808080"; g.fillRect(0, 0, 256, 64); for (let i = 0; i < 900; i++) { const v = 112 + Math.random() * 40 | 0; g.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; g.fillRect(Math.random() * 256, Math.random() * 64, 20 + Math.random() * 120, 1); } const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(2, 2); return t; })();
  M.steel = new T.MeshPhysicalMaterial({ color: new T.Color(0xc4cace), metalness: 1, roughness: 0.32, roughnessMap: brushed });
  M.dark.roughness = 0.5; M.dark.clearcoat = 0;
  M.plastic = new T.MeshPhysicalMaterial({ color: new T.Color(0x16181a), roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  // 모서리가 둥근 상자 (전자부품 외형)
  function roundBox(w, h, d, m, x, y, z, r) {
    r = Math.min(r || 0.003, w / 2.2, d / 2.2); const b = Math.min(r * 0.6, h * 0.3);
    const sh = new T.Shape(), W = w / 2 - b, D = d / 2 - b, R = Math.max(0.0001, r - b);
    sh.moveTo(-W + R, -D); sh.lineTo(W - R, -D); sh.quadraticCurveTo(W, -D, W, -D + R); sh.lineTo(W, D - R); sh.quadraticCurveTo(W, D, W - R, D); sh.lineTo(-W + R, D); sh.quadraticCurveTo(-W, D, -W, D - R); sh.lineTo(-W, -D + R); sh.quadraticCurveTo(-W, -D, -W + R, -D);
    const geo = new T.ExtrudeGeometry(sh, { depth: Math.max(0.0002, h - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments: 6 });
    geo.rotateX(-Math.PI / 2); geo.computeBoundingBox(); const bb = geo.boundingBox; geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
    return mesh(geo, m, x, y, z);
  }
  function mesh(geo, m, x, y, z) {
    const o = new T.Mesh(geo, m);
    o.position.set(x || 0, y || 0, z || 0);
    o.castShadow = true; o.receiveShadow = true;
    return o;
  }
  const box = (w, h, d, m, x, y, z) => mesh(new T.BoxGeometry(w, h, d), m, x, y, z);
  const cyl = (r, h, m, x, y, z, seg) => mesh(new T.CylinderGeometry(r, r, h, Math.max(seg || 32, 12)), m, x, y, z);

  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new T.CanvasTexture(c);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }
  // 윗면 화살표 데칼 (캔버스 위쪽 = 기체 앞쪽)
  function arrowDecal(w, d, label, bg) {
    const tex = canvasTex(128, 192, (g, W, H) => {
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      g.fillStyle = "#fff";
      g.beginPath(); g.moveTo(W / 2, 14); g.lineTo(W - 26, 84); g.lineTo(W / 2 + 14, 84); g.lineTo(W / 2 + 14, 130); g.lineTo(W / 2 - 14, 130); g.lineTo(W / 2 - 14, 84); g.lineTo(26, 84); g.closePath(); g.fill();
      g.font = "bold 26px sans-serif"; g.textAlign = "center"; g.fillText(label, W / 2, 172);
    });
    const p = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    p.rotation.x = -Math.PI / 2;
    return p;
  }
  const texCache = {};
  function textSprite(lines, color) {
    const key = lines.join("|") + color;
    if (!texCache[key]) texCache[key] = canvasTex(256, 128, (g, W, H) => {
      g.fillStyle = "rgba(14,22,20,0.86)";
      const r = 22; g.beginPath(); g.moveTo(r, 4); g.arcTo(W - 4, 4, W - 4, H - 4, r); g.arcTo(W - 4, H - 4, 4, H - 4, r); g.arcTo(4, H - 4, 4, 4, r); g.arcTo(4, 4, W - 4, 4, r); g.fill();
      g.fillStyle = color || "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
      g.font = "bold " + (lines.length > 1 ? 40 : 52) + "px sans-serif";
      lines.forEach((l, i) => g.fillText(l, W / 2, (H * (i + 0.5)) / lines.length + (lines.length > 1 ? (i ? -4 : 4) : 0)));
    });
    const s = new T.Sprite(new T.SpriteMaterial({ map: texCache[key], depthTest: false, transparent: true }));
    s.scale.set(0.11, 0.055, 1); s.renderOrder = 10;
    return s;
  }

  // ---------- 선 끝(납땜 팁·커넥터)과 연결 대상 ----------
  const LEAD = { y: mat(0xe0c020), b: mat(0x2c6fd0), g: mat(0x2f9a4a), r: mat(0xc8281e), k: mat(0x161616), w: mat(0xf2f2f2), o: mat(0xe88a20), v: mat(0x8a5ad0), l: mat(0x3a78d8) };
  // 부품 모형에 선을 붙이고, 끝을 누를 수 있게 등록한다
  function lead(o, key, from, to, m, r, plug) {
    const g = o.group, rr = r || 0.0011;
    const curve = new T.CatmullRomCurve3([new T.Vector3(...from), new T.Vector3((from[0] + to[0]) / 2, Math.max(from[1], to[1]) + 0.002, (from[2] + to[2]) / 2), new T.Vector3(...to)]);
    const t = new T.Mesh(new T.TubeGeometry(curve, 8, rr, 5), m); t.castShadow = true; g.add(t);
    g.add(plug ? box(rr * 4.5, rr * 2.6, rr * 3.5, M.plug, to[0], to[1], to[2]) : cyl(rr * 1.35, 0.003, M.steel, to[0], to[1], to[2], 6));
    const h = new T.Mesh(new T.SphereGeometry(0.009, 8, 6), HIT); h.position.set(...to); h.userData.tip = { part: o.id, key }; g.add(h);
    o.tips[key] = new T.Vector3(...to);
  }
  function target(parent, mesh, info) { mesh.userData.target = info; targets.push(mesh); parent.add(mesh); return mesh; }
  // 위에서 본 회전 방향 화살표 (모터 벨 윗면 인쇄)
  function spinArrow(dir) {
    const tex = canvasTex(128, 128, (g, W) => {
      g.clearRect(0, 0, W, W); g.strokeStyle = "#f4f4f4"; g.fillStyle = "#f4f4f4"; g.lineWidth = 9;
      const c = W / 2, r = 42, ccw = dir === "ccw", a0 = ccw ? 0.35 : Math.PI - 0.35, a1 = ccw ? Math.PI * 1.55 : -Math.PI * 0.55;
      g.beginPath(); g.arc(c, c, r, a0, a1, ccw); g.stroke();
      const ex = c + r * Math.cos(a1), ey = c + r * Math.sin(a1), tg = ccw ? a1 - Math.PI / 2 : a1 + Math.PI / 2;
      g.beginPath(); g.moveTo(ex + 18 * Math.cos(tg), ey + 18 * Math.sin(tg)); g.lineTo(ex + 14 * Math.cos(tg + 2.3), ey + 14 * Math.sin(tg + 2.3)); g.lineTo(ex + 14 * Math.cos(tg - 2.3), ey + 14 * Math.sin(tg - 2.3)); g.closePath(); g.fill();
    });
    const p = new T.Mesh(new T.PlaneGeometry(0.026, 0.026), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    p.rotation.x = -Math.PI / 2; return p;
  }

  // FC 윗면 포트 위치 (FC 모형 좌표, 앞쪽 = -z)
  // 부품 윗면에 인쇄하는 이름표 (평면)
  function nameplate(text, w, h, bg, fg) {
    const W = 256, H = Math.max(32, Math.round((256 * h) / w));
    const tex = canvasTex(W, H, (g) => {
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); } else g.clearRect(0, 0, W, H);
      g.fillStyle = fg || "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
      let fs = Math.round(H * 0.62); g.font = "bold " + fs + "px sans-serif";
      while (g.measureText(text).width > W * 0.9 && fs > 8) { fs -= 2; g.font = "bold " + fs + "px sans-serif"; }
      g.fillText(text, W / 2, H / 2 + 2);
    });
    const p = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: !bg, depthWrite: !!bg }));
    p.rotation.x = -Math.PI / 2; return p;
  }
  // 매끄러운 곡선 프로펠러 날개: 평면형(뿌리 좁고 가운데 넓고 끝이 둥근) + 비틀림
  const BLADE_R = 0.115;
  // 프로펠러 날개: 실제 날개 단면(캠버 있는 에어포일)을 반지름 방향으로 이어 붙인 로프트 + 비틀림 + 둥근 끝
  const bladeTwist = (s, r) => s * (0.5 - 0.32 * Math.min(1, Math.max(0, r / BLADE_R)));
  function bladeGeo(s) {
    const R0 = 0.011, NR = 44, NA = 36, pos = [], uv = [], idx = [];
    const chordAt = (r) => { const t = (r - R0) / (BLADE_R - R0); let c = 0.011 + 0.016 * Math.sin(Math.min(1, t / 0.35) * Math.PI / 2) - 0.006 * Math.max(0, (t - 0.35) / 0.65); if (t > 0.86) c *= Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.86) / 0.14, 2))); return Math.max(c, 0.0004); };
    const thickAt = (r) => { const t = (r - R0) / (BLADE_R - R0); return 0.2 - 0.12 * t; }; // 뿌리 20% → 끝 8%
    for (let i = 0; i <= NR; i++) {
      const r = R0 + (BLADE_R - R0) * (1 - Math.pow(1 - i / NR, 1.4)), c = chordAt(r), tk = thickAt(r), th = bladeTwist(s, r), sweep = 0.004 * Math.pow(r / BLADE_R, 2);
      for (let j = 0; j <= NA; j++) {
        const a = (j / NA) * Math.PI * 2, u = 0.5 + 0.5 * Math.cos(a), up = j <= NA / 2; // 앞전(u=0)→뒷전(u=1) 위·아래 한 바퀴
        const yt = 5 * tk * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u * u * u - 0.1036 * u * u * u * u);
        const m = 0.04, pp = 0.4, yc = u < pp ? (m / (pp * pp)) * (2 * pp * u - u * u) : (m / ((1 - pp) * (1 - pp))) * (1 - 2 * pp + 2 * pp * u - u * u);
        const y = (yc + (up ? yt : -yt)) * c, zc = (u - 0.38) * c * -s + sweep * -s; // 회전 방향 쪽이 앞전
        const ry = y * Math.cos(th) - zc * Math.sin(th), rz = y * Math.sin(th) + zc * Math.cos(th);
        pos.push(r, ry + 0.004, rz); uv.push(u * 0.6, r * 12);
      }
    }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; if (s > 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1); }
    const geo = new T.BufferGeometry(); geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  // 회전체(선반 가공) 모양: [반지름, 높이] 점들
  const lathe = (pts, m, seg) => { const g2 = new T.LatheGeometry(pts.map(([r, y]) => new T.Vector2(r, y)), seg || 48); const o2 = new T.Mesh(g2, m); o2.castShadow = o2.receiveShadow = true; return o2; };
  // 아노다이징 알루미늄·에나멜 구리선·프롭 카본
  M.alu = new T.MeshPhysicalMaterial({ color: new T.Color(0x3a3f45), metalness: 1, roughness: 0.34, roughnessMap: brushed, side: T.DoubleSide });
  M.aluLight = new T.MeshPhysicalMaterial({ color: new T.Color(0xb8bec4), metalness: 1, roughness: 0.28, roughnessMap: brushed });
  M.accent = new T.MeshPhysicalMaterial({ color: new T.Color(0xc0392b), metalness: 0.9, roughness: 0.3 });
  M.winding = new T.MeshPhysicalMaterial({ color: new T.Color(0xc87533), metalness: 0.85, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  M.core = new T.MeshStandardMaterial({ color: new T.Color(0x2a2c2f), metalness: 0.7, roughness: 0.5 });
  M.shrinkBlue = new T.MeshPhysicalMaterial({ color: new T.Color(0x2463c9), roughness: 0.28, metalness: 0, clearcoat: 0.9, clearcoatRoughness: 0.15 });
  M.lid = new T.MeshPhysicalMaterial({ color: new T.Color(0x2b2f35), metalness: 0.85, roughness: 0.38, roughnessMap: brushed, clearcoat: 0.3 });
  M.housing = new T.MeshPhysicalMaterial({ color: new T.Color(0xece4cc), roughness: 0.55, clearcoat: 0.2 });
  M.slot = new T.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.9 });
  M.pin = new T.MeshStandardMaterial({ color: new T.Color(0xd9c37a), metalness: 1, roughness: 0.25 });
  M.rubber = new T.MeshStandardMaterial({ color: new T.Color(0x1b1b1c), roughness: 0.85 });
  M.glow = (c) => new T.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.2, roughness: 0.3 });
  M.propC = (() => { const t = carbonTex.clone(); t.repeat.set(1, 1); t.needsUpdate = true; return new T.MeshPhysicalMaterial({ color: 0xffffff, map: t, roughness: 0.34, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, side: T.DoubleSide }); })();

  // FC 윗면 포트 위치 (FC 모형 좌표, 앞쪽 = -z). 서보 레일은 뒤쪽 한 줄: RC IN, SBUS OUT, MAIN 1–8, AUX 1–6
  const FC_PORT = {
    CAN: [-0.019, 0.016, -0.03], I2C: [-0.019, 0.016, -0.018], SPI: [-0.019, 0.016, -0.006], "SPKT/DSM": [-0.019, 0.016, 0.006], BUZZER: [-0.019, 0.016, 0.018],
    TELEM1: [0.019, 0.016, -0.03], TELEM2: [0.019, 0.016, -0.018], SWITCH: [0.019, 0.016, -0.006], "ADC 3.3V": [0.019, 0.016, 0.006], "ADC 6.6V": [0.019, 0.016, 0.018],
    POWER: [-0.01, 0.016, -0.038], "SERIAL 4/5": [0, 0.016, -0.038], GPS: [0.01, 0.016, -0.038], USB: [-0.026, 0.007, 0],
  };
  const RAIL = ["RC IN", "SBUS OUT"]; for (let n = 1; n <= 8; n++) RAIL.push("MAIN OUT " + n); for (let n = 1; n <= 6; n++) RAIL.push("AUX OUT " + n);
  RAIL.forEach((p, i) => (FC_PORT[p] = [(i - 7.5) * 0.0034, 0.012, 0.044]));
  const RX_COLS = ["1", "2", "3", "4", "5", "6", "7", "8", "SB"], rxColX = (i) => (i - 4) * 0.0026;
  const SHORT = (p) => (p === "RC IN" ? "RC" : p === "SBUS OUT" ? "SB" : /OUT/.test(p) ? p.replace(/\D/g, "") : p);

  // ---------- 부품 모형 (원점 = 장착면 중앙, 안쪽/뒤쪽 = -z) ----------
  function makePart(part) {
    const g = new T.Group(), o = { group: g, id: part.id, tips: {}, pads: {} };
    g.userData.partId = part.id;
    objs[part.id] = o;
    if (part.type === "motor") {
      // 고정부: 알루미늄 베이스(냉각 슬롯) + 고정자 철심 + 구리 권선 12극
      g.add(lathe([[0, 0.0005], [0.0128, 0.0005], [0.0137, 0.0018], [0.0137, 0.0058], [0.0128, 0.0074], [0.0102, 0.0086], [0.0046, 0.0092], [0, 0.0092]], M.aluLight));
      for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2, v = box(0.0016, 0.0032, 0.0046, M.core, Math.cos(a) * 0.0134, 0.0036, Math.sin(a) * 0.0134); v.rotation.y = -a; g.add(v); }
      g.add(cyl(0.0058, 0.011, M.core, 0, 0.0152, 0, 24));
      for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2, t2 = new T.Group(); t2.rotation.y = a; t2.add(roundBox(0.0055, 0.0098, 0.0034, M.winding, 0.0084, 0.0152, 0, 0.0012)); g.add(t2); }
      // 회전부(벨): 측면 회전체 + 스포크 창이 뚫린 윗판 + 색 링 + 축 + 너트
      const bell = new T.Group();
      bell.add(lathe([[0.0124, 0.0094], [0.0140, 0.0098], [0.0143, 0.0108], [0.0143, 0.0228], [0.0138, 0.0242], [0.0127, 0.0249]], M.alu, 64));
      const top = new T.Shape(); top.absarc(0, 0, 0.0128, 0, Math.PI * 2, false);
      for (let k = 0; k < 6; k++) { const a0 = (k / 6) * Math.PI * 2 + 0.16, a1 = a0 + Math.PI / 3 - 0.32, h = new T.Path(); h.absarc(0, 0, 0.0104, a0, a1, false); h.absarc(0, 0, 0.0056, a1, a0, true); h.closePath(); top.holes.push(h); }
      const tg2 = new T.ExtrudeGeometry(top, { depth: 0.0008, bevelEnabled: true, bevelThickness: 0.0003, bevelSize: 0.0003, bevelSegments: 2, curveSegments: 40 }); tg2.rotateX(-Math.PI / 2);
      const topM = new T.Mesh(tg2, M.alu); topM.position.y = 0.0241; topM.castShadow = topM.receiveShadow = true; bell.add(topM);
      bell.add(lathe([[0.01445, 0.0112], [0.01445, 0.0128]], M.accent, 64));
      bell.add(lathe([[0.0062, 0.0252], [0.0060, 0.0262], [0.0040, 0.0266], [0.0026, 0.0266]], M.alu, 40));
      bell.add(cyl(0.0025, 0.012, M.steel, 0, 0.0305, 0, 20));
      // 축 나사 방향에 따라 너트 색이 다르다 (검정 / 은색)
      const nutM = part.thread === "cw" ? M.dark : M.aluLight;
      bell.add(cyl(0.0052, 0.0028, nutM, 0, 0.0336, 0, 6)); bell.add(lathe([[0.0046, 0], [0.0046, 0.0008], [0.0034, 0.0022], [0.0012, 0.0029], [0, 0.003]], nutM, 24).translateY(0.035));
      // X자 장착 플랜지 (나사 구멍 4개)
      for (const a of [Math.PI / 4, -Math.PI / 4]) { const f = roundBox(0.041, 0.0026, 0.0078, M.dark, 0, 0.0013, 0, 0.0035); f.rotation.y = a; g.add(f); }
      for (const a of [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]) { const sx = Math.cos(a) * 0.0175, sz = Math.sin(a) * 0.0175; g.add(cyl(0.0017, 0.0012, M.steel, sx, 0.0031, sz, 16)); g.add(cyl(0.0008, 0.0006, M.dark, sx, 0.0037, sz, 6)); }
      g.add(cyl(0.0034, 0.008, M.dark, 0, 0.004, -0.0125, 16).rotateX(Math.PI / 2)); // 출력선 수축 튜브
      ["y", "b", "g"].forEach((c, k) => lead(o, "ph" + (k + 1), [(k - 1) * 0.004, 0.004, -0.012], [(k - 1) * 0.006, 0.003, -0.021], LEAD[c], 0.0011));
      g.add(bell); o.spinner = bell;
    } else if (part.type === "prop") {
      const sp = new T.Group(), s = part.dir === "ccw" ? 1 : -1, geo = bladeGeo(s);
      const b1 = new T.Mesh(geo, M.propC), b2 = new T.Mesh(geo, M.propC); b1.castShadow = b2.castShadow = true; b2.rotation.y = Math.PI; b1.userData.plate = b2.userData.plate = true; // 얇은 날개는 아래 부품 클릭을 가리지 않는다
      sp.add(b1, b2); // 허브: 선반 가공 몸통 + 날개 뿌리 + 알루미늄 클램프
      sp.add(lathe([[0, 0], [0.0088, 0], [0.0098, 0.001], [0.0098, 0.0078], [0.0086, 0.009], [0.0036, 0.0092], [0.0036, 0.0098], [0, 0.0098]], M.plastic, 40));
      for (const rot of [0, Math.PI]) { const sh = cyl(0.0032, 0.012, M.plastic, 0, 0, 0, 16); sh.rotation.z = Math.PI / 2; const hg2 = new T.Group(); hg2.rotation.y = rot; sh.position.set(0.012, 0.0045, 0); hg2.add(sh); sp.add(hg2); }
      sp.add(roundBox(0.02, 0.0022, 0.0072, M.aluLight, 0, 0.0104, 0, 0.0028)); // 프로펠러 브라켓
      for (const x of [-0.0068, 0.0068]) sp.add(cyl(0.0012, 0.0008, M.dark, x, 0.0118, 0, 6));
      // 날개 윗면 인쇄: 규격(길이 2자리 + 피치 2자리)과 회전 방향 — 확대해야 읽힌다
      const txt = "2408 " + part.dir.toUpperCase();
      for (const rot of [0, Math.PI]) {
        const r = 0.066, th = bladeTwist(s, r), lb = nameplate(txt, 0.034, 0.006, null, "#e8ecec");
        const holder = new T.Group(); holder.rotation.y = rot; sp.add(holder);
        const off = 0.0031; lb.rotation.x = -Math.PI / 2 + th; lb.position.set(r, 0.004 + off * Math.cos(th), off * Math.sin(th));
        holder.add(lb);
      }
      const disc = new T.Mesh(new T.CircleGeometry(0.12, 40), new T.MeshBasicMaterial({ color: 0x9aa6a8, transparent: true, opacity: 0, side: T.DoubleSide, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.position.y = 0.004; disc.raycast = () => {}; // 회전 흐림 원판은 클릭 대상이 아니다
      g.add(sp, disc); o.spinner = sp; o.disc = disc;
      sp.traverse((m) => { if (m.isMesh) m.userData.plate = true; }); // 프로펠러 전체(날개·인쇄·허브)는 아래 부품 클릭을 가리지 않는다
    } else if (part.type === "esc") {
      // 수축 튜브로 감싼 기판 + 윗면 알루미늄 방열판(핀) + 콘덴서 + 라벨
      g.add(roundBox(0.024, 0.0072, 0.048, M.shrinkBlue, 0, 0.0036, 0, 0.0034));
      g.add(roundBox(0.018, 0.0012, 0.026, M.aluLight, 0, 0.0076, -0.004, 0.0015));
      for (let k = 0; k < 6; k++) g.add(box(0.0009, 0.0018, 0.024, M.aluLight, -0.0075 + k * 0.003, 0.0091, -0.004));
      { const cp = cyl(0.0032, 0.012, mat(0x1d1f22, { roughness: 0.4 }), 0.0, 0.0034, 0.0, 20); cp.rotation.z = Math.PI / 2; cp.position.set(0, 0.0034, -0.027); g.add(cp); g.add(cyl(0.0033, 0.0008, M.aluLight, 0.0062, 0.0034, -0.027, 20).rotateZ(Math.PI / 2)); }
      const el = nameplate("ESC 60A", 0.016, 0.005, "#e2b322", "#1a1a1a"); el.position.set(0, 0.0074, 0.0125); g.add(el);
      ["A", "B", "C"].forEach((p, k) => g.add(cyl(0.0014, 0.001, M.aluLight, (k - 1) * 0.007, 0.0099, 0.019, 16))); // 납땜 덩어리
      ["A", "B", "C"].forEach((p, k) => { const pd = box(0.005, 0.0016, 0.006, M.copper, (k - 1) * 0.007, 0.0088, 0.019); g.add(pd); o.pads[p] = new T.Vector3((k - 1) * 0.007, 0.0096, 0.019); target(g, mesh(new T.BoxGeometry(0.0068, 0.006, 0.009), HIT, (k - 1) * 0.007, 0.0096, 0.019), { kind: "escPad", part: part.id, pad: p, label: "ESC 단자 " + p }).userData.tip = { part: part.id, key: "pad" + p }; });
      lead(o, "pwr", [-0.006, 0.004, -0.024], [-0.01, 0.004, -0.034], LEAD.r, 0.0018);
      { const k2 = new T.CatmullRomCurve3([new T.Vector3(-0.003, 0.004, -0.024), new T.Vector3(-0.006, 0.006, -0.029), new T.Vector3(-0.008, 0.004, -0.034)]); const t2 = new T.Mesh(new T.TubeGeometry(k2, 8, 0.0018, 5), LEAD.k); g.add(t2); }
      g.add(box(0.008, 0.0055, 0.0075, M.yellow, -0.009, 0.004, -0.0375)); // XT60M
      lead(o, "sig", [0.0035, 0.005, -0.024], [0.0045, 0.004, -0.034], LEAD.w, 0.0009, true);
      lead(o, "tel", [0.008, 0.005, -0.024], [0.01, 0.004, -0.032], LEAD.o, 0.0008, true);
    } else if (part.type === "fc") {
      // 아래 케이스(플라스틱) + 위 덮개(아노다이징 알루미늄) + 상태 LED 창 + 옆 통풍구 + microSD
      g.add(roundBox(0.05, 0.0092, 0.082, M.plastic, 0, 0.0046, 0, 0.006));
      g.add(roundBox(0.0472, 0.0062, 0.0792, M.lid, 0, 0.0119, 0, 0.0055));
      g.add(roundBox(0.012, 0.0008, 0.005, (o.statusMat = M.glow(0x3b8cff)), 0.0, 0.0151, -0.024, 0.0018));
      for (const sx of [-1, 1]) for (let k = 0; k < 7; k++) g.add(box(0.0006, 0.0028, 0.0035, M.slot, sx * 0.0251, 0.0048, -0.024 + k * 0.006));
      g.add(box(0.008, 0.0014, 0.0008, M.aluLight, 0.012, 0.004, -0.0411));
      target(g, mesh(new T.BoxGeometry(0.03, 0.017, 0.06), HIT, 0, 0.0075, 0.002), { kind: "fc", part: part.id, label: "비행 컨트롤러" });
      const d = arrowDecal(0.024, 0.032, "FC", "#1b1e22"); d.position.set(0, 0.0152, 0.006); g.add(d);
      // 포트마다 커넥터 하우징과 이름 인쇄, 하나씩 꽂을 수 있는 자리
      for (const p in FC_PORT) {
        if (RAIL.includes(p)) continue;
        const v = FC_PORT[p], t = SIM.portType(p), side = Math.abs(v[0]) > 0.015 && p !== "USB";
        const len = t === "usb" ? 0.007 : (SIM.CONN_PINS[t] || 3) * 0.0012 + 0.002;
        if (t === "usb") { g.add(roundBox(0.004, 0.0025, len, M.aluLight, v[0], v[1], v[2], 0.0008)); g.add(box(0.0042, 0.0012, len - 0.002, M.slot, v[0], v[1], v[2])); }
        else { g.add(roundBox(side ? 0.0038 : len, 0.0028, side ? len : 0.0038, M.housing, v[0], 0.0158, v[2], 0.0006)); g.add(box(side ? 0.0018 : len - 0.0014, 0.0004, side ? len - 0.0014 : 0.0018, M.slot, v[0], 0.0173, v[2])); }
        o.ports = o.ports || []; o.ports.push(target(g, mesh(new T.BoxGeometry(side ? 0.006 : len + 0.002, 0.006, side ? len + 0.002 : 0.006), HIT, v[0], 0.016, v[2]), { kind: "fcPort", part: part.id, port: p, label: p }));
        if (p === "USB") continue;
        const lb = nameplate(p, 0.013, 0.0028, null, "#cfd6d4");
        lb.position.set(side ? v[0] - Math.sign(v[0]) * 0.0095 : v[0], 0.0153, side ? v[2] : v[2] + 0.0045); if (side) lb.rotation.z = 0; g.add(lb);
      }
      for (const p of RAIL) {
        const v = FC_PORT[p];
        g.add(box(0.003, 0.0065, 0.0042, M.plastic, v[0], 0.0093, v[2]));
        for (let k = 0; k < 3; k++) g.add(box(0.0005, 0.0026, 0.0005, M.pin, v[0], 0.0136, v[2] - 0.0012 + k * 0.0012)); // 금도금 핀 3개
        o.ports = o.ports || []; o.ports.push(target(g, mesh(new T.BoxGeometry(0.0034, 0.011, 0.008), HIT, v[0], 0.011, v[2]), { kind: "fcPort", part: part.id, port: p, label: p }));
        const lb = nameplate(SHORT(p), 0.0032, 0.0026, null, "#cfd6d4"); lb.position.set(v[0], 0.0153, 0.0385); g.add(lb);
      }
    } else if (part.type === "pm") {
      g.add(roundBox(0.022, 0.009, 0.05, M.plastic, 0, 0.0045, 0, 0.004), roundBox(0.0225, 0.0094, 0.008, M.shrinkBlue, 0, 0.0045, 0.012, 0.004));
      const nl = nameplate("PMU", 0.018, 0.009, "#2a2e33", "#ffffff"); nl.position.set(0, 0.0093, -0.004); g.add(nl);
      g.add(box(0.016, 0.009, 0.012, M.yellow, 0, 0.0045, 0.03));
      target(g, mesh(new T.BoxGeometry(0.02, 0.014, 0.016), HIT, 0, 0.0045, 0.03), { kind: "pmIn", part: part.id, label: "PMU 입력 커넥터" });
      o.pads.in = new T.Vector3(0, 0.0045, 0.037);
      lead(o, "fc", [-0.006, 0.006, -0.025], [-0.016, 0.016, -0.078], LEAD.r, 0.001, true); // FC 앞쪽 밖까지 나오는 긴 6핀 케이블
      // 출력: 빨강·검정 선 끝 XT60M (PDB 주전원 XT60F에 꽂는다)
      lead(o, "out", [0.004, 0.005, -0.025], [0.006, 0.005, -0.046], LEAD.r, 0.0018);
      { const k2 = new T.CatmullRomCurve3([new T.Vector3(0.008, 0.005, -0.025), new T.Vector3(0.0095, 0.007, -0.036), new T.Vector3(0.0085, 0.005, -0.046)]); g.add(new T.Mesh(new T.TubeGeometry(k2, 8, 0.0018, 6), LEAD.k)); }
      g.add(box(0.008, 0.0055, 0.0075, M.yellow, 0.007, 0.005, -0.0505));
    } else if (part.type === "battery") {
      // 리포 팩: 수축 포장 + 라벨 + 끝 보호판 + 밸런스 커넥터(흰 6S 단자와 가는 선) + 고정 스트랩
      g.add(roundBox(0.046, 0.034, 0.135, new T.MeshPhysicalMaterial({ color: new T.Color(0x23282e), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 }), 0, 0.017, 0, 0.007));
      { const lt = canvasTex(256, 512, (c, W, H) => { const gr = c.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#2a6fd6"); gr.addColorStop(1, "#163f86"); c.fillStyle = gr; c.fillRect(0, 0, W, H); c.fillStyle = "#ffd45e"; c.fillRect(0, H * 0.62, W, 10); c.fillStyle = "#fff"; c.textAlign = "center"; c.font = "bold 52px sans-serif"; c.fillText("LiPo 6S", W / 2, 120); c.font = "bold 40px sans-serif"; c.fillText("22.2V", W / 2, 200); c.fillText("16000mAh", W / 2, 260); c.font = "30px sans-serif"; c.fillText("25C", W / 2, 320); c.font = "bold 34px sans-serif"; c.fillText("배터리", W / 2, 420); });
        const lb = new T.Mesh(new T.PlaneGeometry(0.038, 0.088), new T.MeshPhysicalMaterial({ map: lt, roughness: 0.35, clearcoat: 0.6 })); lb.rotation.x = -Math.PI / 2; lb.position.set(0, 0.0342, 0); g.add(lb); }
      for (const z of [-0.0688, 0.0688]) g.add(roundBox(0.047, 0.035, 0.002, M.dark, 0, 0.017, z, 0.006));
      for (const z of [-0.056, 0.056]) g.add(roundBox(0.049, 0.0362, 0.01, mat(0x161616, { roughness: 0.9 }), 0, 0.017, z, 0.007)); // 벨크로 스트랩
      { const bc = new T.CatmullRomCurve3([new T.Vector3(-0.012, 0.03, 0.068), new T.Vector3(-0.015, 0.036, 0.078), new T.Vector3(-0.016, 0.036, 0.09)]); for (let k = 0; k < 4; k++) g.add(new T.Mesh(new T.TubeGeometry(bc.clone ? new T.CatmullRomCurve3(bc.points.map((pt) => pt.clone().add(new T.Vector3(k * 0.0012 - 0.0018, 0, 0)))) : bc, 10, 0.0005, 5), k ? mat(0x111111) : LEAD.r)); g.add(roundBox(0.008, 0.0035, 0.004, M.housing, -0.016, 0.036, 0.092, 0.0006)); }
      lead(o, "xt", [0.012, 0.026, 0.068], [0.012, 0.042, 0.084], LEAD.r, 0.0024, true);
    } else if (part.type === "gps") {
      // 접이식 마스트(카본 튜브 + 알루미늄 받침·접이 관절) + 돔형 GPS 퍽 + 상태 LED 링
      const mastM = new T.MeshPhysicalMaterial({ color: 0xffffff, map: (() => { const t = carbonTex.clone(); t.repeat.set(1, 6); t.needsUpdate = true; return t; })(), roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1 });
      g.add(cyl(0.0032, 0.064, mastM, 0, 0.038, 0, 20));
      g.add(lathe([[0, 0], [0.012, 0], [0.012, 0.002], [0.007, 0.0045], [0.0048, 0.008], [0, 0.008]], M.alu, 32));
      g.add(roundBox(0.009, 0.008, 0.009, M.alu, 0, 0.026, 0, 0.002)); { const kp = cyl(0.0014, 0.011, M.steel, 0, 0.026, 0, 12); kp.rotation.z = Math.PI / 2; g.add(kp); }
      g.add(lathe([[0, 0.068], [0.0065, 0.068], [0.0065, 0.071], [0, 0.071]], M.alu, 24));
      g.add(lathe([[0, 0.07], [0.0295, 0.07], [0.0305, 0.0715], [0.0305, 0.075], [0.029, 0.0775], [0.024, 0.0805], [0.014, 0.0822], [0, 0.0826]], M.plastic, 64));
      g.add(lathe([[0.0306, 0.0718], [0.0306, 0.0732]], (o.ringMat = M.glow(0x37d67a)), 64));
      const d = arrowDecal(0.026, 0.038, "GPS", "#1b1e22"); d.position.y = 0.0829; g.add(d);
      // 마스트 아래에서 양옆으로 나와 FC에 가리지 않는 케이블 끝 (굵은 6핀 / 가는 4핀)
      lead(o, "gps", [0.003, 0.006, 0.0], [0.036, 0.004, -0.006], LEAD.l, 0.0013, true);
      lead(o, "compass", [-0.003, 0.006, 0.0], [-0.036, 0.004, -0.006], LEAD.v, 0.0011, true);
    } else if (part.type === "rx") {
      g.add(roundBox(0.024, 0.01, 0.04, new T.MeshPhysicalMaterial({ color: new T.Color(0x34393f), roughness: 0.42, clearcoat: 0.4 }), 0, 0.005, 0, 0.004), roundBox(0.02, 0.0006, 0.014, M.white, 0, 0.0102, 0.004, 0.0015));
      for (const [x, rz] of [[-0.006, 0], [0.006, -0.5]]) { const ag = new T.Group(); ag.position.set(x, 0.006, 0.02); ag.rotation.set(0.5, 0, rz); ag.add(cyl(0.0008, 0.052, mat(0x111111, { roughness: 0.6 }), 0, 0.026, 0, 8), cyl(0.0012, 0.018, M.white, 0, 0.061, 0, 10), cyl(0.0014, 0.004, M.rubber, 0, 0.002, 0, 10)); g.add(ag); } // 동축 안테나 + 흰 수신부
      const nl = nameplate("R8 수신기", 0.022, 0.007, null, "#ffffff"); nl.position.set(0, 0.0102, 0.004); g.add(nl);
      // 핀 헤더: 채널 1–8, SBUS (뒤쪽 끝)
      RX_COLS.forEach((c, i) => { const x = rxColX(i); g.add(box(0.0022, 0.004, 0.003, M.plastic, x, 0.012, -0.0175)); for (let k = 0; k < 3; k++) g.add(box(0.0004, 0.0018, 0.0004, M.pin, x, 0.0148, -0.0185 + k * 0.001)); const lb = nameplate(c === "SB" ? "B" : c, 0.0024, 0.0024, null, "#ffffff"); lb.position.set(x, 0.0104, -0.0135); g.add(lb); });
      // 바인딩 버튼과 상태 LED
      g.add(cyl(0.0042, 0.0012, M.dark, 0.0075, 0.0106, -0.004, 20)); // 버튼 받침
      o.bindBtn = cyl(0.0033, 0.0022, mat(0xd8382e, { roughness: 0.35 }), 0.0075, 0.0118, -0.004, 20); g.add(o.bindBtn); // 바인드 버튼
      const bh = mesh(new T.BoxGeometry(0.011, 0.008, 0.011), HIT, 0.0075, 0.012, -0.004); bh.userData.bind = part.id; g.add(bh);
      const bl = nameplate("BIND", 0.008, 0.0026, null, "#ffffff"); bl.position.set(0.0075, 0.0104, 0.0012); g.add(bl);
      o.led = new T.Mesh(new T.SphereGeometry(0.0024, 14, 10), new T.MeshBasicMaterial({ color: 0x333333 })); o.led.position.set(-0.0075, 0.0112, -0.004); g.add(o.led);
      o.ledGlow = new T.Sprite(new T.SpriteMaterial({ map: canvasTex(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); }), transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
      o.ledGlow.scale.set(0.016, 0.016, 1); o.ledGlow.position.copy(o.led.position); o.ledGlow.raycast = () => {}; g.add(o.ledGlow);
      const ll = nameplate("LED", 0.006, 0.0024, null, "#ffffff"); ll.position.set(-0.0075, 0.0104, 0.0012); g.add(ll);
      // 3선 커넥터의 FC 쪽 끝
      const hh = new T.Mesh(new T.SphereGeometry(0.0065, 8, 6), HIT); hh.position.set(0, 0.004, -0.04); hh.userData.tip = { part: part.id, key: "sig" }; g.add(hh);
      o.tips.sig = new T.Vector3(0, 0.004, -0.04);
    } else if (part.type === "buzzer") {
      g.add(lathe([[0, 0], [0.008, 0], [0.008, 0.0062], [0.0072, 0.0072], [0.0024, 0.0074], [0.0018, 0.0062], [0, 0.0062]], M.plastic, 40));
      const nl = nameplate("부저", 0.012, 0.005, null, "#ffffff"); nl.position.set(0, 0.0071, 0.0045); g.add(nl);
      lead(o, "fc", [0, 0.003, -0.008], [0, 0.003, -0.018], LEAD.k, 0.0008, true);
    } else if (part.type === "switch") {
      g.add(roundBox(0.014, 0.008, 0.014, M.plastic, 0, 0.004, 0, 0.0025), lathe([[0.0052, 0.0078], [0.0058, 0.0084], [0.0058, 0.0092], [0.005, 0.0096]], (o.ringMat = M.glow(0xff4630)), 32), lathe([[0, 0.0084], [0.0046, 0.0084], [0.0046, 0.0112], [0.0038, 0.012], [0, 0.0121]], new T.MeshPhysicalMaterial({ color: new T.Color(0xc8382e), roughness: 0.3, clearcoat: 0.8 }), 32));
      const nl = nameplate("안전 스위치", 0.014, 0.0035, null, "#ffffff"); nl.position.set(0, 0.0081, 0.0055); g.add(nl);
      lead(o, "fc", [0, 0.003, -0.007], [0, 0.003, -0.018], LEAD.r, 0.0008, true);
    } else if (part.type === "telem") {
      g.add(roundBox(0.024, 0.01, 0.046, new T.MeshPhysicalMaterial({ color: new T.Color(0x2f8a54), roughness: 0.4, clearcoat: 0.5 }), 0, 0.005, 0, 0.004));
      g.add(lathe([[0, 0.008], [0.0034, 0.008], [0.0034, 0.0125], [0.0026, 0.0135], [0, 0.0135]], M.aluLight, 6).translateZ(0.02)); // SMA 커넥터(육각)
      g.add(lathe([[0, 0.013], [0.0036, 0.014], [0.004, 0.03], [0.0034, 0.07], [0.0026, 0.082], [0, 0.0835]], M.rubber, 24).translateZ(0.02)); // 고무 안테나
      const nl = nameplate("텔레메트리", 0.02, 0.006, null, "#ffffff"); nl.position.set(0, 0.0102, -0.006); g.add(nl);
      lead(o, "fc", [0, 0.005, -0.023], [0, 0.004, -0.034], LEAD.y, 0.0009, true);
    }
    if (part.type === "bottom") buildBottom(o);
    if (part.type === "top") buildTop(o);
    if (part.type === "arm") buildArm(o, part);
    if (part.type === "skid") buildSkid(o);
    if (part.type === "canopy") buildCanopy(o);
    g.scale.setScalar(PS[part.type] || 1);
    if (["motor", "esc", "pm", "rx", "telem", "buzzer", "switch"].includes(part.type)) { // 작은 부품은 넉넉한 클릭 영역
      const sc0 = g.scale.x, bb = new T.Box3().setFromObject(g), c = bb.getCenter(new T.Vector3()).divideScalar(sc0), sz = bb.getSize(new T.Vector3()).divideScalar(sc0), m = 0.006 / sc0;
      const hb = mesh(new T.BoxGeometry(sz.x + m, sz.y + m, sz.z + m), HIT, c.x, c.y, c.z); hb.userData.partHit = part.id; g.add(hb);
    }
    return g;
  }

  // ---------- 나사 구멍 (부품 좌표) ----------
  const HOLE_POS = {
    motor: [0, 1, 2, 3].map((k) => [Math.cos(Math.PI / 4 + (k * Math.PI) / 2) * 0.0175, 0.0026, Math.sin(Math.PI / 4 + (k * Math.PI) / 2) * 0.0175]),
    prop: [[0.0065, 0.0106, 0], [-0.0065, 0.0106, 0]],
    arm: [[0, 0.0122, -0.097], [0, 0.0122, -0.087]],
    bottom: [[0.095, 0.0004, 0], [-0.095, 0.0004, 0], [0, 0.0004, 0.104], [0, 0.0004, -0.104]],
    top: [[0.06, 0.0016, 0.078], [-0.06, 0.0016, 0.078], [0.06, 0.0016, -0.078], [-0.06, 0.0016, -0.078]],
    skid: [[0.045, 0.0016, 0.1], [-0.045, 0.0016, 0.1], [0.045, 0.0016, -0.1], [-0.045, 0.0016, -0.1]],
  };
  const headR = (size) => +size * 0.00075; // 기체 좌표 기준 나사 머리 반지름
  const holeHit = [];
  function makeHead(size) {
    const g = new T.Group(), r = headR(size);
    g.add(cyl(r, 0.0012, M.dark, 0, 0.0006, 0, 18), cyl(r * 0.42, 0.0004, mat(0x050505), 0, 0.0012, 0, 6));
    g.add(cyl(r * 0.55, 0.004, M.steel, 0, -0.002, 0, 10)); // 나사산 (떠 있을 때 보인다)
    return g;
  }
  function addHoles(o, part) {
    const list = HOLE_POS[part.type]; if (!list) return;
    o.holes = list.map((p, i) => {
      const hg = new T.Group(); hg.position.set(...p); hg.scale.setScalar(1 / (PS[part.type] || 1));
      (part.type === "prop" ? o.spinner : o.group).add(hg);
      const req = SIM.SCREW_REQ[part.type];
      hg.add(cyl(headR(req) * 0.6, 0.0004, mat(0x0a0a0a), 0, 0.0002, 0, 14)); // 구멍
      const hit = mesh(new T.CylinderGeometry(headR(req) * 1.6, headR(req) * 1.6, 0.004, 10), HIT, 0, 0.001, 0);
      hit.userData.hole = part.id + ":" + i; hg.add(hit); holeHit.push(hit);
      return { g: hg, head: null, key: part.id + ":" + i };
    });
  }
  function syncScrews() {
    for (const p of SIM.PARTS) {
      const o = objs[p.id]; if (!o.holes) continue;
      for (const h of o.holes) {
        const v = SIM.state.screws[h.key] || "", size = SIM.screwSize(v);
        if (h.head && h.size !== size) { h.g.remove(h.head); h.head = null; }
        if (size && !h.head) { h.head = makeHead(size); h.size = size; h.g.add(h.head); }
        if (h.head) h.head.position.y = SIM.screwTight(v) ? 0 : 0.0026; // 조이기 전에는 떠 있다
      }
    }
  }

  // PDB 패드 위치 (기체 기준 x, z)
  const PADS = { batt: { plus: [-0.014, 0.088], minus: [0.014, 0.088] } };
  for (const id of SIM.POS_IDS) { const p = SIM.POS[id], dx = p.x * S2, dz = p.z * S2; PADS[id] = { plus: [dx * 0.088 - dz * 0.027, dz * 0.088 + dx * 0.027], minus: [dx * 0.088 + dz * 0.027, dz * 0.088 - dx * 0.027] }; }
  const HARNESS = [0, 0.0015, -0.09]; // 하판 앞쪽 끝 (하판 왼쪽·오른쪽 자리를 비워 둔다)
  const PDB_MAIN = new T.Vector3(0, 0.005, 0.112); // 주전원 XT60F (하판 뒤쪽 끝)
  const armDir = (pid) => { const p = SIM.POS[pid]; return [p.x * S2, p.z * S2]; };
  // XT60F 위치: 붐대 양옆 (i=0 → 오른쪽 옆, 1 → 왼쪽 옆)
  const xtRoot = (pid, i) => { const [dx, dz] = armDir(pid), s = i ? 1 : -1; return new T.Vector3(dx * 0.066 - dz * 0.03 * s, 0.002, dz * 0.066 + dx * 0.03 * s); };
  const xtLocal = (pid, i) => { const [dx, dz] = armDir(pid), s = i ? 1 : -1; return new T.Vector3(dx * 0.1 - dz * 0.034 * s, 0.004, dz * 0.1 + dx * 0.034 * s); };
  // CNC 가공 카본 판: 둥근 모서리 사각형 + 경량화 구멍·나사 구멍, 3mm 두께, 모서리 면취
  const cfTex = (rep) => { const t = carbonTex.clone(); t.repeat.set(rep, rep); t.needsUpdate = true; return t; };
  M.cfPlate = new T.MeshPhysicalMaterial({ color: 0xffffff, map: cfTex(34), normalMap: normalFrom(weaveH, 2.2, new T.Vector2(34, 34)), normalScale: new T.Vector2(0.35, 0.35), roughness: 0.36, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 });
  function cfPlate(w, d, holes, m, t) {
    t = t || 0.003; const r = 0.016, sh = new T.Shape(), W = w / 2, D = d / 2;
    sh.moveTo(-W + r, -D); sh.lineTo(W - r, -D); sh.quadraticCurveTo(W, -D, W, -D + r); sh.lineTo(W, D - r); sh.quadraticCurveTo(W, D, W - r, D); sh.lineTo(-W + r, D); sh.quadraticCurveTo(-W, D, -W, D - r); sh.lineTo(-W, -D + r); sh.quadraticCurveTo(-W, -D, -W + r, -D);
    for (const h of holes || []) { const p2 = new T.Path(); if (h.length === 3) p2.absarc(h[0], -h[1], h[2], 0, Math.PI * 2, true); else { const [x, z, hw, hd] = h, rr = Math.min(hw, hd); p2.moveTo(x - hw + rr, -z - hd); p2.lineTo(x + hw - rr, -z - hd); p2.absarc(x + hw - rr, -z - hd + rr, rr, -Math.PI / 2, 0, false); p2.lineTo(x + hw, -z + hd - rr); p2.absarc(x + hw - rr, -z + hd - rr, rr, 0, Math.PI / 2, false); p2.lineTo(x - hw + rr, -z + hd); p2.absarc(x - hw + rr, -z + hd - rr, rr, Math.PI / 2, Math.PI, false); p2.lineTo(x - hw, -z - hd + rr); p2.absarc(x - hw + rr, -z - hd + rr, rr, Math.PI, Math.PI * 1.5, false); } sh.holes.push(p2); }
    const b = 0.0004, geo = new T.ExtrudeGeometry(sh, { depth: t - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 16 });
    geo.rotateX(-Math.PI / 2); geo.translate(0, -t / 2 + b, 0);
    return mesh(geo, m || M.cfPlate, 0, 0, 0);
  }
  // 알루미늄 육각 스탠드오프 + 위아래 나사 머리
  function standoff(g, x, y0, y1, z) { const h = y1 - y0; g.add(cyl(0.0032, h, M.aluLight, x, (y0 + y1) / 2, z, 6)); for (const y of [y0 - 0.0018, y1 + 0.0018]) { g.add(cyl(0.0026, 0.0016, M.dark, x, y, z, 20)); } }
  const octPlate = (w, d, m) => { const p = mesh(new T.CylinderGeometry(0.5, 0.5, 0.003, 4), m || M.carbon, 0, 0, 0); p.scale.set(w * 1.5, 1, d * 1.5); p.rotation.y = Math.PI / 4; return p; };
  // 하판: 카본 판 + PDB(구리 패드, +/− 인쇄) + 통신선 하네스 + 스탠드오프
  function buildBottom(o) {
    const g = o.group;
    const BH = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) BH.push([sx * 0.108, sz * 0.108, 0.0022], [sx * 0.108, sz * 0.03, 0.0018]);
    const pl = cfPlate(0.233, 0.233, BH); pl.position.y = -0.0015; pl.userData.plate = true; g.add(pl);
    const pcb = cfPlate(0.205, 0.205, [], new T.MeshPhysicalMaterial({ color: new T.Color(0x0f4a32), roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2 }), 0.0012); pcb.position.y = 0.0006; pcb.castShadow = false; pcb.userData.plate = true; g.add(pcb);
    { const tr = canvasTex(512, 512, (c, W, H) => { c.clearRect(0, 0, W, H); c.strokeStyle = "rgba(210,150,60,0.55)"; c.lineCap = "round"; for (let i = 0; i < 26; i++) { c.lineWidth = 3 + (i % 3) * 3; c.beginPath(); let x = Math.random() * W, y = Math.random() * H; c.moveTo(x, y); for (let k = 0; k < 3; k++) { if (k % 2) x += (Math.random() - 0.5) * 220; else y += (Math.random() - 0.5) * 220; c.lineTo(x, y); } c.stroke(); } c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = 4; c.strokeRect(14, 14, W - 28, H - 28); });
      const tp = new T.Mesh(new T.PlaneGeometry(0.2, 0.2), new T.MeshStandardMaterial({ map: tr, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false })); tp.rotation.x = -Math.PI / 2; tp.position.y = 0.00125; tp.raycast = () => {}; g.add(tp); } // 구리 배선 패턴·실크 테두리
    const silk = (ch) => { const p = new T.Mesh(new T.PlaneGeometry(0.011, 0.011), new T.MeshBasicMaterial({ map: canvasTex(64, 64, (c) => { c.fillStyle = "#143d2c"; c.fillRect(0, 0, 64, 64); c.fillStyle = "#fff"; c.font = "bold 58px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(ch, 32, 34); }) })); p.rotation.x = -Math.PI / 2; return p; };
    // XT60F 8개 (붐대 양옆, 짧은 빨강·검정 선 끝)
    SIM.POS_IDS.forEach((pid) => SIM.XT_OF[pid].forEach((xt, i) => {
      const c = xtLocal(pid, i), a = xtRoot(pid, i);
      for (const [col, off] of [[LEAD.r, -0.0018], [LEAD.k, 0.0018]]) { const cv = new T.CatmullRomCurve3([new T.Vector3(a.x + off, 0.0015, a.z), new T.Vector3((a.x + c.x) / 2 + off, 0.005, (a.z + c.z) / 2), new T.Vector3(c.x + off * 0.6, 0.004, c.z)]); const m = new T.Mesh(new T.TubeGeometry(cv, 8, 0.0016, 5), col); m.castShadow = true; g.add(m); }
      const hs = box(0.009, 0.006, 0.009, M.yellow, c.x, 0.004, c.z); hs.rotation.y = Math.atan2(SIM.POS[pid].x, SIM.POS[pid].z); g.add(hs);
      target(g, mesh(new T.BoxGeometry(0.015, 0.012, 0.015), HIT, c.x, 0.004, c.z), { kind: "xt", part: o.id, xt, pos: pid, label: "PDB " + SIM.xtName(xt) });
      const nl = nameplate(xt.slice(2), 0.006, 0.004, null, "#ffffff"); nl.position.set(a.x, 0.0012, a.z); g.add(nl);
    }));
    // 주전원: +/− 패드에 납땜된 굵은 선 끝 XT60F (배터리 또는 PMU 출력 XT60M을 꽂는다)
    for (const sgn of ["plus", "minus"]) {
      const a = PADS.batt[sgn];
      g.add(box(0.014, 0.0012, 0.014, sgn === "plus" ? M.copper : M.steel, a[0], 0.001, a[1]));
      g.add(cyl(0.004, 0.002, M.steel, a[0], 0.0022, a[1], 12)); // 납땜
      const s = silk(sgn === "plus" ? "+" : "−"); s.position.set(a[0] + (sgn === "plus" ? -0.012 : 0.012), 0.0011, a[1]); g.add(s);
      const cv = new T.CatmullRomCurve3([new T.Vector3(a[0], 0.003, a[1]), new T.Vector3(a[0] * 0.6, 0.008, a[1] + 0.014), new T.Vector3(PDB_MAIN.x + (sgn === "plus" ? -0.002 : 0.002), PDB_MAIN.y, PDB_MAIN.z - 0.006)]);
      g.add(new T.Mesh(new T.TubeGeometry(cv, 10, 0.0022, 6), sgn === "plus" ? LEAD.r : LEAD.k));
    }
    g.add(box(0.009, 0.006, 0.01, M.yellow, PDB_MAIN.x, PDB_MAIN.y, PDB_MAIN.z));
    target(g, mesh(new T.BoxGeometry(0.018, 0.014, 0.018), HIT, PDB_MAIN.x, PDB_MAIN.y, PDB_MAIN.z), { kind: "pdbMain", part: o.id, label: "PDB 주전원 XT60" });
    const ml = nameplate("MAIN", 0.01, 0.0035, null, "#ffffff"); ml.position.set(PDB_MAIN.x, 0.0011, PDB_MAIN.z - 0.012); g.add(ml);
    const pn = nameplate("PDB", 0.024, 0.008, null, "#e6efe9"); pn.position.set(0.045, 0.0011, 0.05); g.add(pn);
    const hb = new T.Group(); hb.position.set(...HARNESS); g.add(hb);
    hb.add(box(0.02, 0.006, 0.012, M.plug, 0, 0.003, 0));
    target(hb, mesh(new T.BoxGeometry(0.024, 0.012, 0.016), HIT, 0, 0.003, 0), { kind: "harness", part: o.id, label: "ESC 통신선 하네스" });
    const ho = { group: hb, id: o.id, tips: {}, pads: {} };
    lead(ho, "harness", [0, 0.004, -0.006], [0.004, 0.006, -0.022], LEAD.o, 0.0009, true);
    o.tips.harness = ho.tips.harness.clone().add(new T.Vector3(...HARNESS));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) standoff(g, sx * 0.06, 0.0012, 0.0365, sz * 0.078);
  }
  function buildTop(o) {
    const TH = [[0, -0.108, 0.034, 0.006], [-0.105, 0.012, 0.005, 0.03], [0.105, 0.012, 0.005, 0.03], [-0.036, 0.112, 0.016, 0.005], [0.036, 0.112, 0.016, 0.005]];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) TH.push([sx * 0.06, sz * 0.078, 0.0017], [sx * 0.1, sz * 0.112, 0.0022]);
    const pl = cfPlate(0.228, 0.254, TH, M.cfPlate.clone()); pl.material.transparent = true; pl.userData.plate = true; o.group.add(pl); sc.topPlate = pl;
    o.group.add(lathe([[0.0075, 0.0015], [0.0075, 0.0035], [0.0062, 0.0048], [0.0034, 0.0048], [0.0034, 0.0015]], M.aluLight, 32).translateZ(0.09)); // 마스트 받침(알루미늄 소켓)
    const fr = arrowDecal(0.016, 0.022, "", "#22262a"); fr.position.set(0, 0.0016, -0.1); o.group.add(fr);
  }
  // 붐대: 가운데가 원점, 바깥쪽 = +z (끝에 모터 마운트)
  // 붐대: 원통 카본 붐대(가운데가 원점, 바깥 = +z), 몸체 쪽 접이 관절, 끝에 모터 마운트와 분사 노즐
  function buildArm(o, part) {
    const g = o.group, alongZ = (m3) => { m3.rotation.x = Math.PI / 2; return m3; }, MZ = ARM_R - 0.14;
    const tubeM = new T.MeshPhysicalMaterial({ color: 0xffffff, map: (() => { const t = carbonTex.clone(); t.repeat.set(2, 10); t.needsUpdate = true; return t; })(), roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 });
    g.add(alongZ(cyl(0.012, 0.2, tubeM, 0, -0.002, 0, 32)));
    g.add(alongZ(cyl(0.0126, 0.024, part.color === "red" ? M.red : M.white, 0, -0.002, 0.04, 32))); // 앞(빨강)·뒤(흰색) 표시 띠
    // 접이 관절: 양쪽 튜브 클램프 + 경첩 몸체 + 피벗 볼트 + 잠금 슬리브
    for (const z of [-0.084, -0.056]) g.add(alongZ(cyl(0.0151, 0.012, M.alu, 0, -0.002, z, 40)));
    g.add(roundBox(0.03, 0.03, 0.03, M.alu, 0, -0.002, -0.07, 0.006));
    { const pv = cyl(0.0035, 0.038, M.steel, 0, -0.002, -0.07, 16); pv.rotation.z = Math.PI / 2; g.add(pv); for (const x of [-0.0195, 0.0195]) { const hd = cyl(0.0052, 0.003, M.dark, x, -0.002, -0.07, 6); hd.rotation.z = Math.PI / 2; g.add(hd); } }
    g.add(alongZ(cyl(0.0158, 0.014, M.accent, 0, -0.002, -0.045, 40))); // 잠금 슬리브
    for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2, rb = box(0.0012, 0.0012, 0.013, M.accent, Math.cos(a) * 0.0161, -0.002 + Math.sin(a) * 0.0161, -0.045); rb.rotation.z = a; g.add(rb); } // 미끄럼 방지 홈
    // 몸체 클램프 + 소켓 볼트
    g.add(roundBox(0.036, 0.028, 0.02, M.alu, 0, -0.002, -0.093, 0.005));
    for (const x of [-0.011, 0.011]) { g.add(cyl(0.0026, 0.0018, M.steel, x, 0.0129, -0.093, 20)); g.add(cyl(0.0012, 0.0008, M.dark, x, 0.0139, -0.093, 6)); }
    // 모터 마운트: 튜브 클램프 + 둥근 사각 장착판(구멍 4개)
    g.add(alongZ(cyl(0.0152, 0.032, M.alu, 0, -0.002, MZ, 40)));
    g.add(roundBox(0.03, 0.012, 0.03, M.alu, 0, 0.002, MZ, 0.004));
    g.add(roundBox(0.052, 0.006, 0.052, M.alu, 0, 0.007, MZ, 0.01));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.0019, 0.0062, M.core, sx * 0.0175, 0.0071, MZ + sz * 0.0175, 16));
    for (const x of [-0.0166, 0.0166]) { const b2 = cyl(0.0024, 0.006, M.steel, x, -0.004, MZ, 6); b2.rotation.z = Math.PI / 2; g.add(b2); } // 클램프 조임 볼트
    // 분사 노즐: 배관 + 노즐 몸체(육각) + 분사 팁, 붐대 아래로 지나는 호스
    g.add(cyl(0.0032, 0.016, M.aluLight, 0, -0.022, MZ, 16));
    g.add(cyl(0.0058, 0.006, M.dark, 0, -0.032, MZ, 6));
    g.add(lathe([[0.0046, 0], [0.0046, -0.002], [0.0028, -0.007], [0.0012, -0.009], [0, -0.009]], mat(0xd8dde0, { roughness: 0.3 }), 24).translateY(-0.035).translateZ(MZ));
    { const hc = new T.CatmullRomCurve3([new T.Vector3(0, -0.017, -0.06), new T.Vector3(0, -0.018, 0.02), new T.Vector3(0, -0.02, MZ - 0.014), new T.Vector3(0, -0.026, MZ - 0.004)]); g.add(new T.Mesh(new T.TubeGeometry(hc, 24, 0.0024, 10), mat(0x22252a, { roughness: 0.6 }))); }
  }
  // 스키드: 앞뒤로 긴 원통 레일 2개, 하판에 물리는 가로대 2개, 바깥으로 벌어진 굽은 다리 4개
  function buildSkid(o) {
    const g = o.group, r = 0.0065, RY = -(LEG - 0.0015 - 0.0065), RX = 0.13;
    const skM = new T.MeshPhysicalMaterial({ color: 0xffffff, map: (() => { const t = carbonTex.clone(); t.repeat.set(10, 1); t.needsUpdate = true; return t; })(), roughness: 0.32, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 });
    const tubeAlong = (pts, rr) => { const c = new T.CatmullRomCurve3(pts.map((p) => new T.Vector3(...p))); const m = new T.Mesh(new T.TubeGeometry(c, 40, rr, 20), skM); m.castShadow = m.receiveShadow = true; return m; };
    const rubber = mat(0x1a1a1a, { roughness: 0.85 });
    for (const sx of [-1, 1]) {
      g.add(tubeAlong([[sx * RX, RY, -0.18], [sx * RX, RY, 0.18]], r)); // 착지 레일
      for (const sz of [-1, 1]) { const cap = lathe([[0, 0], [r + 0.0012, 0], [r + 0.0014, 0.012], [r + 0.0006, 0.017], [0.003, 0.0195], [0, 0.02]], rubber, 24); cap.rotation.x = sz * Math.PI / 2; cap.position.set(sx * RX, RY, sz * 0.175); g.add(cap); } // 고무 발
      for (const sz of [-1, 1]) g.add(tubeAlong([[sx * 0.064, -0.006, sz * 0.1], [sx * 0.08, -0.04, sz * 0.1], [sx * 0.112, -0.085, sz * 0.1], [sx * RX, RY, sz * 0.1]], 0.0055)); // 다리
      for (const sz of [-1, 1]) { const cp = cyl(0.0092, 0.022, M.alu, sx * RX, RY, sz * 0.1, 32); cp.rotation.x = Math.PI / 2; g.add(cp, cyl(0.0078, 0.014, M.alu, sx * RX, RY + 0.009, sz * 0.1, 32)); const bt = cyl(0.0022, 0.022, M.steel, sx * RX, RY, sz * 0.1 + 0.008, 6); bt.rotation.z = Math.PI / 2; g.add(bt); } // T자 알루미늄 이음
      g.add(tubeAlong([[sx * 0.1, -0.06, -0.1], [sx * 0.1, -0.06, 0.1]], 0.004)); // 다리 사이 보강대
    }
    for (const sz of [-1, 1]) {
      g.add(tubeAlong([[-0.08, -0.006, sz * 0.1], [0.08, -0.006, sz * 0.1]], 0.0055));
      for (const sx of [-1, 1]) { g.add(roundBox(0.018, 0.011, 0.02, M.alu, sx * 0.045, -0.004, sz * 0.1, 0.003)); g.add(cyl(0.0022, 0.0014, M.steel, sx * 0.045, 0.0013, sz * 0.1, 16)); } // 하판 고정 클램프
    }
  }

  // 케이스(덮개): 상판 위를 덮는 유선형 셸, 위에 GPS 마스트가 지나는 구멍
  function buildCanopy(o) {
    const g = o.group, shell = new T.MeshPhysicalMaterial({ color: 0xeef1f2, roughness: 0.28, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.12, side: T.DoubleSide });
    const dome = new T.Mesh(new T.SphereGeometry(0.5, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), shell); dome.scale.set(0.21, 0.095, 0.26); dome.castShadow = dome.receiveShadow = true; g.add(dome);
    const skirt = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 0.008, 48, 1, true), shell); skirt.scale.set(0.21, 1, 0.26); skirt.position.y = 0.004; g.add(skirt);
    const stripe = new T.Mesh(new T.TorusGeometry(0.5, 0.012, 8, 64), mat(0xc8382e, { roughness: 0.35 })); stripe.rotation.x = Math.PI / 2; stripe.scale.set(0.212, 0.262, 1); stripe.position.y = 0.006; g.add(stripe);
    const vis = new T.Mesh(new T.SphereGeometry(0.5, 32, 12, -0.6, 1.2, 0.95, 0.45), mat(0x15181b, { roughness: 0.15, metalness: 0.4 })); vis.scale.set(0.215, 0.097, 0.265); vis.rotation.y = Math.PI; g.add(vis); // 앞쪽 검은 창
    g.add(cyl(0.012, 0.004, M.dark, 0, 0.046, 0.09, 24)); // GPS 마스트 구멍 링
    // 뒤쪽 냉각 통풍구(돔 표면을 따라 놓은 검은 슬릿)와 고정 노브
    for (let k = -3; k <= 3; k++) { const a = 0.55 + Math.abs(k) * 0.02, th = (k * 0.09), y = Math.cos(a) * 0.0475, rr = Math.sin(a) * 0.5; const sl = roundBox(0.0035, 0.0012, 0.022, mat(0x0d0f11, { roughness: 0.6 }), Math.sin(th) * rr * 0.21, y + 0.0004, Math.cos(th) * rr * 0.26, 0.0012); sl.rotation.y = th; sl.rotation.x = -a * 0.9; g.add(sl); }
    for (const sx of [-1, 1]) { g.add(cyl(0.006, 0.004, M.dark, sx * 0.098, 0.008, 0, 24)); g.add(cyl(0.0035, 0.0022, M.aluLight, sx * 0.098, 0.011, 0, 24)); }
  }

  // ---------- 장착 자리 (기체 기준 위치·방향) ----------
  const DECKPOS = { "deck:C": [0, 0.04, -0.012], "deck:L": [-0.077, 0.04, -0.035], "deck:R": [0.077, 0.04, -0.035], "deck:RL": [-0.074, 0.04, 0.058], "deck:RR": [0.074, 0.04, 0.058], mast: [0, 0.043, 0.09], "bot:C": [0, 0.0015, 0.004], "bot:L": [-0.078, 0.0015, 0], "bot:R": [0.078, 0.0015, 0], under: [0, -0.047, 0] };
  function slotXform(slot, part) {
    const [t, pos] = slot.split("@"), st = SIM.state;
    if (pos) {
      const p = SIM.POS[pos], ry = Math.atan2(p.x, p.z);
      if (t === "arm") return { p: [p.x * 0.14 * S2, 0, p.z * 0.14 * S2], ry };
      if (t === "motor") return { p: [p.x * ARM_R * S2, 0.01, p.z * ARM_R * S2], ry };
      if (t === "prop") { const fl = part && st.flip[part.id]; return { p: [p.x * ARM_R * S2, fl ? 0.093 : 0.085, p.z * ARM_R * S2], ry: 0, rx: fl ? Math.PI : 0 }; }
      return { p: [p.x * 0.088 * S2, 0.01, p.z * 0.088 * S2], ry };
    }
    const ry = part && (part.type === "fc" || part.type === "gps") ? (-st.rot[part.type] * Math.PI) / 2 : 0;
    if (slot === "frame:base") return { p: [0, 0, 0], ry: 0 };
    if (slot === "frame:top") return { p: [0, 0.0385, 0], ry: 0 };
    if (slot === "frame:skid") return { p: [0, -0.0015, 0], ry: 0 };
    if (slot === "frame:canopy") return { p: [0, 0.04, 0], ry: 0 };
    return { p: DECKPOS[slot], ry };
  }
  // 작업대 위 기본 보관 위치 (partsRoot 좌표)
  function homeOf(part) {
    const b = SIM.state.bench[part.id], by = { skid: 0.128, bottom: 0.0015, top: 0.0015, arm: 0.006 }[part.type] || 0;
    if (b) return { p: [b[0], by, b[1]], ry: part.type === "skid" ? Math.PI / 2 : 0 };
    const n = +(part.id.match(/\d+$/) || [1])[0] - 1;
    if (part.type === "bottom") return { p: [-0.52, 0.0015, -0.39], ry: 0 };
    if (part.type === "top") return { p: [-0.24, 0.0015, -0.39], ry: 0 };
    if (part.type === "arm") return { p: [0.12 + n * 0.055, 0.006, -0.39], ry: 0 };
    if (part.type === "skid") return { p: [0.56, 0.128, -0.38], ry: Math.PI / 2 };
    if (part.type === "canopy") return { p: [0.0, 0, -0.39], ry: 0 };
    if (part.type === "motor") return { p: [-0.66, 0, -0.17 + n * 0.11], ry: 0 };
    if (part.type === "esc") return { p: [-0.52, 0, -0.17 + n * 0.11], ry: 0 };
    if (part.type === "prop") return { p: [0.6, 0, -0.13 + n * 0.1], ry: 0 };
    const row = { fc: -0.42, pm: -0.3, battery: -0.17, gps: 0.0, rx: 0.12, telem: 0.22, buzzer: 0.31, switch: 0.39 };
    return { p: [row[part.type], 0, 0.41], ry: 0 };
  }
const BIND_MSG = { held: "바인드 버튼을 누르고 있습니다. 이 상태로 수신기에 전원을 넣으세요.", released: "바인드 버튼에서 손을 뗐습니다.", "": "수신기 바인드 대기 중 (LED 빠르게 깜빡임)" };
  const xfQuat = (x) => new T.Quaternion().setFromEuler(new T.Euler(x.rx || 0, x.ry, 0, "YXZ"));

  // ---------- 배선 그리기 ----------
  function tube(points, color, r) {
    const curve = new T.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new T.Vector3(p[0], p[1], p[2]))));
    const m = new T.Mesh(new T.TubeGeometry(curve, 24, r || 0.0013, 5), mat(color, { roughness: 0.8 }));
    m.castShadow = true;
    return m;
  }
  // 부품 좌표 → 기체 좌표 (장착된 목표 위치 기준이라 움직이는 중에도 선이 맞는다)
  function toDrone(o, v) {
    if (o.group.parent !== drone && o.group.userData.tp) { const g = o.group, w = v.clone().multiplyScalar(g.scale.x).applyQuaternion(g.userData.tq).add(g.userData.tp); return drone.worldToLocal(partsRoot.localToWorld(w)); }
    const g = o.group, s = g.scale.x;
    return v.clone().multiplyScalar(s).applyQuaternion(g.userData.tq).add(g.userData.tp);
  }
  const tipPos = (id, key) => toDrone(objs[id], /^pad[ABC]$/.test(key) ? objs[id].pads[key[3]] : objs[id].tips[key]);
  const padPos = (key, sgn) => new T.Vector3(PADS[key][sgn][0], 0.002, PADS[key][sgn][1]);
  const fcPortPos = (port) => toDrone(objs.fc, new T.Vector3(...(FC_PORT[port] || [0, 0.014, 0])));
  let curMeta = null; // 지금 그리는 선이 무엇인지 (누르면 정보창)
  function link(a, b, color, r) {
    if (SIM.has("canopy") && a.y > 0.035 && b.y > 0.035 && Math.abs(a.x) < 0.12 && Math.abs(b.x) < 0.12 && Math.abs(a.z) < 0.14 && Math.abs(b.z) < 0.14) return; // 케이스 안쪽 선은 가려진다
    const lift = Math.max(a.y, b.y) + 0.014;
    const pts = [a, new T.Vector3(a.x + (b.x - a.x) * 0.15, lift, a.z + (b.z - a.z) * 0.15), new T.Vector3(a.x + (b.x - a.x) * 0.85, lift, a.z + (b.z - a.z) * 0.85), b];
    wires.add(tube(pts, color, (r || 0.0013) * 1.3));
    if (curMeta) { const fat = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 16, 0.0045, 5), HIT); fat.userData.wire = curMeta; wires.add(fat); }
  }
  // 케이블 이름 → 선 끝 (부품, 팁)
  sc.cableTip = (c) => {
    if (c === "escTelem") return ["frameBot", "harness"];
    if (/^esc[A-Z]{2}$/.test(c)) { const p = SIM.partAt("esc@" + c.slice(3)); return p ? [p.id, "sig"] : null; }
    return { pm: ["pm", "fc"], gps: ["gps", "gps"], compass: ["gps", "compass"], telem: ["telem", "fc"], buzzer: ["buzzer", "fc"], switch: ["switch", "fc"], rx: ["rx", "sig"] }[c];
  };
  const CABLE_COL = { pm: 0xc8281e, gps: 0x3a78d8, compass: 0x8a5ad0, telem: 0xe0c020, buzzer: 0x202020, switch: 0xc8281e, rx: 0x2f9a4a, escTelem: 0xe88a20 };
  function rebuildWires() {
    while (wires.children.length) { const c = wires.children.pop(); c.geometry.dispose(); }
    curMeta = null;
    const w = SIM.state.wiring, fcIn = true, RED = 0xc8281e, BLK = 0x161616;
    for (const id of SIM.POS_IDS) {
      const escP = SIM.partAt("esc@" + id), mot = SIM.partAt("motor@" + id);
      if (!escP) continue;
      if (mot) for (let k = 1; k <= 3; k++) { const pad = w.motorWires[id][k]; curMeta = { label: SIM.POS[id].name + " 모터선 " + "①②③"[k - 1] + " → ESC 단자 " + pad, tip: { part: mot.id, key: "ph" + k } }; if (pad) link(tipPos(mot.id, "ph" + k), toDrone(objs[escP.id], objs[escP.id].pads[pad]), [0xe0c020, 0x2c6fd0, 0x2f9a4a][k - 1], 0.0015); }
      curMeta = { label: SIM.POS[id].name + " ESC 전원선 → PDB " + (SIM.escPowered(id) ? SIM.xtName(w.escPwr[id]) : ""), tip: { part: escP.id, key: "pwr" } };
      if (SIM.escPowered(id) && SIM.has("frameBot")) { const xi = SIM.XT_OF[id].indexOf(w.escPwr[id]), b = xtLocal(id, xi); link(tipPos(escP.id, "pwr"), b, RED, 0.0024); const t0 = tipPos(escP.id, "pwr"); link(t0.clone().add(new T.Vector3(0.002, 0, 0.002)), b.clone().add(new T.Vector3(0.002, 0, 0.002)), BLK, 0.0024); }
      curMeta = { label: SIM.POS[id].name + " ESC 통신선 → 하네스", tip: { part: escP.id, key: "tel" } };
      if (w.escTelem[id] === "harness" && SIM.has("frameBot")) link(tipPos(escP.id, "tel"), toDrone(objs.frameBot, new T.Vector3(HARNESS[0], 0.007, HARNESS[2])), 0xe88a20, 0.0009);
    }
    {
      const o = objs.rx, col = (rev) => (rev ? [0xf2f2f2, 0xc8281e, 0x161616] : [0x161616, 0xc8281e, 0xf2f2f2]);
      const end = tipPos("rx", "sig"), side = toDrone(o, new T.Vector3(0.004, 0, 0)).sub(toDrone(o, new T.Vector3(0, 0, 0))).normalize();
      const tri = (a, b, cols, plugA, plugB) => {
        for (let k = 0; k < 3; k++) { const off = side.clone().multiplyScalar((k - 1) * 0.0022); link(a.clone().add(off), b.clone().add(off), cols[k], 0.0009); }
        for (const [p, on] of [[a, plugA], [b, plugB]]) if (on) { const m = new T.Mesh(new T.BoxGeometry(0.008, 0.004, 0.006), mat(0x111111)); m.position.copy(p); wires.add(m); }
      };
      const ri = RX_COLS.indexOf(w.rxEnd);
      curMeta = { label: "수신기 3선 커넥터 (수신기 쪽 " + (w.rxEnd === "SB" ? "SBUS" : "CH" + w.rxEnd) + (w.rxRevRx ? ", 반대 방향" : "") + ")", tip: { part: "rx", key: "rxEnd" } };
      if (ri >= 0) tri(toDrone(o, new T.Vector3(rxColX(ri), 0.0145, -0.0175)), end, col(w.rxRevRx), true, true);
      else { const m = new T.Mesh(new T.BoxGeometry(0.008, 0.004, 0.006), mat(0x111111)); m.position.copy(end); wires.add(m); }
      curMeta = { label: "수신기 3선 커넥터 → FC " + w.plug.rx + (w.rxRevFc ? " (반대 방향)" : ""), tip: { part: "rx", key: "sig" } };
      if (fcIn && w.plug.rx && SIM.cableReady("rx")) tri(end, fcPortPos(w.plug.rx), col(w.rxRevFc), false, true);
    }
    if (fcIn) for (const c in w.plug) {
      if (c === "rx") continue;
      if (!w.plug[c] || !SIM.cableReady(c)) continue;
      const t = sc.cableTip(c); if (!t) continue;
      curMeta = { label: (SIM.CABLES[c].name) + " → FC " + w.plug[c], tip: { part: t[0], key: t[1] } };
      link(tipPos(t[0], t[1]), fcPortPos(w.plug[c]), /^esc[A-Z]/.test(c) ? 0xf2f2f2 : CABLE_COL[c], 0.0013);
    }
    const mainAt = () => toDrone(objs.frameBot, PDB_MAIN.clone().add(new T.Vector3(0, 0, 0.005)));
    const xtAt = (xt) => { for (const pid of SIM.POS_IDS) { const i = SIM.XT_OF[pid].indexOf(xt); if (i >= 0) return xtLocal(pid, i); } return mainAt(); };
    curMeta = { label: "PMU 출력 XT60 → PDB " + (w.pmOut === "ok" ? "주전원 XT60" : /^xt/.test(w.pmOut) ? SIM.xtName(w.pmOut) : ""), tip: { part: "pm", key: "out" } };
    if (SIM.has("pm") && w.pmOut && SIM.has("frameBot")) { const a0 = tipPos("pm", "out"), b0 = w.pmOut === "ok" ? mainAt() : xtAt(w.pmOut); link(a0, b0, RED, 0.0024); link(a0.clone().add(new T.Vector3(0.002, 0, 0.002)), b0.clone().add(new T.Vector3(0.002, 0, 0)), BLK, 0.0024); }
    curMeta = { label: "배터리 XT60 → " + (w.batt === "pm" ? "PMU 입력 XT60" : "PDB 주전원 XT60"), tip: { part: "battery", key: "xt" } };
    if (SIM.has("battery") && w.batt === "pm" && SIM.has("pm")) link(tipPos("battery", "xt"), toDrone(objs.pm, objs.pm.pads.in), RED, 0.003);
    if (SIM.has("battery") && w.batt === "pdb" && SIM.has("frameBot")) { const a0 = tipPos("battery", "xt"), b0 = mainAt(); link(a0, b0, RED, 0.003); link(a0.clone().add(new T.Vector3(0.002, 0, 0.002)), b0.clone().add(new T.Vector3(0.002, 0, 0)), BLK, 0.003); }
  }

  function rebuildExpect() {
    curMeta = null;
    while (expectGroup.children.length) expectGroup.remove(expectGroup.children[0]);
    if (!sc.showExpect) return;
    const f = SIM.frame();
    f.order.forEach((n, i) => {
      const m = f.motors[n], k = m.x && m.z ? S2 : 1;
      const s = textSprite(["모터 " + n + " (" + "ABCD"[i] + ")", m.spin === "cw" ? "↻ CW" : "↺ CCW"], "#ffd45e");
      s.position.set(m.x * ARM_R * k, 0.2, m.z * ARM_R * k);
      expectGroup.add(s);
    });
  }

  // 상태 → 3D 반영
  sc.sync = function () {
    for (const part of SIM.PARTS) {
      if (sc.drag && sc.drag.id === part.id && sc.drag.active) continue;
      const o = objs[part.id], g = o.group, slot = SIM.state.install[part.id];
      const x = slot ? slotXform(slot, part) : homeOf(part), parent = slot ? drone : partsRoot;
      if (g.parent !== parent) parent.attach(g);
      g.userData.tp = new T.Vector3(x.p[0], x.p[1], x.p[2]);
      g.userData.tq = xfQuat(x);
    }
    rebuildWires(); rebuildExpect(); syncScrews();
    const sel = SIM.selected && objs[SIM.selected];
    selBox.visible = !!sel && sc.env === "bench";
    if (sel) selBox.setFromObject(sel.group);
  };

  sc.setEnv = function (env) {
    sc.env = env;
    benchGroup.visible = partsRoot.visible = env === "bench";
    fieldGroup.visible = env === "field";
    sc.cancelPick();
    applyTheme();
    if (env === "bench") { orbit.target.set(0, 0.2 * KS, 0.16 * KS); orbit.dist = 2.75 * KS; orbit.theta = 0.3; orbit.phi = 0.86; sc.setPose("level"); drone.position.set(0, restY(), 0); drone.quaternion.identity(); }
    else { orbit.dist = 6 * KS; orbit.phi = 1.25; orbit.theta = 0.25; }
    sc.sync();
  };

  // 손으로 기체를 놓는 자세 (가속도계 교정용)
  const POSES = { level: [0, 0, 0], left: [0, 0, Math.PI / 2], right: [0, 0, -Math.PI / 2], nosedown: [-Math.PI / 2, 0, 0], noseup: [Math.PI / 2, 0, 0], back: [0, 0, Math.PI] };
  sc.setPose = function (name) {
    sc.poseName = name;
    const e = POSES[name];
    poseQ.setFromEuler(new T.Euler(e[0], e[1], e[2]));
    sc.lift = name === "level" ? 0 : 0.75;
  };
  sc.setTilt = function (rollDeg, pitchDeg) { // 센서 테스트용: 오른쪽 롤 +, 기수 들림 +
    poseQ.setFromEuler(new T.Euler((pitchDeg * Math.PI) / 180, 0, (-rollDeg * Math.PI) / 180, "YXZ"));
    sc.poseName = "free"; sc.lift = rollDeg || pitchDeg ? 0.45 : 0;
  };

  function applyTheme() {
    const cs = getComputedStyle(document.documentElement);
    const c = cs.getPropertyValue(sc.env === "field" ? "--sky" : "--scene").trim() || "#dfe6e4";
    const H = hdri[sc.env === "field" ? "field" : "bench"];
    if (H) scene.environment = H.env;
    scene.environmentIntensity = sc.env === "field" ? 0.4 : 0.9;
    if (hemi) hemi.intensity = sc.env === "field" ? 0.25 : 0.5;
    if (H && sc.env !== "field") { scene.background = H.bg; scene.backgroundBlurriness = 0.55; scene.backgroundIntensity = 0.55; }
    else { scene.background = new T.Color(c); scene.backgroundBlurriness = 0; scene.backgroundIntensity = 1; }
    scene.fog = sc.env === "field" ? new T.Fog(c, 60, 220) : null;
  }

  // ---------- 실사 환경광(HDRI, Poly Haven CC0): 작업장 / 야외 하늘 ----------
  function loadHdri() {
    const A = T.addons; if (!A || !A.EXRLoader) return;
    const pm = new T.PMREMGenerator(renderer);
    for (const [k, f] of [["bench", "assets/hdri/workshop.exr"], ["field", "assets/hdri/sky.exr"]]) {
      new A.EXRLoader().load(f, (tex) => { tex.mapping = T.EquirectangularReflectionMapping; hdri[k] = { bg: tex, env: pm.fromEquirectangular(tex).texture }; applyTheme(); }, undefined, () => {});
    }
  }
  // ---------- 후처리: 주변광 차폐(GTAO) · 빛 번짐(Bloom) · 톤매핑 출력, MSAA ----------
  function setupPost(w, h) {
    const A = T.addons; if (!A || !A.EffectComposer) return;
    try {
      const rt = new T.WebGLRenderTarget(w, h, { type: T.HalfFloatType, samples: 4 });
      composer = new A.EffectComposer(renderer, rt);
      composer.addPass(new A.RenderPass(scene, camera));
      gtao = new A.GTAOPass(scene, camera, w, h);
      gtao.updateGtaoMaterial({ radius: 0.12 * K, distanceExponent: 1.6, thickness: 0.6 * K, scale: 1.0, samples: 16 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      gtao.blendIntensity = 0.85;
      // 보이지 않는 클릭 영역·글자판·투명 효과는 그림자(차폐) 계산에서 뺀다
      const ov = gtao.overrideVisibility.bind(gtao);
      gtao.overrideVisibility = function () { ov(); scene.traverse((o) => { const m = o.material; if (o.isSprite || m === HIT || (m && m.transparent && m.opacity < 0.5) || (m && m.depthTest === false)) o.visible = false; }); };
      composer.addPass(gtao);
      bloom = new A.UnrealBloomPass(new T.Vector2(w, h), 0.18, 0.35, 0.95);
      composer.addPass(bloom);
      composer.addPass(new A.OutputPass());
    } catch (e) { composer = null; }
  }
  sc.post = () => ({ composer: !!composer, gtao: !!(gtao && gtao.enabled), bloom: !!(bloom && bloom.enabled), hdri: Object.keys(hdri) });

  // ---------- 초기화 ----------
  sc.init = function (canvas) {
    stageEl = canvas.parentElement;
    renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    camera = sc.camera = new T.PerspectiveCamera(42, 1, 0.02, 400);
    // 반사용 환경광: 밝은 천장·창 패널이 있는 작업장 (금속·클리어코트에 비친다)
    try {
      const env = new T.Scene(), pm = new T.PMREMGenerator(renderer);
      const room = new T.Mesh(new T.SphereGeometry(10, 32, 16), new T.MeshBasicMaterial({ side: T.BackSide, vertexColors: true }));
      const cols = [], pos = room.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 10, c = new T.Color().setHSL(0.55, 0.08, 0.35 + 0.45 * Math.max(0, y)); cols.push(c.r, c.g, c.b); }
      room.geometry.setAttribute("color", new T.Float32BufferAttribute(cols, 3)); env.add(room);
      for (const [x, z, w] of [[0, 0, 6], [5, 3, 2], [-5, -2, 2.5]]) { const p = new T.Mesh(new T.PlaneGeometry(w, w * 0.5), new T.MeshBasicMaterial({ color: 0xffffff })); p.position.set(x, 8, z); p.rotation.x = Math.PI / 2; env.add(p); }
      scene.environment = pm.fromScene(env, 0.04).texture; pm.dispose(); // 실사 HDRI를 불러오기 전 임시 환경광
    } catch (e) {}
    loadHdri();
    hemi = new T.HemisphereLight(0xffffff, 0x556060, 0.5); scene.add(hemi);
    sun = new T.DirectionalLight(0xfff3e2, 2.6);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    Object.assign(sun.shadow.camera, { left: -3 * KS, right: 3 * KS, top: 3 * KS, bottom: -3 * KS, near: 0.1, far: 16 * KS });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
    scene.add(sun, sun.target);

    // 작업대
    benchGroup = new T.Group();
    const wood = canvasTex(512, 256, (g, W, H) => { g.fillStyle = "#8a6646"; g.fillRect(0, 0, W, H); for (let i = 0; i < 90; i++) { g.strokeStyle = "rgba(" + (60 + Math.random() * 40) + "," + (40 + Math.random() * 25) + ",20," + (0.15 + Math.random() * 0.2) + ")"; g.lineWidth = 1 + Math.random() * 2; g.beginPath(); const y0 = Math.random() * H; g.moveTo(0, y0); for (let x = 0; x <= W; x += 32) g.lineTo(x, y0 + Math.sin(x * 0.02 + i) * 4); g.stroke(); } });
    const top = box(4.0 * KS, 0.08, 2.9 * KS, new T.MeshPhysicalMaterial({ map: wood, normalMap: normalFrom(wood.image, 3), normalScale: new T.Vector2(0.6, 0.6), roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.4 }), 0, -0.044, 0); top.castShadow = false;
    const matTex = canvasTex(1024, 640, (g, W, H) => {
      g.fillStyle = "#1d6b55"; g.fillRect(0, 0, W, H);
      for (let i = 0; i <= 36; i++) { g.strokeStyle = i % 5 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.34)"; g.lineWidth = i % 5 ? 1 : 2; g.beginPath(); g.moveTo((i * W) / 36, 0); g.lineTo((i * W) / 36, H); g.stroke(); }
      for (let i = 0; i <= 22; i++) { g.strokeStyle = i % 5 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.34)"; g.lineWidth = i % 5 ? 1 : 2; g.beginPath(); g.moveTo(0, (i * H) / 22); g.lineTo(W, (i * H) / 22); g.stroke(); }
      g.fillStyle = "rgba(255,255,255,0.55)"; g.font = "bold 13px sans-serif"; g.textAlign = "center";
      for (let i = 5; i < 36; i += 5) { g.fillText(String(i), (i * W) / 36, 16); g.fillText(String(i), (i * W) / 36, H - 6); }
      g.textAlign = "left"; for (let i = 5; i < 22; i += 5) g.fillText(String(i), 5, (i * H) / 22 - 4);
      g.strokeStyle = "rgba(255,255,255,0.18)"; g.lineWidth = 1.5; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(0, H); g.lineTo(H, 0); g.moveTo(W - H, 0); g.lineTo(W, H); g.stroke(); g.setLineDash([]);
    });
    const pad = mesh(new T.BoxGeometry(3.4 * KS, 0.004, 2.4 * KS), new T.MeshStandardMaterial({ map: matTex, roughness: 0.85 }), 0, -0.002, 0); pad.castShadow = false;
    benchGroup.add(top, pad);
    scene.add(benchGroup);

    // 시험장
    fieldGroup = new T.Group();
    const grass = canvasTex(256, 256, (g, W, H) => { g.fillStyle = "#4f7a45"; g.fillRect(0, 0, W, H); for (let i = 0; i < 5000; i++) { const l = 30 + Math.random() * 22, h = 95 + Math.random() * 20; g.fillStyle = "hsl(" + h + ",32%," + l + "%)"; g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 2 + Math.random() * 4); } });
    grass.wrapS = grass.wrapT = T.RepeatWrapping; grass.repeat.set(160, 160);
    const ground = mesh(new T.PlaneGeometry(600, 600), new T.MeshStandardMaterial({ map: grass, normalMap: normalFrom(grass.image, 2, grass.repeat), normalScale: new T.Vector2(0.5, 0.5), roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.castShadow = false;
    const grid = new T.GridHelper(200, 100, 0xffffff, 0xffffff); grid.material.opacity = 0.07; grid.material.transparent = true; grid.position.y = 0.004;
    const padTex = canvasTex(256, 256, (g) => { g.fillStyle = "#30363a"; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill(); g.strokeStyle = "#ffd45e"; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.stroke(); g.fillStyle = "#fff"; g.font = "bold 130px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("H", 128, 136); });
    const hp = new T.Mesh(new T.PlaneGeometry(3 * KS, 3 * KS), new T.MeshStandardMaterial({ map: padTex, transparent: true, roughness: 0.9 })); hp.rotation.x = -Math.PI / 2; hp.position.y = 0.006; hp.receiveShadow = true;
    fieldGroup.add(ground, grid, hp);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, r = i % 2 ? 10 : 5; const cone = mesh(new T.ConeGeometry(0.12, 0.4, 12), mat(0xe8672c), Math.sin(a) * r, 0.2, Math.cos(a) * r); fieldGroup.add(cone); }
    for (const z of [-20, -40]) fieldGroup.add(box(0.15, 4, 0.15, M.white, 0, 2, z), box(1.2, 0.5, 0.05, M.red, 0, 3.6, z));
    fieldGroup.visible = false;
    scene.add(fieldGroup);

    drone = new T.Group(); sc.drone = drone;
    drone.position.set(0, REST_Y, 0); drone.scale.setScalar(K);
    wires = new T.Group(); expectGroup = new T.Group();
    drone.add(wires, expectGroup);
    partsRoot = new T.Group(); partsRoot.scale.setScalar(K);
    scene.add(drone, partsRoot);
    for (const part of SIM.PARTS) { const g = makePart(part), h = homeOf(part); g.position.set(h.p[0], h.p[1], h.p[2]); partsRoot.add(g); }
    buildTx();
    // 프로펠러 바람(공기 흐름) 표시
    for (const id of SIM.POS_IDS) {
      const g = new T.Group(); g.position.set(SIM.POS[id].x * ARM_R * S2, 0.088, SIM.POS[id].z * ARM_R * S2); drone.add(g);
      const m = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
      for (let i = 0; i < 12; i++) { const a = i * 2.4, r = 0.03 + (i % 6) * 0.02; const st = new T.Mesh(new T.BoxGeometry(0.003, 0.03, 0.003), m); st.raycast = () => {}; st.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); st.userData.ph = i / 12; g.add(st); }
      air[id] = { g, m };
      for (const d of ["cw", "ccw"]) { const ar = spinArrow(d); ar.scale.setScalar(3.2); ar.position.set(SIM.POS[id].x * ARM_R * S2, 0.13, SIM.POS[id].z * ARM_R * S2); ar.visible = false; ar.raycast = () => {}; ar.renderOrder = 15; ar.material.depthTest = false; drone.add(ar); air[id][d] = ar;
        const lb = textSprite(d === "cw" ? ["↻ CW", "시계 방향"] : ["↺ CCW", "반시계 방향"], "#ffd45e"); lb.scale.set(0.09, 0.045, 1); lb.position.set(SIM.POS[id].x * ARM_R * S2, 0.17, SIM.POS[id].z * ARM_R * S2); lb.visible = false; lb.raycast = () => {}; drone.add(lb); air[id][d + "L"] = lb; }
    }
    selBox = new T.BoxHelper(drone, 0xffb020); selBox.visible = false; scene.add(selBox);
    snapRing = new T.Mesh(new T.TorusGeometry(0.05, 0.004, 8, 40), new T.MeshBasicMaterial({ color: 0xffd45e, depthTest: false, transparent: true, opacity: 0.9 }));
    snapRing.rotation.x = -Math.PI / 2; snapRing.renderOrder = 20; snapRing.visible = false; scene.add(snapRing);

    applyTheme();
    try {
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
      new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    } catch (e) {}
    bindPointer(canvas);
    setupPost(canvas.clientWidth || 300, canvas.clientHeight || 200);
    const resize = () => { const w = canvas.clientWidth || 300, h = canvas.clientHeight || 200; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); } };
    try { const ro = new ResizeObserver(resize); ro.observe(stageEl); ro.observe(canvas); } catch (e) {} window.addEventListener("resize", resize);
    resize();
    sc.sync();
    SIM.on(sc.sync);
  };

  // ---------- 나사 케이스와 육각렌치 (작업대 오른쪽 앞) ----------
  const toolObjs = {};
  function buildTools() {
    const cs = new T.Group(); cs.position.set(0.0, 0, -0.4); cs.userData.tool = true; partsRoot.add(cs);
    cs.add(box(0.21, 0.004, 0.1, mat(0x2b3a46), 0, 0.002, 0));
    const wall = mat(0x3d5262);
    for (const x of [-0.105, -0.035, 0.035, 0.105]) cs.add(box(0.003, 0.016, 0.1, wall, x, 0.008, 0));
    for (const z of [-0.05, 0.05]) cs.add(box(0.21, 0.016, 0.003, wall, 0, 0.008, z));
    SIM.SCREW_SIZES.forEach((size, i) => {
      const cx = -0.07 + i * 0.07, r = headR(size);
      for (let k = 0; k < 9; k++) { // 칸 안에 흩어진 나사
        const sc2 = new T.Group(); sc2.add(cyl(r, 0.0012, M.dark, 0, 0, 0, 14), cyl(r * 0.55, 0.006, M.steel, 0, 0, 0.0035, 10).rotateX(Math.PI / 2));
        sc2.position.set(cx + ((k % 3) - 1) * 0.016, 0.006, -0.02 + Math.floor(k / 3) * 0.018); sc2.rotation.y = k * 1.3; cs.add(sc2);
      }
      const lb = nameplate("M" + size, 0.036, 0.012, "#e8eef2", "#1b2630"); lb.position.set(cx, 0.0045, 0.038); cs.add(lb);
      const hit = mesh(new T.BoxGeometry(0.068, 0.03, 0.098), HIT, cx, 0.012, 0); hit.userData.bin = size; cs.add(hit);
      toolObjs["bin" + size] = cs;
    });
    // 육각렌치 3개 (L자, 굵기가 크기마다 다르다)
    SIM.SCREW_SIZES.forEach((size, i) => {
      const kg = new T.Group(), t = +size * 0.0011, z = -0.325 + i * 0.042; kg.userData.tool = true;
      kg.position.set(-0.07, t / 2, z);
      const steel = mat(0x8d969c, { metalness: 0.7, roughness: 0.35 });
      const long = new T.Mesh(new T.CylinderGeometry(t, t, 0.11, 6), steel); long.rotation.z = Math.PI / 2; long.position.x = 0.055; long.castShadow = true;
      const short = new T.Mesh(new T.CylinderGeometry(t, t, 0.03, 6), steel); short.rotation.x = Math.PI / 2; short.position.set(0, 0, -0.015); short.castShadow = true;
      kg.add(long, short); kg.userData.mat = steel;
      const lb = nameplate(size, 0.014, 0.008, "#f2d23c", "#1a1a1a"); lb.position.set(0.122, t + 0.0005, 0); kg.add(lb);
      const hit = mesh(new T.BoxGeometry(0.15, 0.02, 0.024), HIT, 0.05, 0.004, -0.004); hit.userData.key = size; kg.add(hit);
      partsRoot.add(kg); toolObjs["key" + size] = kg;
    });
  }
  // ---------- 조종기 (TX12 형태) ----------
  // 조종기(게임패드형 송신기): 둥근 셸 + 그립, LCD 베젤, 짐벌(먼지 덮개·널링 스틱), 토글 스위치, 버튼, 접이 손잡이·안테나
  function buildTx() {
    const g = new T.Group(); g.position.set(-0.4, 0, 0.24); g.rotation.y = 0.25; g.userData.tool = true; partsRoot.add(g);
    const shellM = new T.MeshPhysicalMaterial({ color: new T.Color(0x2b2e33), roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.5 });
    const gripM = new T.MeshStandardMaterial({ color: new T.Color(0x1a1b1d), roughness: 0.9 });
    // 위에서 본 외곽선 (앞 = -z, 사람 쪽 = +z 그립)
    const sh = new T.Shape();
    sh.moveTo(-0.07, -0.042); sh.quadraticCurveTo(0, -0.05, 0.07, -0.042); sh.quadraticCurveTo(0.09, -0.04, 0.092, -0.012);
    sh.bezierCurveTo(0.095, 0.03, 0.1, 0.075, 0.075, 0.082); sh.quadraticCurveTo(0.055, 0.086, 0.048, 0.06);
    sh.quadraticCurveTo(0.04, 0.035, 0, 0.034); sh.quadraticCurveTo(-0.04, 0.035, -0.048, 0.06); sh.quadraticCurveTo(-0.055, 0.086, -0.075, 0.082);
    sh.bezierCurveTo(-0.1, 0.075, -0.095, 0.03, -0.092, -0.012); sh.quadraticCurveTo(-0.09, -0.04, -0.07, -0.042);
    const bodyG = new T.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 5, curveSegments: 24 });
    bodyG.rotateX(Math.PI / 2); bodyG.translate(0, 0.034, 0); // 윗면 y≈0.04, 아랫면 y≈0.006
    const body = new T.Mesh(bodyG, shellM); body.castShadow = body.receiveShadow = true; g.add(body);
    for (const sx of [-1, 1]) { const gp = roundBox(0.03, 0.026, 0.04, gripM, sx * 0.074, 0.018, 0.058, 0.01); gp.rotation.x = 0.15; g.add(gp); } // 고무 그립
    // LCD: 유광 베젤 + 화면(글자)
    g.add(roundBox(0.066, 0.003, 0.04, new T.MeshPhysicalMaterial({ color: 0x0c0d0f, roughness: 0.15, clearcoat: 1 }), 0, 0.0405, -0.014, 0.004));
    const lcd = canvasTex(256, 150, (c, W, H) => { c.fillStyle = "#9fb3a6"; c.fillRect(0, 0, W, H); c.fillStyle = "#1d2a22"; c.font = "bold 22px monospace"; c.fillText("QUAD", 12, 30); c.fillText("7.6V", W - 70, 30); c.fillRect(0, 40, W, 2); c.font = "bold 46px monospace"; c.fillText("MODEL", 50, 98); c.font = "18px monospace"; c.fillText("TMR 00:00", 12, 136); c.fillText("RSSI --", W - 92, 136); });
    const scr = new T.Mesh(new T.PlaneGeometry(0.056, 0.032), new T.MeshStandardMaterial({ map: lcd, roughness: 0.25, emissive: 0x222b25, emissiveMap: lcd, emissiveIntensity: 0.6 })); scr.rotation.x = -Math.PI / 2; scr.position.set(0, 0.0422, -0.014); g.add(scr);
    // 버튼: SYS·MDL·TEL(왼쪽), PAGE·RTN(오른쪽), 가운데 전원
    const btnM = new T.MeshPhysicalMaterial({ color: 0x18191b, roughness: 0.4, clearcoat: 0.6 });
    for (const [x, z] of [[-0.044, -0.03], [-0.044, -0.021], [-0.044, -0.012], [0.044, -0.03], [0.044, -0.021]]) g.add(lathe([[0, 0], [0.0032, 0], [0.0032, 0.0012], [0.0026, 0.0018], [0, 0.0019]], btnM, 20).translateX(x).translateY(0.04).translateZ(z));
    g.add(lathe([[0, 0], [0.0042, 0], [0.0042, 0.0012], [0.0034, 0.002], [0, 0.0021]], btnM, 24).translateX(0.044).translateY(0.04).translateZ(-0.009)); // ENT 휠
    g.add(lathe([[0, 0], [0.004, 0], [0.004, 0.0014], [0, 0.0016]], M.glow(0x3c7cff), 24).translateY(0.04).translateZ(0.012)); // 전원 버튼(LED)
    // 짐벌: 둥근 홈 + 고무 먼지 덮개 + 스틱 + 널링 끝, 옆 트림 버튼
    for (const sx of [-1, 1]) {
      const gx = sx * 0.058, gz = 0.016;
      g.add(lathe([[0.0205, 0.039], [0.0215, 0.0405], [0.019, 0.0402], [0.017, 0.038]], M.plastic, 40).translateX(gx).translateZ(gz));
      g.add(lathe([[0, 0.0395], [0.0168, 0.0385], [0.016, 0.0402], [0.012, 0.0428], [0.006, 0.0446], [0.003, 0.0452], [0, 0.0452]], M.rubber, 40).translateX(gx).translateZ(gz));
      g.add(cyl(0.0024, 0.024, M.steel, gx, 0.056, gz, 16));
      g.add(lathe([[0, 0.066], [0.0055, 0.066], [0.0062, 0.068], [0.0062, 0.074], [0.0055, 0.0755], [0, 0.0758]], M.aluLight, 24).translateX(gx).translateZ(gz));
      for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, r2 = box(0.0008, 0.0062, 0.0008, M.dark, gx + Math.cos(a) * 0.0063, 0.0712, gz + Math.sin(a) * 0.0063); g.add(r2); } // 널링
      g.add(roundBox(0.004, 0.002, 0.012, btnM, gx + sx * 0.027, 0.0405, gz, 0.0015), roundBox(0.012, 0.002, 0.004, btnM, gx, 0.0405, gz + 0.026, 0.0015)); // 트림
      // 위쪽 토글 스위치 2개(SA·SB / SC·SD)
      for (const k of [0, 1]) { const x = sx * (0.04 + k * 0.026); g.add(lathe([[0, 0.04], [0.0042, 0.04], [0.0042, 0.0435], [0.0028, 0.045], [0, 0.045]], M.aluLight, 6).translateX(x).translateZ(-0.036)); const lv = cyl(0.0015, 0.016, M.steel, x, 0.052, -0.036, 12); lv.rotation.x = -0.35; g.add(lv); g.add(cyl(0.0024, 0.004, M.dark, x, 0.059, -0.0386, 12).rotateX(-0.35)); const sl = nameplate(["SA", "SB", "SC", "SD"][(sx < 0 ? 0 : 2) + k], 0.008, 0.0035, null, "#d8dedc"); sl.position.set(x, 0.0405, -0.028); g.add(sl); }
    }
    // 접이 손잡이(튜브)와 접이 안테나
    { const hc = new T.CatmullRomCurve3([new T.Vector3(-0.038, 0.034, -0.046), new T.Vector3(-0.034, 0.05, -0.06), new T.Vector3(0, 0.056, -0.066), new T.Vector3(0.034, 0.05, -0.06), new T.Vector3(0.038, 0.034, -0.046)]); const hm = new T.Mesh(new T.TubeGeometry(hc, 40, 0.0045, 14), M.plastic); hm.castShadow = true; g.add(hm); }
    g.add(lathe([[0, 0], [0.005, 0], [0.005, 0.006], [0, 0.006]], M.plastic, 20).translateX(0.072).translateY(0.036).translateZ(-0.04));
    { const ag = new T.Group(); ag.position.set(0.072, 0.042, -0.04); ag.rotation.z = -0.3; ag.add(lathe([[0, 0], [0.0042, 0], [0.0046, 0.01], [0.004, 0.05], [0.003, 0.062], [0, 0.063]], M.rubber, 20)); g.add(ag); }
    const lb = nameplate("TX12", 0.018, 0.006, null, "#e8ecec"); lb.position.set(0, 0.0408, 0.026); g.add(lb);
    const hit = mesh(new T.BoxGeometry(0.2, 0.08, 0.14), HIT, 0, 0.035, 0.015); hit.userData.txBox = true; g.add(hit);
    toolObjs.tx = g;
  }

  // 손에 든 것: 나사 한 개(크기) 또는 육각렌치(크기)
  sc.held = null;
  function setHeld(h) {
    sc.held = h;
    for (const size of SIM.SCREW_SIZES) { const k = toolObjs["key" + size]; k.userData.mat.emissive.setHex(h && h.kind === "key" && h.size === size ? 0xb07a00 : 0x000000); }
    if (sc.onHover) sc.onHover("");
  }
  const heldLabel = () => (sc.held ? (sc.held.kind === "key" ? sc.held.size + " 육각렌치" : "M" + sc.held.size + " 나사") : "");

  // ---------- 화면 좌표 ----------
  const _v = new T.Vector3();
  function toScreen(world) {
    _v.copy(world).project(camera);
    const cv = renderer.domElement; return { x: ((_v.x + 1) / 2) * cv.clientWidth, y: ((1 - _v.y) / 2) * cv.clientHeight, vis: _v.z < 1 };
  }
  sc.screenOf = (id) => { const g = objs[id].group, b = new T.Box3().setFromObject(g), c = b.getCenter(new T.Vector3()); c.y = b.max.y; return toScreen(c); };

  // ---------- 선 연결 ----------
  // 지금 이 선 끝이 연결된 상태를 끊는다
  function disconnect(tip) {
    const w = SIM.state.wiring, id = tip.part, k = tip.key, slot = SIM.state.install[id] || "", pos = slot.split("@")[1];
    if (k === "harness") w.plug.escTelem = "";
    else if (k === "rxEnd") w.rxEnd = "";
    else if (/^ph\d$/.test(k)) w.motorWires[pos][k[2]] = "";
    else if (/^pad[ABC]$/.test(k)) { const m = w.motorWires[pos]; for (const n of [1, 2, 3]) if (m[n] === k[3]) m[n] = ""; } // ESC 단자에서 시작: 그 단자에 꽂힌 모터선을 뺀다
    else if (k === "pwr") w.escPwr[pos] = "";
    else if (k === "tel") w.escTelem[pos] = "";
    else if (k === "out") w.pmOut = "";
    else if (k === "xt") w.batt = "";
    else { const c = tipCable(tip); if (c) w.plug[c] = ""; }
  }
  const tipCableOf = (t) => tipCable(t);
  // 하판(PDB)에 꽂는 선: ESC 전원선·통신선, PMU 출력선, 배터리 선
  function pdbCable(tip) { const pt = SIM.part(tip.part); return !!pt && ((pt.type === "esc" && (tip.key === "pwr" || tip.key === "tel")) || (pt.type === "pm" && tip.key === "out") || (pt.type === "battery" && tip.key === "xt")); }
  sc.pdbCable = pdbCable;
  function tipCable(tip) {
    if (tip.key === "harness") return "escTelem";
    const part = SIM.part(tip.part);
    if (part.type === "esc" && tip.key === "sig") return "esc" + SIM.state.install[part.id].split("@")[1];
    if (part.type === "gps") return tip.key;
    if (["pm", "rx", "telem", "buzzer", "switch"].includes(part.type) && (tip.key === "fc" || tip.key === "sig")) return part.id;
    return null;
  }
  // 끌던 선을 FC 근처에 놓으면 화면에서 가장 가까운 포트에 꽂는다 (작은 핀도 쉽게)
  function nearestPort(cx, cy) {
    const o = objs.fc; if (!o || !o.ports) return null;
    if (SIM.has("canopy") && /^deck:/.test(SIM.state.install.fc || "")) return null; // 케이스를 씌우면 상판 위 FC 포트에 손이 닿지 않는다
    const r = renderer.domElement.getBoundingClientRect(), mx = cx - r.left, my = cy - r.top, wp = new T.Vector3();
    let best = null, bd = 34;
    for (const m of o.ports) { m.getWorldPosition(wp); const sp = toScreen(wp); const d = Math.hypot(sp.x - mx, sp.y - my); if (sp.vis && d < bd) { bd = d; best = m.userData.target; } }
    return best;
  }
  // 모터선 ↔ ESC 단자: 같은 붐대에서 화면상 가장 가까운 상대 끝에 붙는다
  function nearestPhase(cx, cy) {
    const tip = sc.pick, pos = (SIM.state.install[tip.part] || "").split("@")[1]; if (!pos) return null;
    const r = renderer.domElement.getBoundingClientRect(), mx = cx - r.left, my = cy - r.top, wp = new T.Vector3();
    let best = null, bd = 46;
    const consider = (o, local, tg) => { wp.copy(local); o.group.localToWorld(wp); const sp = toScreen(wp), d = Math.hypot(sp.x - mx, sp.y - my); if (sp.vis && d < bd) { bd = d; best = tg; } };
    if (/^ph/.test(tip.key)) { const e2 = SIM.partAt("esc@" + pos); if (e2) for (const p of ["A", "B", "C"]) consider(objs[e2.id], objs[e2.id].pads[p], { kind: "escPad", part: e2.id, pad: p, label: "ESC 단자 " + p }); }
    else { const m2 = SIM.partAt("motor@" + pos); if (m2) for (const k of [1, 2, 3]) consider(objs[m2.id], objs[m2.id].tips["ph" + k], { kind: "motorPh", part: m2.id, k, label: "모터선 " + "①②③"[k - 1] }); }
    return best;
  }
  sc.disconnectTip = (tip) => { disconnect(tip); SIM.emit(); };
  sc.startTip = (tip) => { if (!objs[tip.part] || !objs[tip.part].tips[tip.key]) return; startPick(tip); SIM.toast("연결할 곳을 누르세요 (Esc: 취소)"); }; // 팝업의 '선 연결' 버튼
  // 카메라를 부드럽게 옮긴다: FC 확대 → 포트를 꽂거나 취소하면 원래 시점으로
  function zoomFc() {
    const g = objs.fc.group, c = new T.Box3().setFromObject(g).getCenter(new T.Vector3());
    if (!sc.camPrev) sc.camPrev = { target: orbit.target.clone(), dist: orbit.dist, phi: orbit.phi, theta: orbit.theta };
    sc.camGoal = { target: c, dist: 0.75 * KS, phi: 0.42, theta: Math.PI }; sc.fcZoom = true; // 앞쪽 위에서 내려다보아 뒤쪽 GPS에 가리지 않게
  }
  function restoreCam() { if (sc.camPrev) { sc.camGoal = sc.camPrev; sc.camPrev = null; } sc.fcZoom = false; }
  sc.cancelPick = () => { if (sc.fcZoom) restoreCam(); sc.pick = null; sc.wireDrag = false; sc._lastWire = null; if (livePlug) livePlug.visible = false; if (liveWire) { liveWire.geometry.dispose(); drone.remove(liveWire); liveWire = null; } if (sc.onHover) sc.onHover(""); };
  function startPick(tip) {
    disconnect(tip);
    sc.pick = tip;
    SIM.select(null);
    SIM.emit();
  }
  function finishPick(tg) {
    const tip = sc.pick, w = SIM.state.wiring, part = SIM.part(tip.part);
    const pos = (SIM.state.install[tip.part] || "").split("@")[1];
    const say = (m) => SIM.toast(m, "bad");
    const ok = (t) => { if (SIM.sfx) SIM.sfx(t || "plug"); };
    // 전원·모터 배선은 기체에 장착한 부품끼리만 닿는다 (작업대 위에서는 안내만)
    if (["escPad", "motorPh", "xt", "pdbMain", "pdb", "harness", "pmIn"].includes(tg.kind)) {
      if (!SIM.state.install[tip.part]) return say("먼저 " + part.name + "을(를) 기체에 장착한 뒤 연결하세요.");
      if (tg.part && SIM.part(tg.part) && !SIM.state.install[tg.part]) return say("먼저 " + SIM.part(tg.part).name + "을(를) 기체에 장착한 뒤 연결하세요.");
    }
    if (tg.kind === "escPad") {
      if (part.type !== "motor") return say(part.type === "esc" ? "단자끼리는 연결하지 않습니다. 모터선 끝에 놓으세요." : "이 선은 ESC 단자에 연결하지 않습니다.");
      const escPos = SIM.state.install[tg.part].split("@")[1];
      if (escPos !== pos) return say("선이 닿지 않습니다.");
      w.motorWires[pos][tip.key[2]] = tg.pad; ok("plug");
    } else if (tg.kind === "pdbMain") { // XT60은 모양이 맞아 거꾸로 꽂히지 않는다
      if (part.type === "pm" && tip.key === "out") SIM.setPmXt("ok");
      else if (part.type === "battery") w.batt = "pdb";
      else return say("커넥터가 맞지 않습니다.");
      ok("xt");
    } else if (tg.kind === "motorPh") { // ESC 단자를 끌어 모터선 끝에 연결
      if (!(part.type === "esc" && /^pad/.test(tip.key))) return say("커넥터가 맞지 않습니다.");
      const mPos = SIM.state.install[tg.part].split("@")[1]; if (mPos !== pos) return say("선이 닿지 않습니다.");
      w.motorWires[pos][tg.k] = tip.key[3]; ok("plug");
    } else if (tg.kind === "xt") {
      if (part.type === "pm" && tip.key === "out") { SIM.setPmXt(tg.xt); ok("xt"); sc.cancelPick(); return; } // PMU 출력은 빈 XT60F 단자에도
      if (!(part.type === "esc" && tip.key === "pwr")) return say("커넥터가 맞지 않습니다.");
      if (tg.pos !== pos) return say("선이 닿지 않습니다.");
      SIM.setEscXt(pos, tg.xt); ok("xt"); sc.cancelPick(); return;
    } else if (tg.kind === "pmIn") {
      if (part.type !== "battery") return say("커넥터가 맞지 않습니다.");
      w.batt = "pm"; ok("xt");
    } else if (tg.kind === "harness") {
      if (!(part.type === "esc" && tip.key === "tel")) return say("커넥터가 맞지 않습니다.");
      w.escTelem[pos] = "harness"; ok("plug");
    } else if (tg.kind === "fcPort") {
      const c = tipCable(tip);
      if (!c) return say("이 선은 FC에 꽂지 않습니다.");
      if (SIM.CABLES[c].conn !== SIM.portType(tg.port)) return say("커넥터 모양이 맞지 않아 " + tg.port + "에 들어가지 않습니다.");
      SIM.setPlug(c, tg.port); ok("plug"); restoreCam();
    } else if (tg.kind === "fc") { // 선을 든 채 FC를 누르면 FC 세부 보기(포트 배치)를 열어 꽂을 포트를 고르게 한다
      const c = tipCable(tip);
      if (!c) return say("이 선은 FC에 꽂지 않습니다.");
      if (SIM.has("canopy") && /^deck:/.test(SIM.state.install.fc || "")) return say("케이스를 먼저 벗기세요.");
      return approach(tg, null, () => { if (sc.onFcCable) sc.onFcCable(c, true); });
    } else if (tg.kind === "rxDetail") {
      return approach(tg, null, () => { if (sc.onRxCable) sc.onRxCable(); });
    } else if (tg.kind === "pdb") { // 하판에 꽂는 선을 든 채 하판을 누르면 PDB 세부 보기에서 자리를 고른다
      if (!pdbCable(tip)) return say("이 선은 하판(PDB)에 꽂지 않습니다.");
      return approach(tg, null, () => { if (sc.onPdbCable) sc.onPdbCable(tip); });
    }
    sc.cancelPick(); SIM.emit();
  }
  function drawLiveWire(worldPoint, tg) {
    if (!sc.pick) return;
    { const o = objs[sc.pick.part], k = sc.pick.key; if (!o || !(/^pad[ABC]$/.test(k) ? o.pads[k[3]] : o.tips[k])) return; } // 3D 선 끝이 없는 선(수신기 쪽 핀 등)
    if (tg && tg.kind === "fcPort") worldPoint = drone.localToWorld(fcPortPos(tg.port));
    if (tg && tg.kind === "escPad") worldPoint = objs[tg.part].group.localToWorld(objs[tg.part].pads[tg.pad].clone());
    if (tg && tg.kind === "motorPh") worldPoint = objs[tg.part].group.localToWorld(objs[tg.part].tips["ph" + tg.k].clone());
    if (!worldPoint) return;
    if (liveWire) { liveWire.geometry.dispose(); drone.remove(liveWire); }
    const a = tipPos(sc.pick.part, sc.pick.key), b = drone.worldToLocal(worldPoint.clone()), lift = Math.max(a.y, b.y) + 0.01;
    liveWire = tube([a, new T.Vector3((a.x + b.x) / 2, lift, (a.z + b.z) / 2), b], 0xffd45e, 0.0014);
    drone.add(liveWire); sc._lastWire = worldPoint.clone();
    // 선 끝 커넥터: 들고 가는 플러그 (XT60은 노란색, 신호선은 흰 하우징)
    const xt = pdbCable(sc.pick);
    if (!livePlug || livePlug.userData.xt !== xt) { if (livePlug) drone.remove(livePlug); livePlug = new T.Mesh(new T.BoxGeometry(xt ? 0.008 : 0.006, xt ? 0.0055 : 0.003, xt ? 0.0075 : 0.004), xt ? M.yellow : M.housing); livePlug.userData.xt = xt; livePlug.raycast = () => {}; drone.add(livePlug); }
    livePlug.position.copy(b); livePlug.visible = true;
    const dir = b.clone().sub(new T.Vector3((a.x + b.x) / 2, lift, (a.z + b.z) / 2)); livePlug.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
  }
  // 선을 든 채 FC·하판·수신기를 누르면: 커넥터가 선을 끌고 그곳으로 다가가고 카메라도 따라 다가간 뒤 세부 화면을 연다
  function approach(tg, point, done) {
    const tip = sc.pick, o = objs[tip.part];
    if (!o || !o.tips[tip.key]) { sc.cancelPick(); done(); SIM.emit(); return; } // 3D 선 끝이 없는 선은 바로 세부 화면으로
    let to = point ? point.clone() : null;
    const top = (id) => { const bb = new T.Box3().setFromObject(objs[id].group), c = bb.getCenter(new T.Vector3()); c.y = bb.max.y + 0.01 * K; return c; };
    if (tg.kind === "fc" || (tg.kind === "rxDetail" && SIM.state.install.fc && tip.key === "sig")) to = top("fc");
    else if (tg.kind === "pdb" && (tip.key === "out" || tip.key === "xt")) to = objs.frameBot.group.localToWorld(PDB_MAIN.clone());
    else if (tg.kind === "pmIn") to = objs.pm.group.localToWorld(objs.pm.pads.in.clone());
    if (!to) to = top(tg.part && objs[tg.part] ? tg.part : tip.part);
    const from = sc._lastWire ? sc._lastWire.clone() : o.group.localToWorld(o.tips[tip.key].clone());
    if (!sc.camPrev) sc.camPrev = { target: orbit.target.clone(), dist: orbit.dist, phi: orbit.phi, theta: orbit.theta };
    sc.camGoal = { target: to.clone(), dist: Math.min(orbit.dist, 0.9 * KS), phi: Math.min(orbit.phi, 0.7), theta: orbit.theta };
    sc.detailCam = true; sc.anim = { t: 0, dur: 0.85, from, to, done }; sc._keep = true; sc.wireDrag = false;
    snapRing.visible = true; snapRing.position.copy(to);
    if (sc.onHover) sc.onHover("");
  }
  function stepApproach(dt) {
    const A = sc.anim; if (!A) return;
    A.t += dt; const u = Math.min(1, A.t / A.dur), e2 = u * u * (3 - 2 * u);
    const pnt = A.from.clone().lerp(A.to, e2); pnt.y += Math.sin(Math.PI * e2) * 0.05 * K; // 들어 올렸다가 내려놓는 궤적
    drawLiveWire(pnt, null);
    snapRing.scale.setScalar(1 + 0.25 * Math.sin(A.t * 14)); // 도착 지점 표시
    if (u >= 1) { sc.anim = null; snapRing.visible = false; snapRing.scale.setScalar(1); const d = A.done; sc.cancelPick(); d(); SIM.emit(); }
  }
  sc.restoreCam = () => { if (sc.detailCam) { sc.detailCam = false; restoreCam(); } };

  // ---------- 조작: 회전·확대, 부품 끌기, 선 연결 ----------
  function bindPointer(canvas) {
    const pts = new Map(); let moved = 0, pinch = 0, down = null;
    const ray = new T.Raycaster(), v2 = new T.Vector2(), plane = new T.Plane(new T.Vector3(0, 1, 0), 0), hitP = new T.Vector3();
    const setRay = (e) => { const r = canvas.getBoundingClientRect(); v2.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(v2, camera); };
    const partOf = (o) => { while (o && !o.userData.partId) o = o.parent; return o && o.userData.partId; };
    function pickAt(e) {
      setRay(e);
      const list = [partsRoot, drone];
      if (sc.held) { // 나사·렌치를 들고 있을 때: 케이스·렌치를 직접 눌렀는지 먼저 보고, 아니면 화면에서 가장 가까운 구멍
        const th = ray.intersectObjects(Object.values(toolObjs), true).find((x) => x.object.userData.bin || x.object.userData.key);
        if (th) return th.object.userData.bin ? { bin: th.object.userData.bin, point: th.point } : { key: th.object.userData.key, point: th.point };
        const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, wp = new T.Vector3();
        let best = null, bd = 22;
        for (const hm of holeHit) { const key = hm.userData.hole; if (!SIM.state.install[key.split(":")[0]]) continue; hm.getWorldPosition(wp); const sp = toScreen(wp); const d = Math.hypot(sp.x - mx, sp.y - my); if (sp.vis && d < bd) { bd = d; best = { hole: key, point: wp.clone() }; } }
        if (best) return best;
      }
      const see = sc.xray || !!sc.pick;
      if (sc.pick && /^(ph\d|pad[ABC])$/.test(sc.pick.key)) { const np = nearestPhase(e.clientX, e.clientY); if (np) return { target: np, point: null }; }
      // 맞은 순서(카메라에서 가까운 순)대로: 가장 바깥에 있는 물체가 클릭된다. 뒤에 가려진 부품·선 끝은 눌리지 않는다
      const isTool = (o) => { while (o) { if (o.userData.tool) return true; o = o.parent; } return false; };
      const hits = ray.intersectObjects(list, true).filter((h) => {
        const o = h.object; if (o === liveWire || o === snapRing || !o.visible) return false;
        if (see && o === sc.topPlate) return false; // 투시(반투명) 중인 상판은 지나간다
        if (o.material !== HIT && (wires.children.includes(o) || expectGroup.children.includes(o))) return false; // 보이는 선은 넓은 클릭 영역(HIT)으로 판정
        return o.material === HIT || !isTool(o); // 장식(조종기 몸체 등)은 지나가되 클릭 영역은 남긴다
      });
      const real = (h) => h.object.material !== HIT || !!h.object.userData.tip; // 실제 모양 또는 선 끝
      // 작은 부품의 넉넉한 클릭 상자: 상자 안쪽에서 처음 만나는 실제 물체를 고르고, 없으면 그 부품
      const resolveBox = (k, pid) => { for (let n = k + 1; n < hits.length; n++) { const h2 = hits[n]; if (!real(h2)) continue; if (h2.object.userData.tip) return { tip: h2.object.userData.tip, point: h2.point }; return { part: partOf(h2.object) || pid, point: h2.point }; } return { part: pid, point: hits[k].point }; };
      if (!sc.pick) {
        for (let k = 0; k < hits.length; k++) {
          const h = hits[k], o = h.object, ud = o.userData;
          if (o.material === HIT) {
            if (ud.txBox) return { txBox: true, point: h.point };
            if (ud.bin) return { bin: ud.bin, point: h.point };
            if (ud.key) return { key: ud.key, point: h.point };
            if (ud.hole) { if (SIM.state.install[ud.hole.split(":")[0]]) return { hole: ud.hole, point: h.point }; continue; }
            if (ud.bind) return { bind: true, part: ud.bind, point: h.point };
            if (ud.tip) return { tip: ud.tip, point: h.point }; // 작업대 위 부품의 선 끝도 집을 수 있다
            if (ud.wire) return { wire: ud.wire, point: h.point };
            if (ud.partHit) return resolveBox(k, ud.partHit);
            if (ud.target) { const id = partOf(o); if (id) return { part: id, point: h.point }; }
            continue;
          }
          const id = partOf(o);
          return id ? { part: id, point: h.point } : { frame: true, point: h.point };
        }
        return { point: ray.ray.intersectPlane(plane, hitP) ? hitP.clone() : null };
      }
      // 선을 든 채: 가장 바깥 물체가 단자·포트면 거기에, 부품이면 그 부품의 세부 보기로 (가려진 곳은 지나가지 않는다)
      const tip = sc.pick;
      const mapPart = (id, point) => {
        if (!id) return null;
        if (tip.part === "rx" && (id === "rx" || id === "fc")) return { target: { kind: "rxDetail", label: "수신기 ↔ FC 배선 · 자리 고르기" }, point };
        if (id === "fc" && tipCableOf(tip)) return { target: { kind: "fc", part: "fc", label: "비행 컨트롤러 · 포트 고르기" }, point };
        if (id === "pm" && SIM.part(tip.part).type === "battery") return { target: { kind: "pmIn", part: "pm", label: "PMU 입력 커넥터" }, point };
        if (pdbCable(tip) && SIM.state.install.frameBot && (id === "frameBot" || id === "frameTop" || /^bot:/.test(SIM.state.install[id] || ""))) return { target: { kind: "pdb", part: "frameBot", label: "하판(PDB) · 자리 고르기" }, point };
        return null;
      };
      for (let k = 0; k < hits.length; k++) {
        const h = hits[k], o = h.object, ud = o.userData;
        if (o.material === HIT) {
          if (ud.target) { const tg = ud.target; if (!tg.part || SIM.state.install[tg.part] || tg.kind === "fcPort" || tg.kind === "fc") return { target: tg, point: h.point }; const m2 = mapPart(partOf(o), h.point); if (m2) return m2; continue; }
          if (ud.tip) { if (ud.tip.part === tip.part && ud.tip.key === tip.key) continue; const m2 = mapPart(ud.tip.part, h.point); return m2 || { tip: ud.tip, point: h.point }; }
          if (ud.partHit) { const r2 = resolveBox(k, ud.partHit); if (r2.tip) return mapPart(r2.tip.part, r2.point) || r2; return mapPart(r2.part, r2.point) || { point: r2.point, blocked: r2.part }; }
          continue;
        }
        return mapPart(partOf(o), h.point) || { point: h.point, blocked: partOf(o) || "frame" }; // 다른 물체에 가로막힘
      }
      return { point: ray.ray.intersectPlane(plane, hitP) ? hitP.clone() : null };
    }
    const canEdit = () => sc.env === "bench" && !sc.dragDrone && !SIM.flight.active;
    sc._pickAt = pickAt; // 점검용

    canvas.addEventListener("pointerdown", (e) => {
      if (sc.anim) return; // 다가가는 동작 중에는 입력을 받지 않는다
      canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; pinch = 0;
      down = null;
      if (pts.size === 1 && canEdit() && !sc.pick && !sc.held) { const h = pickAt(e); if (h.tip) down = { tip: h.tip }; else if (h.part) down = { id: h.part }; }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (sc.anim) return;
      const p = pts.get(e.pointerId);
      if (!p) { // 버튼을 누르지 않은 이동: 커서 모양과 연결 미리보기
        if (!canEdit()) return;
        const h = pickAt(e);
        canvas.style.cursor = sc.pick ? (h.target ? "copy" : "crosshair") : h.tip || h.bin || h.key || h.hole || h.txBox ? "pointer" : h.part ? "grab" : "default";
        if (sc.pick) drawLiveWire(h.point, h.target);
        if (sc.held) { canvas.style.cursor = h.hole ? "copy" : "crosshair"; if (sc.onHover) sc.onHover(heldLabel(), e.clientX, e.clientY); return; }
        if (sc.onHover) sc.onHover(sc.pick ? (h.target ? h.target.label : "") : h.bin ? "M" + h.bin + " 나사" : h.key ? h.key + " 육각렌치" : h.txBox ? "조종기 (TX12)" : "", e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) orbit.dist = clampDist(orbit.dist * (pinch / d));
        pinch = d; moved = 99; down = null; return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      if (down && down.tip && moved > 4) { // 선 끝을 끌어서 연결
        if (!sc.wireDrag) { startPick(down.tip); sc.wireDrag = true; }
        const h = pickAt(e); drawLiveWire(h.point, h.target);
        if (sc.onHover) sc.onHover(h.target ? h.target.label : "", e.clientX, e.clientY);
        return;
      }
      if (down && down.id && moved > 4) { dragMove(e); if (down) return; }
      if (moved < 0) return; // 분리할 수 없는 부품을 끌던 중: 시점도 돌리지 않는다
      if (down) return;
      if (sc.dragDrone && sc.env === "bench") {
        const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), dx * 0.01).multiply(new T.Quaternion().setFromAxisAngle(right, dy * 0.01));
        poseQ.premultiply(q); sc.poseName = "free"; sc.lift = 0.75;
      } else {
        orbit.theta -= dx * 0.008;
        orbit.phi = Math.min(1.52, Math.max(0.12, orbit.phi - dy * 0.008));
      }
    });
    // 부품 끌기: 가까운 장착 자리에 붙고, 없으면 작업대 위에 내려놓는다
    function dragMove(e) {
      const id = down.id, part = SIM.part(id), o = objs[id], g = o.group;
      if (!sc.drag) {
        const deps = SIM.state.install[id] ? SIM.dependents(SIM.state.install[id]) : [];
        if (deps.length && part.type === "motor") deps.forEach((d) => (SIM.state.install[d.id] = null)); // 모터를 떼면 위의 프로펠러는 작업대로
        else if (deps.length) { SIM.toast("먼저 " + deps.map((d) => d.name).join(", ") + "을(를) 분리하세요.", "bad"); down = null; moved = -1e9; return; }
        sc.drag = { id, active: true, slot: null };
        if (SIM.state.install[id]) SIM.remove(id);
        SIM.select(null);
        if (g.parent !== partsRoot) partsRoot.attach(g);
        canvas.style.cursor = "grabbing";
      }
      setRay(e);
      const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 64;
      for (const slot of SIM.slotsFor(part)) {
        if (SIM.canInstall(part, slot)) continue;
        const x = slotXform(slot, part), wp = drone.localToWorld(new T.Vector3(...x.p)), s = toScreen(wp), d = Math.hypot(s.x - mx, s.y - my);
        if (d < bd) { bd = d; best = { slot, x, wp }; }
      }
      sc.drag.slot = best && best.slot;
      if (best) {
        g.userData.tp = partsRoot.worldToLocal(best.wp.clone()); g.userData.tq = xfQuat(best.x);
        snapRing.visible = true; snapRing.position.copy(best.wp); snapRing.position.y += 0.01;
        if (sc.onHover) sc.onHover(SIM.slotName(best.slot), e.clientX, e.clientY);
        rebuildWires();
      } else {
        snapRing.visible = false;
        plane.constant = 0;
        if (ray.ray.intersectPlane(plane, hitP)) {
          const l = partsRoot.worldToLocal(hitP.clone());
          l.x = Math.max(-0.75, Math.min(0.75, l.x)); l.z = Math.max(-0.52, Math.min(0.52, l.z)); l.y = 0.03;
          g.userData.tp = l; g.userData.tq = new T.Quaternion();
        }
        rebuildWires(); // 끌고 있는 부품에 꽂힌 선이 따라온다
        if (sc.onHover) sc.onHover("", e.clientX, e.clientY);
      }
    }
    function dragEnd() {
      const d = sc.drag; sc.drag = null; snapRing.visible = false;
      if (sc.onHover) sc.onHover("");
      canvas.style.cursor = "grab";
      if (d.slot) { const err = SIM.install(d.id, d.slot); if (err) SIM.toast(err, "bad"); else SIM.sfx && SIM.sfx("mount"); }
      else { const t = objs[d.id].group.userData.tp; SIM.placeOnBench(d.id, +t.x.toFixed(3), +t.z.toFixed(3)); }
    }
    const up = (e) => {
      if (sc.anim) { pts.delete(e.pointerId); return; }
      pts.delete(e.pointerId);
      if (sc.drag) { dragEnd(); down = null; return; }
      if (sc.wireDrag) { // 끌던 선을 놓은 자리
        const h = pickAt(e); down = null;
        if (h.target) finishPick(h.target); else { sc.cancelPick(); SIM.emit(); }
        if (sc.pick && !sc._keep) { sc.cancelPick(); SIM.emit(); }
        sc._keep = false;
        return;
      }
      down = null;
      if (moved > 6 || e.type !== "pointerup" || !canEdit()) return;
      const h = pickAt(e);
      if (sc.pick) {
        if (h.target) finishPick(h.target);
        else if (h.tip) { sc.cancelPick(); startPick(h.tip); }
        else if (h.blocked) { const bp = SIM.part(h.blocked); SIM.toast((bp ? bp.name : "그곳") + "에는 이 선을 연결할 수 없습니다. 연결할 곳이 가려져 있으면 시점을 돌리거나 위 부품을 먼저 떼세요.", "bad"); } // 선은 계속 들고 있다
        else { sc.cancelPick(); SIM.emit(); }
        return;
      }
      if (sc.held) { // 나사를 끼우거나 렌치로 조이기·풀기
        if (h.hole) {
          const cur = SIM.state.screws[h.hole];
          if (sc.held.kind === "screw") { if (cur) return SIM.toast("이미 나사가 있습니다.", "bad"); const err = SIM.putScrew(h.hole, sc.held.size); if (err) SIM.toast(err, "bad"); }
          else { const r = SIM.turnScrew(h.hole, sc.held.size); if (r !== "tightened" && r !== "loosened") SIM.toast(r, "bad"); }
          return;
        }
        if (h.bin && sc.held.kind === "screw") return setHeld({ kind: "screw", size: h.bin });
        if (h.key) return setHeld(sc.held.kind === "key" && sc.held.size === h.key ? null : { kind: "key", size: h.key });
        return setHeld(null);
      }
      if (h.txBox) { if (sc.onTx) sc.onTx(); return; }
      if (h.bin) return setHeld({ kind: "screw", size: h.bin });
      if (h.key) return setHeld({ kind: "key", size: h.key });
      if (h.hole) { if (SIM.state.screws[h.hole]) { const err = SIM.takeScrew(h.hole); if (err) SIM.toast(err, "bad"); } else if (sc.onPick) sc.onPick(h.hole.split(":")[0]); return; }
      if (h.tip) return startPick(h.tip);
      if (h.wire) { if (sc.onWire) sc.onWire(h.wire, e.clientX, e.clientY); return; }
      if (h.bind) { sc.bindPressUntil = performance.now() + 250; if (SIM.sfx) SIM.sfx("plug"); if (!SIM.state.install.rx) { SIM.toast("수신기를 기체에 장착하고 전원을 넣은 뒤 누르세요."); return; } const r = SIM.bindRx(); SIM.toast(BIND_MSG[r] !== undefined ? BIND_MSG[r] : r, BIND_MSG[r] !== undefined ? "" : "bad"); return; }
      if (sc.onPick) sc.onPick(h.part || null);
    };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("dblclick", (e) => { if (!pickAt(e).part) sc.home(); });
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); orbit.dist = clampDist(orbit.dist * Math.exp(e.deltaY * 0.001)); }, { passive: false });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sc.anim) { if (sc.pick) { sc.cancelPick(); SIM.emit(); } if (sc.held) setHeld(null); } });
  }
  const clampDist = (d) => Math.min(sc.env === "field" ? 60 : 7 * KS, Math.max(0.35, d));
  sc.zoom = (f) => { orbit.dist = clampDist(orbit.dist * f); };
  sc.view = (name) => {
    const v = { top: [0, 0.12], front: [Math.PI, 1.3], back: [0, 1.15], side: [Math.PI / 2, 1.3] }[name];
    orbit.theta = v[0]; orbit.phi = v[1];
  };
  // 선택한 부품 쪽으로 시점 이동
  sc.focus = (id) => { const g = objs[id] && objs[id].group; if (!g) return; const c = new T.Box3().setFromObject(g).getCenter(new T.Vector3()); orbit.target.copy(c); orbit.dist = Math.min(orbit.dist, 1.2 * KS); };
  sc.home = () => { orbit.target.set(0, 0.2 * KS, 0.16 * KS); orbit.dist = 2.75 * KS; orbit.theta = 0.3; orbit.phi = 0.86; };

  const tmpQ = new T.Quaternion(), yAxis = new T.Vector3(0, 1, 0);
  let airT = 0;
  // 느린 컴퓨터에서는 화질을 자동으로 낮춘다 (픽셀 밀도·그림자 해상도)
  let perfT = 0, perfN = 0, perfLow = false;
  function adaptQuality(dt) {
    if (perfLow) return; perfT += dt; perfN++;
    if (perfT > 3) { const avg = perfT / perfN; perfT = 0; perfN = 0;
      if (avg > 1 / 30 && gtao && gtao.enabled) { gtao.enabled = false; bloom.enabled = false; return; } // 1단계: 후처리 끄기
      if (avg > 1 / 24) { perfLow = true; renderer.setPixelRatio(1); renderer.shadowMap.type = T.PCFShadowMap; sun.shadow.mapSize.set(1024, 1024); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } window.dispatchEvent(new Event("resize")); } }
  }
  function tweenCam(dt) {
    const gl = sc.camGoal; if (!gl) return;
    const k = 1 - Math.exp(-7 * dt);
    orbit.target.lerp(gl.target, k); orbit.dist += (gl.dist - orbit.dist) * k; orbit.phi += (gl.phi - orbit.phi) * k;
    let dth = gl.theta - orbit.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth)); orbit.theta += dth * k;
    if (orbit.target.distanceTo(gl.target) < 0.002 && Math.abs(gl.dist - orbit.dist) < 0.002 && Math.abs(gl.phi - orbit.phi) < 0.002) sc.camGoal = null;
  }
  // ---------- FC 과전압 효과: 불꽃(가산 스프라이트)·섬광(점광원)·연기·그을음 ----------
  const fx = { parts: [], lastSpark: 0, lastBurn: 0, burnLeft: 0, smokeT: 0, light: null, scorch: false };
  const dotTex = (inner, outer) => canvasTex(64, 64, (c) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(0.4, outer); gr.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gr; c.fillRect(0, 0, 64, 64); });
  let sparkTex, smokeTex;
  const fcTop = () => { const bb = new T.Box3().setFromObject(objs.fc.group), c = bb.getCenter(new T.Vector3()); c.y = bb.max.y; return c; };
  function spawnSparks(n, big) {
    sparkTex = sparkTex || dotTex("rgba(255,255,230,1)", "rgba(255,170,40,0.9)");
    const o = fcTop();
    for (let i = 0; i < n; i++) {
      const m = new T.SpriteMaterial({ map: sparkTex, color: new T.Color().setHSL(0.08 + Math.random() * 0.06, 1, 0.6), transparent: true, depthWrite: false, blending: T.AdditiveBlending });
      const sp = new T.Sprite(m), s0 = (0.01 + Math.random() * 0.018) * (big ? 1.6 : 1); sp.scale.set(s0, s0, 1); sp.raycast = () => {}; sp.renderOrder = 30;
      sp.position.copy(o).add(new T.Vector3((Math.random() - 0.5) * 0.12, 0.005, (Math.random() - 0.5) * 0.2));
      const a = Math.random() * Math.PI * 2, up = 0.6 + Math.random() * (big ? 2.2 : 1.2), side = 0.3 + Math.random() * (big ? 1.4 : 0.8);
      scene.add(sp); fx.parts.push({ sp, v: new T.Vector3(Math.cos(a) * side, up, Math.sin(a) * side), life: 0.35 + Math.random() * (big ? 0.9 : 0.5), age: 0, kind: "spark", s0 });
    }
    if (!fx.light) { fx.light = new T.PointLight(0xffa040, 0, 3, 2); scene.add(fx.light); }
    fx.light.position.copy(o).add(new T.Vector3(0, 0.08, 0)); fx.light.intensity = big ? 9 : 5;
  }
  function spawnSmoke(heavy) {
    smokeTex = smokeTex || dotTex("rgba(55,55,58,0.95)", "rgba(70,70,74,0.5)");
    const o = fcTop(), m = new T.SpriteMaterial({ map: smokeTex, color: 0x5a5a5e, transparent: true, opacity: heavy ? 0.85 : 0.55, depthWrite: false });
    const sp = new T.Sprite(m), s0 = 0.06 + Math.random() * 0.05; sp.scale.set(s0, s0, 1); sp.raycast = () => {}; sp.renderOrder = 25;
    sp.position.copy(o).add(new T.Vector3((Math.random() - 0.5) * 0.1, 0.01, (Math.random() - 0.5) * 0.16)); scene.add(sp);
    fx.parts.push({ sp, v: new T.Vector3((Math.random() - 0.5) * 0.08, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.08), life: 2.6 + Math.random() * 1.6, age: 0, kind: "smoke", s0, op: m.opacity });
  }
  function stepFx(dt) {
    if (SIM.sparkAt && SIM.sparkAt !== fx.lastSpark) { fx.lastSpark = SIM.sparkAt; spawnSparks(10 + Math.floor(Math.random() * 10), false); }
    if (SIM.burnAt && SIM.burnAt !== fx.lastBurn) { fx.lastBurn = SIM.burnAt; fx.burnLeft = 1.4; spawnSparks(70, true); }
    if (fx.burnLeft > 0) { fx.burnLeft -= dt; if (Math.random() < 0.45) spawnSparks(8, true); }
    const burned = SIM.state.fcBurned;
    if (burned) { fx.smokeT -= dt; const heavy = SIM.burnAt && performance.now() - fx.lastBurn < 60000; if (fx.smokeT <= 0) { spawnSmoke(heavy); fx.smokeT = heavy ? 0.12 : 0.35; } }
    // 그을음: 타 버린 FC는 표면 전체가 검게 그을린다 (원래 재질은 보관했다가 초기화 시 되돌림)
    if (burned !== !!fx.scorch) {
      fx.scorch = burned;
      objs.fc.group.traverse((m) => { if (!m.isMesh || m.material === HIT) return; if (burned) { m.userData.mat0 = m.material; const c = m.material.clone(); if (c.color) c.color.multiplyScalar(0.28).lerp(new T.Color(0x2a1a0c), 0.25); if (c.emissive) c.emissiveIntensity = 0; if ("roughness" in c) c.roughness = 0.95; if ("clearcoat" in c) c.clearcoat = 0; m.material = c; } else if (m.userData.mat0) { m.material.dispose(); m.material = m.userData.mat0; delete m.userData.mat0; } });
    }
    if (fx.light && fx.light.intensity > 0) fx.light.intensity = Math.max(0, fx.light.intensity - dt * 40);
    for (let i = fx.parts.length - 1; i >= 0; i--) {
      const q = fx.parts[i]; q.age += dt; const u = q.age / q.life;
      if (u >= 1) { scene.remove(q.sp); q.sp.material.dispose(); fx.parts.splice(i, 1); continue; }
      if (q.kind === "spark") { q.v.y -= 5 * dt; q.sp.position.addScaledVector(q.v, dt); q.sp.material.opacity = 1 - u; }
      else { q.sp.position.addScaledVector(q.v, dt); const k = q.s0 * (1 + u * 3); q.sp.scale.set(k, k, 1); q.sp.material.opacity = q.op * (1 - u); }
    }
  }
  sc.fxCount = () => fx.parts.length;

  sc.update = function (dt, skipRender) {
    stepApproach(dt);
    stepFx(dt);
    tweenCam(dt);
    adaptQuality(dt);
    const k = 1 - Math.exp(-12 * dt);
    for (const part of SIM.PARTS) {
      const g = objs[part.id].group;
      if (g.userData.tp) { g.position.lerp(g.userData.tp, k); g.quaternion.slerp(g.userData.tq, k); }
    }
    if (!SIM.flight.active) {
      if (sc.tumble > 0) {
        sc.tumble -= dt;
        const t = sc.tumble;
        tmpQ.setFromAxisAngle(new T.Vector3(Math.sin(t * 0.9), Math.cos(t * 1.3), Math.sin(t * 0.5 + 1)).normalize(), dt * 2.6);
        poseQ.premultiply(tmpQ); sc.poseName = "free"; sc.lift = 0.75;
      }
      drone.quaternion.slerp(poseQ, k);
      drone.position.lerp(new T.Vector3(0, restY() + sc.lift, 0), k);
    }
    // 모터·프로펠러 회전 표시 (방향이 보이도록 눈에 보이는 속도는 제한)
    for (const id of SIM.POS_IDS) {
      const u = SIM.motorU[id], ph = SIM.motorPhysical(id), s = ph.dir === "ccw" ? 1 : -1;
      const m = SIM.partAt("motor@" + id), pr = SIM.partAt("prop@" + id);
      const rate = u > 0.01 ? s * (3 + 22 * u) * dt : 0;
      if (m) objs[m.id].spinner.rotateOnAxis(yAxis, ph.jitter && (SIM.motorCmd[id] || 0) > 0.02 ? (Math.random() - 0.5) * 0.25 : rate);
      if (pr) { objs[pr.id].spinner.rotateOnAxis(yAxis, rate); objs[pr.id].disc.material.opacity = Math.min(0.3, u * 0.6); }
      if (pr) objs[pr.id].group.visible = !(SIM.flight.active && SIM.flight.lost[id]);
      const A = air[id], flow = pr && u > 0.03 ? ph.thrust : 0;
      const showSpin = u > 0.03 && m && !SIM.flight.active; A.cw.visible = A.cwL.visible = showSpin && ph.dir === "cw"; A.ccw.visible = A.ccwL.visible = showSpin && ph.dir === "ccw";
      if (showSpin) A[ph.dir].rotation.z += (ph.dir === "ccw" ? 1 : -1) * dt * 3; // 추력 방향과 반대로 공기가 흐른다
      A.m.opacity = flow ? Math.min(0.55, 0.2 + u) * Math.min(1, Math.abs(flow) + 0.3) : 0;
      if (flow) { airT += dt * (0.6 + 2 * u) * 0.25; A.g.children.forEach((c) => { const t = (c.userData.ph + airT) % 1; c.position.y = flow > 0 ? -0.01 - t * 0.14 : 0.02 + t * 0.14; }); }
    }
    for (const p of SIM.PARTS) if (!SIM.state.install[p.id] && objs[p.id].disc) objs[p.id].disc.material.opacity = 0;
    if (selBox.visible && SIM.selected) selBox.setFromObject(objs[SIM.selected].group);
    // 전원 표시등: FC 상태 LED(파랑 깜빡임 / GPS 잡히면 초록 / 시동 시 초록 고정), GPS LED 링, 안전 스위치 LED
    { const pw = SIM.power(), w = SIM.state.wiring, tt = performance.now() / 1000, blink = Math.sin(tt * Math.PI * 2) > 0;
      const setL = (m, on, col, k) => { if (!m) return; m.color.setHex(on ? col : 0x1f2226); m.emissive.setHex(col); m.emissiveIntensity = on ? k : 0; };
      if (objs.fc) setL(objs.fc.statusMat, pw.fcBatt, SIM.flight.armed || SIM.gpsOk() ? 0x33ff66 : 0x3b8cff, SIM.flight.armed ? 2.4 : blink ? 2.4 : 0.2);
      if (objs.gps) setL(objs.gps.ringMat, pw.fcBatt && !!w.plug.gps && SIM.cableReady("gps"), 0x37d67a, 1.2 + 1.2 * Math.max(0, Math.sin(tt * 3)));
      if (objs.switch) setL(objs.switch.ringMat, pw.fcBatt && SIM.switchOk(), 0xff4630, SIM.safetyPressed ? 2.4 : blink ? 2.4 : 0.2);
    }
    { const led = SIM.rxLed(), t = performance.now(), on = led === "green" || led === "red" || (led === "fast" && t % 200 < 100);
      const col = led === "green" ? 0x33ff66 : led === "off" ? 0x222222 : on ? 0xff3322 : 0x330000;
      objs.rx.led.material.color.setHex(col); objs.rx.ledGlow.material.color.setHex(led === "green" ? 0x33ff66 : 0xff3322); objs.rx.ledGlow.visible = on;
      if (objs.rx.bindBtn) objs.rx.bindBtn.position.y += ((performance.now() < (sc.bindPressUntil || 0) ? 0.0105 : 0.0118) - objs.rx.bindBtn.position.y) * 0.5; }
    const tm = sc.topPlate.material, want = sc.env === "bench" && (sc.xray || sc.pick) ? 0.22 : 1;
    tm.opacity += (want - tm.opacity) * k; tm.depthWrite = tm.opacity > 0.9;

    if (sc.env === "field") orbit.target.lerp(drone.position, 1 - Math.exp(-6 * dt));
    const sp = Math.sin(orbit.phi);
    camera.position.set(orbit.target.x + orbit.dist * sp * Math.sin(orbit.theta), Math.max(0.05, orbit.target.y + orbit.dist * Math.cos(orbit.phi)), orbit.target.z + orbit.dist * sp * Math.cos(orbit.theta));
    camera.lookAt(orbit.target);
    sun.position.set(orbit.target.x + 1.8 * KS, orbit.target.y + 5.5 * KS, orbit.target.z + 2.4 * KS);
    sun.target.position.copy(orbit.target);
    if (skipRender) return;
    if (composer) composer.render(); else renderer.render(scene, camera);
  };
})();
