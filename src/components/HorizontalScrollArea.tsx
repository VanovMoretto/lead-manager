import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, MoveHorizontal } from 'lucide-react'

type ScrollMetrics = { scrollWidth: number; clientWidth: number; scrollLeft: number; scrollbarWidth: number }

const readMetrics = (body: HTMLDivElement): ScrollMetrics => ({
  scrollWidth: body.scrollWidth,
  clientWidth: body.clientWidth,
  scrollLeft: body.scrollLeft,
  // A barra vertical da tabela ocupa largura que a barra de cima não tem
  scrollbarWidth: body.offsetWidth - body.clientWidth,
})

/**
 * Tabela larga com rolagem lateral acessível no topo (barra espelhada e setas) e altura
 * limitada à tela, para a barra de baixo também ficar sempre visível.
 */
export default function HorizontalScrollArea({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const topRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<ScrollMetrics>({ scrollWidth: 0, clientWidth: 0, scrollLeft: 0, scrollbarWidth: 0 })

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const observer = new ResizeObserver(() => setMetrics(readMetrics(body)))
    observer.observe(body)
    if (body.firstElementChild) observer.observe(body.firstElementChild)
    return () => observer.disconnect()
  }, [])

  const overflowing = metrics.scrollWidth > metrics.clientWidth + 1
  const atStart = metrics.scrollLeft <= 1
  const atEnd = metrics.scrollLeft >= metrics.scrollWidth - metrics.clientWidth - 1

  const handleBodyScroll = () => {
    const body = bodyRef.current
    if (!body) return
    if (topRef.current && topRef.current.scrollLeft !== body.scrollLeft) topRef.current.scrollLeft = body.scrollLeft
    setMetrics(readMetrics(body))
  }

  const handleTopScroll = () => {
    const top = topRef.current
    const body = bodyRef.current
    if (top && body && body.scrollLeft !== top.scrollLeft) body.scrollLeft = top.scrollLeft
  }

  const scrollStep = (direction: 1 | -1) => {
    const body = bodyRef.current
    if (body) body.scrollBy({ left: direction * Math.max(body.clientWidth * 0.6, 240), behavior: 'smooth' })
  }

  const arrowClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:bg-white disabled:hover:text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-brand-900/30 dark:hover:text-brand-200 dark:disabled:hover:bg-slate-900'

  return (
    <div className={className}>
      {overflowing && (
        <div className="border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3 px-5 py-2">
            <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <MoveHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Mais colunas ao lado: use as setas ou a barra abaixo.
            </p>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => scrollStep(-1)} disabled={atStart} aria-label="Ver colunas à esquerda" className={arrowClass}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => scrollStep(1)} disabled={atEnd} aria-label="Ver colunas à direita" className={arrowClass}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div ref={topRef} onScroll={handleTopScroll} aria-hidden="true" className="overflow-x-auto overflow-y-hidden">
            <div style={{ width: metrics.scrollWidth + metrics.scrollbarWidth, height: 1 }} />
          </div>
        </div>
      )}
      <div
        ref={bodyRef}
        onScroll={handleBodyScroll}
        role="region"
        aria-label={label}
        tabIndex={0}
        className="max-h-[calc(100vh-7rem)] overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600"
      >
        {children}
      </div>
    </div>
  )
}
