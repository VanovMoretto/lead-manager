# Gestão de Leads & Propostas — Visão geral completa do app

> Documento de contexto para outra IA (ou desenvolvedor) entender o app por inteiro: o que ele é, para quem, como as telas funcionam, como os dados são modelados, quais regras de negócio existem e onde cada coisa está no código.
>
> Idioma do produto: **português do Brasil** (interface, mensagens, comentários de código e nomes de colunas descritivas). Moeda: **R$ (BRL)**. Datas exibidas como `dd/mm/aaaa`.

---

## 1. O que é

**Micro-CRM para a equipe comercial de um espaço de eventos** (hotel / centro de eventos com salões, salas de reunião, auditório, terraço etc.). Ele cobre o ciclo inteiro de um orçamento de evento:

1. Chega uma **solicitação** (lead) — por Instagram, Google, indicação, WhatsApp, cerimonialista…
2. O comercial cadastra a **proposta**: quem pediu, empresa (ou pessoa física), salas de interesse, data do evento, valores (locação + serviços).
3. Acompanha o **funil**: em aberto → fechado ou perdido (com motivo).
4. Faz **follow-up** pelo WhatsApp com mensagem pronta.
5. Quando fecha, o evento entra na **planilha de faturamento** (NFs, pagamento, PAX, situação operacional).
6. Depois do evento, envia a **pesquisa de satisfação** (nota de 1 a 10).
7. Usa a base para **mailing/campanhas**, sempre respeitando o **opt-out da LGPD**.

Tudo isso com **indicadores** (dashboard de conversão, receita mês a mês, painel por cliente) e **exportações** (Excel, CSV de mailing, PDF).

- Produção: `https://gestao-de-propostas.vercel.app` (Supabase real, acesso só com usuário cadastrado).
- Portfólio: projeto `lead-manager-demo` na Vercel (Modo Demonstração, dados fictícios, sem banco).
- Repositório: `VanovMoretto/lead-manager`.

### Vocabulário do domínio (importante)

| Termo na interface | Significado | No código/banco |
| --- | --- | --- |
| **Proposta** / orçamento / solicitação | Um pedido de evento. É a entidade central. | tabela `leads` (sim, "lead" no banco = proposta) |
| **Lead** (na tela "Consultar Leads") | O **cliente** (empresa, pessoa física ou cerimonialista) com todo o histórico de propostas | tabela `clients` + view `client_summaries` |
| **Contato** / pessoa de contato | Pessoa que fala em nome do cliente (pode mudar com os anos) | tabela `client_contacts` |
| **Braço** | Outro CNPJ da mesma marca (matriz, filial, franquia) — cada um é um cliente separado | `clients` com mesmo nome e CNPJ diferente |
| **Sondagem** | Pedido sem proposta formal enviada (orçamento verbal) | `proposal_sent = false` |
| **Locação de sala** | Valor do espaço; é a **meta pessoal** do comercial | `proposed_value` |
| **A&B** | Alimentos & Bebidas | `ab_value` |
| **Receita Bruta** | 100% de todos os serviços | coluna gerada `total_value` |
| **Receita Líquida do Hotel** | 100% locação e hospedagem, 50% estacionamento, 15% equipamentos, 6% A&B | coluna gerada `net_value` |
| **PAX** | Número de pessoas do evento | `pax` |
| **Responsável** | Usuário que cadastrou a proposta (só o ADMIN troca) | `leads.user_id` |
| **Cerimonialista** | Profissional que indica clientes (festas sociais) | `clients.client_type = 'ceremonialist'`, `leads.ceremonialist_id` |
| **Opt-out LGPD** | Contato pediu para não receber comunicações | `leads.marketing_opt_out` + tabela `marketing_suppressions` |

---

## 2. Stack e arquitetura

- **Front-end:** React 19 + TypeScript (~6) + Vite 8 (Rolldown) + Tailwind CSS 3 + React Router 7. SPA pura, sem servidor próprio.
- **Back-end:** **Supabase** — Postgres com **Row Level Security**, Supabase Auth (e-mail/senha), Storage (buckets privados), funções RPC em PL/pgSQL e muitos **triggers** que concentram as regras de negócio.
- **Gráficos:** Recharts. **Exportação:** SheetJS (`xlsx`), jsPDF + jspdf-autotable (carregados sob demanda). **Ícones:** lucide-react.
- **Lint:** oxlint (`npm run lint`). **Build:** `tsc -b && vite build`.
- **Deploy:** Vercel (cada push na `main` publica o app real e o de portfólio). Há também script para GitHub Pages (opcional).
- **Captcha opcional:** Cloudflare Turnstile (`VITE_TURNSTILE_SITE_KEY`).
- **API externa pública:** BrasilAPI (consulta de CNPJ na Receita Federal para autopreencher o nome da empresa).

Princípio de projeto: **a regra de verdade está no banco** (constraints, triggers, RLS, RPCs). A interface valida para dar boa experiência, mas o banco recusa qualquer coisa inválida, mesmo vinda direto pela API.

