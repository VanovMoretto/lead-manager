# Gestão de Leads e Orçamentos de Eventos

Micro-CRM para equipes comerciais de espaços de eventos: cadastro rápido de leads, acompanhamento de propostas, follow-up e indicadores de conversão.

**Demo:** https://vanovmoretto.github.io/lead-manager/ (acesso com usuário cadastrado no Supabase)

## Funcionalidades

- **Cadastro de leads com baixa fricção**: só o nome é obrigatório; telefone com máscara, empresa (vazio = pessoa física, com sugestão das empresas já cadastradas), várias salas de interesse, evento de um ou mais dias (ou só a previsão), valores de locação, A&B e hospedagem com a receita total calculada na hora.
- **Detalhes do lead**: ao clicar em um lead, abre uma página com todos os dados, ações rápidas (Fechou / Perdeu), observações da negociação com salvamento rápido e anexos das propostas de Locação e de A&B (PDF, DOC, DOCX, PNG ou JPG de até 10 MB, guardados em bucket privado do Supabase Storage).
- **Cliente recorrente**: ao digitar telefone ou e-mail, o sistema avisa se o cliente já fez orçamentos anteriores.
- **Funil comercial**: situação em aberto, fechado ou perdido, com número de proposta obrigatório no fechamento e motivo obrigatório na perda.
- **Dashboard**: solicitações recebidas, propostas enviadas, taxa de conversão, taxa de perda, composição dos valores, evolução no período, ranking dos motivos de perda e demanda por sala e por meio de prospecção.
- **Consulta de leads**: filtros por período (o filtro por data do evento considera eventos de vários dias), situação, proposta, sala, meio de prospecção, empresa (uma empresa, só empresas ou só pessoa física), motivo de recusa e busca por texto, com ordenação e paginação.
- **Follow-up pelo WhatsApp**: botão com mensagem pronta, personalizada com o nome do cliente e as salas de interesse.
- **Exportações**: Excel completo com totais (data de criação como data pura), mailing CSV sem contatos duplicados e relatório PDF com resumo dos filtros. Antes de baixar, uma pré-visualização mostra o resumo e as primeiras linhas do arquivo.
- **LGPD**: opt-out de comunicações por contato. Marcar em um lead vale para todos os leads com o mesmo e-mail ou telefone, inclusive os futuros, e continua valendo depois da exclusão (lista de supressão no banco). O contato nunca sai no mailing, e o cadastro avisa quando o cliente pediu opt-out. Inclui exclusão definitiva de leads.
- **Painel Admin**: cadastro das salas, meios de prospecção e motivos de perda, sem alterar código, e gestão de usuários (ativar/desativar acesso e definir quem é administrador).
- **Login e perfil**: "Manter-me logado", "Lembrar meu usuário" (guarda só o usuário; a senha fica com o gerenciador de senhas do navegador), "Esqueci minha senha" por e-mail, troca de senha e foto de perfil.
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
2. **Projeto já existente**: rode as migrações de `supabase/migrations/` em ordem (002 a 008). Todas podem ser executadas mais de uma vez sem duplicar dados. A 007 cria os perfis de usuário (copiando os ADMINs da antiga tabela `app_admins`), a coluna de observações, a tabela de anexos e os buckets privados `lead-attachments` e `avatars` do Storage. A 008 adiciona o limite de 20 leads por minuto por usuário e o tamanho máximo dos campos de texto.
3. **Recuperação de senha**: em Authentication → URL Configuration, inclua em *Redirect URLs* o endereço da tela de nova senha, por exemplo `https://vanovmoretto.github.io/lead-manager/redefinir-senha` e `http://localhost:5173/redefinir-senha`.
4. **Dados de teste (opcional)**: `supabase/seed_leads_teste.sql` cria 11 leads fictícios, que podem ser removidos com o comando indicado no próprio arquivo.

## Usuários e papéis

Os usuários são **criados no Supabase**; o acesso e a permissão de cada um são ajustados no Painel Admin.

