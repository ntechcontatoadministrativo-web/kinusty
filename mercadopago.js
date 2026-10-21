// Integração com o Mercado Pago (Checkout Pro: PIX, cartão e boleto).
// Credenciais vêm do ambiente: MP_ACCESS_TOKEN e, opcionalmente, MP_WEBHOOK_SECRET.
const crypto = require('node:crypto');

const API = 'https://api.mercadopago.com';

const configurado = () => !!process.env.MP_ACCESS_TOKEN;
const modoTeste = () => (process.env.MP_ACCESS_TOKEN || '').startsWith('TEST-');

async function chamar(metodo, caminho, corpo) {
  if (!configurado()) throw Object.assign(new Error('Pagamento online indisponível no momento.'), { status: 503 });
  const res = await fetch(API + caminho, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(metodo === 'POST' ? { 'X-Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Mercado Pago ${metodo} ${caminho} → ${res.status}`, dados.message || dados);
    throw Object.assign(new Error('Não foi possível falar com o Mercado Pago. Tente novamente.'), { status: 502 });
  }
  return dados;
}

// Cria a preferência de pagamento e devolve o link do checkout
async function criarCheckout({ mensalidade, aluno, titulo, baseUrl }) {
  const https = baseUrl.startsWith('https://');
  const retorno = `${baseUrl}/aluno.html?mp=retorno`;
  const pref = await chamar('POST', '/checkout/preferences', {
    items: [{ id: `mens-${mensalidade.id}`, title: titulo, quantity: 1, unit_price: Number(mensalidade.valor), currency_id: 'BRL' }],
    payer: { name: aluno.nome, email: aluno.email },
    external_reference: `mens-${mensalidade.id}`,
    statement_descriptor: 'KINUSTY VOLEI',
    back_urls: { success: retorno, pending: retorno, failure: retorno },
    // O Mercado Pago só aceita retorno automático e webhook em endereços https (site publicado)
    ...(https ? { auto_return: 'approved', notification_url: `${baseUrl}/api/mercadopago/webhook` } : {}),
  });
  return modoTeste() ? pref.sandbox_init_point || pref.init_point : pref.init_point;
}

const buscarPagamento = id => chamar('GET', `/v1/payments/${encodeURIComponent(id)}`);

// Confere a assinatura x-signature do webhook (só quando MP_WEBHOOK_SECRET estiver definido)
function assinaturaValida(req, dataId) {
  const segredo = process.env.MP_WEBHOOK_SECRET;
  if (!segredo) return true;
  const partes = Object.fromEntries(String(req.get('x-signature') || '').split(',').map(p => p.split('=').map(s => s.trim())));
  if (!partes.ts || !partes.v1) return false;
  const manifesto = `id:${String(dataId).toLowerCase()};request-id:${req.get('x-request-id') || ''};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');
  return esperado.length === partes.v1.length && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(partes.v1));
}

const FORMAS = { pix: 'PIX', bank_transfer: 'PIX', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito', ticket: 'Boleto', account_money: 'Saldo Mercado Pago' };
const formaPagamento = p => `Mercado Pago · ${FORMAS[p.payment_type_id] || p.payment_type_id || 'online'}`;

module.exports = { configurado, modoTeste, criarCheckout, buscarPagamento, assinaturaValida, formaPagamento };
