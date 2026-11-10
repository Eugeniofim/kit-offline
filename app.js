/* Kit Offline — teste
   Três perguntas que esta página responde no aparelho de quem abre:
   1. a IA roda aqui dentro, sem internet?
   2. a biblioteca do Kiwix abre e é pesquisável sem internet?
   3. a IA consegue responder consultando a biblioteca? */

import * as webllm from './vendor/web-llm.js';

const VERSAO = '0.1.0';
const $ = s => document.querySelector(s);

/* ───────── catálogo ───────── */

/* Cada tamanho tem duas embalagens do mesmo modelo: f16 (menor, pede um recurso
   da placa de vídeo) e f32 (para aparelho sem esse recurso). */
const IAS = [
  { chave: 'leve',  nome: 'Leve',  modelo: 'Gemma 3 · 1B, do Google',
    f16: 'gemma3-1b-it-q4f16_1-MLC', mb16: 602,
    f32: 'Llama-3.2-1B-Instruct-q4f32_1-MLC', mb32: 705, modelo32: 'Llama 3.2 · 1B',
    dica: 'Para a maioria dos celulares recentes.' },
  { chave: 'media', nome: 'Média', modelo: 'Qwen 3.5 · 2B',
    f16: 'Qwen3.5-2B-q4f16_1-MLC', mb16: 1083,
    f32: 'Qwen3.5-2B-q4f32_1-MLC', mb32: 1083,
    dica: 'Responde melhor. Pede celular forte.' },
  { chave: 'forte', nome: 'Forte', modelo: 'Gemma 4 · E2B, a do app do Google',
    f16: 'gemma-4-E2B-it-q4f16_1-MLC', mb16: 2831,
    f32: 'gemma-4-E2B-it-q4f32_1-MLC', mb32: 2831,
    dica: 'Para computador ou celular topo de linha.' }
];

/* O pacote é o arquivo oficial do Kiwix (wikipedia_pt_medicine_nopic_2026-10.zim),
   servido daqui em partes: pacotes/medicina/pacote.json diz quais são. */
const PACOTE = {
  nome: 'medicina.zim',
  titulo: 'Medicina',
  base: 'pacotes/medicina/',
  bytes: 122104382
};

const SUGESTOES = [
  'Como tratar uma queimadura?',
  'O que fazer se alguém desmaiar?',
  'Como estancar um sangramento?',
  'Quais são os sinais de desidratação?'
];

const INSTRUCAO = 'Você é o assistente do Kit Offline e funciona sem internet. ' +
  'Responda em português do Brasil, de forma curta e clara. ' +
  'Quando for um procedimento, use passos numerados. ' +
  'Se não tiver certeza, diga que não sabe. Não invente.';

const SECOES_FORA = /^(refer[êe]ncias|ver tamb[ée]m|liga[çc][õo]es externas|bibliografia|notas|leitura adicional|fontes)\b/i;

/* ───────── estado ───────── */

const EST = {
  aparelho: {},
  escolha: localStorage.getItem('kit_ia') || 'leve',
  guardadas: {},            // chave -> true se o modelo já está no aparelho
  motor: null, iaChave: null, iaId: null,
  ligando: false, gerando: false,
  hist: [],
  zim: null,
  bib: { pronta: false, baixando: false, artigos: 0 },
  paginaGuardada: false,
  semRede: new URLSearchParams(location.search).get('semrede') === '1',
  medidas: {}
};

/* ───────── utilidades ───────── */

function el(tag, props, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null) n.append(f);
  return n;
}
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mb = b => b == null ? '?' : (b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : Math.round(b / 1e6) + ' MB');
const idDa = ia => EST.aparelho.f16 ? ia.f16 : ia.f32;
const pesoDa = ia => EST.aparelho.f16 ? ia.mb16 : ia.mb32;
const nomeModelo = ia => (!EST.aparelho.f16 && ia.modelo32) ? ia.modelo32 : ia.modelo;
const pesoTxt = n => n >= 1000 ? (n / 1000).toFixed(1).replace('.', ',') + ' GB' : n + ' MB';
function guardar(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function esquecer(k) { try { localStorage.removeItem(k); } catch (_) {} }

/* ───────── aparelho ───────── */

async function examinarAparelho() {
  const a = EST.aparelho = {
    gpu: false, f16: false, gpuNome: '', gpuErro: '',
    memoria: navigator.deviceMemory || null,
    nucleos: navigator.hardwareConcurrency || null,
    opfs: !!(navigator.storage && navigator.storage.getDirectory),
    sw: 'serviceWorker' in navigator,
    instalado: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    cota: null, uso: null, protegido: null
  };
  if (navigator.gpu) {
    try {
      const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (ad) {
        a.gpu = true;
        a.f16 = ad.features.has('shader-f16');
        const i = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : {}) || {};
        a.gpuNome = [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' ').trim();
        a.maxBuffer = ad.limits.maxBufferSize;
        a.maxLigacao = ad.limits.maxStorageBufferBindingSize;
      } else a.gpuErro = 'o navegador não entregou a placa de vídeo';
    } catch (e) { a.gpuErro = String((e && e.message) || e); }
  } else a.gpuErro = 'este navegador não tem WebGPU';
  await medirEspaco();
}

async function medirEspaco() {
  const a = EST.aparelho;
  try { const e = await navigator.storage.estimate(); a.cota = e.quota; a.uso = e.usage; } catch (_) {}
  try { a.protegido = await navigator.storage.persisted(); } catch (_) {}
}

async function verGuardadas() {
  for (const ia of IAS) {
    try { EST.guardadas[ia.chave] = await webllm.hasModelInCache(idDa(ia)); }
    catch (_) { EST.guardadas[ia.chave] = false; }
  }
}

