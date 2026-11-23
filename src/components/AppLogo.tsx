import { cn } from '../lib/utils'

type AppLogoSize = 'sm' | 'md' | 'lg'
type AppLogoVariant = 'default' | 'onDark'

type AppLogoProps = {
  size?: AppLogoSize
  /** `onDark` para a barra lateral e fundos azul-marinho (textos claros). */
  variant?: AppLogoVariant
  showText?: boolean
  /** Mostra o descritor "Do orçamento ao faturamento" abaixo do nome. */
  showTagline?: boolean
  className?: string
}

const SIZES: Record<AppLogoSize, { mark: string; gap: string; title: string; tagline: string }> = {
  sm: { mark: 'h-7 w-7', gap: 'gap-2', title: 'text-base', tagline: 'text-[11px]' },
  md: { mark: 'h-8 w-8', gap: 'gap-2.5', title: 'text-lg', tagline: 'text-xs' },
  lg: { mark: 'h-10 w-10', gap: 'gap-3', title: 'text-2xl', tagline: 'text-sm' },
}

export const APP_NAME = 'Verto'
export const APP_TAGLINE = 'Do orçamento ao faturamento do evento'

/** Símbolo do Verto: um V com a haste direita um pouco mais alta. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="7" fill="#2563EB" />
      <path
        d="M9 8.5 15.5 23.5 23.5 6.5"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function AppLogo({
  size = 'md',
  variant = 'default',
  showText = true,
  showTagline = false,
  className,
}: AppLogoProps) {
  const styles = SIZES[size]
  const onDark = variant === 'onDark'

  return (
    <div className={cn('flex items-center', styles.gap, className)}>
      <LogoMark className={cn('shrink-0', styles.mark)} />
      {showText && (
        <div className="leading-tight">
          <p
            className={cn(
              'font-semibold tracking-[-0.02em]',
              styles.title,
              onDark ? 'text-white' : 'text-slate-900 dark:text-white',
            )}
          >
            {APP_NAME}
          </p>
          {showTagline && (
            <p className={cn('mt-0.5', styles.tagline, onDark ? 'text-rail-muted' : 'text-slate-500 dark:text-slate-400')}>
              {APP_TAGLINE}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
