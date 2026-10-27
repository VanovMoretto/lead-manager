import { BellOff, Building2, Check, GitBranchPlus, LoaderCircle, UserPlus, UserRound } from 'lucide-react'
import type { ClientBranch, ClientLinkChoice, ClientMatchReason, RecurringClientMatch } from '../hooks/useRecurringClient'
import { describeBranch } from '../lib/clientIdentity'
import { formatBRL, formatDateBR } from '../lib/format'
import { toLocalISODate } from '../lib/dashboard'
import { getLeadRooms } from '../lib/leadFields'
import { cn } from '../lib/utils'
import { LEAD_STATUS_LABELS, type ClientContact } from '../types/lead'

type RecurringClientNoticeProps = {
  checking: boolean
  match: RecurringClientMatch | null
  /** O contato pediu opt-out de comunicações (LGPD). */
  suppressed: boolean
  /** Escolha atual para o cliente reconhecido. */
  choice: ClientLinkChoice | null
  /** Vínculo já decidido (proposta aberta pela página do cliente): sem a pergunta Sim/Não. */
  locked?: boolean
  onLinkChange: (link: boolean) => void
  /** Contato existente escolhido, ou null para "novo contato". */
  onSelectContact: (contact: ClientContact | null) => void
  /** Braço da empresa escolhido (marca com mais de um CNPJ). */
  onSelectBranch: (branch: ClientBranch) => void
  /** "+ Outro CNPJ / Novo braço da empresa". */
  onNewBranch: () => void
}

/** Avisos do cadastro: cliente já cadastrado (com a escolha de histórico) e opt-out da LGPD do contato. */
export default function RecurringClientNotice({
  checking,
  match,
  suppressed,
  choice,
  locked = false,
  onLinkChange,
  onSelectContact,
  onSelectBranch,
  onNewBranch,
}: RecurringClientNoticeProps) {
  if (!checking && !match && !suppressed) return null

  return (
    <div className="space-y-2">
      {checking && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500" aria-live="polite">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Verificando histórico do cliente...
        </p>
      )}

      {suppressed && !checking && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-500 text-white">
            <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="leading-snug">
            <p>
              <strong className="font-semibold">Opt-out LGPD:</strong> este contato pediu para não receber comunicações/mailing.
            </p>
            <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
              O opt-out será aplicado automaticamente a este lead. Não envie campanhas nem mensagens de marketing.
            </p>
          </div>
        </div>
      )}

      {match && choice && (
        <ClientMatchCard
          match={match}
          choice={choice}
          locked={locked}
          onLinkChange={onLinkChange}
          onSelectContact={onSelectContact}
          onSelectBranch={onSelectBranch}
          onNewBranch={onNewBranch}
        />
      )}
    </div>
  )
}