async function verPaginaGuardada() {
  try {
    EST.paginaGuardada = !!(navigator.serviceWorker && navigator.serviceWorker.controller) &&
      !!(await caches.match('./index.html')) && !!(await caches.match('./vendor/web-llm.js'));
  } catch (_) { EST.paginaGuardada = false; }
}

/* ───────── IA: escolher, baixar, ligar ───────── */

function desenharOpcoes() {
  const caixa = $('#opcoesIA'); caixa.replaceChildren();
  for (const ia of IAS) {
    const guardada = EST.guardadas[ia.chave];
    caixa.append(el('button', {
      class: 'opcao', role: 'radio', type: 'button',
      'aria-checked': String(EST.escolha === ia.chave),
      onclick: () => { if (EST.ligando) return; EST.escolha = ia.chave; desenharOpcoes(); }
    },
      el('b', { text: ia.nome }),
      el('span', { class: guardada ? 'guardada' : 'peso', text: guardada ? 'já no aparelho' : pesoTxt(pesoDa(ia)) }),
      el('span', { class: 'dica', text: nomeModelo(ia) + '. ' + ia.dica })
    ));
  }
  const ia = IAS.find(i => i.chave === EST.escolha) || IAS[0];
  const b = $('#btnLigarIA');
  b.disabled = EST.ligando || !EST.aparelho.gpu;
  b.textContent = EST.ligando ? 'Aguarde…'
    : EST.guardadas[ia.chave] ? 'Ligar a IA ' + ia.nome
    : 'Baixar e ligar · ' + pesoTxt(pesoDa(ia));
}

function progressoIA(r) {
  const t = (r && r.text) || '';
  let frase = 'Preparando';
  const m = t.match(/(\d+)\s*MB/);
  if (/fetch/i.test(t)) frase = 'Baixando a IA' + (m ? ' · ' + m[1] + ' MB' : '');
  else if (/from cache/i.test(t)) frase = 'Abrindo a IA guardada no aparelho';
  else if (/shader/i.test(t)) frase = 'Preparando a placa de vídeo';
  else if (/finish/i.test(t)) frase = 'Pronta';
  const pct = Math.round(((r && r.progress) || 0) * 100);
  $('#barraIA').style.width = pct + '%';
  $('#textoIA').textContent = frase + ' · ' + pct + '%';
}

async function ligarIA(chave) {
  if (EST.ligando || _recarregando) return;
  const ia = IAS.find(i => i.chave === (chave || EST.escolha)) || IAS[0];
  const id = idDa(ia);
  const estavaGuardada = !!EST.guardadas[ia.chave];
  EST.ligando = true; EST.escolha = ia.chave;
  $('#erroIA').hidden = true; $('#avisoQueda').hidden = true;
  $('#progressoIA').hidden = false; progressoIA({ progress: 0, text: '' });
  desenharOpcoes();

  /* Se o aparelho fechar a página no meio (falta de memória), este bilhete
     fica para trás e a próxima abertura explica o que houve. */
  guardar('kit_carregando', JSON.stringify({ chave: ia.chave, nome: ia.nome, quando: Date.now() }));
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}

  const t0 = performance.now();
  try {
    if (EST.motor) { try { await EST.motor.unload(); } catch (_) {} EST.motor = null; }
    EST.motor = await webllm.CreateMLCEngine(id, { initProgressCallback: progressoIA, logLevel: 'WARN' });
    EST.iaChave = ia.chave; EST.iaId = id; EST.hist = [];
    EST.guardadas[ia.chave] = true;
    guardar('kit_ia', ia.chave);
    EST.medidas.ia = nomeModelo(ia) + ' (' + id + ')';
    EST.medidas.ligarSeg = +((performance.now() - t0) / 1000).toFixed(1);
    EST.medidas.ligarDe = estavaGuardada ? 'do aparelho' : 'baixando';
    abrirConversa(ia);
  } catch (e) {
    EST.motor = null;
    const msg = String((e && e.message) || e);
    const caixa = $('#erroIA'); caixa.hidden = false;
    caixa.textContent = !navigator.onLine && !estavaGuardada
      ? 'Sem internet não dá para baixar. Conecte uma vez para guardar a IA no aparelho.'
      : 'Não deu para ligar a IA ' + ia.nome + '. ' + (/memory|device|lost|buffer|alloc/i.test(msg)
          ? 'Parece falta de memória: tente um tamanho menor. ' : '') + '(' + msg.slice(0, 180) + ')';
    EST.medidas.erroIA = ia.nome + ': ' + msg.slice(0, 240);
  } finally {
    esquecer('kit_carregando');
    EST.ligando = false;
    $('#progressoIA').hidden = true;
    desenharOpcoes();
    await medirEspaco(); desenharAparelho();
  }
}

function avisarQueda() {
  let b = null;
  try { b = JSON.parse(localStorage.getItem('kit_carregando') || 'null'); } catch (_) {}
  esquecer('kit_carregando');
  if (!b) return false;
  const c = $('#avisoQueda'); c.hidden = false;
  c.textContent = 'Da última vez a página fechou antes de a IA ' + b.nome + ' terminar de ligar. ' +
    'Se o aparelho fechou sozinho, é sinal de pouca memória: tente um tamanho menor.';
  EST.medidas.queda = 'fechou ligando a ' + b.nome;
  return true;
}

/* ───────── conversa ───────── */

function abrirConversa(ia) {
  $('#preparo').hidden = true;
  $('#conversa').hidden = false;
  $('#iaNome').textContent = 'IA ' + ia.nome + ' · ' + nomeModelo(ia);
  $('#chaveBib').hidden = !EST.bib.pronta;
  if (!$('#mensagens').children.length) desenharSugestoes();
  mostrarBarraFala();
}

function desenharSugestoes() {
  const c = $('#sugestoes'); c.replaceChildren();
  for (const s of SUGESTOES) c.append(el('button', { class: 'chip', type: 'button', text: s, onclick: () => perguntar(s) }));
}

