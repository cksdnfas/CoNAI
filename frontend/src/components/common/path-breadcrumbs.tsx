import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type PathCrumb = { key: string; label: string; onClick: () => void }

/** A folder path for the page toolbar: each step opens that folder, the last one (where you are) in bold. */
export function PathBreadcrumbs({ items, ariaLabel, className }: { items: PathCrumb[]; ariaLabel: string; className?: string }) {
  return (
    <nav aria-label={ariaLabel} className={cn('flex min-w-0 flex-wrap items-center gap-0.5 text-sm', className)}>
      {items.map((item, index) => (
        <span key={item.key} className="inline-flex min-w-0 items-center">
          {index === 0 ? null : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
          <Button variant="ghost" size="sm" className="max-w-48" aria-current={index === items.length - 1 ? 'location' : undefined} onClick={item.onClick}>
            <span className="truncate">{item.label}</span>
          </Button>
        </span>
      ))}
    </nav>
  )
}