### Variáveis de ambiente (`.env`)

| Variável | Uso |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Projeto Supabase (chave pública anon/publishable). Sem elas (e fora do demo), o app mostra a tela "Configure o Supabase". |
| `VITE_DEFAULT_EMAIL_DOMAIN` | Domínio completado no login quando se digita só o usuário (padrão `@empresa.com.br`; no demo `@portfolio.demo`). |
| `VITE_DEMO_MODE` | `true` liga o Modo Demonstração (ver seção 9). |
| `VITE_TURNSTILE_SITE_KEY` | Captcha no login e recuperação de senha (opcional; desligado no demo). |

`.env.demo` (commitado, sem segredos) é usado por `npm run dev:demo` / `npm run build:demo`.

---

## 3. Estrutura de pastas

```
src/
  App.tsx              Rotas (lazy por página), providers (tema, confirmação, auth)
  main.tsx
  types/lead.ts        TODOS os tipos do domínio + tipo `Database` do Supabase (tabelas, view, RPCs)
  contexts/            AuthContext (sessão, perfil, papel ADMIN, login/logout/senha), ThemeContext, ConfirmContext
  hooks/               useSettingsOptions, useRecurringClient (reconhecimento de cliente), useCompanies,
                       useAvatarUrl, useCeremonialists, useUserLogins, useLeadSectionDraft, useConfirm
  components/          Layout (sidebar), LeadFormModal (cadastro), LeadFormFields, RecurringClientNotice,
                       ContactMergeDialog, CeremonialistFormModal, CampaignFormModal, ContactFormModal,
                       ClientMetricsPanel, ExportPreviewModal, UserManagement, LeadOwnerCell, WhatsAppButton,
                       StatusBadge, ClientTypeBadge, ValueDetails, Turnstile, DemoLoginPanel, DemoModeBadge…
  pages/               Login, ResetPassword, Dashboard, LeadSearch (Consultar Propostas), LeadDetails,
                       ClientList (Consultar Leads), ClientDashboard, RevenueMap (Faturamento & Eventos),
                       MailingHub (Mailing & Pesquisas), Profile, AdminPanel
  lib/                 supabase.ts (cliente), leadForm.ts (estado/validação/payload do formulário),
                       leadFields.ts (salas, valores, receita líquida), leadQuery.ts / clientQuery.ts (consultas),
                       dashboard.ts (KPIs, períodos), revenue.ts (planilha de faturamento), mailing.ts /
                       mailingHub.ts (mailing, campanhas, pesquisas), communication.ts (registro de envios),
                       whatsapp.ts (links wa.me e mensagens), exporters.ts (xlsx/csv/pdf), leadAttachments.ts,
                       storage.ts, format.ts (máscaras, CNPJ, BRL), cnpj.ts (BrasilAPI), clientIdentity.ts,
                       contactIdentity.ts, authHelpers.ts, passwordRecovery.ts, loginThrottle.ts,
                       rateLimit.ts, turnstile.ts, demoMode.ts / demoStore.ts / demoSeed.ts (modo demo)
supabase/
  schema.sql           Banco completo para projeto novo
  migrations/          002 → 017, incrementais e idempotentes
  seed_leads_teste.sql 11 leads fictícios opcionais
vercel.json, public/_headers, public/_redirects   Rewrites de SPA + cabeçalhos de segurança (CSP etc.)
```

---

## 4. Rotas e navegação

Sidebar fixa (desktop) / menu lateral deslizante (mobile), botão **"+ Nova Proposta"** sempre visível, perfil do usuário (avatar + login), alternância de tema claro/escuro e Sair.

| Rota | Tela | Acesso |
| --- | --- | --- |
| `/login` | Login | público |
| `/redefinir-senha` | Nova senha (link ou código do e-mail) | público |
| `/` | **Dashboard** | logado e ativo |
| `/propostas` | **Consultar Propostas** (lista de orçamentos) | logado |
| `/propostas/:proposalId` | **Detalhes da proposta** (edição inline) | logado |
| `/leads` | **Consultar Leads** (lista de clientes) | logado |
| `/leads/:clientId` | **Dashboard do cliente** | logado |
| `/faturamento` | **Faturamento & Eventos** (planilha mensal) | logado |
| `/mailing` | **Mailing & Pesquisas** | logado |
| `/perfil` | Meu perfil (foto, troca de senha) | logado |
| `/admin` | **Painel Admin** | só ADMIN |
| `*` | redireciona para `/` | |

Páginas são carregadas sob demanda (`React.lazy`). `PrivateRoute` exige sessão; `AdminRoute` exige papel ADMIN.

---

## 5. Telas em detalhe