function mostrarBarraFala() {
  const naConversa = $('#abaConversa').classList.contains('on') && !$('#conversa').hidden;
  $('#barraFala').hidden = !naConversa;
}

function bolha(quem, texto) {
  const corpo = el('div', { text: texto });
  const b = el('div', { class: 'msg ' + quem }, corpo);
  $('#mensagens').append(b);
  rolarFim(true);
  return { b, corpo };
}

function rolarFim(forcar) {
  const p = $('#palco');
  if (forcar || p.scrollHeight - p.scrollTop - p.clientHeight < 160) p.scrollTop = p.scrollHeight;
}

/* modelos pequenos escrevem markdown e, alguns, um bloco de "pensamento" */
function limparResposta(t) {
  return t
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<think>[\s\S]*$/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,4}\s*/gm, '')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .trim();
}

/* IA pequena às vezes trava repetindo a mesma linha até o limite. Três linhas
   completas iguais em seguida = travou. */
const semNumero = l => l.replace(/^\s*(\d+[.)]|[•*-])\s*/, '').trim().toLowerCase();
function emLaco(t) {
  const l = t.split('\n').map(semNumero).filter(x => x.length > 12);
  const n = l.length - 1;                       // a última linha ainda está sendo escrita
  return n >= 3 && l[n - 1] === l[n - 2] && l[n - 2] === l[n - 3];
}
function semRepeticao(t) {
  const l = t.split('\n');
  l.pop();                                      // linha pela metade
  while (l.length > 1 && !l[l.length - 1].trim()) l.pop();
  while (l.length > 1 && semNumero(l[l.length - 1]) === semNumero(l[l.length - 2])) l.pop();
  return l.join('\n');
}

function botaoEnviar(gerando) {
  const b = $('#btnEnviar');
  b.setAttribute('aria-label', gerando ? 'Parar' : 'Enviar');
  b.innerHTML = gerando
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
}

async function perguntar(texto) {
  texto = String(texto || '').trim();
  if (!texto || EST.gerando || !EST.motor) return;
  $('#sugestoes').replaceChildren();
  $('#campoFala').value = ''; ajustarCampo();
  bolha('eu', texto);
  const { b, corpo } = bolha('ia', 'Pensando…');
  b.classList.add('pensando');
  EST.gerando = true; botaoEnviar(true);

  let fontes = [], contexto = '', resposta = '';
  const t0 = performance.now(); let t1 = null, uso = null, consultaMs = null;
  try {
    if (EST.bib.pronta && $('#usarBib').checked) {
      corpo.textContent = 'Consultando a biblioteca…';
      const c0 = performance.now();
      try { const r = await consultarBiblioteca(texto); fontes = r.fontes; contexto = r.contexto; }
      catch (e) { console.warn('consulta à biblioteca falhou:', e); }
      consultaMs = Math.round(performance.now() - c0);
      corpo.textContent = fontes.length ? 'Lendo “' + fontes[0].titulo + '”…' : 'Pensando…';
    }

    /* Modelo pequeno agarra qualquer saída fácil: se a instrução oferece "diga que
       não achou", ele diz. Por isso o pedido é só um: responder com o que os trechos trazem. */
    const atual = contexto
      ? INSTRUCAO + '\n\nA biblioteca offline traz os trechos abaixo sobre o assunto. ' +
        'Responda à pergunta com as informações deles, começando pelo que a pessoa deve fazer primeiro.\n\n' +
        contexto + '\n\nPergunta: ' + texto + '\nResposta, com base nos trechos:'
      : INSTRUCAO + '\n\nPergunta: ' + texto;
    const msgs = [...EST.hist.slice(-4), { role: 'user', content: atual }];

    const pedido = { messages: msgs, stream: true, stream_options: { include_usage: true },
      temperature: 0.3, max_tokens: 600, frequency_penalty: 0.6, presence_penalty: 0.3 };
    if (/^Qwen3/i.test(EST.iaId)) pedido.extra_body = { enable_thinking: false };

    let travou = false;
    const fluxo = await EST.motor.chat.completions.create(pedido);
    for await (const parte of fluxo) {
      const d = (parte.choices && parte.choices[0] && parte.choices[0].delta && parte.choices[0].delta.content) || '';
      if (d && !travou) {
        if (t1 === null) { t1 = performance.now(); b.classList.remove('pensando'); }
        resposta += d;
        corpo.textContent = limparResposta(resposta) || '…';
        rolarFim();
        if (emLaco(resposta)) { travou = true; try { EST.motor.interruptGenerate(); } catch (_) {} }
      }
      if (parte.usage) uso = parte.usage;
    }
    b.classList.remove('pensando');
    if (travou) { resposta = semRepeticao(resposta); EST.medidas.travou = (EST.medidas.travou || 0) + 1; }
    const limpa = limparResposta(resposta);
    corpo.textContent = limpa || '(a IA não respondeu nada)';
    EST.hist.push({ role: 'user', content: texto }, { role: 'assistant', content: limpa });

    const seg = t1 ? (performance.now() - t1) / 1000 : 0;
    const palavras = limpa.split(/\s+/).filter(Boolean).length;
    const pps = seg > 0.2 ? palavras / seg : null;
    const tps = uso && uso.extra && uso.extra.decode_tokens_per_s;
    EST.medidas.ultima = {
      esperaSeg: t1 ? +((t1 - t0) / 1000).toFixed(1) : null,
      palavrasSeg: pps ? +pps.toFixed(1) : null,
      tokensSeg: tps ? +tps.toFixed(1) : null,
      palavras, comBiblioteca: !!contexto, consultaMs,
      fontes: fontes.map(f => f.titulo).join(' | ')
    };

    const rodape = el('div', { class: 'rodape' });
    if (fontes.length) {
      rodape.append(el('span', { text: 'Fonte:' }));
      for (const f of fontes) rodape.append(el('button', { class: 'fonte', type: 'button', text: f.titulo, onclick: () => { trocarAba('abaBiblioteca'); abrirArtigo(f.caminho); } }));
    }
    if (travou) rodape.append(el('span', { text: 'Parei a IA: ela começou a se repetir.' }));
    if (pps) rodape.append(el('span', { text: pps.toFixed(pps < 10 ? 1 : 0).replace('.', ',') + ' palavras por segundo' }));
    if (rodape.children.length) b.append(rodape);
  } catch (e) {
    b.classList.remove('pensando');
    const msg = String((e && e.message) || e);
    corpo.textContent = (limparResposta(resposta) ? limparResposta(resposta) + '\n\n' : '') +
      'A IA parou: ' + msg.slice(0, 200);
    EST.medidas.erroConversa = msg.slice(0, 240);
  } finally {
    EST.gerando = false; botaoEnviar(false);
    rolarFim(); desenharAparelho();
  }
}

