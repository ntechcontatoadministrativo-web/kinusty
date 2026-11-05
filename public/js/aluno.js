const conteudo = document.getElementById('conteudo');
let resumo = null;

async function carregarResumo() {
  resumo = await api('/api/aluno/resumo');
  document.getElementById('nome-usuario').textContent = resumo.perfil.nome;
  document.getElementById('avatar').outerHTML = avatar(resumo.perfil).replace('class="avatar"', 'class="avatar" id="avatar"');
  const pend = resumo.em_atraso;
  const cont = document.getElementById('cont-mens');
  cont.textContent = pend;
  cont.classList.toggle('oculto', !pend);
  return resumo;
}

const topo = (titulo, sub = '') => `<div class="conteudo-topo"><div><h1>${titulo}</h1>${sub ? `<p>${sub}</p>` : ''}</div></div>`;

// ---------- PIX copia e cola (padrão BR Code do Banco Central) ----------
function campoPix(id, valor) { return id + String(valor.length).padStart(2, '0') + valor; }
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}
function payloadPix(chave, valor, txid) {
  const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const corpo = campoPix('00', '01')
    + campoPix('26', campoPix('00', 'br.gov.bcb.pix') + campoPix('01', chave))
    + campoPix('52', '0000') + campoPix('53', '986') + campoPix('54', Number(valor).toFixed(2))
    + campoPix('58', 'BR') + campoPix('59', semAcento('Kinusty Volleyball').slice(0, 25)) + campoPix('60', 'BELEM')
    + campoPix('62', campoPix('05', txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25)))
    + '6304';
  return corpo + crc16(corpo);
}