function reasonsText(match: RecurringClientMatch): string {
  const labels: Record<ClientMatchReason, string> = {
    cnpj: 'CNPJ',
    email: 'e-mail',
    phone: 'telefone',
    company: 'nome da empresa',
    domain: `domínio @${match.client.email_domain ?? ''}`,
  }
  const parts = match.reasons.map((reason) => labels[reason])
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}` : (parts[0] ?? '')
}

type ClientMatchCardProps = {
  match: RecurringClientMatch
  choice: ClientLinkChoice
  locked: boolean
  onLinkChange: (link: boolean) => void
  onSelectContact: (contact: ClientContact | null) => void
  onSelectBranch: (branch: ClientBranch) => void
  onNewBranch: () => void
}

function ClientMatchCard({ match, choice, locked, onLinkChange, onSelectContact, onSelectBranch, onNewBranch }: ClientMatchCardProps) {
  const isCompany = match.client.client_type === 'company'
  // Marca com mais de um CNPJ: a pergunta passa a ser em qual braço entra
  const showBranches = !locked && isCompany && match.branches.length > 1
  const branchText = describeBranch(match.client)
  const Icon = isCompany ? Building2 : UserRound
  const target = isCompany ? 'da empresa' : 'do cliente'
  const { last } = match
  const lastRooms = last ? getLeadRooms(last) : []

  return (
    <section
      aria-label="Cliente já cadastrado"
      className="overflow-hidden rounded-xl border border-brand-200 bg-brand-50/60 text-sm text-slate-700 dark:border-brand-900/60 dark:bg-brand-900/15 dark:text-slate-200"
    >
      <div className="flex items-start gap-3 px-3.5 pt-3.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-900 to-brand-600 text-white shadow-sm">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 leading-snug">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
            {locked ? 'Proposta para o cliente' : isCompany ? 'Empresa já cadastrada' : 'Cliente já cadastrado'}
          </p>
          <p className="truncate text-base font-semibold text-slate-900 dark:text-white">{match.client.name}</p>
          {branchText && <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{branchText}</p>}
          {match.reasons.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Reconhecido pelo {reasonsText(match)}.</p>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 px-3.5 pt-3">
        <Stat label="Propostas" value={String(match.count)} />
        <Stat label="Fechadas" value={String(match.closedCount)} />
        <Stat label="Receita gerada" value={formatBRL(match.closedRevenue)} />
      </dl>

      {last && (
        <p className="px-3.5 pt-2 text-xs text-slate-500 dark:text-slate-400">
          Última proposta em{' '}
          <strong className="font-semibold text-slate-700 dark:text-slate-200">
            {formatDateBR(toLocalISODate(new Date(last.created_at)))}
          </strong>{' '}
          ({lastRooms.length > 0 ? lastRooms.join(', ') : 'sem sala definida'} - {LEAD_STATUS_LABELS[last.status]}).
        </p>
      )}

      {!choice.link && match.contacts.length > 0 && (
        <p className="px-3.5 pt-2 text-xs text-slate-500 dark:text-slate-400">
          Contatos anteriores: {match.contacts.map((contact) => contact.name).join(', ')}.
        </p>
      )}

      <div className="mt-3 border-t border-brand-200/70 px-3.5 py-3 dark:border-brand-900/50">
        {locked ? (
          <p className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-white">
            <Check className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
            Esta proposta entra no histórico {target} <span className="font-semibold">{match.client.name}</span>.
          </p>
        ) : showBranches ? (
          <>
            <p className="font-medium text-slate-900 dark:text-white">
              Adicionar ao histórico de qual braço {target} <span className="font-semibold">{match.client.name}</span>?
            </p>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Braço da empresa">
              {match.branches.map((branch) => (
                <ContactOption
                  key={branch.id}
                  selected={choice.link && branch.id === match.client.id}
                  onClick={() => onSelectBranch(branch)}
                  title={branch.branch_label ? `${branch.name} (${branch.branch_label})` : branch.name}
                  detail={branch.cnpj ?? 'CNPJ não informado'}
                />
              ))}
              <ContactOption
                selected={!choice.link}
                onClick={onNewBranch}
                title="+ Outro CNPJ / Novo braço"
                detail="Filial ou franquia ainda não cadastrada"
                icon={GitBranchPlus}
              />
            </div>
          </>
        ) : (
          <>
            <p className="font-medium text-slate-900 dark:text-white">
              Adicionar ao histórico {target} <span className="font-semibold">{match.client.name}</span>?
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label={`Adicionar ao histórico ${target}`}>
              <ChoiceButton selected={choice.link} onClick={() => onLinkChange(true)}>
                Sim, adicionar ao histórico
              </ChoiceButton>
              <ChoiceButton selected={!choice.link} onClick={() => onLinkChange(false)}>
                Não, criar cadastro separado
              </ChoiceButton>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300" aria-live="polite">
              <Check className={cn('h-3.5 w-3.5', choice.link ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')} aria-hidden="true" />
              {choice.link
                ? `Ao salvar, a proposta entra no histórico ${target} ${match.client.name}${match.client.cnpj ? ` (CNPJ ${match.client.cnpj})` : ''}.`
                : 'Ao salvar, a proposta cria um cadastro novo, separado deste.'}
            </p>
          </>
        )}

        {choice.link && match.contacts.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
              {isCompany ? 'Quem da empresa está pedindo esta proposta?' : 'Quem está pedindo esta proposta?'}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2" role="radiogroup" aria-label="Pessoa de contato">
              {match.contacts.map((contact) => (
                <ContactOption
                  key={contact.id}
                  selected={choice.contactId === contact.id}
                  onClick={() => onSelectContact(contact)}
                  title={contact.name}
                  detail={[contact.role, contact.phone, contact.email].filter(Boolean).join(' · ')}
                />
              ))}
              <ContactOption
                selected={choice.contactId === null}
                onClick={() => onSelectContact(null)}
                title="Novo contato"
                detail={isCompany ? 'Outra pessoa da empresa' : 'Outra pessoa'}
                icon={UserPlus}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-white/80 px-2.5 py-2 ring-1 ring-brand-100 dark:bg-slate-900/50 dark:ring-brand-900/40">
      <dt className="text-[11px] text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="truncate font-semibold text-slate-900 tabular-nums dark:text-white">{value}</dd>
    </div>
  )
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        selected
          ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
      )}
    >
      {selected && <Check className="h-4 w-4" aria-hidden="true" />}
      {children}
    </button>
  )
}

type ContactOptionProps = { selected: boolean; onClick: () => void; title: string; detail: string; icon?: typeof UserPlus }

function ContactOption({ selected, onClick, title, detail, icon: Icon }: ContactOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex max-w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        selected
          ? 'border-brand-600 bg-white ring-1 ring-brand-600 dark:bg-slate-900'
          : 'border-slate-200 bg-white/70 hover:border-brand-300 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-brand-700',
      )}
    >
      {Icon ? (
        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
      ) : (
        <span
          className={cn(
            'mt-1 h-2.5 w-2.5 shrink-0 rounded-full border',
            selected ? 'border-brand-600 bg-brand-600' : 'border-slate-300 dark:border-slate-600',
          )}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        {detail && <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{detail}</span>}
      </span>
    </button>
  )
}