function ajustarCampo() {
  const c = $('#campoFala');
  c.style.height = 'auto';
  c.style.height = Math.min(c.scrollHeight, 140) + 'px';
}

/* ───────── biblioteca (Kiwix) ───────── */

function zim(acao, dados) {
  return new Promise((ok, falha) => {
    if (!EST.zim) return falha(new Error('biblioteca fechada'));
    const canal = new MessageChannel();
    const relogio = setTimeout(() => falha(new Error('a biblioteca demorou demais')), 45000);
    canal.port1.onmessage = ev => { clearTimeout(relogio); ok(ev.data); };
    EST.zim.postMessage(Object.assign({ action: acao }, dados || {}), [canal.port2]);
  });
}

async function abrirZim(arquivo) {
  if (EST.zim) { try { EST.zim.terminate(); } catch (_) {} }
  EST.zim = new Worker('./vendor/libzim-wasm.js');
  EST.zim.onerror = e => console.warn('leitor do Kiwix:', e.message || e);
  await zim('init', { files: [arquivo] });
  EST.bib.artigos = Number(await zim('getArticleCount')) || 0;
  EST.bib.pronta = true;
  desenharBiblioteca();
}

async function abrirBibliotecaGuardada() {
  let reg = null;
  try { reg = JSON.parse(localStorage.getItem('kit_bib') || 'null'); } catch (_) {}
  if (!reg || !EST.aparelho.opfs) return;
  try {
    const raiz = await navigator.storage.getDirectory();
    const arq = await (await raiz.getFileHandle(PACOTE.nome)).getFile();
    if (arq.size !== reg.bytes) throw new Error('arquivo incompleto');
    await abrirZim(arq);
  } catch (e) {
    console.warn('biblioteca guardada não abriu:', e);
    EST.medidas.erroBib = String((e && e.message) || e).slice(0, 200);
  }
}

