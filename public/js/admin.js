const conteudo = document.getElementById('conteudo');
const graficos = [];
let info = null; // planos/turmas para filtros e edição

const topo = (titulo, sub = '', acoes = '') => `<div class="conteudo-topo"><div><h1>${titulo}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="flex">${acoes}</div></div>`;
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- Gráficos (Chart.js) ----------
const COR = { gold: '#f2c418', goldFill: 'rgba(242,196,24,.85)', cinza: '#85837b', texto: '#b9b6ab', grade: 'rgba(255,255,255,.06)', superficie: '#1a1a1d' };
if (window.Chart) {
  Chart.defaults.color = COR.texto;
  Chart.defaults.font.family = 'Poppins, system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.plugins.tooltip.backgroundColor = '#26262b';
  Chart.defaults.plugins.tooltip.borderColor = '#3a3a40';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.titleColor = '#f3f1ea';
  Chart.defaults.plugins.tooltip.bodyColor = '#f3f1ea';
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
}
function limparGraficos() { while (graficos.length) graficos.pop().destroy(); }
function grafico(id, config) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  graficos.push(new Chart(el, config));
}
const eixos = (fmtY = v => v) => ({
  x: { grid: { display: false }, border: { color: '#2c2c31' } },
  y: { beginAtZero: true, grid: { color: COR.grade }, border: { display: false }, ticks: { callback: fmtY, maxTicksLimit: 5 } },
});

const nomePlano = p => (p.nome || p).replace(/^Plano /, '');
const SEXO = { F: 'Feminino', M: 'Masculino', O: 'Outro' };
const simNaoTxt = v => v === 1 ? 'Sim' : v === 0 ? 'Não' : '—';

