// Tutorial guiado: destaca cada parte da tela com um balão explicando o que ela faz.
// Aparece sozinho no primeiro acesso e pode ser revisto pelo botão "Ver tutorial".
const Tutorial = (() => {
  let passos = [], i = 0, foco, balao, chave;

  const alvoDo = p => p.alvo && [...document.querySelectorAll(p.alvo)].find(el => el.getClientRects().length);
  const celular = () => matchMedia('(max-width: 860px)').matches;
  const naLateral = el => el?.closest('.lateral');

  function montar() {
    foco = Object.assign(document.createElement('div'), { className: 'tour-foco' });
    balao = Object.assign(document.createElement('div'), { className: 'tour-balao', role: 'dialog' });
    balao.setAttribute('aria-live', 'polite');
    document.body.append(foco, balao);
    foco.addEventListener('click', () => ir(i + 1));
    addEventListener('resize', posicionar);
    addEventListener('keydown', teclas);
  }

  function teclas(e) {
    if (e.key === 'Escape') fechar();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') ir(i + 1);
    else if (e.key === 'ArrowLeft') ir(i - 1);
  }

  function posicionar() {
    const p = passos[i];
    const el = alvoDo(p);
    const vw = innerWidth, vh = innerHeight, m = 16;
    const bw = Math.min(340, vw - 2 * m);
    balao.style.width = bw + 'px';
    foco.classList.toggle('sem-alvo', !el);
    if (!el) {
      // Sem alvo: só escurece a tela e centraliza o balão
      Object.assign(foco.style, { top: vh / 2 + 'px', left: vw / 2 + 'px', width: '0px', height: '0px' });
      const bh = balao.offsetHeight;
      Object.assign(balao.style, { left: (vw - bw) / 2 + 'px', top: Math.max(m, (vh - bh) / 2) + 'px', transformOrigin: 'center' });
      return;
    }
    const r = el.getBoundingClientRect(), pad = 6;
    Object.assign(foco.style, { top: r.top - pad + 'px', left: r.left - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
    const bh = balao.offsetHeight;
    let left, top, origem;
    if (r.right + 14 + bw + m <= vw && r.width < vw / 2) {           // à direita (menu lateral no computador)
      left = r.right + 14; top = Math.min(Math.max(m, r.top + r.height / 2 - bh / 2), vh - bh - m); origem = 'left center';
    } else if (r.bottom + 14 + bh + m <= vh) {                         // embaixo
      top = r.bottom + 14; left = Math.min(Math.max(m, r.left + r.width / 2 - bw / 2), vw - bw - m); origem = 'top center';
    } else {                                                           // em cima
      top = Math.max(m, r.top - 14 - bh); left = Math.min(Math.max(m, r.left + r.width / 2 - bw / 2), vw - bw - m); origem = 'bottom center';
    }
    Object.assign(balao.style, { left: left + 'px', top: top + 'px', transformOrigin: origem });
  }

  async function ir(n) {
    if (n >= passos.length) return fechar();
    if (n < 0) return;
    i = n;
    const p = passos[i];
    await p.antes?.();
    let el = alvoDo(p);
    // No celular o menu fica escondido: abre a gaveta quando o passo aponta para ele
    const lateral = document.querySelector('.lateral');
    if (celular() && lateral) lateral.classList.toggle('aberta', !!naLateral(el));
    if (el && !naLateral(el)) {
      el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      await new Promise(r => setTimeout(r, 350));
    }
    balao.innerHTML = `
      <div class="tour-topo"><span class="tour-emoji">${p.emoji || '👉'}</span><span class="tour-contagem">${i + 1} de ${passos.length}</span></div>
      <h3>${p.titulo}</h3><p>${p.texto}</p>
      <div class="tour-pontos">${passos.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="tour-acoes">
        ${i < passos.length - 1 ? '<button class="btn btn-ghost btn-sm" data-t="pular">Pular</button>' : '<span></span>'}
        <div class="flex" style="gap:.5rem">
          ${i > 0 ? '<button class="btn btn-outline btn-sm" data-t="voltar">Voltar</button>' : ''}
          <button class="btn btn-gold btn-sm" data-t="proximo">${i < passos.length - 1 ? 'Próximo' : 'Começar a usar 🏐'}</button>
        </div>
      </div>`;
    balao.querySelector('[data-t="pular"]')?.addEventListener('click', fechar);
    balao.querySelector('[data-t="voltar"]')?.addEventListener('click', () => ir(i - 1));
    balao.querySelector('[data-t="proximo"]').addEventListener('click', () => ir(i + 1));
    balao.classList.remove('entra'); void balao.offsetWidth; balao.classList.add('entra');
    posicionar();
    balao.querySelector('[data-t="proximo"]').focus({ preventScroll: true });
  }

  function fechar() {
    try { localStorage.setItem(chave, '1'); } catch (e) {}
    removeEventListener('resize', posicionar);
    removeEventListener('keydown', teclas);
    document.querySelector('.lateral')?.classList.remove('aberta');
    foco.classList.add('sai'); balao.classList.add('sai');
    const f = foco, b = balao;
    setTimeout(() => { f.remove(); b.remove(); }, 220);
    foco = balao = null;
  }

  function iniciar(lista, nome) {
    if (foco) return;
    passos = lista; chave = nome;
    montar();
    ir(0);
  }

  // Primeiro acesso: espera a abertura da NTECH sumir antes de começar
  function primeiraVez(lista, nome) {
    try { if (localStorage.getItem(nome)) return; } catch (e) { return; }
    // Também espera fechar qualquer janela aberta (ex.: avaliação vinda da notificação)
    const tentar = () => document.getElementById('ntech-intro') || document.getElementById('modal')
      ? setTimeout(tentar, 400) : setTimeout(() => iniciar(lista, nome), 600);
    tentar();
  }

  return { iniciar, primeiraVez };
})();
