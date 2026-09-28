import { cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

const listRowVariants = cva('flex min-w-0 items-center gap-3 border-b border-line text-sm text-foreground last:border-b-0', {
  variants: {
    size: {
      sm: 'min-h-9 py-1',
      md: 'min-h-11 py-1.5',
      lg: 'min-h-14 py-2',
    },
    /** Hover wash + focus ring + pointer. Rows gain a little inline padding so the wash does not touch the text. */
    interactive: {
      true: 'w-full cursor-pointer px-2 text-left transition-colors outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
      false: '',
    },
  },
  defaultVariants: {
    size: 'md',
    interactive: false,
  },
})

interface ListRowProps extends ComponentProps<'div'>, VariantProps<typeof listRowVariants> {
  /** Checkbox, thumbnail, icon… (does not shrink). */
  leading?: ReactNode
  /** Count, status, row actions… (does not shrink, right aligned). */
  trailing?: ReactNode
  /** Current / selected row: subtle primary wash (also sets data-selected). */
  selected?: boolean
  /**
   * Render the single child element (a `<button>`, `<a>`, router `Link`, `<li>`) as the row. Its own children become
   * the main slot between `leading` and `trailing`.
   */
  asChild?: boolean
}

/**
 * Generic flat list row: hairline below (none on the last row), leading / main / trailing slots. Stack rows directly
 * in a container without `space-y-*` (or a `RowGroup`) so the hairlines touch.
 */
function ListRow({ leading, trailing, selected, size, interactive, asChild = false, className, children, ...props }: ListRowProps) {
  const rowClassName = cn(
    listRowVariants({ size, interactive }),
    selected && 'bg-primary/8 hover:bg-primary/12',
    className,
  )
  const renderSlots = (main: ReactNode) => (
    <>
      {leading ? <span data-slot="list-row-leading" className="flex shrink-0 items-center">{leading}</span> : null}
      <span data-slot="list-row-main" className="flex min-w-0 flex-1 items-center gap-3">{main}</span>
      {trailing ? <span data-slot="list-row-trailing" className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">{trailing}</span> : null}
    </>
  )

  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ children?: ReactNode }>

    return (
      <Slot.Root data-slot="list-row" data-selected={selected ? 'true' : undefined} className={rowClassName} {...props}>
        {cloneElement(child, undefined, renderSlots(child.props.children))}
      </Slot.Root>
    )
  }

  return (
    <div data-slot="list-row" data-selected={selected ? 'true' : undefined} className={rowClassName} {...props}>
      {renderSlots(children)}
    </div>
  )
}

export { ListRow, listRowVariants }
export type { ListRowProps }
