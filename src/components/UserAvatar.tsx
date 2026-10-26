import { useAvatarUrl } from '../hooks/useAvatarUrl'
import { cn } from '../lib/utils'

type UserAvatarProps = {
  /** Caminho da foto no bucket `avatars`. Sem foto, mostra a inicial do nome. */
  path: string | null | undefined
  name: string
  className?: string
}

export default function UserAvatar({ path, name, className }: UserAvatarProps) {
  const url = useAvatarUrl(path)

  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold uppercase text-slate-600',
        'dark:bg-slate-800 dark:text-slate-300',
        className,
      )}
    >
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : name.charAt(0) || '?'}
    </span>
  )
}
