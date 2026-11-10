/* Kit Offline — baixa um pacote do Kiwix (.zim) para dentro do aparelho.

   O pacote fica na nossa própria hospedagem, dividido em partes, porque o único
   servidor do Kiwix que aceita download vindo de uma página é lento demais.
   Roda num worker porque gravar arquivo grande só funciona igual no Chrome, no
   Safari e no Firefox por aqui (createSyncAccessHandle). */

self.onmessage = async (e) => {
  const { nome, base, partes, bytes, pular } = e.data || {};
  let acesso = null;
  try {
    const raiz = await navigator.storage.getDirectory();
    const arq = await raiz.getFileHandle(nome, { create: true });
    acesso = await arq.createSyncAccessHandle();

    /* retomada: só pula as partes que já estão inteiras no arquivo */
    let feitas = Math.max(0, pular | 0), feito = 0;
    for (let i = 0; i < feitas; i++) feito += partes[i].bytes;
    if (acesso.getSize() < feito) { feitas = 0; feito = 0; }
    acesso.truncate(feito);

    let avisou = 0;
    for (let i = feitas; i < partes.length; i++) {
      const res = await fetch(base + partes[i].arquivo, { cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error('o servidor respondeu ' + res.status);
      const leitor = res.body.getReader();
      let daParte = 0;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        acesso.write(value, { at: feito });
        feito += value.byteLength; daParte += value.byteLength;
        const agora = Date.now();
        if (agora - avisou > 250) { avisou = agora; self.postMessage({ tipo: 'progresso', feito, total: bytes }); }
      }
      if (daParte !== partes[i].bytes) throw new Error('uma parte chegou incompleta');
      acesso.flush();
      self.postMessage({ tipo: 'parte', feitas: i + 1, feito, total: bytes });
    }
    acesso.close(); acesso = null;

    if (feito !== bytes) throw new Error('o download parou no meio (' + feito + ' de ' + bytes + ')');
    self.postMessage({ tipo: 'fim', feito });
  } catch (err) {
    try { if (acesso) acesso.close(); } catch (_) {}
    self.postMessage({ tipo: 'erro', erro: String((err && err.message) || err) });
  }
};
