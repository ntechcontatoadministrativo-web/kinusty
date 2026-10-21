// Intro da NTECH: aparece sempre que o site é aberto (uma vez por sessão do navegador).
// Carregado no <head> para cobrir a página antes de ela aparecer.
(function () {
  try { if (sessionStorage.getItem('ntech_intro')) return; sessionStorage.setItem('ntech_intro', '1'); } catch (e) {}

  var reduzido = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DURACAO = reduzido ? 1200 : 2700;

  var fonte = document.createElement('link');
  fonte.rel = 'stylesheet';
  fonte.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@500;900&display=swap';
  document.head.appendChild(fonte);

  var css = document.createElement('style');
  css.textContent = [
    'html.ntech-intro{overflow:hidden}',
    '#ntech-intro{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:#0B0F0E;cursor:pointer;',
    '  font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;transition:opacity .5s ease,visibility .5s}',
    '#ntech-intro.sair{opacity:0;visibility:hidden}',
    '#ntech-intro .ni-palco{display:flex;flex-direction:column;align-items:center;gap:18px;padding:16px;text-align:center}',
    '#ntech-intro .ni-logo{width:84px;height:84px;filter:drop-shadow(0 0 22px rgba(92,255,79,.55));animation:ni-logo .9s cubic-bezier(.2,.9,.3,1.3) both}',
    '#ntech-intro .ni-logo path{stroke:#0B0F0E;stroke-width:1;stroke-dasharray:200;stroke-dashoffset:200;animation:ni-traco .8s .35s ease forwards}',
    '#ntech-intro .ni-por{color:#8a948f;font-size:12px;font-weight:500;letter-spacing:.35em;text-transform:uppercase;opacity:0;animation:ni-sobe .6s .55s ease forwards}',
    '#ntech-intro .ni-nome{display:flex;color:#fff;font-size:clamp(44px,12vw,88px);font-weight:900;letter-spacing:.14em;line-height:1;margin-right:-.14em}',
    '#ntech-intro .ni-nome span{opacity:0;transform:translateY(.4em);animation:ni-letra .5s ease forwards}',
    '#ntech-intro .ni-nome span:first-child{color:#5CFF4F;text-shadow:0 0 24px rgba(92,255,79,.6)}',
    '#ntech-intro .ni-linha{width:0;height:3px;border-radius:3px;background:#5CFF4F;box-shadow:0 0 14px #5CFF4F;animation:ni-linha .7s 1.25s ease forwards}',
    '#ntech-intro .ni-pular{position:absolute;bottom:20px;color:#5d6661;font-size:11px;letter-spacing:.2em;text-transform:uppercase}',
    '@keyframes ni-logo{from{opacity:0;transform:scale(.4) rotate(-12deg)}to{opacity:1;transform:none}}',
    '@keyframes ni-traco{to{stroke-dashoffset:0}}',
    '@keyframes ni-sobe{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
    '@keyframes ni-letra{to{opacity:1;transform:none}}',
    '@keyframes ni-linha{to{width:min(220px,50vw)}}',
    '@media (prefers-reduced-motion:reduce){#ntech-intro *{animation-duration:.01s!important;animation-delay:0s!important}}'
  ].join('\n');
  document.head.appendChild(css);

  var letras = 'NTECH'.split('').map(function (l, i) {
    return '<span style="animation-delay:' + (0.75 + i * 0.07).toFixed(2) + 's">' + l + '</span>';
  }).join('');

  var el = document.createElement('div');
  el.id = 'ntech-intro';
  el.setAttribute('role', 'presentation');
  el.innerHTML =
    '<div class="ni-palco">' +
      '<svg class="ni-logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#5CFF4F"/>' +
      '<path d="M18 46V22c0-3 2-5 5-5s4 1 5 3l9 16V18h9v24c0 3-2 5-5 5s-4-1-5-3l-9-16v18z" fill="#0B0F0E"/></svg>' +
      '<div class="ni-por">desenvolvido por</div>' +
      '<div class="ni-nome" aria-label="NTECH">' + letras + '</div>' +
      '<div class="ni-linha"></div>' +
    '</div>' +
    '<div class="ni-pular">toque para pular</div>';

  document.documentElement.classList.add('ntech-intro');
  document.documentElement.appendChild(el);

  var fechado = false;
  function fechar() {
    if (fechado) return;
    fechado = true;
    el.classList.add('sair');
    document.documentElement.classList.remove('ntech-intro');
    document.removeEventListener('keydown', fechar);
    setTimeout(function () { el.remove(); }, 600);
  }
  el.addEventListener('click', fechar);
  document.addEventListener('keydown', fechar);
  setTimeout(fechar, DURACAO);
})();