### 5.1 Login (`pages/Login.tsx`)
- Campo **Usuário** (digita `nome.sobrenome`; o app completa com `VITE_DEFAULT_EMAIL_DOMAIN`; e-mail completo também vale) e **Senha** com mostrar/ocultar.
- "Manter-me logado" (sessão em `localStorage` ou `sessionStorage`), "Lembrar meu usuário" (guarda só o usuário, nunca a senha).
- "Esqueci minha senha": envia e-mail do Supabase (cooldown de 60 s, mensagem neutra que não revela se o usuário existe).
- **Freio contra força bruta** no navegador: 5 falhas → bloqueio de 30 s, e cada nova falha dobra a espera (60 s, 120 s…), persistido no `localStorage`.
- Captcha Turnstile opcional.
- Usuário **desativado** consegue autenticar no Auth, mas o app lê o perfil, encerra a sessão e mostra o aviso "Seu acesso ainda não foi liberado ou está desativado".
- Painel de marca à esquerda (desktop) com o slogan "Cada evento começa com um bom atendimento."
- **No modo demo**: caixa "✨ Modo Demonstração (Portfólio)" com botões de login de 1 clique (Admin / Comercial).

### 5.2 Redefinir senha (`pages/ResetPassword.tsx`, `lib/passwordRecovery.ts`)
- Página fora do app: aceita o **link** do e-mail ou um **código** (token do template do Supabase).
- A sessão de recuperação fica **só em memória** (cliente Supabase separado, sem persistência) — não vira login no app; serve só para gravar a nova senha. Ao salvar, **todas as sessões são encerradas**.
- Senha mínima: 8 caracteres com letras e números.

### 5.3 Dashboard (`pages/Dashboard.tsx`, `lib/dashboard.ts`)
Filtro de período: **Este mês** (padrão), Últimos 30 dias, Este ano, Personalizado. Os leads do período são contados pela **data de criação** da proposta.
- **KPIs:**
  - *Solicitações recebidas* (total + média diária, contando só dias já passados).
  - *Propostas formais enviadas* vs. sondagens (barra percentual). Proposta fechada conta como enviada mesmo sem o toggle.
  - *Taxa de conversão geral* = fechados ÷ total (e também fechados ÷ propostas enviadas), com locação de sala fechada e receita bruta fechada.
  - *Taxa de perda/recusa* = perdidos ÷ total (+ quantos ainda em aberto).
- **Composição dos orçamentos**: Fechado vs. Em aberto (pipeline), com Locação de sala em destaque, receita líquida, receita bruta e a barra das demais receitas (A&B, Hospedagem, Equipamentos, Estacionamento).
- **Receita mês a mês**: dois gráficos de barras, cada um com seletor de mês independente do filtro de período:
  - *Pelo mês do evento*: realizada (fechados) × em negociação.
  - *Pelo mês da proposta*: quanto fechou, está em aberto ou foi perdido do que foi proposto naquele mês.
  - Clicar numa barra seleciona aquele mês.
- **Evolução das solicitações**: barras por dia (até 45 dias) ou por mês: recebidas, propostas enviadas, fechadas.
- **Origem das solicitações**: donut por **Sala/Salão** ou por **Meio de prospecção** (um lead com várias salas conta em cada uma; até 7 fatias).
- **Motivos de perda**: ranking horizontal.
- **Últimos leads em aberto** (8 mais recentes): contato, empresa, telefone + botão WhatsApp, salas/origem, data do evento, receita total, nº da proposta ou "Sondagem", selo **"sem atualização"** (âmbar a partir de 7 dias, vermelho a partir de 14), e ação rápida para atualizar a situação sem sair da Dashboard.

### 5.4 Nova Proposta — formulário (`components/LeadFormModal.tsx`, `lib/leadForm.ts`)
Modal grande, aberto pelo botão "Nova Proposta" (ou "Nova Proposta para este Cliente" na página do cliente / cerimonialista). Seções e campos:
- **Contato:** nome (obrigatório), telefone/WhatsApp com máscara `(11) 98765-4321`, e-mail, **CNPJ** (máscara + validação dos dígitos), **Empresa** (vazio = pessoa física; autocomplete das empresas/braços já cadastrados), opt-out LGPD.
  - Digitar CNPJ já cadastrado preenche a empresa; CNPJ novo é consultado na **BrasilAPI** para sugerir o nome.
