// Componente de escolha de plano + turma + dias (usado na matrícula e na troca de plano)
// Nos planos casal/família a turma é escolhida para cada pessoa (na etapa de dados), aqui só plano e dias.
const TIPOS_PLANO = {
  individual: { nome: 'Individual', desc: 'Para uma pessoa' },
  casal: { nome: 'Casal', desc: 'Valor para os dois · informe os dados de ambos na inscrição' },
  familia: { nome: 'Família', desc: 'Obrigatoriamente terça e quinta (horário do Kids) · valor pelo número de pessoas' },
};

function seletorPlano(el, info, inicial = {}, aoMudar = () => {}) {
  const tipos = Object.keys(TIPOS_PLANO).filter(t => info.planos.some(p => p.tipo === t));
  const planoInicial = info.planos.find(p => p.id === Number(inicial.plano_id));
  const estado = {
    tipo: planoInicial?.tipo || (tipos.includes(inicial.tipo) ? inicial.tipo : tipos[0]),
    plano_id: planoInicial?.id || null,
    turma_id: Number(inicial.turma_id) || null,
    dias: [...(inicial.dias || [])],
  };

  const plano = () => info.planos.find(p => p.id === estado.plano_id);
  const turma = () => info.turmas.find(t => t.id === estado.turma_id);
  const emGrupo = () => estado.tipo !== 'individual';
  // Sem turma (planos em grupo): qualquer dia em que alguma turma treine
  const diasDisponiveis = () => {
    const t = turma();
    if (!emGrupo()) return t ? t.dias : [];
    const todos = new Set(info.turmas.flatMap(x => x.dias));
    return Object.keys(info.dias_nomes).filter(d => todos.has(d));
  };
  const rotuloPlano = p => p.tipo === 'familia' ? `<strong>${p.pessoas}</strong><small>pessoas</small>` : `<strong>${p.dias_semana}x</strong><small>por semana</small>`;

  function render() {
    const p = plano(), t = turma();
    const fixos = p?.dias_fixos;
    let n = 1;
    el.innerHTML = `
      ${tipos.length > 1 ? `<div class="campo">
        <label>${n++}. Tipo de plano</label>
        <div class="opcoes-turma">${tipos.map(tp => `
          <div class="opcao ${tp === estado.tipo ? 'sel' : ''}" data-tipo="${tp}" tabindex="0">
            <strong>${TIPOS_PLANO[tp].nome}</strong><small>${TIPOS_PLANO[tp].desc}</small>
          </div>`).join('')}</div>
      </div>` : ''}
      <div class="campo">
        <label>${n++}. Plano</label>
        <div class="opcoes-plano">${info.planos.filter(pl => pl.tipo === estado.tipo).map(pl => `
          <div class="opcao ${pl.id === estado.plano_id ? 'sel' : ''}" data-plano="${pl.id}" tabindex="0">
            ${rotuloPlano(pl)}
            <div class="gold">${moeda(pl.preco)}/mês</div>
          </div>`).join('')}</div>
      </div>
      ${emGrupo() ? '' : `<div class="campo">
        <label>${n++}. Turma</label>
        <div class="opcoes-turma">${info.turmas.map(tu => {
          const insuf = p && tu.dias.length < p.dias_semana;
          return `<div class="opcao ${tu.id === estado.turma_id ? 'sel' : ''}" data-turma="${tu.id}" tabindex="0" ${insuf ? 'style="opacity:.45"' : ''}>
            <strong>${esc(tu.nome)}</strong>
            <small>${tu.horario_inicio}–${tu.horario_fim} · ${tu.dias.map(d => DIAS_CURTOS[d]).join(', ')}</small>
            ${insuf ? `<div class="hint">Treina só ${tu.dias.length}x/semana</div>` : ''}
          </div>`;
        }).join('')}</div>
      </div>`}
      <div class="campo">
        <label>${n++}. Dias de treino ${p && !fixos ? `<span class="gold">(${estado.dias.length}/${p.dias_semana})</span>` : ''}</label>
        ${fixos ? `<div class="dias-sel">${fixos.map(d => `<button type="button" class="dia-btn sel" disabled>${info.dias_nomes[d]}</button>`).join('')}</div>
          <p class="hint">O plano família treina sempre terça e quinta.</p>`
        : !emGrupo() && !t ? '<p class="hint">Selecione uma turma para ver os dias.</p>' : `
        <div class="dias-sel">${diasDisponiveis().map(d => `<button type="button" class="dia-btn ${estado.dias.includes(d) ? 'sel' : ''}" data-dia="${d}">${info.dias_nomes[d]}</button>`).join('')}</div>
        ${emGrupo() ? '<p class="hint">Os dois treinam nos mesmos dias. A turma de cada um é escolhida na próxima etapa.</p>' : ''}`}
      </div>`;
  }

  el.addEventListener('click', e => {
    const op = e.target.closest('[data-tipo],[data-plano],[data-turma],[data-dia]');
    if (!op) return;
    if (op.dataset.tipo) {
      if (op.dataset.tipo !== estado.tipo) Object.assign(estado, { tipo: op.dataset.tipo, plano_id: null, dias: [] });
    } else if (op.dataset.plano) {
      estado.plano_id = Number(op.dataset.plano);
      const p = plano();
      if (p.dias_fixos) estado.dias = [...p.dias_fixos];
      else if (estado.dias.length > p.dias_semana) estado.dias = estado.dias.slice(0, p.dias_semana);
      // Com o plano máximo, já marca todos os dias disponíveis
      const disp = diasDisponiveis();
      if (!p.dias_fixos && disp.length === p.dias_semana) estado.dias = [...disp];
    } else if (op.dataset.turma) {
      const novo = Number(op.dataset.turma);
      if (novo !== estado.turma_id) { estado.turma_id = novo; estado.dias = []; }
      const t = turma(), p = plano();
      if (p && t.dias.length === p.dias_semana) estado.dias = [...t.dias];
    } else if (op.dataset.dia) {
      const d = op.dataset.dia, p = plano();
      if (estado.dias.includes(d)) estado.dias = estado.dias.filter(x => x !== d);
      else if (!p) { toast('Escolha o plano primeiro.', 'erro'); return; }
      else if (estado.dias.length >= p.dias_semana) { toast(`Seu plano permite ${p.dias_semana} dias. Desmarque um dia para trocar.`, 'erro'); return; }
      else estado.dias.push(d);
    }
    render();
    aoMudar(estado);
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.opcao')) e.target.click(); });

  render();
  return {
    estado,
    valido() {
      const p = plano(), t = turma();
      if (!p) return 'Escolha um plano.';
      if (!emGrupo()) {
        if (!t) return 'Escolha uma turma.';
        if (t.dias.length < p.dias_semana) return `A turma ${t.nome} treina só ${t.dias.length}x por semana. Escolha outra turma ou outro plano.`;
      }
      if (estado.dias.length !== p.dias_semana) return `Selecione ${p.dias_semana} dias de treino.`;
      return null;
    },
    plano, turma, emGrupo,
  };
}