async function baixarBiblioteca() {
  if (EST.bib.baixando) return;
  if (!EST.aparelho.opfs) { erroBib('Este navegador não deixa guardar arquivo grande no aparelho.'); return; }
  EST.bib.baixando = true;
  $('#erroBib').hidden = true; $('#progressoBib').hidden = false; $('#btnBaixarBib').disabled = true;
  $('#barraBib').style.width = '0%'; $('#textoBib').textContent = 'Começando…';
  try { if (navigator.storage.persist) navigator.storage.persist(); } catch (_) {}

  let indice = null;
  try {
    const r = await fetch(PACOTE.base + 'pacote.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('índice ' + r.status);
    indice = await r.json();
  } catch (e) {
    EST.bib.baixando = false; $('#progressoBib').hidden = true; $('#btnBaixarBib').disabled = false;
    erroBib(!navigator.onLine || EST.semRede ? 'Sem internet não dá para baixar a biblioteca.' : 'Não achei o pacote da biblioteca. (' + String((e && e.message) || e) + ')');
    return;
  }

  const w = new Worker('./baixa-zim.js');
  const fim = () => { EST.bib.baixando = false; $('#progressoBib').hidden = true; $('#btnBaixarBib').disabled = false; w.terminate(); };
  w.onerror = e => { fim(); erroBib('O download falhou. ' + (e.message || '')); };
  w.onmessage = async ev => {
    const d = ev.data || {};
    if (d.tipo === 'progresso' || d.tipo === 'parte') {
      /* cada parte inteira fica anotada: se cair, a próxima tentativa continua dali */
      if (d.tipo === 'parte') guardar('kit_bib_parcial', String(d.feitas));
      const pct = d.total ? Math.round(d.feito / d.total * 100) : 0;
      $('#barraBib').style.width = pct + '%';
      $('#textoBib').textContent = 'Baixando · ' + mb(d.feito) + ' de ' + mb(d.total) + ' · ' + pct + '%';
    } else if (d.tipo === 'fim') {
      $('#textoBib').textContent = 'Abrindo a biblioteca…';
      try {
        esquecer('kit_bib_parcial');
        guardar('kit_bib', JSON.stringify({ nome: PACOTE.nome, bytes: d.feito, quando: Date.now() }));
        const raiz = await navigator.storage.getDirectory();
        await abrirZim(await (await raiz.getFileHandle(PACOTE.nome)).getFile());
        fim();
      } catch (e) { fim(); erroBib('Baixou, mas não abriu: ' + String((e && e.message) || e).slice(0, 160)); }
      await medirEspaco(); desenharAparelho();
    } else if (d.tipo === 'erro') {
      fim();
      erroBib(!navigator.onLine ? 'Sem internet não dá para baixar a biblioteca. Toque de novo quando voltar: continua de onde parou.'
        : 'O download falhou: ' + d.erro + '. Toque de novo: continua de onde parou.');
    }
  };
  w.postMessage({ nome: PACOTE.nome, base: PACOTE.base, partes: indice.partes, bytes: indice.bytes,
    pular: Number(localStorage.getItem('kit_bib_parcial')) || 0 });
}

function erroBib(t) { const c = $('#erroBib'); c.hidden = false; c.textContent = t; EST.medidas.erroBib = t.slice(0, 200); }

function desenharBiblioteca() {
  $('#bibBaixar').hidden = EST.bib.pronta;
  $('#bibPronta').hidden = !EST.bib.pronta;
  $('#chaveBib').hidden = !EST.bib.pronta || $('#conversa').hidden;
  if (EST.bib.pronta) $('#bibResumo').textContent = PACOTE.titulo + ' · ' + EST.bib.artigos.toLocaleString('pt-BR') + ' artigos guardados no aparelho';
  desenharAparelho();
}

/* procura por título e por texto, e junta os dois */
async function procurar(texto, quantos) {
  const vistos = new Map();
  const junta = lista => (lista || []).forEach(x => { if (x && x.path && !vistos.has(x.path)) vistos.set(x.path, { caminho: x.path, titulo: x.title || x.path }); });
  try { junta((await zim('suggest', { text: texto, numResults: 6 })).suggestions); } catch (_) {}
  try { junta((await zim('search', { text: texto, numResults: quantos || 12 })).results); } catch (_) {}
  return [...vistos.values()];
}

async function buscarNaTela(texto) {
  const lista = $('#resultados'); const art = $('#artigo');
  art.hidden = true; lista.hidden = false; lista.replaceChildren(el('div', { class: 'fraco', text: 'Procurando…' }));
  const achados = await procurar(texto, 14);
  lista.replaceChildren();
  if (!achados.length) { lista.append(el('div', { class: 'fraco', text: 'Nada encontrado para “' + texto + '”.' })); return; }
  for (const a of achados) lista.append(el('button', { class: 'resultado', type: 'button', text: a.titulo, onclick: () => abrirArtigo(a.caminho) }));
}

async function lerArtigo(caminho) {
  const r = await zim('getEntryByPath', { path: caminho, follow: true });
  if (!r || !r.content || !r.content.length) return null;
  if (r.mimetype && !/html/i.test(r.mimetype)) return null;
  const doc = new DOMParser().parseFromString(new TextDecoder('utf-8').decode(r.content), 'text/html');
  doc.querySelectorAll('script,style,link,meta,img,figure,table,sup,noscript,audio,video,svg,math,' +
    '.mw-editsection,.reference,.reflist,.references,.navbox,.infobox,.noprint,.hatnote,.thumb,.gallery,.metadata,.mw-empty-elt').forEach(n => n.remove());
  const titulo = ((doc.querySelector('h1') || {}).textContent || doc.title || caminho).replace(/\s+/g, ' ').trim();

  /* o artigo vira uma fila de blocos de texto puro; nada do HTML original vai para a tela */
  const blocos = []; let secao = '', sub = '', fora = false, ordem = 0;
  doc.body.querySelectorAll('h2,h3,h4,p,li,dd').forEach(n => {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (!t) return;
    if (/^H[2-4]$/.test(n.tagName)) {
      if (n.tagName === 'H2') { secao = t; sub = ''; fora = SECOES_FORA.test(t); }
      else sub = t;
      if (!fora) blocos.push({ tipo: n.tagName.toLowerCase(), texto: t, secao, sub, ordem: ordem++ });
      return;
    }
    if (fora) return;
    if (n.tagName === 'LI' && n.querySelector('ul,ol')) return;
    if (n.tagName === 'P' && t.length < 25) return;
    blocos.push({ tipo: n.tagName === 'P' ? 'p' : 'li', texto: t, secao, sub, ordem: ordem++ });
  });
  return { titulo, caminho, blocos };
}

async function abrirArtigo(caminho) {
  const lista = $('#resultados'); const art = $('#artigo');
  art.hidden = false; lista.hidden = true;
  art.replaceChildren(el('div', { class: 'fraco', text: 'Abrindo…' }));
  let a = null;
  try { a = await lerArtigo(caminho); } catch (e) { console.warn(e); }
  art.replaceChildren(el('button', { class: 'link', type: 'button', text: '← voltar', onclick: () => { art.hidden = true; lista.hidden = false; } }));
  if (!a) { art.append(el('p', { class: 'fraco', text: 'Não consegui abrir este artigo.' })); return; }
  art.append(el('h1', { text: a.titulo }));
  let ul = null;
  for (const b of a.blocos) {
    if (b.tipo === 'li') { if (!ul) { ul = el('ul'); art.append(ul); } ul.append(el('li', { text: b.texto })); continue; }
    ul = null;
    art.append(el(b.tipo === 'p' ? 'p' : b.tipo, { text: b.texto }));
  }
  art.append(el('p', { class: 'mini fraco', text: 'Texto da Wikipédia (CC BY-SA), lido de um pacote do Kiwix guardado neste aparelho.' }));
  $('#palco').scrollTop = 0;
}

/* ── a parte que junta IA e biblioteca ── */

const VAZIAS = new Set(('a o as os um uma uns umas de da do das dos em no na nos nas por para pra com sem sobre entre e ou mas que se ' +
  'como quando onde qual quais quem porque é sao ser estar esta foi tem ter fazer faz feito faco posso pode devo deve preciso caso ' +
  'meu minha seu sua isso isto esse essa este ele ela eles elas eu voce me te lhe ao aos ja nao sim mais menos muito muita pouco ' +
  'bem mal tudo algo alguem alguma algum coisa sinais sinal tipos tipo existe existem acontece').split(/\s+/));

function palavrasChave(texto) {
  const vistos = new Set(), saida = [];
  for (const w of String(texto).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3) continue;
    const n = semAcento(w);
    if (VAZIAS.has(n) || vistos.has(n)) continue;
    vistos.add(n);
    /* raiz grosseira: basta para "tratar" achar "tratamento" e "queimadura" achar "queimaduras" */
    saida.push({ orig: w, norm: n, raiz: n.length > 5 ? n.slice(0, n.length - 2) : n.slice(0, Math.max(3, n.length - 1)) });
  }
  return saida.slice(0, 6);
}