- **Reconhecimento de cliente recorrente** (`hooks/useRecurringClient.ts` + `RecurringClientNotice`): enquanto digita, cruza CNPJ, e-mail, telefone, nome da empresa e domínio do e-mail corporativo com a base (pesos: CNPJ 20, e-mail 8, telefone 4, empresa 3, domínio 2). Mostra o cartão do cliente (propostas anteriores, fechamentos, receita, contatos, última proposta) e pergunta se a nova proposta **entra no histórico** dele ou vira **cadastro separado**. Se houver vários braços, o vendedor escolhe. Avisa também quando o contato pediu **opt-out** (a proposta nasce com opt-out). `ContactMergeDialog` pergunta se o contato digitado deve usar os dados da empresa a que já está ligado.
- **Origem e interesse:** meio de prospecção (opções do Painel Admin); se for **"Cerimonialista"**, pede qual cerimonialista indicou (ou cadastra uma nova: nome, telefone, e-mail — RPC `create_ceremonialist`). Salas/Salões de interesse: **seleção múltipla** (chips).
- **Evento:** nome do evento, PAX, data de interesse; "evento de mais de um dia" (data inicial e final); ou "**Cliente ainda sem data definida**" com campo de previsão (ex.: "Previsão para Novembro").
- **Valores:** Locação/Espaço (R$) e toggles com valor para A&B, Hospedagem, Equipamentos/Extras, Estacionamento. Campo de moeda digita da direita (centavos primeiro). Mostra na hora a **Receita Bruta** e a **Receita Líquida**.
- **Proposta e funil:** "Proposta formal enviada?" (Sim/Não), nº da proposta, situação em cards: **Em Aberto / Fechou / Não Fechou**. Perdido exige motivo (opções do Admin; "Outros" exige descrição).
- **Validação (proposta nova):** nome; ao menos uma sala (se houver salas cadastradas); data ou "sem data definida"; valor de locação; telefone/CNPJ/e-mail válidos se preenchidos; fechado exige **nº da proposta**; data final ≥ inicial.
- Botões: **Cadastrar proposta** e **Salvar e cadastrar outro**. Toast de sucesso no rodapé.
- Payload limpa o que não se aplica (ex.: perdido sem nº de proposta; desmarcar A&B zera o valor; fechado implica `proposal_sent = true`).

### 5.5 Consultar Propostas (`pages/LeadSearch.tsx`, `lib/leadQuery.ts`)
Lista paginada (25/50/100) de **cada orçamento individual**.
- **Filtros:** período por *data de criação* ou *data do evento* (De/Até; o filtro por evento pega eventos de vários dias que tocam o período), situação, proposta enviada (sim/não), sala, meio de prospecção, empresa (uma empresa, só empresas, só pessoa física), motivo de recusa e **busca textual** (nome, e-mail, telefone — inclusive só dígitos —, nº da proposta, empresa, CNPJ). Contador de filtros ativos + "Limpar".
- **Colunas:** criado em, contato (+empresa, WhatsApp), evento/datas, salas, receita total, situação (badge), **Responsável** (login; ADMIN pode trocar inline), ações.
- Ordenação por criação, nome, data do evento, receita, situação. Clicar abre os **Detalhes**.
- **Exportações** (com pré-visualização antes de baixar — `ExportPreviewModal`):
  - **Excel (.xlsx):** todas as colunas (criado em como data real, contato, empresa, CNPJ, telefone, e-mail, meio, salas, data do evento, valores de cada serviço, receita bruta e líquida, proposta enviada, nº, situação, motivo, opt-out, observações) com linha de totais.
  - **Mailing (.csv):** **um contato por linha** (deduplicado por e-mail OU telefone, de forma transitiva via union-find), sem quem pediu opt-out (inclusive opt-outs de leads fora do filtro ou já excluídos). Colunas: Nome, Empresa, Email, Telefone, Sala de Interesse, Status, Qtd Solicitações, Já Fechou Evento?.
  - **Relatório PDF:** cabeçalho com resumo dos filtros, tabela com a situação colorida e totais.
  - Proteção contra *formula injection* (texto começando com `=`, `+`, `-`, `@` recebe apóstrofo).

### 5.6 Detalhes da proposta (`pages/LeadDetails.tsx`, `hooks/useLeadSectionDraft.ts`)
Página com todos os dados, **editáveis no próprio card**:
- Cabeçalho: contato, empresa, badge de situação, nº da proposta, link **"Ver histórico da empresa/do cliente"**, botão WhatsApp de follow-up, ações rápidas **Fechou / Perdeu** (levam ao campo a preencher), excluir (ADMIN).
- Cards **Contato** e **Evento**: botão Editar de cada card (nome, telefone, e-mail, CNPJ, empresa, meio de prospecção, cerimonialista; salas, data/data final ou previsão, nome do evento, PAX).
- Card **Proposta**: edição direta (situação, proposta enviada, nº, motivo da perda, locação e serviços extras), com o resumo de receitas recalculado na hora e **Salvar/Descartar**. Cada card tem rascunho próprio e grava só as próprias colunas.
- **Faturamento, NFs e Pós-Evento**: situação operacional, NFs (locação, A&B, estacionamento), pagamento, pesquisa (status e nota).
- **Observações da negociação**: texto livre (até 5000 caracteres) com salvamento rápido.
- **Anexos das propostas**: Proposta de Locação e Proposta de A&B (PDF, DOC, DOCX, PNG, JPG até 10 MB). Validação por extensão, tipo MIME e **assinatura dos bytes**. Arquivos no bucket privado `lead-attachments`, abertos por link assinado de 60 s (Abrir / Baixar / Excluir-ADMIN).
- **Histórico**: cadastrado em, última atualização, responsável.

