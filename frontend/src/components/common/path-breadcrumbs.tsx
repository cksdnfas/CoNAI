import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DropTarget } from '@/lib/use-drop-target'
import { cn } from '@/lib/utils'

export type PathCrumb = {
  key: string
  label: string
  onClick: () => void
  /** Opt in as a drop target: the id `useDropTarget` reports for this step. Takes effect with PathBreadcrumbs `dropTarget`. */
  dropId?: string
}

/**
 * A folder path for the page toolbar: each step opens that folder, the last one (where you are) in bold.
 * With `dropTarget` (the page's `useDropTarget`), the bar handles the drag events and each step that has a `dropId` takes drops.
 */
export function PathBreadcrumbs({ items, ariaLabel, className, dropTarget }: { items: PathCrumb[]; ariaLabel: string; className?: string; dropTarget?: DropTarget }) {
  return (
    <nav aria-label={ariaLabel} className={cn('flex min-w-0 flex-wrap items-center gap-0.5 text-sm', className)} {...dropTarget?.containerProps}>
      {items.map((item, index) => {
        const button = (
          <Button variant="ghost" size="sm" className="max-w-48" aria-current={index === items.length - 1 ? 'location' : undefined} onClick={item.onClick}>
            <span className="truncate">{item.label}</span>
          </Button>
        )

        return (
          <span key={item.key} className="inline-flex min-w-0 items-center">
            {index === 0 ? null : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
            {dropTarget && item.dropId !== undefined ? (
              // Same drop look as a navigation row (SidebarItem, Button nav); the ghost button has none of its own.
              <span
                {...dropTarget.getTargetAttributes(item.dropId)}
                className="inline-flex min-w-0 rounded-sm data-[drop-target=true]:bg-primary/20 data-[drop-target=true]:ring-2 data-[drop-target=true]:ring-primary/60"
              >
                {button}
              </span>
            ) : button}
          </span>
        )
      })}
    </nav>
  )
}
