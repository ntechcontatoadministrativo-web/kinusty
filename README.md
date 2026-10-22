# 🏐 Kinusty Volleyball — Sistema da Escolinha

Site de matrículas, área do aluno e painel administrativo da **Kinusty Volleyball** (Belém/PA).

## Como rodar

Requisito: **Node.js 22.9 ou mais novo**. O banco é Postgres na **Neon** (projeto `kinusty-volei`);
a string de conexão fica em `.env.local` como `DATABASE_URL` (esse arquivo não vai para o GitHub).

```bash
npm install
npm start        # abre em http://localhost:3000
```

> ⚠️ O computador local e o site publicado usam **o mesmo banco**. `npm run seed` adiciona alunos
> fictícios (o banco hoje só tem alunos reais — não rode no banco de produção) e `npm run reset` **apaga tudo** (inclusive alunos reais) — use com cuidado.

| Acesso | Login | Senha |
|---|---|---|
| Administração | `admin@kinusty.com` | `kinusty2026` |

> Para começar do zero (só o admin, sem alunos fictícios): `npm run reset`.
> **Troque a senha do admin e a chave PIX** em *Configurações* antes de usar de verdade.

## O que tem

**Site público** (`/`) — apresentação, planos individuais (2x R$150 · 3x R$200 · 4x R$230), casal (2x R$280 · 3x R$370 · 4x R$420) e família (terça e quinta: 2 pessoas R$270 · 3 R$405 · 4 R$540), turmas e horários, botão de WhatsApp para aula experimental.

**Matrícula online** (`/matricula.html`) — 3 etapas: tipo de plano (individual, casal ou família) → plano → turma e dias (as turmas não têm limite de vagas); ficha de cada pessoa igual à ficha em papel (sexo, RG/CPF, endereço, já praticou vôlei, condições de saúde e, para menores de 18, responsável com parentesco, telefone e e-mail); login, autorização de uso de imagem e aceite das regras (reposição de faltas etc.). No casal/família, o 1º é o titular: faz o login e a mensalidade do grupo fica no nome dele; os demais não têm login. Ao concluir, o aluno já entra logado na área dele e a 1ª mensalidade é gerada (vence em 3 dias).

**Área do aluno** (`/aluno.html`)
- Início: plano, status, frequência, próximos treinos, mural de avisos
- Check-in de presença no dia de treino
- Mensalidades com **PIX copia e cola + QR Code** gerados automaticamente e botão "informar pagamento"
- Histórico de frequência, sequência de treinos
- Troca de plano/turma/dias, edição de dados e senha

**Painel administrativo** (`/admin.html`)
- **Dashboard**: alunos ativos e crescimento, faturamento mensal (MRR), projeção anual, recebido x previsto, valor em atraso e % de inadimplência, ticket médio, novas matrículas e cancelamentos, gráfico de faturamento de 6 meses, evolução de alunos, alunos/receita por plano, ocupação das turmas, alunos por dia, nível, faixa etária, aniversariantes do mês, lista de inadimplentes com botão "Cobrar" no WhatsApp
- **Alunos**: busca e filtros, ficha completa, alterar plano/turma/dias/status (ativa, trancada, cancelada), exportar planilha CSV
- **Financeiro**: mensalidades por mês, confirmar pagamentos informados pelos alunos, dar baixa (PIX/dinheiro/cartão), estornar, cancelar cobrança
- **Chamada**: lista dos alunos de cada turma no dia, presente/falta
- **Turmas e planos**: criar/editar turmas, horários, dias e vagas; alterar preços
- **Avisos** para o mural dos alunos e **Configurações** (WhatsApp, endereço, chave PIX, dia de vencimento)

Mensalidades de todos os alunos ativos são geradas automaticamente todo mês (vencimento padrão dia 10).

## Estrutura

```
server.js        API (Express) — rotas públicas, aluno e admin
db.js            conexão Postgres (Neon), criação das tabelas e dados iniciais
seed.js          dados de demonstração / reset
render.yaml      configuração de publicação no Render
public/          site, matrícula, área do aluno e painel admin
```

## Publicação (Render + Neon)

O site roda no **Render** (plano grátis, região Ohio) e o banco na **Neon** (região us-east-2, a mesma).
O Render publica automaticamente a cada `git push` na branch `main`.
A única variável obrigatória no Render é `DATABASE_URL` (copiada do `.env.local` ou do painel da Neon → *Connect*).

No plano grátis o Render "dorme" após 15 min sem acesso; o primeiro acesso depois disso leva ~50 s.
Para ficar sempre ligado, mude para o plano pago (Starter) no painel do Render.

## Mercado Pago

Os alunos podem pagar a mensalidade online (PIX, cartão ou boleto) pelo **Checkout Pro**; quando o pagamento
é aprovado a mensalidade é baixada sozinha. A chave PIX manual continua disponível como alternativa.

1. No [painel de desenvolvedor do Mercado Pago](https://www.mercadopago.com.br/developers/panel/app), crie uma aplicação
   (produto *Checkout Pro*) e copie o **Access Token** (`APP_USR-...` para produção ou `TEST-...` para testes).
2. Coloque em `.env.local` (local) e nas variáveis de ambiente do Render:
   ```
   MP_ACCESS_TOKEN=APP_USR-xxxxxxxx
   MP_WEBHOOK_SECRET=xxxxxxxx   # opcional: "assinatura secreta" da tela de Webhooks
   ```
3. Em *Webhooks* da aplicação, cadastre `https://SEU-SITE.onrender.com/api/mercadopago/webhook` com o evento **Pagamentos**
   (a URL exata aparece em *Configurações* no painel admin).

No computador local (http) o webhook não chega, mas o pagamento é confirmado quando o aluno volta do checkout.