function abrirPagamento(m) {
  const codigo = payloadPix(resumo.pix, m.valor, `KV${m.id}${m.competencia.replace('-', '')}`);
  const box = abrirModal(`
    <h2>Pagar mensalidade</h2>
    <p class="muted" style="margin-top:0">${competenciaBR(m.competencia, true)} · vence em ${dataBR(m.vencimento)}</p>
    ${resumo.mercadopago ? `<div class="card mp-card">
      <div><strong>Pagar online com Mercado Pago</strong>
        <p class="muted" style="margin:.2rem 0 0;font-size:.9rem">PIX, cartão ou boleto · ${moeda(m.valor)} · confirmação automática</p></div>
      <button class="btn btn-gold" id="pagar-mp">Pagar agora</button>
    </div>
    <p class="hint" style="margin:0 0 1rem">Ou pague direto pela chave PIX da escolinha:</p>` : ''}
    <div class="flex" style="align-items:flex-start;gap:1.5rem">
      <div id="qr" style="background:#fff;padding:10px;border-radius:12px;width:200px;height:200px;display:grid;place-items:center;flex-shrink:0"></div>
      <div style="flex:1;min-width:220px">
        <div class="kpi destaque" style="margin-bottom:1rem"><div class="rotulo">Valor</div><div class="valor">${moeda(m.valor)}</div></div>
        <label>PIX copia e cola</label>
        <div class="pix-box" id="pix-codigo">${esc(codigo)}</div>
        <div class="flex mt">
          <button class="btn btn-outline btn-sm" id="copiar">Copiar código</button>
        </div>
        <p class="hint">Chave PIX: <strong>${esc(resumo.pix)}</strong></p>
      </div>
    </div>
    <div class="card mt" style="background:var(--bg-2)">
      <strong>Já pagou?</strong>
      <p class="muted" style="margin:.2rem 0 1rem;font-size:.9rem">Informe o pagamento e a escolinha confirma. Se quiser, envie o comprovante pelo WhatsApp.</p>
      <div class="flex">
        <button class="btn btn-gold btn-sm" id="informar">Informar pagamento</button>
        <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${linkWhats(resumo.whatsapp, `Olá! Segue o comprovante da mensalidade de ${competenciaBR(m.competencia, true)} — ${resumo.perfil.nome}`)}">Enviar comprovante 📎</a>
      </div>
    </div>`);
  if (window.qrcode) {
    const qr = qrcode(0, 'M'); qr.addData(codigo); qr.make();
    box.querySelector('#qr').innerHTML = qr.createSvgTag(4, 0);
    box.querySelector('#qr svg').style.cssText = 'width:100%;height:100%';
  } else box.querySelector('#qr').innerHTML = '<span style="color:#333;font-size:.8rem;text-align:center">Use o código copia e cola</span>';
  box.querySelector('#copiar').onclick = () => navigator.clipboard.writeText(codigo).then(() => toast('Código PIX copiado!'));
  box.querySelector('#pagar-mp')?.addEventListener('click', async e => {
    e.target.disabled = true; e.target.textContent = 'Abrindo...';
    try { location.href = (await api(`/api/aluno/mensalidades/${m.id}/mercadopago`, { method: 'POST' })).url; }
    catch (err) { toast(err.message, 'erro'); e.target.disabled = false; e.target.textContent = 'Pagar agora'; }
  });
  box.querySelector('#informar').onclick = async () => {
    try {
      await api(`/api/aluno/mensalidades/${m.id}/informar-pagamento`, { method: 'POST', body: { forma: 'PIX' } });
      fecharModal(); toast('Pagamento informado! Aguarde a confirmação.');
      await carregarResumo(); render(abaAtual);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function trocarFoto(depois) {
  try {
    const foto = await escolherFoto();
    if (!foto) return;
    await api('/api/aluno/foto', { method: 'PUT', body: { foto } });
    toast('Foto salva!'); depois();
  } catch (e) { toast(e.message, 'erro'); }
}

// ---------- Notificações no celular (chegam como as do WhatsApp, mesmo com o site fechado) ----------
const push = {
  suportado: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  ios: /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  async inscricao() {
    if (!this.suportado) return null;
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? reg.pushManager.getSubscription() : null;
  },
  // ativo | inativo | bloqueado | instalar (iPhone fora da Tela de Início) | sem-suporte
  async estado() {
    if (!this.suportado) return this.ios ? 'instalar' : 'sem-suporte';
    if (Notification.permission === 'denied') return 'bloqueado';
    return Notification.permission === 'granted' && await this.inscricao() ? 'ativo' : 'inativo';
  },
  async ativar() {
    if (await Notification.requestPermission() !== 'granted') throw new Error('Você não permitiu as notificações. Libere nas configurações do navegador.');
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const { chave } = await api('/api/push/chave');
    const b64 = (chave + '='.repeat((4 - chave.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) });
    await api('/api/aluno/push', { method: 'POST', body: { inscricao: sub.toJSON() } });
  },
  async desativar() {
    const sub = await this.inscricao();
    if (!sub) return;
    await api('/api/aluno/push', { method: 'DELETE', body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  },
  // Ao abrir o site: confirma no servidor que este aparelho é deste aluno
  async sincronizar() {
    if (!this.suportado) return;
    await navigator.serviceWorker.register('/sw.js');
    const sub = Notification.permission === 'granted' && await this.inscricao();
    if (sub) await api('/api/aluno/push', { method: 'POST', body: { inscricao: sub.toJSON() }, silencioso: true });
  },
};

const TEXTO_NOTIF = {
  inativo: 'Receba um aviso no celular 30 minutos antes do treino e, quando acabar, um lembrete para avaliar.',
  bloqueado: 'As notificações estão bloqueadas neste navegador. Toque no cadeado ao lado do endereço do site e permita as notificações.',
  instalar: 'No iPhone: toque em Compartilhar ⬆️ → "Adicionar à Tela de Início", abra o Kinusty pelo ícone e ative as notificações por lá.',
};

async function cartaoNotificacoes() {
  const estado = await push.estado();
  if (!TEXTO_NOTIF[estado]) return '';
  return `<div class="card notif-card"><div><strong>🔔 Ative as notificações dos treinos</strong><p class="texto-2">${TEXTO_NOTIF[estado]}</p></div>
    ${estado === 'inativo' ? '<button class="btn btn-gold btn-sm" data-ativar-notif>Ativar notificações</button>' : ''}</div>`;
}

function ligarBotoesNotif(depois) {
  conteudo.querySelectorAll('[data-ativar-notif]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await push.ativar(); toast('Notificações ativadas! 🔔'); depois(); }
    catch (e) { toast(e.message, 'erro'); b.disabled = false; }
  });
}

// ---------- Avaliação do treino ----------
const ROTULO_NOTA = ['', 'Ruim 😕', 'Regular 😐', 'Bom 🙂', 'Muito bom 😄', 'Excelente! 🤩'];
function abrirAvaliacao(av, depois) {
  const box = abrirModal(`
    <h2>Como foi o treino?</h2>
    <p class="muted" style="margin-top:0">${esc(av.dia || '')} ${dataBR(av.data)}${av.turma ? ` · ${esc(av.turma)}` : ''}</p>
    <div class="estrelas">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-nota="${n}" aria-label="${n} estrela(s)">★</button>`).join('')}</div>
    <p class="rotulo-nota" id="rotulo-nota"></p>
    <div class="campo"><label>Quer deixar um comentário? (opcional)</label>
      <textarea id="coment-aval" rows="3" maxlength="500" placeholder="O que você achou do treino, do professor, dos exercícios..."></textarea></div>
    <button class="btn btn-gold" id="enviar-aval" style="width:100%">Enviar avaliação</button>`);
  let nota = 0;
  const estrelas = box.querySelectorAll('[data-nota]');
  estrelas.forEach(b => b.onclick = () => {
    nota = Number(b.dataset.nota);
    estrelas.forEach(e => e.classList.toggle('on', Number(e.dataset.nota) <= nota));
    box.querySelector('#rotulo-nota').textContent = ROTULO_NOTA[nota];
  });
  box.querySelector('#enviar-aval').onclick = async e => {
    if (!nota) return toast('Toque nas estrelas para dar a sua nota.', 'erro');
    e.target.disabled = true;
    try {
      await api('/api/aluno/avaliacoes', { method: 'POST', body: { data: av.data, nota, comentario: box.querySelector('#coment-aval').value } });
      fecharModal(); toast('Obrigado pela avaliação! 🏐'); depois?.();
    } catch (err) { toast(err.message, 'erro'); e.target.disabled = false; }
  };
}

// Veio pela notificação "avalie o treino": abre a avaliação direto
function avaliacaoDoLink() {
  const data = new URLSearchParams(location.search).get('avaliar');
  if (!data) return;
  history.replaceState(null, '', location.pathname + location.hash);
  const p = resumo?.avaliacao_pendente;
  if (p?.data === data) abrirAvaliacao(p, abas.inicio);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(data)) abrirAvaliacao({ data, turma: resumo?.matricula?.turma_nome }, abas.inicio);
}

const valorPlano = mat => !mat ? '–' : mat.grupo_id && !mat.valor_mensal ? 'pago pelo titular do plano' : `${moeda(mat.valor_mensal)}/mês`;

// ---------- Abas ----------
const abas = {
  async inicio() {
    const r = await carregarResumo();
    const mat = r.matricula;
    const boasVindas = new URLSearchParams(location.search).has('bemvindo');
    const m = r.mensalidade_aberta;
    const primeiroNome = r.perfil.nome.split(' ')[0];
    conteudo.innerHTML = `
      ${topo(`Olá, ${esc(primeiroNome)}! 👋`, mat ? `${esc(mat.turma_nome)} · ${diasTexto(mat.dias)} · ${mat.horario_inicio}–${mat.horario_fim}` : '')}
      ${boasVindas ? `<div class="card boas-vindas" style="margin-bottom:1rem">
        <h3>🎉 Matrícula realizada com sucesso!</h3>
        <p class="texto-2" style="margin:0">Bem-vindo(a) à família Kinusty! Sua primeira mensalidade já está disponível em <strong>Mensalidades</strong>. Nos vemos na quadra 🏐</p></div>` : ''}
      ${await cartaoNotificacoes()}
      ${r.avaliacao_pendente ? `<div class="card notif-card"><div><strong>⭐ Como foi o treino de ${r.avaliacao_pendente.dia.toLowerCase()}?</strong>
        <p class="texto-2">${dataBR(r.avaliacao_pendente.data)} · ${esc(r.avaliacao_pendente.turma)} — sua opinião ajuda a escolinha a melhorar.</p></div>
        <button class="btn btn-gold btn-sm" id="avaliar-treino">Avaliar treino</button></div>` : ''}
      ${!r.perfil.tem_foto ? `<div class="card pausa-card flex space" style="margin-bottom:1rem"><span>📷 Falta a sua foto no cadastro da escolinha.</span>
        <button class="btn btn-gold btn-sm" id="add-foto">Adicionar foto</button></div>` : ''}
      ${mat?.status === 'trancada' ? `<div class="card pausa-card" style="margin-bottom:1rem"><strong>⏸ Sua matrícula está pausada</strong>
        <p class="muted" style="margin:.3rem 0 0">${mat.pausa_ate ? `Até ${dataBR(mat.pausa_ate)}. Ela volta a ficar ativa sozinha no dia seguinte.` : 'Fale com a escolinha quando quiser voltar.'} Durante a pausa não há mensalidades nem treinos.</p></div>`
      : mat && mat.status !== 'ativa' ? `<div class="erro-msg">Sua matrícula está <strong>${ROTULO_STATUS[mat.status]}</strong>. Fale com a escolinha para reativar.</div>` : ''}

      <div class="kpis">
        <div class="kpi destaque"><div class="rotulo">Plano</div><div class="valor">${mat?.dias_semana ?? '–'}x/sem</div><div class="sub">${valorPlano(mat)}</div></div>
        <div class="kpi"><div class="rotulo">Status</div><div class="valor" style="font-size:1.2rem;margin:.6rem 0">${mat ? badge(mat.status) : '–'}</div><div class="sub">Aluno desde ${dataBR(mat?.data_inicio)}</div></div>
        <div class="kpi"><div class="rotulo">Frequência (30 dias)</div><div class="valor">${r.frequencia_30d.taxa ?? '–'}${r.frequencia_30d.taxa !== null ? '%' : ''}</div><div class="sub">${r.frequencia_30d.presentes} presenças em ${r.frequencia_30d.total} aulas</div></div>
        <div class="kpi"><div class="rotulo">Próxima mensalidade</div>
          <div class="valor">${m ? moeda(m.valor) : 'Em dia ✓'}</div>
          <div class="sub">${m ? `${badge(m.status)} vence ${dataBR(m.vencimento)}` : 'Nenhuma pendência'}</div></div>
      </div>

      <div class="grid-dash">
        <div class="card">
          <div class="card-head"><h3>Próximos treinos</h3>
            ${r.treina_hoje ? (r.checkin_hoje ? '<span class="badge b-paga">Presença confirmada hoje</span>' : '<button class="btn btn-gold btn-sm" id="btn-checkin">✋ Fazer check-in de hoje</button>') : ''}
          </div>
          ${r.proximas_aulas.length ? r.proximas_aulas.map(a => {
            const [, mes, dia] = a.data.split('-');
            return `<div class="aula"><div class="data-box"><small>${MESES[mes - 1]}</small><strong>${dia}</strong></div>
              <div><strong>${a.dia}</strong><div class="muted" style="font-size:.85rem">${a.horario} · ${esc(mat.turma_nome)}</div></div></div>`;
          }).join('') : '<p class="muted">Nenhum treino agendado.</p>'}
        </div>
        <div class="card">
          <div class="card-head"><h3>Mural de avisos</h3></div>
          ${r.avisos.length ? r.avisos.slice(0, 3).map(a => `<div class="aviso-item"><strong>${esc(a.titulo)}</strong><div class="hint">${dataBR(a.criado_em)}</div><p>${esc(a.mensagem)}</p></div>`).join('') : '<p class="muted">Nenhum aviso no momento.</p>'}
        </div>
      </div>
      ${m ? `<div class="card flex space"><div><strong>Mensalidade de ${competenciaBR(m.competencia, true)}</strong><div class="muted">${moeda(m.valor)} · vence ${dataBR(m.vencimento)}</div></div>
        ${m.status === 'em_analise' ? badge('em_analise') : `<button class="btn btn-gold" id="pagar-agora">${r.mercadopago ? 'Pagar mensalidade' : 'Pagar com PIX'}</button>`}</div>` : ''}`;

    document.getElementById('btn-checkin')?.addEventListener('click', async () => {
      try { await api('/api/aluno/checkin', { method: 'POST' }); toast('Presença confirmada! Bom treino 🏐'); abas.inicio(); }
      catch (e) { toast(e.message, 'erro'); }
    });
    document.getElementById('pagar-agora')?.addEventListener('click', () => abrirPagamento(m));
    document.getElementById('add-foto')?.addEventListener('click', () => trocarFoto(abas.inicio));
    document.getElementById('avaliar-treino')?.addEventListener('click', () => abrirAvaliacao(r.avaliacao_pendente, abas.inicio));
    ligarBotoesNotif(abas.inicio);
    avaliacaoDoLink();
  },

  async mensalidades() {
    const lista = await api('/api/aluno/mensalidades');
    const pagas = lista.filter(m => m.status === 'paga');
    conteudo.innerHTML = `${topo('Mensalidades', resumo.mercadopago ? 'Acompanhe seus pagamentos e pague por PIX, cartão ou boleto' : 'Acompanhe seus pagamentos e pague via PIX')}
      <div class="kpis">
        <div class="kpi"><div class="rotulo">Total pago</div><div class="valor">${moeda(pagas.reduce((a, m) => a + m.valor, 0))}</div><div class="sub">${pagas.length} mensalidade(s)</div></div>
        <div class="kpi"><div class="rotulo">Em aberto</div><div class="valor">${moeda(lista.filter(m => ['pendente', 'atrasada'].includes(m.status)).reduce((a, m) => a + m.valor, 0))}</div></div>
        <div class="kpi"><div class="rotulo">Em atraso</div><div class="valor ${resumo.em_atraso ? 'delta-down' : ''}">${resumo.em_atraso}</div></div>
        <div class="kpi"><div class="rotulo">Chave PIX</div><div class="valor" style="font-size:.95rem;word-break:break-all">${esc(resumo.pix)}</div></div>
      </div>
      <div class="card"><div class="tabela-wrap"><table>
        <thead><tr><th>Referência</th><th>Vencimento</th><th class="num">Valor</th><th>Status</th><th>Pago em</th><th></th></tr></thead>
        <tbody>${lista.map(m => `<tr>
          <td><strong>${competenciaBR(m.competencia, true)}</strong></td>
          <td>${dataBR(m.vencimento)}</td><td class="num">${moeda(m.valor)}</td><td>${badge(m.status)}</td>
          <td>${m.pago_em ? `${dataBR(m.pago_em)} <span class="muted">· ${esc(m.forma_pagamento || '')}</span>` : '—'}</td>
          <td class="num">${['pendente', 'atrasada'].includes(m.status) ? `<button class="btn btn-gold btn-sm" data-pagar="${m.id}">Pagar</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma mensalidade ainda.</td></tr>'}</tbody>
      </table></div></div>`;
    conteudo.querySelectorAll('[data-pagar]').forEach(b => b.onclick = () => abrirPagamento(lista.find(m => m.id == b.dataset.pagar)));
  },

  async frequencia() {
    const [lista] = await Promise.all([api('/api/aluno/presencas'), carregarResumo()]);
    const presentes = lista.filter(p => p.presente).length;
    // Sequência atual de presenças consecutivas
    let seq = 0; for (const p of lista) { if (p.presente) seq++; else break; }
    conteudo.innerHTML = `${topo('Frequência', 'Seu histórico de treinos')}
      <div class="kpis">
        <div class="kpi destaque"><div class="rotulo">Últimos 30 dias</div><div class="valor">${resumo.frequencia_30d.taxa ?? '–'}${resumo.frequencia_30d.taxa !== null ? '%' : ''}</div><div class="sub">${resumo.frequencia_30d.presentes}/${resumo.frequencia_30d.total} aulas</div></div>
        <div class="kpi"><div class="rotulo">Total de treinos</div><div class="valor">${presentes}</div><div class="sub">desde a matrícula</div></div>
        <div class="kpi"><div class="rotulo">Sequência atual</div><div class="valor">${seq} 🔥</div><div class="sub">treinos seguidos</div></div>
        <div class="kpi"><div class="rotulo">Faltas</div><div class="valor">${lista.length - presentes}</div><div class="sub">registradas</div></div>
      </div>
      <div class="card"><div class="tabela-wrap"><table>
        <thead><tr><th>Data</th><th>Turma</th><th>Situação</th><th>Registro</th></tr></thead>
        <tbody>${lista.map(p => `<tr><td>${dataBR(p.data)}</td><td>${esc(p.turma || '—')}</td>
          <td>${p.presente ? '<span class="badge b-paga">Presente</span>' : '<span class="badge b-atrasada">Falta</span>'}</td>
          <td class="muted">${p.origem === 'checkin' ? 'Check-in pelo app' : 'Chamada do professor'}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Ainda não há registros de presença.</td></tr>'}</tbody>
      </table></div></div>`;
  },

  async plano() {
    const [info] = await Promise.all([api('/api/publico/info'), carregarResumo()]);
    const mat = resumo.matricula;
    // Planos casal/família só são alterados pela escolinha
    const emGrupo = !!mat.grupo_id;
    conteudo.innerHTML = `${topo('Meu plano', emGrupo ? 'Seu plano em grupo' : 'Altere seu plano, turma ou dias de treino')}
      <div class="grid-dash">
        ${emGrupo ? `<div class="card">
          <h3>Pessoas no plano</h3>
          <ul class="lista">${resumo.grupo.map(g => `<li><div><strong>${esc(g.nome)}</strong><div class="sec">${esc(g.turma)}</div></div>${g.titular ? '<span class="badge b-ativa">Titular</span>' : ''}</li>`).join('')}</ul>
          <p class="muted" style="font-size:.9rem">Para mudar o plano, os dias ou as pessoas do grupo, fale com a escolinha.</p>
        </div>` : `<div class="card">
          <h3>Alterar plano</h3>
          <p class="muted" style="margin-top:0;font-size:.9rem">A mudança de valor passa a valer na próxima mensalidade gerada.</p>
          <div id="seletor"></div>
          <button class="btn btn-gold" id="salvar-plano">Salvar alterações</button>
        </div>`}
        <div class="card">
          <h3>Plano atual</h3>
          <div class="resumo-box">
            <div><span>Plano</span><strong>${esc(mat.plano_nome)}</strong></div>
            <div><span>Valor</span><strong class="gold">${valorPlano(mat)}</strong></div>
            <div><span>Turma</span><strong>${esc(mat.turma_nome)}</strong></div>
            <div><span>Horário</span><strong>${mat.horario_inicio}–${mat.horario_fim}</strong></div>
            <div><span>Dias</span><strong>${diasTexto(mat.dias)}</strong></div>
            <div><span>Nível</span><strong>${NIVEIS[mat.nivel]}</strong></div>
            <div><span>Vencimento</span><strong>todo dia ${mat.dia_vencimento}</strong></div>
          </div>
          <p class="muted mt" style="font-size:.85rem">Precisa pausar ou cancelar? <a target="_blank" rel="noopener" href="${linkWhats(resumo.whatsapp, 'Olá! Gostaria de falar sobre a minha matrícula na Kinusty.')}">Fale com a escolinha</a>.</p>
        </div>
      </div>`;
    if (emGrupo) return;
    const individuais = { ...info, planos: info.planos.filter(p => p.tipo === 'individual') };
    const sel = seletorPlano(document.getElementById('seletor'), individuais, { plano_id: mat.plano_id, turma_id: mat.turma_id, dias: mat.dias.split(',') });
    document.getElementById('salvar-plano').onclick = async () => {
      const erro = sel.valido();
      if (erro) return toast(erro, 'erro');
      try { await api('/api/aluno/plano', { method: 'PUT', body: sel.estado }); toast('Plano atualizado!'); abas.plano(); }
      catch (e) { toast(e.message, 'erro'); }
    };
  },

  async comunidade() {
    const r = resumo || await carregarResumo();
    return montarComunidade(conteudo, { eu: r.perfil, admin: false });
  },

  async avisos() {
    await carregarResumo();
    conteudo.innerHTML = `${topo('Avisos', 'Comunicados da Kinusty')}
      <div class="card">${resumo.avisos.map(a => `<div class="aviso-item"><strong>${esc(a.titulo)}</strong><div class="hint">${dataBR(a.criado_em)}</div><p>${esc(a.mensagem)}</p></div>`).join('') || '<p class="vazio">Nenhum aviso no momento.</p>'}</div>`;
  },

  async perfil() {
    const { perfil: p } = await carregarResumo();
    conteudo.innerHTML = `${topo('Meus dados')}
      <div class="grid-dash">
        <form class="card" id="f-perfil">
          <h3>Dados pessoais</h3>
          <div class="foto-escolha campo">${avatar(p, 88)}<button type="button" class="btn btn-outline btn-sm" id="trocar-foto">${p.tem_foto ? 'Trocar foto' : '📷 Adicionar foto'}</button></div>
          <div class="campo"><label>Nome completo</label><input name="nome" value="${esc(p.nome)}" required></div>
          <div class="grid-2">
            <div class="campo"><label>E-mail (login)</label><input value="${esc(p.email)}" disabled></div>
            <div class="campo"><label>Data de nascimento</label><input value="${dataBR(p.nascimento)}" disabled></div>
            <div class="campo"><label>WhatsApp</label><input name="telefone" value="${esc(p.telefone || '')}"></div>
            <div class="campo"><label>Contato de emergência</label><input name="contato_emergencia" value="${esc(p.contato_emergencia || '')}"></div>
          </div>
          <div class="campo"><label>Endereço</label><input name="endereco" value="${esc(p.endereco || '')}"></div>
          <div class="grid-2">
            <div class="campo"><label>Bairro</label><input name="bairro" value="${esc(p.bairro || '')}"></div>
            <div class="campo"><label>Cidade</label><input name="cidade" value="${esc(p.cidade || '')}"></div>
            <div class="campo"><label>Responsável</label><input name="responsavel" value="${esc(p.responsavel || '')}"></div>
            <div class="campo"><label>Parentesco</label><input name="parentesco_responsavel" value="${esc(p.parentesco_responsavel || '')}"></div>
            <div class="campo"><label>Telefone do responsável</label><input name="telefone_responsavel" value="${esc(p.telefone_responsavel || '')}"></div>
            <div class="campo"><label>E-mail do responsável</label><input name="email_responsavel" type="email" value="${esc(p.email_responsavel || '')}"></div>
          </div>
          <div class="campo"><label>Observações de saúde</label><textarea name="observacoes_saude">${esc(p.observacoes_saude || '')}</textarea></div>
          <div class="campo"><label>Uso de imagem para divulgação da escolinha</label><select name="autoriza_imagem">
            ${p.autoriza_imagem == null ? '<option value="">Não informado</option>' : ''}
            <option value="sim" ${p.autoriza_imagem === 1 ? 'selected' : ''}>Autorizo</option>
            <option value="nao" ${p.autoriza_imagem === 0 ? 'selected' : ''}>Não autorizo</option></select></div>
          <button class="btn btn-gold">Salvar</button>
        </form>
        <div style="display:grid;gap:1rem;align-self:start">
        <div class="card" id="card-notif"><h3>🔔 Notificações no celular</h3><p class="muted">Carregando...</p></div>
        <form class="card" id="f-senha">
          <h3>Alterar senha</h3>
          <div class="campo"><label>Senha atual</label><input type="password" name="atual" required autocomplete="current-password"></div>
          <div class="campo"><label>Nova senha</label><input type="password" name="nova" minlength="6" required autocomplete="new-password"></div>
          <button class="btn btn-outline">Alterar senha</button>
        </form>
        </div>
      </div>`;
    montarCardNotif();
    document.getElementById('trocar-foto').onclick = () => trocarFoto(abas.perfil);
    document.getElementById('f-perfil').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/aluno/perfil', { method: 'PUT', body: dadosForm(e.target) }); toast('Dados atualizados!'); carregarResumo(); }
      catch (err) { toast(err.message, 'erro'); }
    };
    document.getElementById('f-senha').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/aluno/senha', { method: 'PUT', body: dadosForm(e.target) }); toast('Senha alterada!'); e.target.reset(); }
      catch (err) { toast(err.message, 'erro'); }
    };
  },
};

async function montarCardNotif() {
  const card = document.getElementById('card-notif');
  if (!card) return;
  const estado = await push.estado();
  const ativo = estado === 'ativo';
  card.innerHTML = `<h3>🔔 Notificações no celular</h3>
    <p class="muted" style="margin-top:0;font-size:.9rem">${ativo ? '✅ Ativadas neste aparelho. Você recebe um aviso 30 minutos antes de cada treino e um pedido de avaliação quando ele acabar.'
      : TEXTO_NOTIF[estado] || 'Este navegador não recebe notificações. Abra o site pelo Chrome (Android) ou pelo ícone na Tela de Início (iPhone).'}</p>
    <div class="flex">${ativo ? `<button class="btn btn-outline btn-sm" id="testar-notif">Enviar notificação de teste</button>
      <button class="btn btn-ghost btn-sm" id="desativar-notif">Desativar</button>`
      : estado === 'inativo' ? '<button class="btn btn-gold btn-sm" data-ativar-notif>Ativar notificações</button>' : ''}</div>`;
  ligarBotoesNotif(montarCardNotif);
  card.querySelector('#testar-notif')?.addEventListener('click', async e => {
    e.target.disabled = true;
    try { await api('/api/aluno/push/teste', { method: 'POST' }); toast('Enviada! Ela deve aparecer em alguns segundos.'); }
    catch (err) { toast(err.message, 'erro'); }
    e.target.disabled = false;
  });
  card.querySelector('#desativar-notif')?.addEventListener('click', async () => {
    try { await push.desativar(); toast('Notificações desativadas.'); montarCardNotif(); }
    catch (err) { toast(err.message, 'erro'); }
  });
}

// ---------- Tutorial ----------
const esperarTela = () => new Promise(r => setTimeout(r, 450));
const passosTutorial = irAba => [
  { emoji: '👋', titulo: 'Bem-vindo(a) à sua área!', texto: 'Em 1 minuto você conhece tudo o que dá para fazer aqui. Use <strong>Próximo</strong> ou toque fora do balão para avançar.' },
  { alvo: '.menu [data-aba="inicio"]', emoji: '🏠', titulo: 'Início', texto: 'Seus próximos treinos, o check-in do dia, a frequência e a próxima mensalidade, tudo num lugar só.' },
  { alvo: '.notif-card [data-ativar-notif], #btn-checkin', emoji: '🔔', titulo: 'Avisos no celular', texto: 'Ative as notificações para receber um lembrete 30 minutos antes do treino e um pedido de avaliação quando ele acabar, como uma mensagem do WhatsApp.',
    antes: async () => { if (abaAtual !== 'inicio') { irAba('inicio'); await esperarTela(); } } },
  { alvo: '.menu [data-aba="mensalidades"]', emoji: '💳', titulo: 'Mensalidades', texto: 'Veja o que já foi pago e pague a mensalidade pelo PIX copia e cola ou online, sem sair do site.' },
  { alvo: '.menu [data-aba="frequencia"]', emoji: '📅', titulo: 'Frequência', texto: 'Seu histórico de treinos, a sequência de presenças 🔥 e as faltas.' },
  { alvo: '.menu [data-aba="plano"]', emoji: '🏐', titulo: 'Meu plano', texto: 'Troque de plano, turma ou dias de treino quando precisar.' },
  { alvo: '.menu [data-aba="avisos"]', emoji: '📣', titulo: 'Avisos', texto: 'Comunicados da escolinha: feriados, mudanças de horário, eventos.' },
  { alvo: '.menu [data-aba="perfil"]', emoji: '👤', titulo: 'Meus dados', texto: 'Atualize sua foto e seus contatos, troque a senha e ligue ou desligue as notificações.' },
  { alvo: '.menu [data-aba="comunidade"]', emoji: '💬', titulo: 'Feed da turma', texto: 'Poste fotos, curta e comente os treinos com a galera da Kinusty.' },
  { alvo: '#ver-tutorial', emoji: '❓', titulo: 'Pronto!', texto: 'Quando quiser rever este tutorial, é só tocar aqui. Bons treinos! 🏐' },
];

let abaAtual = 'inicio';
function render(aba) {
  abaAtual = aba;
  conteudo.innerHTML = '<p class="muted">Carregando...</p>';
  abas[aba]().catch(e => { conteudo.innerHTML = `<div class="erro-msg">${esc(e.message)}</div>`; });
}

// Volta do checkout do Mercado Pago: confirma o pagamento antes de mostrar as telas
async function retornoMercadoPago() {
  const q = new URLSearchParams(location.search);
  if (q.get('mp') !== 'retorno') return;
  history.replaceState(null, '', location.pathname + '#mensalidades');
  const paymentId = q.get('payment_id') || q.get('collection_id');
  if (!paymentId || paymentId === 'null') return toast('Pagamento não concluído. Você pode tentar de novo quando quiser.', 'erro');
  try {
    const { status } = await api('/api/aluno/mercadopago/confirmar', { method: 'POST', body: { payment_id: paymentId } });
    if (status === 'approved') toast('Pagamento aprovado! Obrigado 🏐');
    else if (['pending', 'in_process', 'authorized'].includes(status)) toast('Pagamento em processamento. Ele será confirmado automaticamente.');
    else toast('O pagamento não foi aprovado. Tente novamente ou use outra forma.', 'erro');
  } catch (e) { toast(e.message, 'erro'); }
}

api('/api/me').then(async r => {
  if (r.user.role === 'admin') return (location.href = '/admin.html');
  await retornoMercadoPago();
  const irAba = iniciarMenu(render);
  push.sincronizar().catch(() => {});
  const passos = passosTutorial(irAba);
  document.getElementById('ver-tutorial').onclick = () => Tutorial.iniciar(passos, 'kv_tutorial_aluno');
  Tutorial.primeiraVez(passos, 'kv_tutorial_aluno');
});

// QR code do PIX
const s = document.createElement('script');
s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
document.head.appendChild(s);
