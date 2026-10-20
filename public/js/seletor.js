// Componente de escolha de plano + turma + dias (usado na matrícula e na troca de plano)
function seletorPlano(el, info, inicial = {}, aoMudar = () => {}) {
  const estado = {
    plano_id: Number(inicial.plano_id) || null,
    turma_id: Number(inicial.turma_id) || null,
    dias: [...(inicial.dias || [])],
  };
  // Vagas próprias do aluno (troca de plano) não contam como ocupadas
  const meus = new Set(inicial.turma_id ? (inicial.dias || []).map(d => `${inicial.turma_id}:${d}`) : []);

  const plano = () => info.planos.find(p => p.id === estado.plano_id);
  const turma = () => info.turmas.find(t => t.id === estado.turma_id);
  const vagas = (t, d) => (t.vagas[d] ?? 0) + (meus.has(`${t.id}:${d}`) ? 1 : 0);

  function render() {
    const p = plano(), t = turma();
    el.innerHTML = `
      <div class="campo">
        <label>1. Plano</label>
        <div class="opcoes-plano">${info.planos.map(pl => `
          <div class="opcao ${pl.id === estado.plano_id ? 'sel' : ''}" data-plano="${pl.id}" tabindex="0">
            <strong>${pl.dias_semana}x</strong><small>por semana</small>
            <div class="gold">${moeda(pl.preco)}/mês</div>
          </div>`).join('')}</div>
      </div>
      <div class="campo">
        <label>2. Turma</label>
        <div class="opcoes-turma">${info.turmas.map(tu => {
          const insuf = p && tu.dias.length < p.dias_semana;
          return `<div class="opcao ${tu.id === estado.turma_id ? 'sel' : ''}" data-turma="${tu.id}" tabindex="0" ${insuf ? 'style="opacity:.45"' : ''}>
            <strong>${esc(tu.nome)}</strong>
            <small>${tu.horario_inicio}–${tu.horario_fim} · ${tu.dias.map(d => DIAS_CURTOS[d]).join(', ')}</small>
            ${insuf ? `<div class="hint">Treina só ${tu.dias.length}x/semana</div>` : ''}
          </div>`;
        }).join('')}</div>
      </div>
      <div class="campo">
        <label>3. Dias de treino ${p ? `<span class="gold">(${estado.dias.length}/${p.dias_semana})</span>` : ''}</label>
        ${!t ? '<p class="hint">Selecione uma turma para ver os dias.</p>' : `
        <div class="dias-sel">${t.dias.map(d => {
          const v = vagas(t, d);
          return `<button type="button" class="dia-btn ${estado.dias.includes(d) ? 'sel' : ''}" data-dia="${d}" ${v <= 0 && !estado.dias.includes(d) ? 'disabled' : ''}>
            ${info.dias_nomes[d]}<small>${v <= 0 ? 'lotado' : v + ' vaga' + (v > 1 ? 's' : '')}</small></button>`;
        }).join('')}</div>`}
      </div>`;
  }

  el.addEventListener('click', e => {
    const op = e.target.closest('[data-plano],[data-turma],[data-dia]');
    if (!op) return;
    if (op.dataset.plano) {
      estado.plano_id = Number(op.dataset.plano);
      const p = plano();
      if (estado.dias.length > p.dias_semana) estado.dias = estado.dias.slice(0, p.dias_semana);
      // Com o plano máximo, já marca todos os dias da turma
      const t = turma();
      if (t && t.dias.length === p.dias_semana) estado.dias = t.dias.filter(d => vagas(t, d) > 0);
    } else if (op.dataset.turma) {
      const novo = Number(op.dataset.turma);
      if (novo !== estado.turma_id) { estado.turma_id = novo; estado.dias = []; }
      const t = turma(), p = plano();
      if (p && t.dias.length === p.dias_semana) estado.dias = t.dias.filter(d => vagas(t, d) > 0);
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
      if (!t) return 'Escolha uma turma.';
      if (t.dias.length < p.dias_semana) return `A turma ${t.nome} treina só ${t.dias.length}x por semana. Escolha outra turma ou outro plano.`;
      if (estado.dias.length !== p.dias_semana) return `Selecione ${p.dias_semana} dias de treino.`;
      return null;
    },
    plano, turma,
  };
}