// ---------- Abas ----------
const abas = {
  async dashboard() {
    const d = await api('/api/admin/dashboard');
    const k = d.kpis;
    atualizarContador(k.em_analise);
    const pctRecebido = k.previsto_mes ? Math.round((k.recebido_mes / k.previsto_mes) * 100) : 0;
    const evo = d.evolucao;
    const crescimento = evo.length > 1 && evo[evo.length - 2].ativos ? Math.round(((evo[evo.length - 1].ativos - evo[evo.length - 2].ativos) / evo[evo.length - 2].ativos) * 100) : 0;
    const maxDia = Math.max(1, ...d.por_dia.map(x => x.alunos));
    const totalNivel = d.por_nivel.reduce((a, n) => a + n.n, 0) || 1;
    const totalIdade = d.por_idade.reduce((a, n) => a + n.n, 0) || 1;

    conteudo.innerHTML = `
      ${topo('Dashboard', `Visão geral · ${competenciaBR(d.competencia, true)}`, `<button class="btn btn-ghost btn-sm" onclick="render('dashboard')">↻ Atualizar</button>`)}

      ${k.em_analise ? `<div class="card flex space" style="margin-bottom:1rem;border-color:rgba(240,169,44,.4)">
        <span>⚠️ <strong>${k.em_analise}</strong> pagamento(s) informado(s) por alunos aguardando sua confirmação.</span>
        <button class="btn btn-sm btn-outline" onclick="irPara('financeiro', 'em_analise')">Conferir</button></div>` : ''}

      <div class="kpis">
        <div class="kpi destaque"><div class="rotulo">Alunos ativos</div><div class="valor">${k.alunos_ativos}</div>
          <div class="sub"><span class="${crescimento >= 0 ? 'delta-up' : 'delta-down'}">${crescimento >= 0 ? '▲' : '▼'} ${Math.abs(crescimento)}%</span> vs. mês anterior</div></div>
        <div class="kpi destaque"><div class="rotulo">Faturamento mensal (MRR)</div><div class="valor">${moeda(k.mrr)}</div>
          <div class="sub">Projeção anual: ${moedaCurta(k.projecao_anual)}</div></div>
        <div class="kpi"><div class="rotulo">Recebido no mês</div><div class="valor">${moeda(k.recebido_mes)}</div>
          <div class="barra-prog" style="margin:.4rem 0"><div style="width:${Math.min(100, pctRecebido)}%"></div></div>
          <div class="sub">${pctRecebido}% de ${moeda(k.previsto_mes)} previstos</div></div>
        <div class="kpi"><div class="rotulo">Em atraso</div><div class="valor ${k.em_atraso ? 'delta-down' : ''}">${moeda(k.em_atraso)}</div>
          <div class="sub">${k.inadimplentes} aluno(s) · ${k.taxa_inadimplencia}% de inadimplência</div></div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="rotulo">Novas matrículas no mês</div><div class="valor">${k.novos_mes}</div><div class="sub">${k.cancelamentos_mes} cancelamento(s) no mês</div></div>
        <div class="kpi"><div class="rotulo">Ticket médio</div><div class="valor">${moeda(k.ticket_medio)}</div><div class="sub">por aluno ativo</div></div>
        <div class="kpi"><div class="rotulo">A receber (em dia)</div><div class="valor">${moeda(k.a_receber)}</div><div class="sub">${k.a_receber_qtd} mensalidade(s)</div></div>
        <div class="kpi"><div class="rotulo">Frequência média (30d)</div><div class="valor">${k.frequencia_30d ?? '–'}${k.frequencia_30d !== null ? '%' : ''}</div><div class="sub">${k.trancados} trancado(s) · ${k.cancelados} cancelado(s)</div></div>
      </div>

      <div class="grid-dash">
        <div class="card">
          <div class="card-head"><h3>Faturamento — últimos 6 meses</h3><span class="muted" style="font-size:.8rem">por mês de referência</span></div>
          <div class="grafico"><canvas id="g-receita"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Alunos por plano</h3></div>
          <ul class="lista">${d.por_plano.map(p => `<li><div><strong>${esc(nomePlano(p))}</strong><div class="sec">${moeda(p.preco)}/mês</div></div>
            <div style="text-align:right"><strong>${p.alunos} alunos</strong><div class="sec">${moeda(p.receita)}/mês</div></div></li>`).join('')}</ul>
          <div class="grafico baixo mt"><canvas id="g-planos"></canvas></div>
        </div>
      </div>

      <div class="grid-dash">
        <div class="card">
          <div class="card-head"><h3>Evolução de alunos ativos</h3></div>
          <div class="grafico baixo"><canvas id="g-evolucao"></canvas></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Ocupação das turmas</h3><span class="muted" style="font-size:.8rem">dia mais cheio</span></div>
          ${d.por_turma.map(t => `<div style="margin-bottom:1rem">
            <div class="flex space" style="font-size:.9rem;margin-bottom:.3rem"><span><strong>${esc(t.nome)}</strong> <span class="muted">${t.horario}</span></span><span>${t.ocupacao_pico}/${t.capacidade}</span></div>
            <div class="barra-prog"><div style="width:${Math.min(100, t.ocupacao_pct)}%;${t.ocupacao_pct >= 90 ? 'background:var(--bad)' : ''}"></div></div>
            <div class="hint">${t.alunos} alunos matriculados · ${t.ocupacao_pct}% ocupada</div></div>`).join('')}
        </div>
      </div>

      <div class="grid-dash-3">
        <div class="card"><h3>Alunos por dia de treino</h3>
          ${d.por_dia.map(x => `<div style="margin:.8rem 0"><div class="flex space" style="font-size:.88rem"><span>${x.dia}</span><strong>${x.alunos}</strong></div>
            <div class="barra-prog"><div style="width:${(x.alunos / maxDia) * 100}%"></div></div></div>`).join('')}</div>
        <div class="card"><h3>Nível dos alunos</h3>
          ${['iniciante', 'intermediario', 'avancado'].map(n => { const v = d.por_nivel.find(x => x.nivel === n)?.n || 0; return `<div style="margin:.8rem 0"><div class="flex space" style="font-size:.88rem"><span>${NIVEIS[n]}</span><strong>${v} <span class="muted" style="font-weight:400">(${Math.round(v / totalNivel * 100)}%)</span></strong></div>
            <div class="barra-prog"><div style="width:${v / totalNivel * 100}%"></div></div></div>`; }).join('')}
          <h3 class="mt">Faixa etária</h3>
          ${d.por_idade.map(f => `<div style="margin:.6rem 0"><div class="flex space" style="font-size:.88rem"><span>${f.faixa} anos</span><strong>${f.n}</strong></div>
            <div class="barra-prog"><div style="width:${f.n / totalIdade * 100}%"></div></div></div>`).join('')}</div>
        <div class="card"><h3>🎂 Aniversariantes do mês</h3>
          <ul class="lista">${d.aniversariantes.map(a => `<li><span>${esc(a.nome)}</span><span class="sec">${dataBR(a.nascimento).slice(0, 5)}</span></li>`).join('') || '<li class="muted">Nenhum aniversariante este mês.</li>'}</ul></div>
      </div>

      <div class="grid-dash">
        <div class="card">
          <div class="card-head"><h3>Inadimplentes</h3><button class="btn btn-ghost btn-sm" onclick="irPara('financeiro', 'atrasada')">Ver todos →</button></div>
          <div class="tabela-wrap"><table><thead><tr><th>Aluno</th><th>Parcelas</th><th>Desde</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>${d.inadimplentes.map(i => `<tr><td><a href="#" onclick="verAluno(${i.id});return false">${esc(i.nome)}</a></td><td>${i.parcelas}</td><td>${dataBR(i.desde)}</td>
            <td class="num delta-down">${moeda(i.total)}</td>
            <td class="num">${i.telefone ? `<a class="btn btn-sm btn-success" target="_blank" rel="noopener" href="${linkWhats(i.telefone, `Olá, ${i.nome.split(' ')[0]}! Tudo bem? Aqui é da Kinusty Volleyball. Identificamos ${i.parcelas} mensalidade(s) em aberto no valor de ${moeda(i.total)}. Qualquer dúvida estamos à disposição 🏐`)}">Cobrar</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Ninguém em atraso 🎉</td></tr>'}</tbody></table></div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Últimas matrículas</h3></div>
          <ul class="lista">${d.ultimas.map(u => `<li><div><a href="#" onclick="verAluno(${u.id});return false">${esc(u.nome)}</a><div class="sec">${esc(u.turma)} · ${esc(u.plano)}</div></div><span class="sec">${dataBR(u.data_inicio)}</span></li>`).join('')}</ul>
        </div>
      </div>`;

    const rotulos = d.receita.map(r => competenciaBR(r.competencia));
    grafico('g-receita', {
      type: 'bar',
      data: {
        labels: rotulos,
        datasets: [
          { label: 'Recebido', data: d.receita.map(r => r.pago), backgroundColor: COR.goldFill, hoverBackgroundColor: COR.gold, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 38, order: 2 },
          { label: 'Previsto', data: d.receita.map(r => r.previsto), type: 'line', borderColor: COR.cinza, borderDash: [5, 4], borderWidth: 2, pointRadius: 4, pointBackgroundColor: COR.superficie, pointBorderColor: COR.cinza, pointBorderWidth: 2, order: 1 },
        ],
      },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${moeda(c.parsed.y)}` } } },
        scales: eixos(v => moedaCurta(v)),
      },
    });
    grafico('g-planos', {
      type: 'bar',
      data: { labels: d.por_plano.map(nomePlano), datasets: [{ label: 'Faturamento mensal', data: d.por_plano.map(p => p.receita), backgroundColor: COR.goldFill, hoverBackgroundColor: COR.gold, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 26 }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${moeda(c.parsed.x)}/mês` } } },
        scales: { x: { beginAtZero: true, grid: { color: COR.grade }, border: { display: false }, ticks: { callback: v => moedaCurta(v), maxTicksLimit: 4 } }, y: { grid: { display: false } } },
      },
    });
    grafico('g-evolucao', {
      type: 'line',
      data: { labels: evo.map(e => competenciaBR(e.competencia)), datasets: [{ label: 'Alunos ativos', data: evo.map(e => e.ativos), borderColor: COR.gold, backgroundColor: 'rgba(242,196,24,.12)', fill: true, tension: .3, borderWidth: 2, pointRadius: 4, pointBackgroundColor: COR.gold, pointBorderColor: COR.superficie, pointBorderWidth: 2 }] },
      options: {
        maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: c => `Novas matrículas: ${evo[c.dataIndex].novos}` } } },
        scales: eixos(),
      },
    });
  },

  async alunos(filtroInicial = {}) {
    conteudo.innerHTML = `${topo('Alunos', '', `<a class="btn btn-outline btn-sm" href="/api/admin/alunos.csv">⬇ Exportar planilha</a><a class="btn btn-gold btn-sm" href="/matricula.html" target="_blank">+ Nova matrícula</a>`)}
      <div class="filtros">
        <input type="search" id="f-busca" placeholder="Buscar por nome, e-mail ou telefone...">
        <select id="f-status"><option value="">Todos os status</option><option value="ativa">Ativos</option><option value="trancada">Trancados</option><option value="cancelada">Cancelados</option></select>
        <select id="f-turma"><option value="">Todas as turmas</option>${info.turmas.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join('')}</select>
        <select id="f-plano"><option value="">Todos os planos</option>${info.planos.map(p => `<option value="${p.id}">${esc(nomePlano(p))}</option>`).join('')}</select>
      </div>
      <div class="card"><div class="tabela-wrap" id="tabela-alunos"></div></div>`;
    if (filtroInicial.status) document.getElementById('f-status').value = filtroInicial.status;

    const carregar = async () => {
      const q = new URLSearchParams({ busca: val('f-busca'), status: val('f-status'), turma: val('f-turma'), plano: val('f-plano') });
      const lista = await api('/api/admin/alunos?' + q);
      document.getElementById('tabela-alunos').innerHTML = `<table>
        <thead><tr><th>Aluno</th><th>Turma</th><th>Plano</th><th>Dias</th><th>Status</th><th>Financeiro</th><th></th></tr></thead>
        <tbody>${lista.map(a => `<tr>
          <td><div class="flex" style="flex-wrap:nowrap"><div class="avatar" style="width:32px;height:32px;font-size:.75rem">${iniciais(a.nome)}</div>
            <div><strong>${esc(a.nome)}</strong><div class="muted" style="font-size:.8rem">${esc(a.telefone || a.email)}</div></div></div></td>
          <td>${esc(a.turma)}</td><td>${esc(nomePlano(a.plano))} <div class="muted" style="font-size:.8rem">${a.grupo_id && !a.preco ? 'no plano do titular' : moeda(a.preco)}</div></td>
          <td>${diasTexto(a.dias)}</td><td>${badge(a.status)}</td>
          <td>${a.atrasadas ? `<span class="badge b-atrasada">${a.atrasadas} em atraso</span>` : '<span class="badge b-paga">Em dia</span>'}</td>
          <td class="num"><button class="btn btn-sm" onclick="verAluno(${a.id})">Abrir</button></td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum aluno encontrado.</td></tr>'}</tbody>
      </table><p class="muted" style="font-size:.85rem;margin-bottom:0">${lista.length} aluno(s)</p>`;
    };
    let t;
    document.getElementById('f-busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 250); };
    ['f-status', 'f-turma', 'f-plano'].forEach(id => document.getElementById(id).onchange = carregar);
    carregar();
  },

  async financeiro(statusInicial = '') {
    const comp = hojeISO().slice(0, 7);
    conteudo.innerHTML = `${topo('Financeiro', 'Mensalidades, baixas e cobranças', `<button class="btn btn-outline btn-sm" id="gerar">Gerar mensalidades do mês</button>`)}
      <div class="filtros">
        <input type="search" id="f-busca" placeholder="Buscar aluno...">
        <input type="month" id="f-comp" value="${statusInicial ? '' : comp}">
        <select id="f-status"><option value="">Todos os status</option><option value="pendente">Pendentes</option><option value="em_analise">Em análise</option><option value="atrasada">Atrasadas</option><option value="paga">Pagas</option><option value="cancelada">Canceladas</option></select>
      </div>
      <div class="kpis" id="totais"></div>
      <div class="card"><div class="tabela-wrap" id="tabela"></div></div>`;
    document.getElementById('f-status').value = statusInicial;

    const carregar = async () => {
      const q = new URLSearchParams({ busca: val('f-busca'), competencia: val('f-comp'), status: val('f-status') });
      const r = await api('/api/admin/mensalidades?' + q);
      document.getElementById('totais').innerHTML = `
        <div class="kpi"><div class="rotulo">Recebido</div><div class="valor delta-up">${moeda(r.totais.paga)}</div></div>
        <div class="kpi"><div class="rotulo">Em análise</div><div class="valor" style="color:var(--warn)">${moeda(r.totais.em_analise)}</div></div>
        <div class="kpi"><div class="rotulo">Pendente</div><div class="valor" style="color:var(--info)">${moeda(r.totais.pendente)}</div></div>
        <div class="kpi"><div class="rotulo">Atrasado</div><div class="valor delta-down">${moeda(r.totais.atrasada)}</div></div>`;
      document.getElementById('tabela').innerHTML = `<table>
        <thead><tr><th>Aluno</th><th>Referência</th><th>Vencimento</th><th class="num">Valor</th><th>Status</th><th>Pagamento</th><th></th></tr></thead>
        <tbody>${r.itens.map(m => `<tr>
          <td><a href="#" onclick="verAluno(${m.user_id});return false">${esc(m.nome)}</a></td>
          <td>${competenciaBR(m.competencia)}</td><td>${dataBR(m.vencimento)}</td><td class="num">${moeda(m.valor)}</td><td>${badge(m.status)}</td>
          <td>${m.pago_em ? `${dataBR(m.pago_em)} <span class="muted">· ${esc(m.forma_pagamento || '')}</span>` : m.status === 'em_analise' ? `<span class="muted">Aluno informou ${esc(m.forma_pagamento || '')}</span>` : '—'}</td>
          <td class="num" style="white-space:nowrap">${acoesMensalidade(m)}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhuma mensalidade encontrada.</td></tr>'}</tbody></table>`;
      ligarAcoesMensalidade(document.getElementById('tabela'), carregar);
    };
    let t;
    document.getElementById('f-busca').oninput = () => { clearTimeout(t); t = setTimeout(carregar, 250); };
    ['f-comp', 'f-status'].forEach(id => document.getElementById(id).onchange = carregar);
    document.getElementById('gerar').onclick = async () => {
      const c = val('f-comp') || comp;
      const r = await api('/api/admin/mensalidades/gerar', { method: 'POST', body: { competencia: c } });
      toast(r.criadas ? `${r.criadas} mensalidade(s) gerada(s) para ${competenciaBR(c, true)}.` : 'Todas as mensalidades desse mês já existem.');
      carregar();
    };
    carregar();
  },

  async chamada() {
    conteudo.innerHTML = `${topo('Chamada', 'Registre a presença dos alunos no treino')}
      <div class="filtros">
        <input type="date" id="c-data" value="${hojeISO()}">
        <select id="c-turma">${info.turmas.map(t => `<option value="${t.id}">${esc(t.nome)} · ${t.horario_inicio}</option>`).join('')}</select>
      </div>
      <div class="card" id="lista-chamada"></div>`;
    const carregar = async () => {
      const r = await api(`/api/admin/chamada?data=${val('c-data')}&turma_id=${val('c-turma')}`);
      const doDia = r.alunos.filter(a => a.treina_no_dia);
      const outros = r.alunos.filter(a => !a.treina_no_dia);
      const estado = new Map(r.alunos.map(a => [a.id, a.presente === null ? null : !!a.presente]));
      const linha = a => `<div class="chamada-linha" data-id="${a.id}">
          <div><strong>${esc(a.nome)}</strong>${a.origem === 'checkin' ? ' <span class="badge b-paga">check-in</span>' : ''}<div class="muted" style="font-size:.8rem">${diasTexto(a.dias)}</div></div>
          <div class="toggle"><button data-v="1">Presente</button><button data-v="0">Falta</button></div></div>`;
      const box = document.getElementById('lista-chamada');
      box.innerHTML = `<div class="card-head"><h3>${r.dia}, ${dataBR(r.data)}</h3>
          <div class="flex"><button class="btn btn-ghost btn-sm" id="todos">Marcar todos presentes</button><button class="btn btn-gold btn-sm" id="salvar">Salvar chamada</button></div></div>
        ${doDia.length ? doDia.map(linha).join('') : '<p class="muted">Nenhum aluno desta turma treina neste dia.</p>'}
        ${outros.length ? `<details class="mt"><summary class="muted" style="cursor:pointer">Outros alunos da turma (reposição) — ${outros.length}</summary>${outros.map(linha).join('')}</details>` : ''}`;
      const pintar = () => box.querySelectorAll('.chamada-linha').forEach(l => {
        const v = estado.get(Number(l.dataset.id));
        l.querySelector('[data-v="1"]').className = v === true ? 'on-p' : '';
        l.querySelector('[data-v="0"]').className = v === false ? 'on-f' : '';
      });
      box.onclick = e => {
        const b = e.target.closest('[data-v]');
        if (b) { estado.set(Number(b.closest('.chamada-linha').dataset.id), b.dataset.v === '1'); pintar(); }
      };
      box.querySelector('#todos').onclick = () => { doDia.forEach(a => estado.set(a.id, true)); pintar(); };
      box.querySelector('#salvar').onclick = async () => {
        const presencas = [...estado].filter(([, v]) => v !== null).map(([user_id, presente]) => ({ user_id, presente }));
        await api('/api/admin/chamada', { method: 'POST', body: { data: r.data, turma_id: Number(val('c-turma')), presencas } });
        toast(`Chamada salva: ${presencas.filter(p => p.presente).length} presente(s).`);
      };
      pintar();
    };
    ['c-data', 'c-turma'].forEach(id => document.getElementById(id).onchange = carregar);
    carregar();
  },

  async turmas() {
    const [turmas, planos] = await Promise.all([api('/api/admin/turmas'), api('/api/admin/planos')]);
    conteudo.innerHTML = `${topo('Turmas e planos', '', `<button class="btn btn-gold btn-sm" id="nova-turma">+ Nova turma</button>`)}
      <div class="card" style="margin-bottom:1rem"><h3>Planos e valores</h3>
        <div class="tabela-wrap"><table><thead><tr><th>Plano</th><th>Dias/semana</th><th>Preço mensal</th><th>Ativo</th><th></th></tr></thead>
        <tbody>${planos.map(p => `<tr data-plano="${p.id}"><td><input value="${esc(p.nome)}" data-k="nome"></td><td>${p.dias_semana}x${p.dias_fixos ? ` (${diasTexto(p.dias_fixos)})` : ''}${p.pessoas > 1 ? ` · ${p.pessoas} pessoas` : ''}</td>
          <td><input type="number" step="0.01" min="1" value="${p.preco}" data-k="preco" style="max-width:130px"></td>
          <td><input type="checkbox" ${p.ativo ? 'checked' : ''} data-k="ativo" style="width:auto;accent-color:var(--gold)"></td>
          <td class="num"><button class="btn btn-sm btn-outline" data-salvar-plano>Salvar</button></td></tr>`).join('')}</tbody></table></div>
        <p class="hint">Mudanças de preço valem para as próximas mensalidades geradas.</p></div>
      <div class="horarios">${turmas.map(t => `<div class="horario" style="${t.ativo ? '' : 'opacity:.5'}">
        <span class="muted" style="font-size:.8rem">${esc(t.categoria || '')} ${t.ativo ? '' : '· inativa'}</span>
        <h3>${esc(t.nome)}</h3><div class="hora">${t.horario_inicio} às ${t.horario_fim}</div>
        <div class="chips">${t.dias.split(',').map(d => `<span class="chip">${DIAS_CURTOS[d]}: ${t.ocupacao[d] || 0}/${t.capacidade}</span>`).join('')}</div>
        <button class="btn btn-sm btn-ghost mt" data-editar-turma="${t.id}">Editar</button></div>`).join('')}</div>`;

    conteudo.querySelectorAll('[data-salvar-plano]').forEach(b => b.onclick = async () => {
      const tr = b.closest('tr');
      const g = k => tr.querySelector(`[data-k="${k}"]`);
      try {
        await api(`/api/admin/planos/${tr.dataset.plano}`, { method: 'PUT', body: { nome: g('nome').value, preco: Number(g('preco').value), ativo: g('ativo').checked } });
        toast('Plano atualizado!'); await carregarInfo();
      } catch (e) { toast(e.message, 'erro'); }
    });
    const formTurma = (t = {}) => {
      const box = abrirModal(`<h2>${t.id ? 'Editar turma' : 'Nova turma'}</h2><form id="f-turma">
        <div class="grid-2"><div class="campo"><label>Nome</label><input name="nome" value="${esc(t.nome || '')}" required></div>
          <div class="campo"><label>Categoria</label><input name="categoria" value="${esc(t.categoria || '')}" placeholder="Kids, Feminino, Masculino, Misto..."></div></div>
        <div class="grid-3"><div class="campo"><label>Início</label><input type="time" name="horario_inicio" value="${t.horario_inicio || '19:00'}"></div>
          <div class="campo"><label>Fim</label><input type="time" name="horario_fim" value="${t.horario_fim || '20:00'}"></div>
          <div class="campo"><label>Vagas por dia</label><input type="number" min="1" name="capacidade" value="${t.capacidade || 20}"></div></div>
        <div class="campo"><label>Dias de treino</label><div class="flex">${['seg', 'ter', 'qua', 'qui', 'sex', 'sab'].map(d => `<label class="check"><input type="checkbox" name="dia" value="${d}" ${(t.dias || '').split(',').includes(d) ? 'checked' : ''}>${DIAS_CURTOS[d]}</label>`).join('')}</div></div>
        <label class="check"><input type="checkbox" name="ativo" ${t.ativo === 0 ? '' : 'checked'}> Turma ativa (aparece no site e na matrícula)</label>
        <button class="btn btn-gold mt">Salvar</button></form>`);
      box.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const corpo = { ...Object.fromEntries(fd), dias: fd.getAll('dia'), ativo: fd.has('ativo') };
        try {
          await api(t.id ? `/api/admin/turmas/${t.id}` : '/api/admin/turmas', { method: t.id ? 'PUT' : 'POST', body: corpo });
          fecharModal(); toast('Turma salva!'); await carregarInfo(); abas.turmas();
        } catch (err) { toast(err.message, 'erro'); }
      };
    };
    document.getElementById('nova-turma').onclick = () => formTurma();
    conteudo.querySelectorAll('[data-editar-turma]').forEach(b => b.onclick = () => formTurma(turmas.find(t => t.id == b.dataset.editarTurma)));
  },

  async avisos() {
    const lista = await api('/api/admin/avisos');
    conteudo.innerHTML = `${topo('Avisos', 'Comunicados exibidos na área de todos os alunos')}
      <div class="grid-dash">
        <div class="card">${lista.map(a => `<div class="aviso-item flex space" style="align-items:flex-start;flex-wrap:nowrap">
          <div><strong>${esc(a.titulo)}</strong><div class="hint">${dataBR(a.criado_em)}</div><p>${esc(a.mensagem)}</p></div>
          <button class="btn btn-sm btn-danger" data-del="${a.id}">Excluir</button></div>`).join('') || '<p class="vazio">Nenhum aviso publicado.</p>'}</div>
        <form class="card" id="f-aviso" style="align-self:start"><h3>Novo aviso</h3>
          <div class="campo"><label>Título</label><input name="titulo" required placeholder="Ex.: Não teremos treino na segunda"></div>
          <div class="campo"><label>Mensagem</label><textarea name="mensagem" rows="5" required></textarea></div>
          <button class="btn btn-gold">Publicar</button></form>
      </div>`;
    document.getElementById('f-aviso').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/admin/avisos', { method: 'POST', body: dadosForm(e.target) }); toast('Aviso publicado!'); abas.avisos(); }
      catch (err) { toast(err.message, 'erro'); }
    };
    conteudo.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await api(`/api/admin/avisos/${b.dataset.del}`, { method: 'DELETE' }); toast('Aviso excluído.'); abas.avisos();
    });
  },

  async config() {
    const c = await api('/api/admin/config');
    conteudo.innerHTML = `${topo('Configurações')}
      <div class="grid-dash">
        <form class="card" id="f-config"><h3>Dados da escolinha</h3>
          <div class="grid-2">
            <div class="campo"><label>Nome</label><input name="nome_escola" value="${esc(c.nome_escola)}"></div>
            <div class="campo"><label>WhatsApp (com DDD)</label><input name="whatsapp" value="${esc(c.whatsapp)}"></div>
            <div class="campo"><label>Instagram</label><input name="instagram" value="${esc(c.instagram)}"></div>
            <div class="campo"><label>Endereço / local de treino</label><input name="endereco" value="${esc(c.endereco)}"></div>
            <div class="campo"><label>Chave PIX</label><input name="chave_pix" value="${esc(c.chave_pix)}"><div class="hint">Usada para gerar o QR Code e o PIX copia e cola dos alunos</div></div>
            <div class="campo"><label>Dia de vencimento padrão</label><input type="number" min="1" max="28" name="dia_vencimento" value="${esc(c.dia_vencimento)}"><div class="hint">Aplicado às novas matrículas</div></div>
          </div>
          <button class="btn btn-gold">Salvar</button></form>
        <div class="card" style="align-self:start"><h3>Mercado Pago</h3>
          ${c.mercadopago.ativo
            ? `<p>${c.mercadopago.teste ? '<span class="badge b-em_analise">Modo de teste</span>' : '<span class="badge b-paga">Conectado</span>'}</p>
               <p class="muted" style="font-size:.9rem">Os alunos podem pagar por PIX, cartão ou boleto e a mensalidade é baixada automaticamente.</p>
               <label>URL de notificações (webhook)</label><div class="pix-box">${esc(c.mercadopago.webhook)}</div>`
            : `<p><span class="badge b-cancelada">Não configurado</span></p>
               <p class="muted" style="font-size:.9rem">Defina a variável <strong>MP_ACCESS_TOKEN</strong> no servidor (arquivo .env.local e no Render) com o Access Token da sua conta Mercado Pago.</p>`}
        </div>
        <form class="card" id="f-senha" style="align-self:start"><h3>Senha do administrador</h3>
          <div class="campo"><label>Senha atual</label><input type="password" name="atual" required></div>
          <div class="campo"><label>Nova senha</label><input type="password" name="nova" minlength="6" required></div>
          <button class="btn btn-outline">Alterar senha</button></form>
      </div>`;
    document.getElementById('f-config').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/admin/config', { method: 'PUT', body: dadosForm(e.target) }); toast('Configurações salvas!'); }
      catch (err) { toast(err.message, 'erro'); }
    };
    document.getElementById('f-senha').onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/admin/senha', { method: 'PUT', body: dadosForm(e.target) }); toast('Senha alterada!'); e.target.reset(); }
      catch (err) { toast(err.message, 'erro'); }
    };
  },
};