function escolherTrechos(blocos, chaves, limite) {
  const textos = blocos.filter(b => b.tipo === 'p' || b.tipo === 'li');
  textos.forEach((b, i) => {
    const t = semAcento(b.texto), s = semAcento(b.secao), u = semAcento(b.sub);
    let p = i === 0 ? 4 : 0;                       // a primeira frase do artigo diz do que se trata
    for (const k of chaves) {
      p += Math.min(2, t.split(k.raiz).length - 1);
      /* quem pergunta "como tratar" quer a seção "Tratamento": o nome da seção
         pesa mais que a palavra solta no meio de um parágrafo */
      if (s.includes(k.raiz)) p += 4;
      if (u.includes(k.raiz)) p += 4;
    }
    b.pts = p;
  });
  const escolhidos = []; let usado = 0;
  for (const b of textos.slice().sort((x, y) => y.pts - x.pts || x.ordem - y.ordem)) {
    if (b.pts <= 0) break;
    const t = b.texto.length > 480 ? b.texto.slice(0, 480).replace(/\s+\S*$/, '') + '…' : b.texto;
    if (usado + t.length > limite) continue;
    const onde = [b.secao, b.sub].filter(Boolean).join(' › ');
    escolhidos.push({ ordem: b.ordem, linha: (onde ? '[' + onde + '] ' : '') + t });
    usado += t.length;
  }
  return escolhidos.sort((x, y) => x.ordem - y.ordem).map(x => x.linha).join('\n');
}

async function consultarBiblioteca(pergunta) {
  const chaves = palavrasChave(pergunta);
  if (!chaves.length) return { contexto: '', fontes: [] };

  const cand = new Map();
  const soma = (lista, base) => (lista || []).forEach((x, i) => {
    if (!x || !x.path) return;
    const c = cand.get(x.path) || { caminho: x.path, titulo: x.title || '', pts: 0 };
    c.pts += Math.max(0, base - i * 0.4);
    cand.set(x.path, c);
  });

  try { soma((await zim('search', { text: chaves.map(c => c.orig).join(' '), numResults: 8 })).results, 4); } catch (_) {}
  for (const c of chaves.slice().sort((x, y) => y.norm.length - x.norm.length).slice(0, 3)) {
    try { soma((await zim('suggest', { text: c.orig, numResults: 4 })).suggestions, 3); } catch (_) {}
  }
  for (const c of cand.values()) {
    const t = semAcento(c.titulo);
    for (const k of chaves) {
      if (t === k.norm) c.pts += 8;
      else if (t.split(/[^a-z0-9]+/).some(w => w.startsWith(k.raiz))) c.pts += 3;
    }
  }
  const ordem = [...cand.values()].sort((x, y) => y.pts - x.pts);
  if (!ordem.length) return { contexto: '', fontes: [] };

  const usar = [ordem[0]];
  if (ordem[1] && ordem[1].pts >= ordem[0].pts * 0.6) usar.push(ordem[1]);

  const partes = [], fontes = [];
  for (let i = 0; i < usar.length; i++) {
    let a = null;
    try { a = await lerArtigo(usar[i].caminho); } catch (_) {}
    if (!a) continue;
    const trecho = escolherTrechos(a.blocos, chaves, i === 0 ? 2400 : 900);
    if (!trecho) continue;
    partes.push('Trecho do artigo “' + a.titulo + '”:\n' + trecho);
    fontes.push({ titulo: a.titulo, caminho: a.caminho });
  }
  return { contexto: partes.join('\n\n'), fontes };
}

/* ───────── aba Aparelho ───────── */

function linha(estado, titulo, detalhe) {
  const marca = { ok: ['✓', 'marca-ok'], nao: ['✕', 'marca-nao'], meh: ['•', 'marca-meh'] }[estado];
  return el('li', {}, el('span', { class: marca[1], 'aria-hidden': 'true', text: marca[0] }),
    el('div', {}, titulo, detalhe ? el('span', { class: 'd', text: detalhe }) : null));
}

function desenharAparelho() {
  const a = EST.aparelho;
  const algumaIA = IAS.filter(i => EST.guardadas[i.chave]);

  const pronto = $('#listaPronto'); pronto.replaceChildren(
    linha(EST.paginaGuardada ? 'ok' : 'nao', 'A página está guardada no aparelho',
      EST.paginaGuardada ? null : 'Abra com internet uma vez e espere alguns segundos.'),
    linha(algumaIA.length ? 'ok' : 'nao', 'A IA está guardada no aparelho',
      algumaIA.length ? algumaIA.map(i => i.nome).join(', ') : 'Baixe na aba Conversa.'),
    linha(EST.bib.pronta ? 'ok' : 'meh', 'A biblioteca está guardada no aparelho',
      EST.bib.pronta ? PACOTE.titulo : 'Opcional. Baixe na aba Biblioteca.'),
    linha(a.protegido || a.instalado ? 'ok' : 'meh', 'O aparelho não vai apagar esses arquivos sozinho',
      a.protegido || a.instalado ? null : 'Para garantir, adicione esta página à tela de início.')
  );
  $('#dicaAviao').textContent = EST.semRede
    ? 'Simulando sem internet: a rede desta página está cortada.'
    : (EST.paginaGuardada && algumaIA.length)
      ? 'Agora ligue o modo avião, feche esta página, abra de novo e faça uma pergunta.'
      : 'Quando os dois primeiros itens estiverem marcados, dá para testar em modo avião.';

  $('#listaAparelho').replaceChildren(
    linha(a.gpu ? 'ok' : 'nao', 'Placa de vídeo liberada para a IA',
      a.gpu ? (a.gpuNome || 'sem nome') + (a.f16 ? '' : ' · versão mais pesada dos modelos') : a.gpuErro),
    linha(a.opfs ? 'ok' : 'nao', 'Guarda arquivo grande', a.opfs ? null : 'A biblioteca não vai funcionar aqui.'),
    linha('meh', 'Memória', a.memoria ? 'cerca de ' + a.memoria + ' GB' + (a.memoria >= 8 ? ' ou mais' : '') : 'o navegador não informa'),
    linha('meh', 'Espaço', a.cota ? mb(a.uso) + ' usados de ' + mb(a.cota) + ' liberados' : 'o navegador não informa')
  );
  $('#relatorio').textContent = montarRelatorio();
}