### 5.7 Consultar Leads (`pages/ClientList.tsx`, `lib/clientQuery.ts`)
Uma linha **por cliente** (empresa, pessoa física ou cerimonialista), lendo a view `client_summaries`.
- Colunas: cliente (nome, CNPJ, badge de tipo), pessoas de contato (principal + "+N contatos", telefone, e-mail, WhatsApp ou selo "Opt-out LGPD"), propostas (total, fechadas, em aberto), **receita gerada** (soma das fechadas) e em aberto, último contato, botão Abrir.
- Busca por nome, CNPJ, domínio, qualquer contato, telefone (também só dígitos) ou e-mail. Filtros: **Tipo** (Empresas, Pessoa Física, **Cerimonialistas**), **Histórico** (já fechou, com proposta em aberto, sem fechamento). Ordenação: maior receita, qtd. de propostas, último contato, nome.

### 5.8 Dashboard do cliente (`pages/ClientDashboard.tsx`, `components/ClientMetricsPanel.tsx`)
- Cabeçalho: nome, tipo, CNPJ, domínio corporativo, **observações gerais do cliente**, editar nome/tipo/CNPJ, **"Nova Proposta para este Cliente"**, **"Criar outro braço / CNPJ desta empresa"**, excluir cliente (ADMIN — com ou sem as propostas).
- KPIs: **Receita total gerada (LTV)** com composição, **Em negociação (pipeline)**, **Conversão do cliente**, **Ticket médio fechado**. Os três primeiros abrem um painel de gráficos: receita líquida fechada mês a mês ou por ano, meses em que o cliente mais pede propostas, valor em negociação por mês do evento (com a lista das propostas abertas), conversão por ano com motivos de perda.
- **Pessoas de contato**: principal (coroa), cargo, quantas propostas tratou, ano, inativos; adicionar/editar/excluir (excluir só ADMIN); só um principal por cliente.
- **Histórico de propostas** (todos os anos): data, nº, quem pediu, salas, evento (datas), receita total com composição, situação, responsável.
- Para **cerimonialista**: mostra também as propostas que ela indicou (inclusive de empresas).

### 5.9 Faturamento & Eventos (`pages/RevenueMap.tsx`, `lib/revenue.ts`)
Planilha mensal **pelos eventos (data de realização)**, só propostas fechadas e em aberto (perdidas não entram).
- Período: mês, ano inteiro ou **personalizado (De/Até, ex.: 18/09 a 17/10)** — mudar uma ponta além da outra arrasta a outra pelo mesmo intervalo.
- **3 camadas de receita:** Locação de Sala (meta pessoal), Receita Líquida do Hotel e Receita Bruta. Cards de KPIs com tooltip de composição (por serviço; ou por situação na locação). Gráfico comparativo janeiro→dezembro (métrica: locação, líquida, bruta ou comparação) e "Eventos & Público (PAX)".
- **Situação do evento** na planilha: proposta em aberto = **À confirmar**; fechada = **Confirmado** (evento futuro) ou **Realizado** (já passou).
- **Planilha** (cabeçalho fixo, rolagem horizontal com setas): Data, Evento, Empresa/Contato, Origem, Local, PAX, Situação, Locação, Extras (100% e 15%), A&B (100% e 6%), Hospedagem, Estacionamento (100% e 50%), NF Locação, NF A&B, NF Estac., Pagamento (Pendente/Pago/Parcial), Faturamento Bruto, Faturamento Líquido, Nº Proposta, Pesquisa, Responsável. **Edição rápida na linha**: situação, PAX, NFs, pagamento e pesquisa.
- Rodapé com soma bruta, soma líquida e meta de locação. Exportação **Excel** e **PDF**.

### 5.10 Mailing & Pesquisas (`pages/MailingHub.tsx`, `lib/mailingHub.ts`, `lib/mailing.ts`)
Filtro de período no topo e indicadores:
- **Performance de e-mail**: funil Enviados → Entregues → Abertos (→ cliques/respostas) somando as campanhas do período.
- **Pesquisas de satisfação**: eventos no período, pesquisas enviadas, respondidas (taxa de resposta), **nota média (1–10)**.
- **Engajamento via WhatsApp**: mensagens iniciadas pelo app por finalidade (follow-up comercial, relacionamento/saudação, pesquisa pós-evento, campanha, envio de proposta).
- **Saúde da base & LGPD**: contatos elegíveis, com e-mail válido, com WhatsApp válido, opt-outs, tamanho da lista de supressão.