// ---------- Mensalidades: ações ----------
function acoesMensalidade(m) {
  if (m.status === 'paga') return `<button class="btn btn-sm btn-ghost" data-acao="estornar" data-id="${m.id}">Estornar</button>`;
  if (m.status === 'cancelada') return '';
  return `<button class="btn btn-sm btn-success" data-acao="pagar" data-id="${m.id}">${m.status === 'em_analise' ? 'Confirmar' : 'Dar baixa'}</button>
    <button class="btn btn-sm btn-ghost" data-acao="cancelar" data-id="${m.id}" title="Cancelar cobrança">✕</button>`;
}
function ligarAcoesMensalidade(raiz, depois) {
  raiz.querySelectorAll('[data-acao]').forEach(b => b.onclick = async () => {
    const { acao, id } = b.dataset;
    let corpo = {};
    if (acao === 'pagar') {
      const forma = await escolherForma();
      if (!forma) return;
      corpo = { forma };
    }
    try {
      await api(`/api/admin/mensalidades/${id}/${acao}`, { method: 'POST', body: corpo });
      toast({ pagar: 'Pagamento confirmado!', estornar: 'Pagamento estornado.', cancelar: 'Cobrança cancelada.' }[acao]);
      atualizarContador();
      depois();
    } catch (e) { toast(e.message, 'erro'); }
  });
}
function escolherForma() {
  return new Promise(resolve => {
    const box = abrirModal(`<h2>Confirmar pagamento</h2><p class="muted">Forma de pagamento recebida:</p>
      <div class="flex">${['PIX', 'Dinheiro', 'Cartão', 'Transferência'].map(f => `<button class="btn btn-outline" data-f="${f}">${f}</button>`).join('')}</div>`);
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { fecharModal(); resolve(b.dataset.f); });
    const obs = new MutationObserver(() => { if (!document.getElementById('modal')) { obs.disconnect(); resolve(null); } });
    obs.observe(document.body, { childList: true });
  });
}