- **Criar usuário**: Authentication → Users → Add user, com o e-mail `nome.sobrenome@swanhoteis.com.br`. No login, basta digitar `nome.sobrenome`: o app completa o domínio. Quem usa outro domínio digita o e-mail completo. O perfil é criado automaticamente como usuário comum ativo.
- **Ativar, desativar ou tornar ADMIN**: Painel Admin → Usuários. Usuário desativado é desconectado e não lê nem grava nenhum dado (a regra está no banco). Ninguém altera o próprio acesso, o que evita ficar sem administrador.
- **Mudar e-mail ou usuário**: edite o e-mail do usuário em Authentication → Users. O nome exibido no app é a parte antes do `@`.
- **Remover de vez**: exclua o usuário em Authentication → Users (o perfil sai junto).

### Papéis

| Ação | Usuário | ADMIN |
| --- | --- | --- |
| Ver, criar e editar leads, observações e anexos | ✓ | ✓ |
| Excluir leads e anexos | | ✓ |
| Painel Admin (opções dos formulários e usuários) | | ✓ |

As regras ficam no banco (políticas de RLS com `public.is_admin()` e `public.is_active_user()`, a partir da tabela `public.user_profiles`); a interface apenas esconde o que o usuário não pode fazer. O primeiro ADMIN, se ainda não houver nenhum, é definido no SQL Editor:

```sql
update public.user_profiles set is_admin = true, is_active = true
where email = 'admin@suaempresa.com.br';
```

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

- Todas as tabelas usam Row Level Security: somente usuários autenticados e com acesso ativo leem e gravam dados.
- Anexos e fotos de perfil ficam em buckets privados do Supabase Storage e são abertos por links temporários. Cada usuário só envia foto para a própria pasta; anexos só entram na pasta de um lead existente.
- A chave usada no front-end é a chave pública (anon/publishable) do Supabase; a proteção dos dados vem das políticas do banco. Nunca use a chave `service_role` no front-end.
- As exportações neutralizam textos que poderiam ser interpretados como fórmulas no Excel.
- Login com freio contra força bruta: após 5 falhas seguidas o navegador bloqueia novas tentativas por 30 s, e cada nova falha depois disso dobra a espera (60 s, 120 s...). "Esqueci minha senha" só pode ser pedido a cada 60 s.
- Captcha opcional com Cloudflare Turnstile: defina `VITE_TURNSTILE_SITE_KEY` no `.env` e ative o CAPTCHA em Supabase → Authentication → Attack Protection com a chave secreta. Sem a variável, o widget não aparece.
- Senhas com no mínimo 8 caracteres, letras e números (o Supabase Auth guarda só o hash bcrypt). Nenhuma senha é salva no navegador pelo app.
- Ações de gravação repetidas em menos de 1,5 s (duplo clique) são ignoradas, e consultas antigas são canceladas ao trocar de filtro ou de página.
- No banco: no máximo 20 leads por minuto por usuário, autoria sempre do usuário logado e limite de tamanho nos campos de texto, valendo mesmo para chamadas diretas à API.
- Anexos validados por extensão, tipo e assinatura do arquivo no navegador, e por tipo e tamanho no banco e no Storage.
- Cabeçalhos HTTP de segurança (CSP, HSTS, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy`) em `vercel.json` e `public/_headers` (Cloudflare Pages / Netlify). O GitHub Pages não permite cabeçalhos personalizados, então eles só valem nessas plataformas.

## Estrutura

```
src/
  components/   Layout, formulário de lead e componentes compartilhados
  contexts/     Autenticação e tema
  hooks/        Opções do Painel Admin, cliente recorrente, empresas e fotos de perfil
  lib/          Cliente Supabase, consultas, formatação, exportações, anexos e WhatsApp
  pages/        Login, nova senha, Dashboard, Consulta e Detalhes do lead, Perfil e Painel Admin
  types/        Tipos do domínio e do banco
supabase/
  schema.sql    Estrutura completa do banco
  migrations/   Alterações incrementais
```