Abas:
1. **Campanhas & Métricas de E-mail**: gráfico Enviados × Entregues × Abertos; **nova campanha** (`CampaignFormModal`): nome, canal (E-mail, WhatsApp, Ambos), **segmento** (toda a base elegível, clientes que já fecharam, propostas em aberto, recuperação de perdidos, apenas empresas B2B) → calcula o **público elegível** (contatos únicos, sem opt-out, alcançáveis pelo canal), exporta o CSV; depois registra os números de retorno ("Atualizar números"). Status: Rascunho → Enviada (o banco grava `sent_at`) → Concluída. O banco garante entregues ≤ enviados, abertos ≤ entregues, cliques ≤ abertos.
2. **Pesquisas de Satisfação**: eventos realizados (opcionalmente confirmados) no período, botão para **enviar a pesquisa pelo WhatsApp** (mensagem pronta pedindo nota de 1 a 10), situação (não enviada / enviada / respondida) e nota. O banco preenche `survey_sent_at` / `survey_responded_at`.
3. **Base de Contatos & Audiência** ("Mailing vivo"): base única agrupada por contato, com busca, filtros (com e-mail, com WhatsApp, já fechou, LGPD) e exportação do mailing.

**Cada clique num botão de WhatsApp do app é registrado** em `communication_logs` (canal, finalidade, destinatário, lead/cliente) — limite de 60 registros/min por usuário no banco.

### 5.11 Perfil (`pages/Profile.tsx`)
Foto de perfil (PNG/JPG/WEBP, bucket privado `avatars`, caminho `{user_id}/{uuid}.ext`, exibida por link assinado de 1 h) e troca de senha (confirma a senha atual antes).

### 5.12 Painel Admin (`pages/AdminPanel.tsx`, `components/UserManagement.tsx`)
- **Opções dos formulários** em 3 colunas: **Salas/Salões**, **Meios de Prospecção**, **Motivos de Perda**. Adicionar, ativar/desativar (inativas somem dos formulários mas continuam no histórico), **renomear** (corrige também as propostas que usam o nome antigo — RPC `admin_rename_setting_option`) e **excluir** (opcionalmente passando as propostas para outra opção, para juntar duplicadas — RPC `admin_delete_setting_option`). Mostra quantas propostas usam cada opção. "Outros" (motivo de perda) é protegido.
- **Usuários**: lista (login, e-mail, último acesso), permissão (Admin / Usuário Comum) e acesso (Ativo / Desativado), via RPC `admin_set_user_access`. Ninguém altera o próprio acesso. Usuários novos nascem **desativados** até um ADMIN ativar.

---

## 6. Modelo de dados (Supabase / Postgres)

Tipos TypeScript espelhados em `src/types/lead.ts` (inclui o tipo `Database` usado em `createClient<Database>`).

### `leads` (a proposta)
Principais colunas:
- Identificação/tempo: `id`, `created_at` (definido pelo banco, não pode ser enviado), `updated_at` (trigger; ignora mudanças de colunas derivadas).
- Contato: `contact_name` (obrigatório), `contact_phone`, `contact_email`, `company` (nulo = pessoa física), `cnpj`, `marketing_opt_out`.
- Origem/interesse: `origin`, `room_interests text[]` (várias salas), `room_interest` (espelho legível "Sala A | Sala B", mantido por trigger), `ceremonialist_id`.
- Data: `event_date`, `event_end_date` (evento de vários dias), `is_date_flexible`, `date_notes`.
- Valores: `proposed_value` (locação), `has_ab`/`ab_value`, `has_lodging`/`lodging_value`, `has_equipment`/`equipment_value`, `has_parking`/`parking_value`.
- Funil: `proposal_sent`, `proposal_number` (único quando informado), `status` (`em_aberto` | `fechado` | `perdido`), `loss_reason` (obrigatório se perdido), `loss_reason_details`, `observations`.
- Evento/pós-evento: `event_name`, `pax`, `operational_status` (`a_confirmar` | `confirmado` | `realizado`), `nf_rental`, `nf_ab`, `nf_parking`, `payment_status` (`pendente` | `pago` | `parcial`), `survey_status` (`nao_enviada` | `enviada` | `respondida`), `survey_sent_at`, `survey_responded_at`, `survey_score` (1–10).
- Vínculos: `user_id` (responsável), `client_id`, `contact_id`.
- **Colunas geradas** (somente leitura): `contact_phone_digits`, `cnpj_digits`, `event_last_date` (= fim ou início), `total_value` (receita bruta), `net_value` (receita líquida).

### Demais tabelas
- **`clients`**: `name`, `client_type` (`company` | `individual` | `ceremonialist`), `email_domain` (domínio corporativo; nulo para gmail/hotmail etc.), `notes`, `cnpj` (único) + `cnpj_digits`, `branch_label` (ex.: "Matriz", "Filial Novo Hamburgo").
- **`client_contacts`**: `client_id`, `name`, `role`, `phone` + `phone_digits`, `email`, `is_primary` (no máximo um por cliente), `active`.
- **View `client_summaries`**: cliente + contagens (propostas, fechadas, em aberto, perdidas), receita fechada e em aberto, última proposta, contato principal (e se ele tem opt-out), `search_text` para busca. Para cerimonialista, conta também as propostas que indicou.
- **`app_settings_options`**: `category` (`room` | `origin` | `loss_reason`), `label` (único por categoria), `active`.
- **`marketing_suppressions`**: lista de supressão LGPD (`kind` email|phone, `value` normalizado, `source_lead_id` sem FK — sobrevive à exclusão do lead). Somente leitura para o app; mantida por triggers.
- **`lead_attachments`**: `lead_id`, `kind` (`rental_proposal` | `ab_proposal`), `storage_path` (`{lead}/{tipo}/{uuid}.ext`), `file_name`, `mime_type`, `size_bytes`, `uploaded_by`.
- **`user_profiles`**: `user_id`, `email`, `is_admin`, `is_active`, `avatar_path`, `last_sign_in_at` (criado/atualizado por trigger em `auth.users`).
- **`mailing_campaigns`**: `name`, `channel`, `segment_filter`, `status`, `audience_count`, `sent_count`, `delivered_count`, `opened_count`, `clicked_count`, `sent_at`, `notes`, `created_by`.
- **`communication_logs`**: `lead_id`, `client_id`, `channel` (whatsapp|email), `purpose`, `recipient`, `created_by`, `created_at`.