// ---------- Ficha do aluno ----------
async function verAluno(id) {
  const r = await api(`/api/admin/alunos/${id}`);
  const a = r.aluno, m = r.matricula;
  const box = abrirModal(`
    <div class="flex" style="margin-bottom:1rem"><div class="avatar" style="width:52px;height:52px;font-size:1.1rem">${iniciais(a.nome)}</div>
      <div><h2 style="margin:0">${esc(a.nome)}</h2><span class="muted">${a.idade ?? '–'} anos · aluno desde ${dataBR(m?.data_inicio)}</span></div></div>
    <div class="flex" style="margin-bottom:1rem">
      ${a.telefone ? `<a class="btn btn-sm btn-success" target="_blank" rel="noopener" href="${linkWhats(a.telefone)}">WhatsApp</a>` : ''}
      <span class="badge b-${m.status}">${ROTULO_STATUS[m.status]}</span>
      <span class="muted" style="font-size:.85rem">Frequência 30d: <strong>${r.frequencia_30d.taxa ?? '–'}${r.frequencia_30d.taxa !== null ? '%' : ''}</strong></span>
    </div>
    <div class="grid-2" style="font-size:.9rem;margin-bottom:1rem">
      <div><span class="muted">E-mail:</span> ${esc(a.email || 'sem login (plano em grupo)')}</div><div><span class="muted">Telefone:</span> ${esc(a.telefone || '—')}</div>
      <div><span class="muted">Nascimento:</span> ${dataBR(a.nascimento)}</div><div><span class="muted">Sexo:</span> ${SEXO[a.sexo] || '—'}</div>
      <div><span class="muted">RG/CPF:</span> ${esc(a.cpf || '—')}</div><div><span class="muted">Emergência:</span> ${esc(a.contato_emergencia || '—')}</div>
      <div style="grid-column:1/-1"><span class="muted">Endereço:</span> ${esc([a.endereco, a.bairro, a.cidade].filter(Boolean).join(' — ') || '—')}</div>
      ${a.responsavel ? `<div style="grid-column:1/-1"><span class="muted">Responsável:</span> ${esc(a.responsavel)}${a.parentesco_responsavel ? ` (${esc(a.parentesco_responsavel)})` : ''} · ${esc(a.telefone_responsavel || '')}${a.email_responsavel ? ` · ${esc(a.email_responsavel)}` : ''}</div>` : ''}
      <div><span class="muted">Já praticou vôlei:</span> ${simNaoTxt(a.ja_jogou)}</div>
      <div><span class="muted">Uso de imagem:</span> ${a.autoriza_imagem === 1 ? '<span class="badge b-paga">Autorizado</span>' : a.autoriza_imagem === 0 ? '<span class="badge b-atrasada">Não autorizado</span>' : '—'}</div>
      ${a.observacoes_saude ? `<div style="grid-column:1/-1"><span class="muted">Saúde:</span> <span class="gold">${esc(a.observacoes_saude)}</span></div>` : ''}
      ${r.grupo.length ? `<div style="grid-column:1/-1"><span class="muted">${esc(nomePlano(m.plano_nome))}:</span> ${r.grupo.map(g => g.id === a.id ? `<strong>${esc(g.nome)}</strong>` : `<a href="#" onclick="verAluno(${g.id});return false">${esc(g.nome)}</a>`).join(', ')}
        <span class="muted">· mensalidade no nome do titular (${esc(r.grupo[0].nome)})</span></div>` : ''}
    </div>
    <form id="f-mat" class="card" style="background:var(--bg-2)"><h3>Matrícula</h3>
      <div class="grid-3">
        <div class="campo"><label>Status</label><select name="status">${['ativa', 'trancada', 'cancelada'].map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${ROTULO_STATUS[s]}</option>`).join('')}</select></div>
        <div class="campo"><label>Plano</label><select name="plano_id">${info.planos.map(p => `<option value="${p.id}" ${p.id === m.plano_id ? 'selected' : ''}>${esc(nomePlano(p))} — ${moeda(p.preco)}</option>`).join('')}</select></div>
        <div class="campo"><label>Turma</label><select name="turma_id">${info.turmas.map(t => `<option value="${t.id}" ${t.id === m.turma_id ? 'selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label>Nível</label><select name="nivel">${Object.entries(NIVEIS).map(([k, v]) => `<option value="${k}" ${m.nivel === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="campo"><label>Dia de vencimento</label><input type="number" min="1" max="28" name="dia_vencimento" value="${m.dia_vencimento}"></div>
      </div>
      <div class="campo"><label>Dias de treino</label><div class="flex">${['seg', 'ter', 'qua', 'qui', 'sex', 'sab'].map(d => `<label class="check"><input type="checkbox" name="dia" value="${d}" ${m.dias.split(',').includes(d) ? 'checked' : ''}>${DIAS_CURTOS[d]}</label>`).join('')}</div></div>
      <div class="flex space"><button class="btn btn-gold btn-sm">Salvar matrícula</button><button type="button" class="btn btn-danger btn-sm" id="excluir">Excluir aluno</button></div>
    </form>
    <h3 class="mt">Mensalidades</h3>
    <div class="tabela-wrap" id="mens-aluno"><table><thead><tr><th>Ref.</th><th>Vencimento</th><th class="num">Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${r.mensalidades.map(x => `<tr><td>${competenciaBR(x.competencia)}</td><td>${dataBR(x.vencimento)}</td><td class="num">${moeda(x.valor)}</td><td>${badge(x.status)}</td><td class="num" style="white-space:nowrap">${acoesMensalidade(x)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Sem mensalidades.</td></tr>'}</tbody></table></div>`);

  ligarAcoesMensalidade(box.querySelector('#mens-aluno'), () => verAluno(id));
  box.querySelector('#f-mat').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/api/admin/alunos/${id}/matricula`, { method: 'PUT', body: { ...Object.fromEntries(fd), plano_id: Number(fd.get('plano_id')), turma_id: Number(fd.get('turma_id')), dias: fd.getAll('dia') } });
      toast('Matrícula atualizada!'); verAluno(id); if (abaAtual !== 'dashboard') render(abaAtual);
    } catch (err) { toast(err.message, 'erro'); }
  };
  box.querySelector('#excluir').onclick = async () => {
    const btn = box.querySelector('#excluir');
    if (btn.dataset.confirmar !== '1') { btn.dataset.confirmar = '1'; btn.textContent = 'Clique de novo para confirmar'; return; }
    await api(`/api/admin/alunos/${id}`, { method: 'DELETE' });
    fecharModal(); toast('Aluno excluído.'); render(abaAtual);
  };
}

// ---------- Navegação ----------
const val = id => document.getElementById(id)?.value || '';
let abaAtual = 'dashboard', irMenu;
function render(aba, arg) {
  abaAtual = aba;
  limparGraficos();
  conteudo.innerHTML = '<p class="muted">Carregando...</p>';
  abas[aba](arg).catch(e => { conteudo.innerHTML = `<div class="erro-msg">${esc(e.message)}</div>`; });
}
function irPara(aba, arg) {
  document.querySelectorAll('.menu button').forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
  history.replaceState(null, '', '#' + aba);
  render(aba, arg);
}
async function atualizarContador(n) {
  if (n === undefined) n = (await api('/api/admin/mensalidades?status=em_analise')).itens.length;
  const c = document.getElementById('cont-analise');
  c.textContent = n; c.classList.toggle('oculto', !n);
}
async function carregarInfo() { info = await api('/api/publico/info'); }

api('/api/me').then(async r => {
  if (r.user.role !== 'admin') return (location.href = '/aluno.html');
  document.getElementById('nome-usuario').textContent = r.user.nome;
  await carregarInfo();
  irMenu = iniciarMenu(render);
  atualizarContador();
});
