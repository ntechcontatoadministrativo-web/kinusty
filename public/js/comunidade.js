// Comunidade: feed de posts compartilhado pela área do aluno e pelo painel do admin.
// Uso: montarComunidade(elemento, { eu: { id, nome, tem_foto }, admin: true/false })

function tempoAtras(s) {
  const d = new Date(s.replace(' ', 'T') + '-03:00'); // criado_em vem no horário de Belém
  const seg = Math.max(0, (Date.now() - d) / 1000);
  if (seg < 60) return 'agora';
  if (seg < 3600) return `há ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `há ${Math.floor(seg / 3600)} h`;
  if (seg < 7 * 86400) return `há ${Math.floor(seg / 86400)} d`;
  return dataBR(s);
}

// Posts e comentários do admin aparecem como a escolinha
const autorPost = x => x.role === 'admin'
  ? { avatar: '<div class="avatar avatar-escola" style="width:42px;height:42px"><img src="/img/logo.png" alt=""></div>', nome: 'Kinusty Volleyball', selo: '<span class="badge selo-escola">Escolinha</span>' }
  : { avatar: avatar({ id: x.user_id, nome: x.nome, tem_foto: x.autor_foto }, 42), nome: x.nome, selo: '' };

function montarComunidade(el, { eu, admin }) {
  let fotoNova = null;
  let ultimoId = 0;

  el.innerHTML = `
    <div class="conteudo-topo"><div><h1>Comunidade</h1><p>Fotos, conquistas e recados da família Kinusty 🏐</p></div></div>
    <div class="feed">
      <form class="card post-novo" id="post-novo">
        <div class="post-novo-linha">
          ${admin ? autorPost({ role: 'admin' }).avatar : avatar(eu, 42)}
          <textarea name="texto" maxlength="2000" rows="2" placeholder="${admin ? 'Escreva um post para os alunos...' : 'Compartilhe algo com a turma...'}"></textarea>
        </div>
        <div class="post-novo-previa oculto" id="previa-post"><img alt=""><button type="button" class="btn btn-sm" id="tirar-foto" aria-label="Remover foto">✕</button></div>
        <div class="flex space">
          <button type="button" class="btn btn-ghost btn-sm" id="foto-post">📷 Foto</button>
          <button class="btn btn-gold btn-sm" id="publicar">Publicar</button>
        </div>
      </form>
      <div id="lista-posts"></div>
      <button class="btn btn-ghost btn-block oculto" id="mais-posts">Carregar mais</button>
    </div>`;
  const lista = el.querySelector('#lista-posts');
  const form = el.querySelector('#post-novo');
  const previa = el.querySelector('#previa-post');

  const htmlPost = p => {
    const a = autorPost(p);
    return `<article class="card post ${p.fixado ? 'post-fixado' : ''}" data-post="${p.id}">
      <header class="post-topo">
        ${a.avatar}
        <div class="post-autor"><strong>${esc(a.nome)}</strong> ${a.selo}<small>${tempoAtras(p.criado_em)}${p.fixado ? ' · 📌 Fixado' : ''}</small></div>
        <div class="post-acoes">
          ${admin ? `<button class="btn btn-ghost btn-sm" data-acao="fixar" title="${p.fixado ? 'Desafixar' : 'Fixar no topo'}">📌</button>` : ''}
          ${p.pode_apagar ? `<button class="btn btn-ghost btn-sm" data-acao="apagar" title="Apagar post">🗑</button>` : ''}
        </div>
      </header>
      ${p.texto ? `<p class="post-texto">${esc(p.texto)}</p>` : ''}
      ${p.tem_foto ? `<img class="post-foto" src="/api/comunidade/posts/${p.id}/foto" alt="Foto do post" loading="lazy">` : ''}
      <footer class="post-rodape">
        <button class="post-btn ${p.curti ? 'curtido' : ''}" data-acao="curtir"><span>${p.curti ? '❤️' : '🤍'}</span> <b>${p.curtidas}</b></button>
        <button class="post-btn" data-acao="comentarios">💬 <b>${p.comentarios}</b> ${p.comentarios === 1 ? 'comentário' : 'comentários'}</button>
      </footer>
      <div class="comentarios oculto"></div>
    </article>`;
  };

  async function carregar(mais = false) {
    const r = await api(`/api/comunidade/posts${mais ? `?antes=${ultimoId}` : ''}`);
    const html = r.posts.map(htmlPost).join('');
    if (mais) lista.insertAdjacentHTML('beforeend', html);
    else lista.innerHTML = html || '<div class="card vazio">Nenhum post ainda. Que tal ser o primeiro? 🏐</div>';
    const normais = r.posts.filter(p => !p.fixado);
    if (normais.length) ultimoId = normais[normais.length - 1].id;
    el.querySelector('#mais-posts').classList.toggle('oculto', !r.mais);
  }

  async function abrirComentarios(post) {
    const box = post.querySelector('.comentarios');
    const cs = await api(`/api/comunidade/posts/${post.dataset.post}/comentarios`);
    box.innerHTML = `${cs.map(c => {
      const a = autorPost(c);
      return `<div class="comentario" data-comentario="${c.id}">${a.avatar.replace(/42px/g, '30px')}
        <div class="comentario-corpo"><strong>${esc(a.nome)}</strong> <small class="muted">${tempoAtras(c.criado_em)}</small><p>${esc(c.texto)}</p></div>
        ${c.pode_apagar ? '<button class="btn btn-ghost btn-sm" data-acao="apagar-comentario" title="Apagar comentário">✕</button>' : ''}</div>`;
    }).join('')}
      <form class="comentar"><input name="texto" maxlength="500" placeholder="Escreva um comentário..." autocomplete="off"><button class="btn btn-gold btn-sm">Enviar</button></form>`;
    box.classList.remove('oculto');
    const contador = post.querySelector('[data-acao="comentarios"]');
    contador.innerHTML = `💬 <b>${cs.length}</b> ${cs.length === 1 ? 'comentário' : 'comentários'}`;
  }

  el.querySelector('#foto-post').onclick = async () => {
    try {
      const f = await escolherFoto();
      if (!f) return;
      fotoNova = f;
      previa.querySelector('img').src = f;
      previa.classList.remove('oculto');
    } catch (e) { toast(e.message, 'erro'); }
  };
  el.querySelector('#tirar-foto').onclick = () => { fotoNova = null; previa.classList.add('oculto'); };

  form.onsubmit = async e => {
    e.preventDefault();
    const btn = el.querySelector('#publicar');
    btn.disabled = true;
    try {
      await api('/api/comunidade/posts', { method: 'POST', body: { texto: form.texto.value, foto: fotoNova } });
      form.reset(); fotoNova = null; previa.classList.add('oculto');
      toast('Post publicado!');
      await carregar();
    } catch (err) { toast(err.message, 'erro'); }
    btn.disabled = false;
  };

  el.querySelector('#mais-posts').onclick = () => carregar(true).catch(e => toast(e.message, 'erro'));

  // Ações dos posts (delegação: os posts são recriados a cada carga)
  lista.addEventListener('click', async e => {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const post = b.closest('[data-post]');
    const id = post.dataset.post;
    try {
      if (b.dataset.acao === 'curtir') {
        const r = await api(`/api/comunidade/posts/${id}/curtir`, { method: 'POST' });
        b.classList.toggle('curtido', r.curti);
        b.innerHTML = `<span>${r.curti ? '❤️' : '🤍'}</span> <b>${r.curtidas}</b>`;
      } else if (b.dataset.acao === 'comentarios') {
        const box = post.querySelector('.comentarios');
        if (box.classList.contains('oculto')) await abrirComentarios(post);
        else box.classList.add('oculto');
      } else if (b.dataset.acao === 'fixar') {
        await api(`/api/comunidade/posts/${id}/fixar`, { method: 'PUT' });
        await carregar();
      } else if (b.dataset.acao === 'apagar') {
        // Pede um segundo clique para confirmar, sem abrir caixa de diálogo do navegador
        if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.textContent = 'Apagar?'; b.classList.add('btn-perigo'); return; }
        await api(`/api/comunidade/posts/${id}`, { method: 'DELETE' });
        post.remove();
        toast('Post apagado.');
      } else if (b.dataset.acao === 'apagar-comentario') {
        await api(`/api/comunidade/comentarios/${b.closest('[data-comentario]').dataset.comentario}`, { method: 'DELETE' });
        await abrirComentarios(post);
      }
    } catch (err) { toast(err.message, 'erro'); }
  });

  lista.addEventListener('submit', async e => {
    if (!e.target.matches('.comentar')) return;
    e.preventDefault();
    const post = e.target.closest('[data-post]');
    try {
      await api(`/api/comunidade/posts/${post.dataset.post}/comentarios`, { method: 'POST', body: { texto: e.target.texto.value } });
      await abrirComentarios(post);
      post.querySelector('.comentar input').focus();
    } catch (err) { toast(err.message, 'erro'); }
  });

  return carregar();
}
