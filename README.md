# Gestão de Leads e Orçamentos de Eventos

Micro-CRM para equipes comerciais de espaços de eventos: cadastro rápido de leads, acompanhamento de propostas, follow-up e indicadores de conversão.

**Demo:** https://vanovmoretto.github.io/lead-manager/ (acesso com usuário cadastrado no Supabase)

## Funcionalidades

- **Cadastro de leads com baixa fricção**: só o nome é obrigatório; telefone com máscara, várias salas de interesse, data ou previsão, valores de locação, A&B e hospedagem com valor global calculado na hora.
- **Cliente recorrente**: ao digitar telefone ou e-mail, o sistema avisa se o cliente já fez orçamentos anteriores.
- **Funil comercial**: situação em aberto, fechado ou perdido, com número de proposta obrigatório no fechamento e motivo obrigatório na perda.
- **Dashboard**: solicitações recebidas, propostas enviadas, taxa de conversão, taxa de perda, composição dos valores, evolução no período, ranking dos motivos de perda e demanda por sala e por meio de prospecção.
- **Consulta de leads**: filtros por período, situação, proposta, sala, meio de prospecção, motivo de recusa e busca por texto, com ordenação e paginação.
- **Follow-up pelo WhatsApp**: botão com mensagem pronta, personalizada com o nome do cliente e as salas de interesse.
- **Exportações**: Excel completo com totais, mailing CSV sem contatos duplicados e relatório PDF com resumo dos filtros.
- **LGPD**: opt-out de comunicações por lead (o contato sai do mailing) e exclusão definitiva de leads.
- **Painel Admin**: cadastro das salas, meios de prospecção e motivos de perda, sem alterar código.
- **Tema claro e escuro** e layout responsivo.

## Tecnologias

React 19, TypeScript, Vite, Tailwind CSS, React Router, Supabase (Postgres, Auth e Row Level Security), Recharts, SheetJS, jsPDF e Lucide.

## Como rodar localmente

Pré-requisitos: Node.js 20+ e um projeto no [Supabase](https://supabase.com).

```bash
git clone https://github.com/VanovMoretto/lead-manager.git
cd lead-manager
npm install
```

Crie o arquivo `.env` a partir do exemplo e preencha com os dados do seu projeto (Supabase → Project Settings → API):

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon-ou-publishable
```

Inicie o servidor de desenvolvimento:

```bash
npm run dev
```

## Banco de dados

No SQL Editor do Supabase:

1. **Projeto novo**: rode `supabase/schema.sql`. Ele cria as tabelas, as políticas de acesso (apenas usuários autenticados) e os motivos de perda padrão.
2. **Projeto já existente**: rode as migrações de `supabase/migrations/` em ordem. Todas podem ser executadas mais de uma vez sem duplicar dados.
3. **Dados de teste (opcional)**: `supabase/seed_leads_teste.sql` cria 11 leads fictícios, que podem ser removidos com o comando indicado no próprio arquivo.

Depois, crie os usuários da equipe em **Authentication → Users → Add user**.

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Verificação de tipos e build de produção |
| `npm run lint` | Análise estática do código |
| `npm run preview` | Pré-visualização do build |
| `npm run deploy` | Build para o GitHub Pages e publicação na branch `gh-pages` |

## Deploy

### GitHub Pages

```bash
npm run deploy
```

O build é gerado com o prefixo `/lead-manager/` e publicado na branch `gh-pages`. Uma cópia do `index.html` como `404.html` garante que atualizar a página em qualquer rota continue funcionando. As variáveis do `.env` são incorporadas no build.

### Vercel, Netlify ou Cloudflare Pages

Use `npm run build` com a pasta `dist`. Os arquivos `vercel.json` e `public/_redirects` já fazem o redirecionamento de rotas para o `index.html`. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` nas variáveis de ambiente da plataforma.

## Segurança

- Todas as tabelas usam Row Level Security: somente usuários autenticados leem e gravam dados.
- A chave usada no front-end é a chave pública (anon/publishable) do Supabase; a proteção dos dados vem das políticas do banco. Nunca use a chave `service_role` no front-end.
- As exportações neutralizam textos que poderiam ser interpretados como fórmulas no Excel.

## Estrutura

```
src/
  components/   Layout, formulário de lead e componentes compartilhados
  contexts/     Autenticação e tema
  hooks/        Opções do Painel Admin e detecção de cliente recorrente
  lib/          Cliente Supabase, consultas, formatação, exportações e WhatsApp
  pages/        Login, Dashboard, Consulta de Leads e Painel Admin
  types/        Tipos do domínio e do banco
supabase/
  schema.sql    Estrutura completa do banco
  migrations/   Alterações incrementais
```