### RPCs
`is_admin()`, `is_active_user()`, `admin_set_user_access(p_user_id, p_is_admin?, p_is_active?)`, `admin_rename_setting_option`, `admin_delete_setting_option`, `create_ceremonialist(p_name, p_phone?, p_email?)`, `admin_set_lead_owner(p_lead_id, p_user_id)`, `list_user_logins()`.

### Storage
Buckets **privados** `lead-attachments` (10 MB, tipos de proposta) e `avatars`. Políticas validam o formato do caminho (sem `../`), a pasta do próprio usuário (avatar) e a existência da proposta (anexo).

---

## 7. Regras de negócio implementadas no banco (triggers)

1. **Cliente e contato de cada proposta** (`link_lead_client`): pelo app, proposta sem `client_id` cria um cliente novo (o vendedor já decidiu no formulário entre "histórico" e "cadastro separado"); por importação/SQL agrupa automaticamente (empresa pelo nome; pessoa física pelo telefone/e-mail). O contato é localizado dentro do cliente (mesmo e-mail = mesma pessoa; telefone só vale com o mesmo nome) ou criado. Cliente que só tem aquela proposta acompanha correções de nome/empresa.
2. **CNPJ/braços**: CNPJ já cadastrado leva a proposta ao braço dono; cliente sem CNPJ "aprende" o CNPJ e o propaga às suas propostas; CNPJ diferente da mesma marca cria um braço novo; mudar o CNPJ do cliente atualiza as propostas.
3. **Opt-out LGPD** (`apply_marketing_suppression` / `sync_marketing_suppression`): marcar opt-out registra e-mail e telefone na lista de supressão e propaga para todos os leads do mesmo contato; proposta nova de contato suprimido já nasce com opt-out. Revogar (novo consentimento) libera só o contato daquela proposta.
4. **Situação operacional × funil** (`sync_operational_status`): fechar uma proposta "à confirmar" vira *confirmado* (evento futuro) ou *realizado* (já passou); marcar confirmado/realizado numa proposta em aberto a fecha (e marca proposta enviada); voltar para "à confirmar" reabre; reabrir no funil volta para "à confirmar".
5. **Pesquisa**: marcar enviada/respondida preenche as datas.
6. **Autoria**: `user_id` = usuário logado no insert e não muda nas edições (só `admin_set_lead_owner`). `created_at` definido pelo banco.
7. **Limites**: no máximo **20 propostas por minuto por usuário**; 60 registros de comunicação/min; tamanho máximo dos textos; valores ≥ 0 e sem `NaN`; data final ≥ inicial; nota 1–10.
8. **Opções renomeadas/excluídas** atualizam as propostas sem mexer no `updated_at` (correção em massa não conta como edição).
9. **Usuário desativado** é recusado antes de qualquer trigger de escrita.

---

## 8. Segurança e permissões

| Ação | Usuário comum | ADMIN |
| --- | --- | --- |
| Ver, criar e editar propostas, clientes, contatos, observações, anexos, campanhas | ✓ | ✓ |
| Excluir propostas, clientes, contatos, anexos, campanhas | | ✓ |
| Trocar responsável da proposta | | ✓ |
| Painel Admin (opções e usuários) | | ✓ |

- **RLS em todas as tabelas**: só autenticado **e ativo** (`is_active_user()`) lê/grava. A interface só esconde o que o usuário não pode fazer.
- Chave pública (anon) no front-end; nunca `service_role`.
- Cabeçalhos HTTP (CSP restrita a self + Supabase + Turnstile + BrasilAPI, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy) em `vercel.json` e `public/_headers`.
- Anti duplo clique: mesma mutação ignorada por 1,5 s (`lib/rateLimit.ts`); consultas antigas canceladas com `AbortSignal` ao trocar filtro/página.
- Exportações neutralizam fórmulas.

---

## 9. Modo Portfólio / Demonstração (`VITE_DEMO_MODE=true`)

