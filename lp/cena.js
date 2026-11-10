/* Kit Offline — página de apresentação.
   Cena 3D guiada pela rolagem: um celular no centro e, atrás dele, a "internet"
   (nós ligados por linhas). Rolou: a rede cai, o farol acende e a tela do
   celular mostra o app funcionando. Sem WebGL a página segue legível, só sem a cena. */

import * as THREE from './vendor/three.module.min.js';

const raiz = document.documentElement;
raiz.classList.add('js');

const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const suave = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const calmo = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Pergunta e resposta REAIS do app, com a rede cortada (IA Média + biblioteca).
   O item 2 está abreviado com reticências; nada foi acrescentado. */
const PERGUNTA = 'Quais são os sinais de desidratação?';
const RESPOSTA = 'Os sinais de desidratação incluem:\n1. Sede\n2. Alterações neurológicas, como dor de cabeça, mal-estar, perda de apetite, náuseas e diminuição do volume urinário…\n3. Confusão mental\n4. Fadiga inexplicável\n5. Unhas roxas';

/* ───────── o que a rolagem diz ───────── */

const SEC = ['topo', 'dentro', 'passos', 'video', 'final']
  .map(id => ({ id, el: document.getElementById(id), peso: 0, local: 0 }));
const sec = Object.fromEntries(SEC.map(s => [s.id, s]));

const l2 = $('#l2');
const beats = [...document.querySelectorAll('.beat')];
const pontos = [...document.querySelectorAll('.pontos i')];
const passosLi = [...document.querySelectorAll('#listaPassos li')];

/* estado da história, lido da rolagem a cada quadro */
const E = { secao: 'topo', estado: 'farol', fim: false, rede: 1, farol: 0, semSinal: false, aviao: false,
            beat: 0, perguntou: false, chars: 0, fonte: false, passo: 0 };

function medir() {
  const vh = window.innerHeight;
  for (const s of SEC) {
    const r = s.el.getBoundingClientRect();
    s.peso = clamp((Math.min(r.bottom, vh) - Math.max(r.top, 0)) / vh);   // quanto da tela é desta parte
    const curso = r.height - vh;                                           // quanto ela fica presa
    s.local = curso > 8 ? clamp(-r.top / curso) : clamp(1 - r.top / vh);
  }
}

function ler() {
  const t = sec.topo.local, d = sec.dentro.local, p = sec.passos.local;
  let maior = SEC[0];
  for (const s of SEC) if (s.peso > maior.peso) maior = s;
  E.secao = maior.id;
  E.estado = maior.id === 'dentro' ? 'conversa' : (maior.id === 'passos' || maior.id === 'video') ? 'pronto' : 'farol';
  E.fim = maior.id === 'final';
  E.rede = 1 - suave(0.06, 0.82, t);
  E.farol = suave(0.45, 0.95, t);
  E.semSinal = E.rede < 0.45;
  E.beat = d < 0.34 ? 0 : d < 0.67 ? 1 : 2;
  E.perguntou = sec.dentro.peso > 0.3 || d > 0;
  E.chars = Math.round(RESPOSTA.length * suave(0.03, 0.56, d));
  E.fonte = d > 0.58;
  E.passo = maior.id === 'video' || maior.id === 'final' ? 3 : p < 0.12 ? 0 : p < 0.42 ? 1 : p < 0.72 ? 2 : 3;
  E.aviao = (E.estado === 'conversa' && d > 0.72) || (E.estado === 'pronto' && E.passo >= 3);
}

function pintarPagina() {
  l2.classList.toggle('acesa', sec.topo.local > 0.6);
  beats.forEach((b, i) => b.classList.toggle('on', i === E.beat));
  pontos.forEach((b, i) => b.classList.toggle('on', i === E.beat));
  passosLi.forEach((li, i) => li.classList.toggle('feito', i < E.passo));
  document.body.classList.toggle('rolou', window.scrollY > 30);
}

/* ───────── a cena ───────── */