function montarRelatorio() {
  const a = EST.aparelho, m = EST.medidas, u = m.ultima || {};
  const L = [
    'Kit Offline · teste ' + VERSAO + ' · ' + new Date().toLocaleString('pt-BR'),
    'navegador: ' + navigator.userAgent,
    'tela: ' + screen.width + '×' + screen.height + ' @' + (window.devicePixelRatio || 1) + ' · instalado: ' + (a.instalado ? 'sim' : 'não'),
    'rede agora: ' + (EST.semRede ? 'cortada (simulação)' : navigator.onLine ? 'com internet' : 'SEM internet'),
    'placa de vídeo: ' + (a.gpu ? 'sim · ' + (a.gpuNome || '?') + ' · f16 ' + (a.f16 ? 'sim' : 'não') + ' · buffer ' + mb(a.maxBuffer) : 'NÃO · ' + a.gpuErro),
    'memória: ' + (a.memoria ? a.memoria + ' GB' : '?') + ' · núcleos: ' + (a.nucleos || '?'),
    'espaço: ' + mb(a.uso) + ' de ' + mb(a.cota) + ' · protegido: ' + (a.protegido ? 'sim' : 'não') + ' · arquivo grande: ' + (a.opfs ? 'sim' : 'não'),
    'página guardada: ' + (EST.paginaGuardada ? 'sim' : 'não'),
    'IAs guardadas: ' + (IAS.filter(i => EST.guardadas[i.chave]).map(i => i.nome).join(', ') || 'nenhuma'),
    'IA ligada: ' + (m.ia ? m.ia + ' · ligou em ' + m.ligarSeg + ' s (' + m.ligarDe + ')' : 'nenhuma'),
    'última resposta: ' + (u.palavras != null
      ? u.palavras + ' palavras · ' + (u.palavrasSeg || '?') + ' palavras/s · ' + (u.tokensSeg || '?') + ' tokens/s · esperou ' + (u.esperaSeg || '?') + ' s'
      : 'nenhuma'),
    'biblioteca: ' + (EST.bib.pronta ? PACOTE.titulo + ' · ' + EST.bib.artigos + ' artigos' : 'não baixada') +
      (u.comBiblioteca ? ' · consulta ' + u.consultaMs + ' ms · fontes: ' + u.fontes : '')
  ];
  if (m.travou) L.push('a IA travou repetindo: ' + m.travou + ' vez(es)');
  for (const k of ['queda', 'erroIA', 'erroConversa', 'erroBib']) if (m[k]) L.push(k + ': ' + m[k]);
  return L.join('\n');
}

async function apagarTudo() {
  if (!confirm('Apagar a IA e a biblioteca guardadas neste aparelho? Para usar de novo, será preciso baixar outra vez.')) return;
  try { if (EST.motor) await EST.motor.unload(); } catch (_) {}
  try { if (EST.zim) EST.zim.terminate(); } catch (_) {}
  for (const ia of IAS) for (const id of [ia.f16, ia.f32]) { try { await webllm.deleteModelAllInfoInCache(id); } catch (_) {} }
  try { const raiz = await navigator.storage.getDirectory(); await raiz.removeEntry(PACOTE.nome); } catch (_) {}
  ['kit_ia', 'kit_bib', 'kit_bib_parcial', 'kit_carregando'].forEach(esquecer);
  recarregar();
}

/* ───────── abas e rede ───────── */

function trocarAba(id) {
  document.querySelectorAll('.aba').forEach(s => s.classList.toggle('on', s.id === id));
  document.querySelectorAll('.abas button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === id)));
  mostrarBarraFala();
  if (id === 'abaAparelho') medirEspaco().then(verPaginaGuardada).then(desenharAparelho);
  $('#palco').scrollTop = id === 'abaConversa' ? $('#palco').scrollHeight : 0;
}

function mostrarRede() {
  const r = $('#rede');
  const fora = EST.semRede || !navigator.onLine;
  r.classList.toggle('fora', fora);
  r.textContent = EST.semRede ? 'sem internet (simulação)' : fora ? 'sem internet' : 'com internet';
}

/* ───────── atualização da página (receita da casa) ───────── */

const VOLTOU = []; let _voltouEm = 0;
function aoVoltar(fn, minSeg) { VOLTOU.push({ fn, min: (minSeg || 0) * 1000, ultimo: 0 }); }
function _dispararVolta(forcado) {
  const agora = Date.now();
  if (!forcado && agora - _voltouEm < 1500) return;
  _voltouEm = agora;
  VOLTOU.forEach(v => {
    if (!forcado && v.min && agora - v.ultimo < v.min) return;
    v.ultimo = agora;
    try { v.fn(); } catch (e) { console.warn('aoVoltar:', e); }
  });
}
/* Sair da página por vontade própria dispara pagehide; o sistema matar a página
   por falta de memória, não. Só o segundo caso deve deixar o bilhete de queda. */
window.addEventListener('pagehide', () => esquecer('kit_carregando'));
document.addEventListener('visibilitychange', () => { if (!document.hidden) _dispararVolta(); });
window.addEventListener('focus', () => _dispararVolta());
window.addEventListener('pageshow', e => { if (e.persisted) _dispararVolta(true); });
window.addEventListener('online', () => _dispararVolta(true));

/* "a pessoa está no meio de alguma coisa?" — recarregar agora desligaria a IA */
function isBusyEditing() {
  return EST.gerando || EST.ligando || EST.bib.baixando || !!EST.motor || !!$('#campoFala').value.trim();
}

let NOVA_ESPERANDO = null, _recarregando = false;
function mostrarNova(w) {
  NOVA_ESPERANDO = w;
  if (!isBusyEditing()) { aplicarNova(); return; }
  $('#novaBar').classList.add('on');
}
/* Recarregar por conta própria não é queda: sem apagar o bilhete, a próxima
   abertura acusaria "o aparelho fechou a página" sem ter fechado. */
function recarregar() {
  _recarregando = true;
  esquecer('kit_carregando');
  try { location.reload(); } catch (_) {}
}
function aplicarNova() {
  if (_recarregando) return; _recarregando = true;
  $('#novaBar').classList.remove('on');
  try { if (NOVA_ESPERANDO) NOVA_ESPERANDO.postMessage({ tipo: 'assumir' }); } catch (_) {}
  setTimeout(recarregar, 2000);
}

function avisarSW(msg) {
  return new Promise(ok => {
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!sw) return ok(null);
    const canal = new MessageChannel();
    const relogio = setTimeout(() => ok(null), 2000);
    canal.port1.onmessage = e => { clearTimeout(relogio); ok(e.data); };
    sw.postMessage(msg, [canal.port2]);
  });
}

