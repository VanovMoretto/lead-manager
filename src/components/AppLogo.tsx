import { useId } from 'react'
import { cn } from '../lib/utils'

type AppLogoSize = 'sm' | 'md' | 'lg'
type AppLogoVariant = 'default' | 'onDark'

type AppLogoProps = {
  size?: AppLogoSize
  /** `onDark` para fundos escuros ou em gradiente (textos claros). */
  variant?: AppLogoVariant
  showText?: boolean
  className?: string
}

const SIZES: Record<AppLogoSize, { mark: string; gap: string; title: string; subtitle: string }> = {
  sm: { mark: 'h-8 w-8', gap: 'gap-2.5', title: 'text-sm', subtitle: 'text-[11px]' },
  md: { mark: 'h-10 w-10', gap: 'gap-3', title: 'text-base', subtitle: 'text-xs' },
  lg: { mark: 'h-12 w-12', gap: 'gap-3.5', title: 'text-lg', subtitle: 'text-sm' },
}

function LogoMark({ className }: { className?: string }) {
  const id = useId()
  const bg = `${id}-bg`
  const shine = `${id}-shine`
  const accent = `${id}-accent`

  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1E3A8A" />
          <stop offset="1" stopColor="#2563EB" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="0" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.2" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={accent} x1="22" y1="41" x2="42" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#93C5FD" />
          <stop offset="1" stopColor="#FFFFFF" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
      <rect width="64" height="64" rx="16" fill={`url(#${shine})`} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.5">
        <rect x="15" y="18" width="34" height="31" rx="7" stroke="#FFFFFF" />
        <path d="M24 13v8M40 13v8" stroke="#FFFFFF" />
        <path d="M22 41l7-7 5 4 8-9M37.5 29H42v4.5" stroke={`url(#${accent})`} />
      </g>
    </svg>
  )
}

export default function AppLogo({ size = 'md', variant = 'default', showText = true, className }: AppLogoProps) {
  const styles = SIZES[size]
  const onDark = variant === 'onDark'

  return (
    <div className={cn('flex items-center', styles.gap, className)}>
      <span
        className={cn(
          'flex shrink-0 overflow-hidden rounded-[25%]',
          styles.mark,
          onDark ? 'shadow-lg shadow-black/20 ring-1 ring-white/25' : 'shadow-sm shadow-brand-900/20',
        )}
      >
        <LogoMark className="h-full w-full" />
      </span>
      {showText && (
        <div className="leading-tight">
          <p className={cn('font-bold tracking-tight', styles.title, onDark ? 'text-white' : 'text-slate-900 dark:text-white')}>
            Gestão de Leads
          </p>
          <p className={cn('font-medium', styles.subtitle, onDark ? 'text-brand-100' : 'text-slate-500 dark:text-slate-400')}>
            Eventos &amp; Propostas
          </p>
        </div>
      )}
    </div>
  )
}