function montarCena() {
  const canvas = $('#cena');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 10, 21);
  const FOV = 35, DIST = 9;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  camera.position.set(0, 0, DIST);
  const MEIA_ALT = Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * DIST;

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const chave = new THREE.DirectionalLight(0xe6edff, 2.4); chave.position.set(-3, 4, 6); scene.add(chave);
  const contra = new THREE.DirectionalLight(0x6f8fd0, 1.1); contra.position.set(4, -2, -3); scene.add(contra);

  /* brilho redondo, usado nos pontos e nos halos */
  const brilho = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  /* ── o celular ── */
  const retArr = (w, h, r) => {
    const s = new THREE.Shape(), x = -w / 2, y = -h / 2, P = Math.PI;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -P / 2, 0, false);
    s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, P / 2, false);
    s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, P / 2, P, false);
    s.lineTo(x, y + r); s.absarc(x + r, y + r, r, P, P * 1.5, false);
    return s;
  };
  const fone = new THREE.Group(); scene.add(fone);

  const corpoGeo = new THREE.ExtrudeGeometry(retArr(2.1, 4.4, 0.36),
    { depth: 0.14, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 4, curveSegments: 24 });
  corpoGeo.translate(0, 0, -0.07);
  fone.add(new THREE.Mesh(corpoGeo, new THREE.MeshStandardMaterial({ color: 0x1c2027, metalness: 0.55, roughness: 0.38 })));

  /* a tela é um desenho feito na hora (canvas 2D) colado no vidro */
  const TW = 360, TH = 784, U = 2, SW = 1.96, SH = 4.26;
  const telaCv = document.createElement('canvas'); telaCv.width = TW * U; telaCv.height = TH * U;
  const g = telaCv.getContext('2d');
  const tex = new THREE.CanvasTexture(telaCv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const telaGeo = new THREE.ShapeGeometry(retArr(SW, SH, 0.3), 24);
  { const uv = telaGeo.attributes.uv, ps = telaGeo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ps.getX(i) / SW + 0.5, ps.getY(i) / SH + 0.5); }
  const telaMesh = new THREE.Mesh(telaGeo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  telaMesh.position.z = 0.108; fone.add(telaMesh);

  /* brilho do farol por cima da tela (só no estado "farol") */
  const FAROL_Y = (0.5 - 318 / TH) * SH;
  const brilhoTela = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: brilho, color: 0xff8a1f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  brilhoTela.position.set(0, FAROL_Y, 0.13); fone.add(brilhoTela);

  /* halo e anéis atrás do aparelho: o sinal próprio dele */
  const aura = new THREE.Group(); scene.add(aura);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: brilho, color: 0xff8a1f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.position.z = -0.6; aura.add(halo);
  const aneis = [];
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Mesh(new THREE.RingGeometry(0.988, 1, 128),
      new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    a.position.z = -0.5; aura.add(a); aneis.push(a);
  }
  const luzFarol = new THREE.PointLight(0xff8a1f, 0, 14, 1.4); scene.add(luzFarol);

  /* ── a rede (a internet) ── */
  let rede = null, mx = 5, ret = false, POSES = null, semente = 11;
  const rnd = () => { semente = (semente * 16807) % 2147483647; return (semente - 1) / 2147483646; };

  function montarRede() {
    if (rede) { scene.remove(rede.grupo); rede.grupo.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    semente = 11;
    const n = ret ? 70 : 130, nos = [];
    for (let i = 0; i < n; i++) {
      const z = -1.4 - rnd() * 8.6, esp = 1 + (-z) / 9;       // mais longe, mais espalhado
      nos.push({ x: (rnd() * 2 - 1) * (mx + 1) * esp, y: (rnd() * 2 - 1) * 3.5 * esp, z, atraso: rnd() * 0.6, fase: rnd() * 6.28, queda: 5 + rnd() * 5 });
    }
    const vistos = new Set(), arestas = [];
    for (let i = 0; i < n; i++) {
      const d = [];
      for (let j = 0; j < n; j++) if (j !== i) {
        const dx = nos[i].x - nos[j].x, dy = nos[i].y - nos[j].y, dz = nos[i].z - nos[j].z;
        d.push([dx * dx + dy * dy + dz * dz, j]);
      }
      d.sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < 2; k++) {
        const j = d[k][1], ch = i < j ? i + '-' + j : j + '-' + i;
        if (!vistos.has(ch)) { vistos.add(ch); arestas.push({ a: i, b: j, lim: 0.06 + rnd() * 0.8 }); }
      }
    }
    const grupo = new THREE.Group();
    const nosGeo = new THREE.BufferGeometry();
    nosGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    nosGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    grupo.add(new THREE.Points(nosGeo, new THREE.PointsMaterial({ size: 0.16, map: brilho, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    const linGeo = new THREE.BufferGeometry();
    linGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arestas.length * 6), 3));
    linGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(arestas.length * 6), 3));
    grupo.add(new THREE.LineSegments(linGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    const np = ret ? 14 : 26, pacotes = [];
    for (let i = 0; i < np; i++) pacotes.push({ e: (rnd() * arestas.length) | 0, t: rnd(), v: 0.25 + rnd() * 0.45 });
    const pacGeo = new THREE.BufferGeometry();
    pacGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(np * 3), 3));
    pacGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(np * 3), 3));
    grupo.add(new THREE.Points(pacGeo, new THREE.PointsMaterial({ size: 0.26, map: brilho, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    scene.add(grupo);
    rede = { grupo, nos, arestas, pacotes, nosGeo, linGeo, pacGeo, ultima: -1 };
  }

  function moverRede(t, dt) {
    const r = E.rede;
    if (r <= 0.001) { rede.grupo.visible = false; return; }
    rede.grupo.visible = true;
    const { nos, arestas, pacotes } = rede;
    const np = rede.nosGeo.attributes.position, nc = rede.nosGeo.attributes.color;
    for (let i = 0; i < nos.length; i++) {
      const o = nos[i], caido = clamp((1 - r - o.atraso) / 0.35), vivo = 1 - caido;
      o.yy = o.y - caido * caido * o.queda;
      np.setXYZ(i, o.x, o.yy, o.z);
      const pisca = calmo ? 0.8 : 0.62 + 0.38 * Math.sin(t * 1.3 + o.fase);
      nc.setXYZ(i, 0.49 * vivo * pisca, 0.64 * vivo * pisca, 0.86 * vivo * pisca);
    }
    np.needsUpdate = nc.needsUpdate = true;
    const lp = rede.linGeo.attributes.position, lc = rede.linGeo.attributes.color;
    for (let i = 0; i < arestas.length; i++) {
      const a = arestas[i], A = nos[a.a], B = nos[a.b], v = clamp((r - a.lim) * 7) * 0.34;
      a.vivo = v;
      lp.setXYZ(i * 2, A.x, A.yy, A.z); lp.setXYZ(i * 2 + 1, B.x, B.yy, B.z);
      lc.setXYZ(i * 2, 0.42 * v, 0.56 * v, 0.8 * v); lc.setXYZ(i * 2 + 1, 0.42 * v, 0.56 * v, 0.8 * v);
    }
    lp.needsUpdate = lc.needsUpdate = true;
    const pp = rede.pacGeo.attributes.position, pc = rede.pacGeo.attributes.color;
    for (let i = 0; i < pacotes.length; i++) {
      const p = pacotes[i];
      if (!calmo) p.t += dt * p.v;
      if (p.t > 1) { p.t = 0; for (let k = 0; k < 4; k++) { p.e = (Math.random() * arestas.length) | 0; if (arestas[p.e].vivo > 0.1) break; } }
      const a = arestas[p.e], A = nos[a.a], B = nos[a.b], v = a.vivo * 2.6;
      pp.setXYZ(i, lerp(A.x, B.x, p.t), lerp(A.yy, B.yy, p.t), lerp(A.z, B.z, p.t));
      pc.setXYZ(i, 0.8 * v, 0.9 * v, 1 * v);
    }
    pp.needsUpdate = pc.needsUpdate = true;
  }

  /* poeira ao fundo, para o escuro não ficar chapado depois que a rede cai */
  const poeira = (() => {
    const n = 150, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = (Math.random() * 2 - 1) * 14; a[i * 3 + 1] = (Math.random() * 2 - 1) * 8; a[i * 3 + 2] = -2 - Math.random() * 10; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(a, 3));
    const m = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.07, map: brilho, color: 0x8a93a0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(m); return m;
  })();

  /* ── onde o celular fica em cada parte ── */
  function poses() {
    /* no celular em pé, o aparelho da abertura começa logo abaixo do texto,
       seja qual for a altura da tela */
    let yTopo = -1.78;
    if (ret) {
      const palco = document.querySelector('#topo .palco'), txt = document.querySelector('#topo .texto');
      const baixo = txt.offsetTop + txt.offsetHeight, h = canvas.clientHeight || window.innerHeight;
      if (palco && baixo > 0) yTopo = MEIA_ALT - ((baixo + 20) / h) * 2 * MEIA_ALT - 2.2 * 0.84 * 0.93;
    }
    return ret ? {
      topo:   { p: [0, yTopo, 0],       r: [0.24, -0.26, 0.03], s: 0.84 },
      dentro: { p: [0, 0.04, 0],        r: [0, 0, 0],           s: 0.97 },   /* abaixo do topo fixo da página */
      passos: { p: [0, 1.02, 0],        r: [0.04, 0.1, 0],      s: 0.6 },
      video:  { p: [0, 6.4, -3],        r: [-0.5, 0.7, 0.2],    s: 0.6 },
      final:  { p: [0, 0.72, 0],        r: [0.05, -0.1, 0],     s: 0.7 }
    } : {
      topo:   { p: [mx * 0.48, -0.05, 0], r: [0.10, -0.45, 0.04], s: 1.0 },
      dentro: { p: [mx * 0.45, 0, 0.5],   r: [0.02, -0.2, 0],     s: 1.08 },
      passos: { p: [-mx * 0.45, 0, 0.2],  r: [0.02, 0.24, 0],     s: 1.0 },
      video:  { p: [mx * 0.25, 6.8, -4],  r: [-0.6, 0.9, 0.2],    s: 0.8 },
      final:  { p: [mx * 0.46, -0.05, 0], r: [0.06, -0.32, 0.02], s: 0.96 }
    };
  }

  function ajustar() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const novoMx = MEIA_ALT * camera.aspect, novoRet = camera.aspect < 0.9;
    const mudou = !rede || novoRet !== ret || Math.abs(novoMx - mx) / mx > 0.12;
    mx = novoMx; ret = novoRet; POSES = poses();
    if (mudou) montarRede();
  }
  window.addEventListener('resize', ajustar);
  ajustar();
  /* a fonte do título chega depois e muda a altura do texto */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { POSES = poses(); });

  /* ── o desenho da tela do celular ── */
  const COR = { chao: '#0d1014', linha: '#262d36', texto: '#f3efe8', fraco: '#a3abb5', sinal: '#ff8a1f', sinalTexto: '#1a0d00', ok: '#46d68a' };
  const FAM = 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const F = (peso, tam) => peso + ' ' + tam + 'px ' + FAM;
  const AVIAO = new Path2D('M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z');

  function caixa(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function quebrar(texto, larg) {
    const linhas = [];
    for (const par of texto.split('\n')) {
      let l = '';
      for (const p of par.split(' ')) {
        const t = l ? l + ' ' + p : p;
        if (l && g.measureText(t).width > larg) { linhas.push(l); l = p; } else l = t;
      }
      linhas.push(l);
    }
    return linhas;
  }
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mistura = (a, b, t) => { const A = hex(a), B = hex(b); return 'rgb(' + A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',') + ')'; };

  g.setTransform(U, 0, 0, U, 0, 0);
  g.font = F(600, 14.5); const linhasPergunta = quebrar(PERGUNTA, 214);
  g.font = F(500, 14);   const linhasResposta = quebrar(RESPOSTA, 270);

  function barraStatus() {
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = COR.texto; g.font = F(650, 13.5);
    g.fillText('9:41', 30, 28);
    g.globalAlpha = 0.55; g.strokeStyle = COR.texto; g.lineWidth = 1; caixa(308.5, 21.5, 23, 12, 3.5); g.stroke(); g.globalAlpha = 1;
    caixa(310.5, 23.5, 15, 8, 2); g.fill();
    if (E.aviao) { g.save(); g.translate(281, 18); g.scale(0.82, 0.82); g.fillStyle = COR.sinal; g.fill(AVIAO); g.restore(); }
    else if (E.semSinal) { g.font = F(600, 11.5); g.textAlign = 'right'; g.fillStyle = COR.fraco; g.fillText('Sem serviço', 300, 28); }
    else for (let i = 0; i < 4; i++) { const h = 4 + i * 2.6; g.fillStyle = COR.texto; caixa(277 + i * 6, 33 - h, 4, h, 1); g.fill(); }
  }
  function cabecalho() {
    g.fillStyle = 'rgba(255,138,31,.2)'; g.beginPath(); g.arc(27, 69, 9, 0, 7); g.fill();
    g.fillStyle = COR.sinal; g.beginPath(); g.arc(27, 69, 5, 0, 7); g.fill();
    g.textAlign = 'left'; g.fillStyle = COR.texto; g.font = F(700, 17.5); g.fillText('Kit Offline', 43, 69.5);
    const fora = E.semSinal || E.aviao, txt = fora ? 'sem internet' : 'com internet';
    g.font = F(550, 12.5); g.textAlign = 'right'; g.fillStyle = fora ? COR.sinal : COR.fraco; g.fillText(txt, 338, 69.5);
    const lw = g.measureText(txt).width;
    g.fillStyle = fora ? COR.sinal : COR.ok; g.beginPath(); g.arc(338 - lw - 9, 69.5, 4, 0, 7); g.fill();
    g.strokeStyle = COR.linha; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 93.5); g.lineTo(TW, 93.5); g.stroke();
  }
  function abas(ativa) {
    g.strokeStyle = COR.linha; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 718.5); g.lineTo(TW, 718.5); g.stroke();
    ['Conversa', 'Biblioteca', 'Aparelho'].forEach((n, i) => {
      const cx = 60 + i * 120, cy = 741, cor = i === ativa ? COR.sinal : COR.fraco;
      g.strokeStyle = cor; g.lineWidth = 1.7; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath();
      if (i === 0) { g.moveTo(cx - 9, cy - 8); g.lineTo(cx + 9, cy - 8); g.lineTo(cx + 9, cy + 4); g.lineTo(cx - 3, cy + 4); g.lineTo(cx - 9, cy + 9); g.closePath(); }
      else if (i === 1) { g.rect(cx - 8, cy - 8, 7, 16); g.rect(cx + 1, cy - 8, 7, 16); }
      else caixa(cx - 5.5, cy - 9, 11, 18, 2.5);
      g.stroke();
      g.fillStyle = cor; g.font = F(600, 11.5); g.textAlign = 'center'; g.fillText(n, cx, 765);
    });
  }
  function telaFarol() {
    const f = E.fim ? 1 : E.farol, cx = 180, cy = 318;
    if (f > 0.01) {
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 200);
      gr.addColorStop(0, 'rgba(255,138,31,' + 0.4 * f + ')'); gr.addColorStop(0.45, 'rgba(255,138,31,' + 0.11 * f + ')'); gr.addColorStop(1, 'rgba(255,138,31,0)');
      g.fillStyle = gr; g.fillRect(0, 94, TW, 540);
    }
    g.lineWidth = 1.5;
    [54, 90, 130].forEach((r, i) => { g.strokeStyle = 'rgba(255,138,31,' + ((0.55 - i * 0.15) * f + 0.06 * (1 - f)) + ')'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); });
    g.fillStyle = mistura('#39404a', COR.sinal, f); g.beginPath(); g.arc(cx, cy, 27, 0, 7); g.fill();
    g.textAlign = 'center'; g.fillStyle = COR.texto; g.font = F(800, 31); g.fillText('Kit Offline', cx, 498);
    g.font = F(550, 15);
    if (E.fim) { g.fillStyle = COR.sinal; g.fillText('Pronto antes de precisar.', cx, 534); }
    else if (E.semSinal) { g.fillStyle = COR.sinal; g.fillText('Sem internet. Funcionando.', cx, 534); }
    else { g.fillStyle = COR.fraco; g.fillText('IA e biblioteca médica no aparelho', cx, 534); }
  }
  function telaConversa() {
    g.textAlign = 'left'; g.fillStyle = COR.fraco; g.font = F(550, 12.5); g.fillText('IA Média · roda neste aparelho', 18, 114);
    if (E.perguntou) {
      g.font = F(600, 14.5);
      const lh = 20, wp = Math.max(...linhasPergunta.map(l => g.measureText(l).width)) + 28, hp = linhasPergunta.length * lh + 22;
      const xp = 342 - wp, yp = 130;
      caixa(xp, yp, wp, hp, 16); g.fillStyle = COR.sinal; g.fill();
      g.fillStyle = COR.sinalTexto; linhasPergunta.forEach((l, i) => g.fillText(l, xp + 14, yp + 11 + lh / 2 + i * lh));

      const xa = 18, ya = yp + hp + 12, wa = 300, la = 19.5;
      g.font = F(500, 14);
      let resta = E.chars; const vis = [];
      for (const l of linhasResposta) { if (resta <= 0) break; vis.push(l.slice(0, resta)); resta -= l.length + 1; }
      const pensando = !vis.length, ha = (pensando ? 1 : vis.length) * la + 24 + (E.fonte ? 46 : 0);
      caixa(xa, ya, wa, ha, 16); g.fillStyle = COR.chao; g.fill(); g.strokeStyle = COR.linha; g.lineWidth = 1; g.stroke();
      if (pensando) { g.fillStyle = COR.fraco; g.fillText('Consultando a biblioteca…', xa + 14, ya + 12 + la / 2); }
      else { g.fillStyle = COR.texto; vis.forEach((l, i) => g.fillText(l, xa + 14, ya + 12 + la / 2 + i * la)); }
      if (E.fonte && !pensando) {
        const yf = ya + ha - 46;
        g.setLineDash([3, 3]); g.strokeStyle = COR.linha; g.beginPath(); g.moveTo(xa + 14, yf + 6.5); g.lineTo(xa + wa - 14, yf + 6.5); g.stroke(); g.setLineDash([]);
        g.font = F(500, 12); g.fillStyle = COR.fraco; g.fillText('Fonte:', xa + 14, yf + 27);
        const wf = g.measureText('Fonte:').width; g.font = F(600, 12);
        const wc = g.measureText('Desidratação').width + 22;
        caixa(xa + 14 + wf + 8, yf + 14, wc, 26, 13); g.strokeStyle = COR.sinal; g.lineWidth = 1.2; g.stroke();
        g.fillStyle = COR.texto; g.fillText('Desidratação', xa + 14 + wf + 19, yf + 27.5);
      }
    }
    caixa(18, 662, 270, 44, 14); g.fillStyle = COR.chao; g.fill(); g.strokeStyle = COR.linha; g.lineWidth = 1; g.stroke();
    g.textAlign = 'left'; g.fillStyle = '#6e7783'; g.font = F(500, 14); g.fillText('Pergunte alguma coisa', 34, 684.5);
    caixa(296, 662, 46, 44, 14); g.fillStyle = COR.sinal; g.fill();
    g.strokeStyle = COR.sinalTexto; g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(310, 684); g.lineTo(328, 684); g.moveTo(322, 678); g.lineTo(328, 684); g.lineTo(322, 690); g.stroke();
  }
  function telaPronto() {
    g.textAlign = 'left'; g.fillStyle = COR.texto; g.font = F(800, 22);
    g.fillText('Pronto para o', 18, 128); g.fillText('modo avião?', 18, 156);
    caixa(18, 182, 324, 214, 16); g.fillStyle = COR.chao; g.fill(); g.strokeStyle = COR.linha; g.lineWidth = 1; g.stroke();
    [['App instalado', 'na tela de início'], ['IA e biblioteca guardadas', '718 MB no aparelho'], ['Funciona em modo avião', 'sem depender de sinal']]
      .forEach((r, i) => {
        const y = 218 + i * 68, ok = i < E.passo;
        if (i) { g.strokeStyle = COR.linha; g.lineWidth = 1; g.beginPath(); g.moveTo(34, y - 33.5); g.lineTo(326, y - 33.5); g.stroke(); }
        g.beginPath(); g.arc(48, y, 13, 0, 7);
        if (ok) {
          g.fillStyle = COR.ok; g.fill(); g.strokeStyle = '#04150b'; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round';
          g.beginPath(); g.moveTo(42, y + 0.5); g.lineTo(46.5, y + 5); g.lineTo(54.5, y - 4.5); g.stroke();
        } else { g.strokeStyle = '#4a515b'; g.lineWidth = 1.6; g.stroke(); }
        g.fillStyle = ok ? COR.texto : COR.fraco; g.font = F(650, 15); g.fillText(r[0], 74, y - 9);
        g.fillStyle = COR.fraco; g.font = F(500, 12.5); g.fillText(r[1], 74, y + 11);
      });
    if (E.passo >= 3) {
      caixa(18, 414, 324, 56, 16); g.fillStyle = '#1d1408'; g.fill(); g.strokeStyle = COR.sinal; g.lineWidth = 1.2; g.stroke();
      g.fillStyle = COR.sinal; g.font = F(700, 15); g.fillText('Tudo pronto. Pode cair a internet.', 34, 442.5);
    }
  }

  let chaveTela = '', estadoTela = '', troca = 0;
  function pintarTela(dt) {
    if (E.estado !== estadoTela) { estadoTela = E.estado; troca = calmo ? 0 : 1; }
    const ch = [E.estado, E.fim, E.semSinal, E.aviao, Math.round((E.fim ? 1 : E.farol) * 14), E.chars, E.fonte, E.passo, E.perguntou].join('|');
    if (ch === chaveTela && troca <= 0) return;
    chaveTela = ch;
    g.setTransform(U, 0, 0, U, 0, 0);
    g.fillStyle = '#000'; g.fillRect(0, 0, TW, TH);
    barraStatus(); cabecalho();
    if (E.estado === 'conversa') { telaConversa(); abas(0); }
    else if (E.estado === 'pronto') { telaPronto(); abas(2); }
    else { telaFarol(); abas(0); }
    if (troca > 0) { g.fillStyle = 'rgba(0,0,0,' + troca + ')'; g.fillRect(0, 94, TW, 624); troca = Math.max(0, troca - dt * 5); }
    tex.needsUpdate = true;
  }

  /* ── o quadro ── */
  const at = { p: [0, 0, 0], r: [0, 0, 0], s: 1 };
  let primeira = true, mouseX = 0, mouseY = 0;
  window.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    mouseX = e.clientX / window.innerWidth * 2 - 1; mouseY = e.clientY / window.innerHeight * 2 - 1;
  }, { passive: true });

  function quadro(t, dt) {
    /* posição: mistura as poses conforme quanto de cada parte está na tela */
    let soma = 0; const al = { p: [0, 0, 0], r: [0, 0, 0], s: 0 };
    for (const s of SEC) {
      const w = s.peso; if (w <= 0) continue;
      const P = POSES[s.id]; soma += w;
      for (let i = 0; i < 3; i++) { al.p[i] += P.p[i] * w; al.r[i] += P.r[i] * w; }
      al.s += P.s * w;
    }
    if (soma > 0) {
      const k = primeira || calmo ? 1 : 1 - Math.exp(-dt * 5.5);
      for (let i = 0; i < 3; i++) { at.p[i] = lerp(at.p[i], al.p[i] / soma, k); at.r[i] = lerp(at.r[i], al.r[i] / soma, k); }
      at.s = lerp(at.s, al.s / soma, k); primeira = false;
    }
    const b = calmo ? 0 : 1;
    fone.position.set(at.p[0], at.p[1] + Math.sin(t * 0.9) * 0.045 * b, at.p[2]);
    fone.rotation.set(at.r[0] + mouseY * 0.05 + Math.sin(t * 0.7) * 0.012 * b, at.r[1] + mouseX * 0.1 + Math.sin(t * 0.55) * 0.035 * b, at.r[2]);
    fone.scale.setScalar(at.s);

    /* farol: halo, anéis e luz */
    const f = E.farol;
    aura.position.copy(fone.position);
    halo.scale.setScalar((7.5 + Math.sin(t * 1.4) * 0.5 * b) * at.s);
    halo.material.opacity = 0.34 * f;
    aneis.forEach((a, i) => {
      const fase = calmo ? (i + 0.5) / aneis.length : (t * 0.16 + i / aneis.length) % 1;
      a.scale.setScalar(lerp(1.5, 6.4, fase) * at.s);
      a.material.opacity = f * Math.pow(1 - fase, 1.6) * 0.6;
    });
    luzFarol.position.set(fone.position.x, fone.position.y, fone.position.z + 1.7);
    luzFarol.intensity = 26 * f;
    brilhoTela.material.opacity = (E.estado === 'farol' ? 1 : 0) * (E.fim ? 1 : f) * (1 - troca) * (0.5 + 0.14 * Math.sin(t * 2.1) * b);
    brilhoTela.scale.setScalar(1.5 + 0.12 * Math.sin(t * 2.1) * b);

    moverRede(t, dt);
    if (!calmo) poeira.rotation.z = t * 0.006;
    pintarTela(dt);
    renderer.render(scene, camera);
  }

  return { quadro };
}

/* ───────── partida ───────── */

let cena = null;
try { cena = montarCena(); }
catch (e) { console.warn('cena 3D:', e); raiz.classList.add('sem3d'); }

let antes = performance.now();
function quadro(agora) {
  const dt = Math.min(0.05, (agora - antes) / 1000); antes = agora;
  medir(); ler(); pintarPagina();
  if (cena) cena.quadro(agora / 1000, dt);
  requestAnimationFrame(quadro);
}
requestAnimationFrame(quadro);

/* "Ver o vídeo": rola até ele e já dá o play (o toque autoriza o som) */
const filme = $('#filme'), verVideo = $('#verVideo');
if (filme && verVideo) verVideo.addEventListener('click', () => { try { const p = filme.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} });

/* porta de conferência */
window.LP = { E, sec };