function ligarAtualizacao() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;

  /* lido AGORA, antes de qualquer troca: na primeira visita não há controlador */
  const jaTinhaControlador = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(e => console.warn('sw:', e));

  navigator.serviceWorker.ready.then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) mostrarNova(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const novo = reg.installing; if (!novo) return;
      novo.addEventListener('statechange', () => {
        if (novo.state === 'installed' && navigator.serviceWorker.controller) mostrarNova(novo);
      });
    });
    const checar = () => { if (navigator.onLine && !EST.semRede) reg.update().catch(() => {}); };
    checar();
    aoVoltar(checar, 60);
    setInterval(checar, 30 * 60 * 1000);
  }).catch(() => {});

  let jaTrocou = false;
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    await avisarSW({ tipo: 'semrede', ligado: EST.semRede });
    await verPaginaGuardada(); desenharAparelho();
    if (!jaTinhaControlador) return;       // primeira visita: não é atualização
    if (jaTrocou) return; jaTrocou = true;
    recarregar();
  });
}

/* ───────── partida ───────── */

async function partida() {
  document.querySelectorAll('.abas button').forEach(b => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
  $('#btnLigarIA').addEventListener('click', () => ligarIA());
  $('#btnTrocarIA').addEventListener('click', () => {
    if (EST.gerando) return;
    $('#conversa').hidden = true; $('#preparo').hidden = false; mostrarBarraFala(); desenharOpcoes();
  });
  $('#barraFala').addEventListener('submit', e => {
    e.preventDefault();
    if (EST.gerando) { try { EST.motor.interruptGenerate(); } catch (_) {} return; }
    perguntar($('#campoFala').value);
  });
  $('#campoFala').addEventListener('input', ajustarCampo);
  $('#campoFala').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#barraFala').requestSubmit(); }
  });
  $('#btnBaixarBib').addEventListener('click', baixarBiblioteca);
  $('#formBusca').addEventListener('submit', e => { e.preventDefault(); const q = $('#campoBusca').value.trim(); if (q) buscarNaTela(q); });
  $('#btnCopiar').addEventListener('click', async () => {
    const t = montarRelatorio();
    try { await navigator.clipboard.writeText(t); $('#btnCopiar').textContent = 'Copiado'; }
    catch (_) {
      const s = getSelection(), r = document.createRange(); r.selectNodeContents($('#relatorio')); s.removeAllRanges(); s.addRange(r);
      $('#btnCopiar').textContent = 'Selecionado: copie com o dedo';
    }
    setTimeout(() => { $('#btnCopiar').textContent = 'Copiar relatório'; }, 2500);
  });
  $('#btnApagar').addEventListener('click', apagarTudo);
  $('#btnNova').addEventListener('click', aplicarNova);
  $('#btnNovaX').addEventListener('click', () => $('#novaBar').classList.remove('on'));
  window.addEventListener('online', mostrarRede);
  window.addEventListener('offline', mostrarRede);
  mostrarRede();

  ligarAtualizacao();
  /* sempre avisa, ligado ou não: a simulação nunca pode ficar presa de uma abertura para a outra */
  await avisarSW({ tipo: 'semrede', ligado: EST.semRede });

  await examinarAparelho();
  await verGuardadas();
  await verPaginaGuardada();
  $('#bibPeso').textContent = mb(PACOTE.bytes);

  if (!EST.aparelho.gpu) {
    const c = $('#avisoSemGPU'); c.hidden = false;
    c.textContent = 'Este navegador não liberou a placa de vídeo, e sem ela a IA não liga aqui. ' +
      'No iPhone, atualize o sistema e abra no Safari. No Android, use o Chrome atualizado.';
  }
  const caiu = avisarQueda();
  desenharOpcoes(); desenharBiblioteca(); desenharAparelho();

  /* a biblioteca abre sozinha; a IA também, se já estiver guardada e não tiver derrubado a página antes */
  abrirBibliotecaGuardada();
  if (!caiu && EST.aparelho.gpu && EST.guardadas[EST.escolha]) ligarIA(EST.escolha);
}

/* porta de serviço para conferência */
window.KIT = { EST, IAS, perguntar, consultarBiblioteca, procurar, lerArtigo, montarRelatorio, avisarSW, palavrasChave };

partida();
