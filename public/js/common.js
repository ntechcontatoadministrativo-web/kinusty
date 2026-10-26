// Funções compartilhadas por todas as páginas
async function api(url, opcoes = {}) {
  const { silencioso, ...resto } = opcoes;
  const cfg = { method: 'GET', headers: {}, credentials: 'same-origin', ...resto };
  if (cfg.body && typeof cfg.body !== 'string') {
    cfg.body = JSON.stringify(cfg.body);
    cfg.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, cfg);
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !silencioso && !url.includes('/auth/')) { location.href = '/login.html'; }
    throw new Error(dados.erro || 'Erro inesperado.');
  }
  return dados;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const moeda = v => BRL.format(Number(v) || 0);
const moedaCurta = v => (Math.abs(v) >= 1000 ? 'R$ ' + (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : moeda(v));

function dataBR(s) {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function competenciaBR(c, longo = false) {
  const [y, m] = c.split('-');
  return longo ? `${MESES_LONGOS[m - 1]} de ${y}` : `${MESES[m - 1]}/${y.slice(2)}`;
}

const DIAS_CURTOS = { dom: 'Dom', seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb' };
const diasTexto = csv => (csv || '').split(',').filter(Boolean).map(d => DIAS_CURTOS[d]).join(', ');

const ROTULO_STATUS = { paga: 'Paga', pendente: 'Pendente', em_analise: 'Em análise', atrasada: 'Atrasada', cancelada: 'Cancelada', ativa: 'Ativa', trancada: 'Pausada' };
const badge = s => `<span class="badge b-${s}">${ROTULO_STATUS[s] || s}</span>`;
const NIVEIS = { iniciante: 'Iniciante', intermediario: 'Intermediário', avancado: 'Avançado' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const iniciais = nome => (nome || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
// Avatar com a foto do aluno (ou as iniciais, se ainda não tiver foto)
const avatar = (u, tam = 38) => `<div class="avatar" style="width:${tam}px;height:${tam}px;font-size:${Math.round(tam / 2.7)}px">${u.tem_foto ? `<img src="/api/fotos/${u.id}?v=${Date.now()}" alt="">` : iniciais(u.nome)}</div>`;

// Reduz a imagem escolhida para no máximo 600px (JPEG) antes de enviar
function reduzirFoto(arquivo, max = 600) {
  return new Promise((resolve, reject) => {
    if (!arquivo?.type.startsWith('image/')) return reject(new Error('Escolha um arquivo de imagem.'));
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * escala); c.height = Math.round(img.height * escala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('Não foi possível ler essa imagem. Tente outra (JPG ou PNG).')); };
    img.src = URL.createObjectURL(arquivo);
  });
}

// Abre o seletor de arquivo (ou a câmera, no celular) e devolve a foto reduzida
function escolherFoto() {
  return new Promise((resolve, reject) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
    input.onchange = () => input.files[0] ? reduzirFoto(input.files[0]).then(resolve, reject) : resolve(null);
    input.click();
  });
}

const linkWhats =(num, texto = '') => `https://wa.me/${String(num || '').replace(/\D/g, '').replace(/^(?!55)/, '55')}${texto ? '?text=' + encodeURIComponent(texto) : ''}`;

let toastTimer;
function toast(msg, tipo = 'ok') {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = `show ${tipo}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3200);
}

function abrirModal(html) {
  fecharModal();
  const m = document.createElement('div');
  m.className = 'modal';
  m.id = 'modal';
  m.innerHTML = `<div class="modal-box"><button class="modal-fechar" aria-label="Fechar">&times;</button>${html}</div>`;
  m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('modal-fechar')) fecharModal(); });
  document.body.appendChild(m);
  return m.querySelector('.modal-box');
}
function fecharModal() { document.getElementById('modal')?.remove(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') fecharModal(); });

async function sair() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
}

// Navegação por abas nos painéis (aluno/admin)
function iniciarMenu(render) {
  const botoes = document.querySelectorAll('.menu button[data-aba]');
  const ir = aba => {
    botoes.forEach(b => b.classList.toggle('ativo', b.dataset.aba === aba));
    document.querySelector('.lateral')?.classList.remove('aberta');
    history.replaceState(null, '', '#' + aba);
    render(aba);
    window.scrollTo(0, 0);
  };
  botoes.forEach(b => b.addEventListener('click', () => ir(b.dataset.aba)));
  document.getElementById('abrir-menu')?.addEventListener('click', () => document.querySelector('.lateral').classList.toggle('aberta'));
  const inicial = location.hash.slice(1);
  ir([...botoes].some(b => b.dataset.aba === inicial) ? inicial : botoes[0].dataset.aba);
  return ir;
}

function dadosForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}
