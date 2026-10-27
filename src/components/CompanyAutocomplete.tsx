import { useId, useMemo, useState, type KeyboardEvent } from 'react'
import { Building2 } from 'lucide-react'
import type { CompanyOption } from '../hooks/useCompanies'
import { cn } from '../lib/utils'

const MAX_SUGGESTIONS = 8

/** Sem acento e em minúsculas, para "cafe" encontrar "Café". */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim()
}

type CompanyAutocompleteProps = {
  id: string
  value: string
  options: CompanyOption[]
  onChange: (value: string) => void
  /** Empresa escolhida na lista (com o braço e o CNPJ, quando houver). */
  onSelect: (option: CompanyOption) => void
  className: string
  placeholder?: string
  maxLength?: number
  describedBy?: string
}

/** Campo Empresa com sugestões das empresas já cadastradas (nome, braço e CNPJ). */
export default function CompanyAutocomplete({
  id,
  value,
  options,
  onChange,
  onSelect,
  className,
  placeholder,
  maxLength,
  describedBy,
}: CompanyAutocompleteProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const suggestions = useMemo(() => {
    const term = normalize(value)
    if (!term) return []
    const digits = term.replace(/\D/g, '')
    // Encontra pelo nome, pelo braço ("filial centro") ou por parte do CNPJ
    const matches = options.filter(
      (option) =>
        normalize(option.name).includes(term) ||
        (option.branch_label && normalize(option.branch_label).includes(term)) ||
        (digits.length >= 3 && option.cnpj?.replace(/\D/g, '').includes(digits)),
    )
    // Quem começa com o texto digitado vem primeiro
    matches.sort((a, b) => {
      const aStarts = normalize(a.name).startsWith(term) ? 0 : 1
      const bStarts = normalize(b.name).startsWith(term) ? 0 : 1
      return aStarts - bStarts || a.name.localeCompare(b.name, 'pt-BR')
    })
    // Já digitou exatamente uma empresa sem braços: não precisa sugerir
    if (matches.length === 1 && normalize(matches[0].name) === term && !matches[0].cnpj) return []
    return matches.slice(0, MAX_SUGGESTIONS)
  }, [value, options])

  const expanded = open && suggestions.length > 0
  const active = Math.min(activeIndex, suggestions.length - 1)

  const choose = (option: CompanyOption) => {
    onSelect(option)
    setOpen(false)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!expanded) {
      if (event.key === 'ArrowDown' && suggestions.length > 0) setOpen(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((active + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((active - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter') {
      // Enter escolhe a sugestão em vez de enviar o formulário
      event.preventDefault()
      choose(suggestions[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        maxLength={maxLength}
        placeholder={placeholder}
        value={value}
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded ? `${listId}-${active}` : undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange(event.target.value)
          setActiveIndex(0)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className={className}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Empresas cadastradas"
          className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {suggestions.map((option, index) => (
            <li
              key={option.id ?? option.name}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown: escolhe antes do campo perder o foco
              onMouseDown={(event) => {
                event.preventDefault()
                choose(option)
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                'flex cursor-pointer items-start gap-2 px-3 py-2 text-sm',
                index === active ? 'bg-brand-50 dark:bg-brand-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800',
              )}
            >
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900 dark:text-white">
                  {option.name}
                  {option.branch_label && <span className="font-normal text-slate-500 dark:text-slate-400"> · {option.branch_label}</span>}
                </span>
                {option.cnpj && <span className="block text-xs tabular-nums text-slate-500 dark:text-slate-400">CNPJ {option.cnpj}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