Usado para publicar o app num portfólio **sem banco e sem dados reais**.
- `src/lib/supabase.ts` troca o cliente Supabase por `createDemoClient()` (`src/lib/demoStore.ts`): um **"Supabase em memória"** com a mesma interface usada pelo app — auth (sessão, login, logout, troca de senha), construtor de consultas PostgREST (`select/insert/update/delete`, `eq/neq/gt/gte/lt/lte/like/ilike/is/in/contains/not/or/filter`, `order`, `range`, `limit`, `single/maybeSingle`, `count: 'exact'`, `head`), RPCs, view `client_summaries` calculada, e Storage simulado (Object URLs; arquivos pequenos persistidos como Data URL). Reproduz as regras dos triggers (colunas geradas, cliente/contato, CNPJ, LGPD, situação operacional, unicidades, permissões de ADMIN).
- Dados no **`sessionStorage` da aba** (`gestao-leads-demo-db-v1`): cada visitante tem sua própria cópia; fechar a aba volta ao original. Nada é compartilhado entre visitantes.
- Base fictícia em `src/lib/demoSeed.ts`, com **datas relativas a hoje**: ~28 propostas (empresas, pessoas físicas, clientes recorrentes, eventos de vários dias, fechadas/em aberto/perdidas com vários motivos e alertas de follow-up), 5 salas (Salão Imperial, Sala Executiva, Auditório Panorama, Terraço Gourmet, Sala Rubi), meios de prospecção, motivos de perda e 3 usuários: `admin@portfolio.demo` (ADMIN), `comercial@portfolio.demo` (comum), `estagio@portfolio.demo` (desativado). Senha: `demo1234`. IDs sequenciais, para links continuarem válidos depois de restaurar.
- Interface: login com botões **"🚀 Entrar como Admin (1 Clique)"** e **"👤 Entrar como Comercial (1 Clique)"**; selo **"Modo Demo · Portfólio"** na sidebar com **"Restaurar dados"**.
- Fora do modo demo, **nenhum código da demonstração entra no build** (componentes carregados com `lazy()` condicionado à comparação direta com `import.meta.env.VITE_DEMO_MODE`).
- Build: `npm run build:demo` (usa `.env.demo`). Projeto Vercel separado, **sem** variáveis do Supabase.

---

## 10. Convenções de código

- Tudo em **português**: nomes de telas, mensagens, comentários (JSDoc curto acima de funções), labels. Identificadores de código em inglês (`lead`, `client`, `status`), valores de enum em português (`em_aberto`, `fechado`, `perdido`, `a_confirmar`…).
- Datas `date` trafegam como `"YYYY-MM-DD"` (nunca `new Date()` direto, para não sofrer fuso); `timestamptz` como ISO.
- Valores monetários no formulário em **centavos** (inteiros) para evitar erro de ponto flutuante; no banco `numeric(12,2)`.
- Erros do Postgres/PostgREST traduzidos para mensagens amigáveis (`translateDbError`, `translateAuthError`, `translateStorageError`), com foco no campo do erro.
- Carregamento de dados com estado derivado de uma **chave da consulta** (sem `setState` síncrono em effect), cancelamento por `AbortController`, `leadsVersion` no contexto do Layout para recarregar listas depois de salvar.
- Confirmações de ações perigosas por `useConfirm()` (modal próprio, tons danger/warning/default).
- Tema claro/escuro com Tailwind `darkMode: 'class'`; cor de marca azul (`brand-600 #2563EB`, `brand-900 #1E3A8A`); fonte Inter.
- Layout responsivo: tabelas com rolagem horizontal (`HorizontalScrollArea`), sidebar vira menu no mobile.
- Comandos: `npm run dev`, `npm run dev:demo`, `npm run build`, `npm run build:demo`, `npm run lint`, `npm run preview`.

---

## 11. Fluxos típicos (resumo)

- **Novo pedido de orçamento:** Nova Proposta → digita telefone/e-mail/empresa → o app reconhece o cliente e mostra o histórico → escolhe "adicionar ao histórico" → marca salas, data, valores → Cadastrar. Aparece na Dashboard (solicitações do mês) e em Consultar Propostas.
- **Follow-up:** Dashboard → "Últimos leads em aberto" com selo de 7/14 dias sem atualização → botão WhatsApp (mensagem pronta com primeiro nome e salas; clique registrado) → ou atualiza a situação ali mesmo.
- **Fechamento:** Detalhes → "Fechou" → informa nº da proposta → o banco marca o evento como Confirmado → entra na planilha de Faturamento do mês do evento.
- **Pós-evento:** evento passa → fica Realizado → Faturamento: NFs e pagamento → Mailing & Pesquisas: envia pesquisa pelo WhatsApp → registra resposta e nota.
- **Campanha:** Mailing & Pesquisas → Nova campanha → escolhe segmento e canal → exporta CSV do público elegível (sem opt-out) → dispara fora do app → volta e registra enviados/entregues/abertos.
- **Gestão:** ADMIN cadastra salas/origens/motivos, ativa usuários novos, troca responsável de propostas, exclui registros.
